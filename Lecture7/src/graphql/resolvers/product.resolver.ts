import { Resolver, Query, Args, ID } from '@nestjs/graphql';
import { ProductType } from '../types/product.type';
import { ProductsService } from '../../products/products.service';

@Resolver(() => ProductType)
export class ProductResolver {
  constructor(private readonly productsService: ProductsService) {}

  @Query(() => [ProductType], { name: 'products' })
  async findAll(): Promise<ProductType[]> {
    return this.productsService.findAll();
  }

  @Query(() => ProductType, { name: 'product' })
  async findOne(@Args('id', { type: () => ID }) id: number): Promise<ProductType> {
    return this.productsService.findOne(id);
  }

  @Query(() => [ProductType], { name: 'availableProducts' })
  async findAvailable(): Promise<ProductType[]> {
    return this.productsService.findAvailable();
  }
}
