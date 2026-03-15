export interface OrderProcessMessageDto {
  messageId: string;
  orderId: number | string;
  createdAt: string;
  attempt: number;
  correlationId?: string;
  producer?: string;
  eventName?: string;
}

export interface OrderDlqMessageDto extends OrderProcessMessageDto {
  failedAt: string;
  reason?: string;
}

export const ORDER_PROCESS_EVENT_NAME = 'order.created';
