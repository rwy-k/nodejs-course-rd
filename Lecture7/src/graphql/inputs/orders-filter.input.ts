import { InputType, Field } from '@nestjs/graphql';
import { IsOptional, IsDate } from 'class-validator';
import { Type } from 'class-transformer';
import { OrderStatus } from '../../entities/order.entity';

@InputType()
export class OrdersFilterInput {
  @Field(() => OrderStatus, { nullable: true })
  @IsOptional()
  status?: OrderStatus;

  @Field({ nullable: true })
  @IsOptional()
  @IsDate({ message: 'dateFrom must be a valid date' })
  @Type(() => Date)
  dateFrom?: Date;

  @Field({ nullable: true })
  @IsOptional()
  @IsDate({ message: 'dateTo must be a valid date' })
  @Type(() => Date)
  dateTo?: Date;
}
