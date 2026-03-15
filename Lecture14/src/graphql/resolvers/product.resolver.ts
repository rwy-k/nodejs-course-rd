import { Resolver, Query, Args, ID } from '@nestjs/graphql';
import { ProductType } from '../types/product.type';
import { ProductsService } from '../../products/products.service';
import { Public } from '../../auth/decorators/public.decorator';

@Resolver(() => ProductType)
export class ProductResolver {
  constructor(private readonly productsService: ProductsService) {}

  @Public()
  @Query(() => [ProductType], { name: 'products' })
  async findAll(): Promise<ProductType[]> {
    return this.productsService.findAll();
  }

  @Public()
  @Query(() => ProductType, { name: 'product' })
  async findOne(@Args('id', { type: () => ID }) id: number): Promise<ProductType> {
    return this.productsService.findOne(id);
  }

  @Public()
  @Query(() => [ProductType], { name: 'availableProducts' })
  async findAvailable(): Promise<ProductType[]> {
    return this.productsService.findAvailable();
  }
}
