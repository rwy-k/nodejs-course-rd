import { ObjectType, Field, Int } from '@nestjs/graphql';
import { OrderType } from './order.type';
import { PageInfo } from './page-info.type';

@ObjectType()
export class OrdersConnection {
  @Field(() => [OrderType])
  nodes: OrderType[];

  @Field(() => Int)
  totalCount: number;

  @Field(() => PageInfo)
  pageInfo: PageInfo;
}
