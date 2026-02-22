import { registerEnumType } from '@nestjs/graphql';
import { OrderStatus } from '../../entities/order.entity';

registerEnumType(OrderStatus, {
  name: 'OrderStatus',
});

export { OrderStatus };
