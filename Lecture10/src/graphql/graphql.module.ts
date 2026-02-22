import { Module } from '@nestjs/common';
import { ProductResolver } from './resolvers/product.resolver';
import { OrderResolver } from './resolvers/order.resolver';
import { OrderItemResolver } from './resolvers/order-item.resolver';
import { ProductLoader } from './loaders/product.loader';
import { UserLoader } from './loaders/user.loader';
import { ProductsModule } from '../products/products.module';
import { OrdersModule } from '../orders/orders.module';
import { UsersModule } from '../users/users.module';

import './enums/order-status.enum';

@Module({
  imports: [ProductsModule, OrdersModule, UsersModule],
  providers: [
    ProductResolver,
    OrderResolver,
    OrderItemResolver,
    ProductLoader,
    UserLoader,
  ],
})
export class GraphqlResolversModule {}
