import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { PaymentService } from './payment.service';

@Controller()
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @GrpcMethod('Payments', 'Authorize')
  async authorize(input: {
    order_id: string;
    amount: string;
    currency: string;
    idempotency_key?: string;
  }) {
    const result = await this.paymentService.authorize({
      orderId: input.order_id,
      amount: input.amount,
      currency: input.currency,
      idempotencyKey: input.idempotency_key,
    });
    return {
      payment_id: result.paymentId,
      status: result.status,
      error_message: result.errorMessage,
    };
  }

  @GrpcMethod('Payments', 'GetPaymentStatus')
  async getPaymentStatus(input: { payment_id: string }) {
    const result = await this.paymentService.getPaymentStatus(input.payment_id);
    return {
      payment_id: result.paymentId,
      status: result.status,
      error_message: result.errorMessage,
    };
  }

  @GrpcMethod('Payments', 'Capture')
  async capture(input: { payment_id: string; amount: string; idempotency_key?: string }) {
    return this.paymentService.captureStub(input.payment_id, input.amount, input.idempotency_key);
  }

  @GrpcMethod('Payments', 'Refund')
  async refund(input: { payment_id: string; amount: string; idempotency_key?: string }) {
    return this.paymentService.refundStub(input.payment_id, input.amount, input.idempotency_key);
  }
}
