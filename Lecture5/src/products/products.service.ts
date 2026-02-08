import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Product } from '../entities/product.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { SearchProductsDto } from './dto/search-products.dto';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    private readonly dataSource: DataSource,
  ) {}

  async create(createProductDto: CreateProductDto): Promise<Product> {
    const product = this.productRepository.create(createProductDto);
    return this.productRepository.save(product);
  }

  async findAll(): Promise<Product[]> {
    return this.productRepository.find();
  }

  async findAvailable(): Promise<Product[]> {
    return this.productRepository.find({
      where: { isAvailable: true },
    });
  }

  async findByCategory(category: string): Promise<Product[]> {
    return this.productRepository.find({ where: { category } });
  }

  async search(dto: SearchProductsDto): Promise<{
    data: Product[];
    total: number;
    explain?: string;
  }> {
    const qb = this.productRepository.createQueryBuilder('p');

    if (dto.search) {
      qb.andWhere('p.name ILIKE :search', { search: `%${dto.search}%` });
    }

    if (dto.category) {
      qb.andWhere('p.category = :category', { category: dto.category });
    }

    if (dto.minPrice !== undefined) {
      qb.andWhere('p.price >= :minPrice', { minPrice: dto.minPrice });
    }
    if (dto.maxPrice !== undefined) {
      qb.andWhere('p.price <= :maxPrice', { maxPrice: dto.maxPrice });
    }

    if (dto.isAvailable !== undefined) {
      qb.andWhere('p.isAvailable = :isAvailable', {
        isAvailable: dto.isAvailable,
      });
    }

    const sortBy = dto.sortBy || 'createdAt';
    const sortOrder = dto.sortOrder || 'DESC';
    qb.orderBy(`p.${sortBy}`, sortOrder);

    const limit = dto.limit || 20;
    const offset = dto.offset || 0;
    qb.skip(offset).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return { data, total };
  }

  async explainSearch(dto: SearchProductsDto): Promise<string> {
    const qb = this.productRepository.createQueryBuilder('p');

    if (dto.search) {
      qb.andWhere('p.name ILIKE :search', { search: `%${dto.search}%` });
    }
    if (dto.category) {
      qb.andWhere('p.category = :category', { category: dto.category });
    }
    if (dto.minPrice !== undefined) {
      qb.andWhere('p.price >= :minPrice', { minPrice: dto.minPrice });
    }
    if (dto.maxPrice !== undefined) {
      qb.andWhere('p.price <= :maxPrice', { maxPrice: dto.maxPrice });
    }
    if (dto.isAvailable !== undefined) {
      qb.andWhere('p.isAvailable = :isAvailable', {
        isAvailable: dto.isAvailable,
      });
    }

    const sortBy = dto.sortBy || 'createdAt';
    const sortOrder = dto.sortOrder || 'DESC';
    qb.orderBy(`p.${sortBy}`, sortOrder);

    const limit = dto.limit || 20;
    const offset = dto.offset || 0;
    qb.skip(offset).take(limit);

    const [sql, params] = qb.getQueryAndParameters();

    const explainResult: Array<{ 'QUERY PLAN': string }> =
      await this.dataSource.query(`EXPLAIN ANALYZE ${sql}`, params);

    return explainResult
      .map((row: { 'QUERY PLAN': string }) => row['QUERY PLAN'])
      .join('\n');
  }

  async findOne(id: number): Promise<Product> {
    const product = await this.productRepository.findOne({ where: { id } });
    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }
    return product;
  }

  async update(
    id: number,
    updateProductDto: UpdateProductDto,
  ): Promise<Product> {
    const product = await this.findOne(id);
    Object.assign(product, updateProductDto);
    return this.productRepository.save(product);
  }

  async updateStock(id: number, quantity: number): Promise<Product> {
    const product = await this.findOne(id);
    product.stock += quantity;
    return this.productRepository.save(product);
  }

  async remove(id: number): Promise<void> {
    const product = await this.findOne(id);
    await this.productRepository.remove(product);
  }
}
