export class CreateOrderItemDto {
  productId: number;
  quantity: number;
}

export class CreateOrderDto {
  userId: number;
  shippingAddress?: string;
  items: CreateOrderItemDto[];
  idempotencyKey?: string;
}

