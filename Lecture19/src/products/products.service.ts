import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
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

  async search(searchProductsDto: SearchProductsDto): Promise<{
    data: Product[];
    total: number;
    explain?: string;
  }> {
    const productQueryBuilder =
      this.productRepository.createQueryBuilder('product');

    if (searchProductsDto.search) {
      productQueryBuilder.andWhere('product.name ILIKE :search', {
        search: `%${searchProductsDto.search}%`,
      });
    }

    if (searchProductsDto.category) {
      productQueryBuilder.andWhere('product.category = :category', {
        category: searchProductsDto.category,
      });
    }

    if (searchProductsDto.minPrice !== undefined) {
      productQueryBuilder.andWhere('product.price >= :minPrice', {
        minPrice: searchProductsDto.minPrice,
      });
    }
    if (searchProductsDto.maxPrice !== undefined) {
      productQueryBuilder.andWhere('product.price <= :maxPrice', {
        maxPrice: searchProductsDto.maxPrice,
      });
    }

    if (searchProductsDto.isAvailable !== undefined) {
      productQueryBuilder.andWhere('product.isAvailable = :isAvailable', {
        isAvailable: searchProductsDto.isAvailable,
      });
    }

    const sortBy = searchProductsDto.sortBy || 'createdAt';
    const sortOrder = searchProductsDto.sortOrder || 'DESC';
    productQueryBuilder.orderBy(`product.${sortBy}`, sortOrder);

    const limit = searchProductsDto.limit || 20;
    const offset = searchProductsDto.offset || 0;
    productQueryBuilder.skip(offset).take(limit);

    const [data, total] = await productQueryBuilder.getManyAndCount();

    return { data, total };
  }

  async explainSearch(searchProductsDto: SearchProductsDto): Promise<string> {
    const productQueryBuilder =
      this.productRepository.createQueryBuilder('product');

    if (searchProductsDto.search) {
      productQueryBuilder.andWhere('product.name ILIKE :search', {
        search: `%${searchProductsDto.search}%`,
      });
    }
    if (searchProductsDto.category) {
      productQueryBuilder.andWhere('product.category = :category', {
        category: searchProductsDto.category,
      });
    }
    if (searchProductsDto.minPrice !== undefined) {
      productQueryBuilder.andWhere('product.price >= :minPrice', {
        minPrice: searchProductsDto.minPrice,
      });
    }
    if (searchProductsDto.maxPrice !== undefined) {
      productQueryBuilder.andWhere('product.price <= :maxPrice', {
        maxPrice: searchProductsDto.maxPrice,
      });
    }
    if (searchProductsDto.isAvailable !== undefined) {
      productQueryBuilder.andWhere('product.isAvailable = :isAvailable', {
        isAvailable: searchProductsDto.isAvailable,
      });
    }

    const sortBy = searchProductsDto.sortBy || 'createdAt';
    const sortOrder = searchProductsDto.sortOrder || 'DESC';
    productQueryBuilder.orderBy(`product.${sortBy}`, sortOrder);

    const limit = searchProductsDto.limit || 20;
    const offset = searchProductsDto.offset || 0;
    productQueryBuilder.skip(offset).take(limit);

    const [sql, parameters] = productQueryBuilder.getQueryAndParameters();

    const explainResult: Array<{ 'QUERY PLAN': string }> =
      await this.dataSource.query(`EXPLAIN ANALYZE ${sql}`, parameters);

    return explainResult
      .map((row: { 'QUERY PLAN': string }) => row['QUERY PLAN'])
      .join('\n');
  }

  async findOne(productRecordId: number): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { id: productRecordId },
    });
    if (!product) {
      throw new NotFoundException(
        `Product with ID ${productRecordId} not found`,
      );
    }
    return product;
  }

  async findByIds(productRecordIds: number[]): Promise<Product[]> {
    if (productRecordIds.length === 0) {
      return [];
    }
    return this.productRepository.find({
      where: { id: In(productRecordIds) },
    });
  }

  async update(
    productRecordId: number,
    updateProductDto: UpdateProductDto,
  ): Promise<Product> {
    const product = await this.findOne(productRecordId);
    Object.assign(product, updateProductDto);
    return this.productRepository.save(product);
  }

  async updateStock(
    productRecordId: number,
    quantity: number,
  ): Promise<Product> {
    const product = await this.findOne(productRecordId);
    product.stock += quantity;
    return this.productRepository.save(product);
  }

  async remove(productRecordId: number): Promise<void> {
    const product = await this.findOne(productRecordId);
    await this.productRepository.remove(product);
  }
}
