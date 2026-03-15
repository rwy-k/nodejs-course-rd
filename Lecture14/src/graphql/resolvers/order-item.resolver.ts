import { Resolver, ResolveField, Parent } from '@nestjs/graphql';
import { OrderItemType } from '../types/order-item.type';
import { ProductType } from '../types/product.type';
import { ProductLoader } from '../loaders/product.loader';
import { OrderItem } from '../../entities/order-item.entity';

@Resolver(() => OrderItemType)
export class OrderItemResolver {
  constructor(private readonly productLoader: ProductLoader) {}

  @ResolveField('product', () => ProductType, { nullable: true })
  async getProduct(@Parent() orderItem: OrderItem): Promise<ProductType | null> {
    if (!orderItem.productId) {
      return null;
    }
    return this.productLoader.load(orderItem.productId);
  }
}
