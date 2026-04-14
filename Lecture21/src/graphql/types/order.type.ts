import { ObjectType, Field, ID, Float } from '@nestjs/graphql';
import { OrderStatus } from '../../entities/order.entity';
import { OrderItemType } from './order-item.type';
import { UserType } from './user.type';

@ObjectType()
export class OrderType {
  @Field(() => ID)
  id: number;

  @Field(() => OrderStatus)
  status: OrderStatus;

  @Field(() => Float)
  totalAmount: number;

  @Field({ nullable: true })
  shippingAddress?: string;

  @Field(() => [OrderItemType])
  items: OrderItemType[];

  @Field(() => UserType, { nullable: true })
  user?: UserType;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}
