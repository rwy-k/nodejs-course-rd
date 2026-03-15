import {
  Resolver,
  Query,
  Args,
  ID,
  ResolveField,
  Parent,
} from '@nestjs/graphql';
import { OrderType } from '../types/order.type';
import { OrderItemType } from '../types/order-item.type';
import { UserType } from '../types/user.type';
import { OrdersConnection } from '../types/orders-connection.type';
import { OrdersFilterInput } from '../inputs/orders-filter.input';
import { OrdersPaginationInput } from '../inputs/orders-pagination.input';
import { OrdersService } from '../../orders/orders.service';
import { UserLoader } from '../loaders/user.loader';
import { Order } from '../../entities/order.entity';

@Resolver(() => OrderType)
export class OrderResolver {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly userLoader: UserLoader,
  ) {}

  @Query(() => OrdersConnection, { name: 'orders' })
  async findAll(
    @Args('filter', { type: () => OrdersFilterInput, nullable: true }) filter?: OrdersFilterInput,
    @Args('pagination', { type: () => OrdersPaginationInput, nullable: true }) pagination?: OrdersPaginationInput,
  ): Promise<OrdersConnection> {
    const result = await this.ordersService.findAllFiltered({ filter, pagination });

    return {
      nodes: result.data,
      totalCount: result.totalCount,
      pageInfo: {
        hasNextPage: result.hasNextPage,
        hasPreviousPage: result.hasPreviousPage,
        startCursor: result.startCursor,
        endCursor: result.endCursor,
      },
    };
  }

  @Query(() => OrderType, { name: 'order' })
  async findOne(@Args('id', { type: () => ID }) id: number): Promise<OrderType> {
    return this.ordersService.findOne(id);
  }

  @Query(() => [OrderType], { name: 'ordersByUser' })
  async findByUser(
    @Args('userId', { type: () => ID }) userId: number,
  ): Promise<OrderType[]> {
    return this.ordersService.findByUser(userId);
  }

  @ResolveField('items', () => [OrderItemType])
  getItems(@Parent() order: Order): OrderItemType[] {
    return order.items || [];
  }

  @ResolveField('user', () => UserType, { nullable: true })
  async getUser(@Parent() order: Order): Promise<UserType | null> {
    if (!order.userId) {
      return null;
    }
    return this.userLoader.load(order.userId);
  }
}
