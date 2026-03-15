import { Injectable } from '@nestjs/common';

@Injectable()
export class PaymentService {
  private readonly paymentStore = new Map<string, { status: string }>();
  private readonly authorizeByKey = new Map<string, { paymentId: string; status: string; errorMessage?: string }>();
  private readonly captureByKey = new Map<string, { success: boolean; status: string; error_message?: string }>();
  private readonly refundByKey = new Map<string, { success: boolean; status: string; error_message?: string }>();

  async authorize(data: {
    orderId: string;
    amount: string;
    currency: string;
    idempotencyKey?: string;
  }): Promise<{ paymentId: string; status: string; errorMessage?: string }> {
    if (data.idempotencyKey) {
      const stored = this.authorizeByKey.get(data.idempotencyKey);
      if (stored) return stored;
    }

    const paymentId = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    this.paymentStore.set(paymentId, { status: 'AUTHORIZED' });
    const result = { paymentId, status: 'AUTHORIZED' as const };

    if (data.idempotencyKey) {
      this.authorizeByKey.set(data.idempotencyKey, result);
    }
    return result;
  }

  async getPaymentStatus(paymentId: string): Promise<{
    paymentId: string;
    status: string;
    errorMessage?: string;
  }> {
    const record = this.paymentStore.get(paymentId);
    if (!record) {
      return {
        paymentId,
        status: 'UNKNOWN',
        errorMessage: 'Payment not found',
      };
    }
    return { paymentId, status: record.status };
  }

  async captureStub(
    paymentId: string,
    amount: string,
    idempotencyKey?: string,
  ): Promise<{ success: boolean; status: string; error_message?: string }> {
    if (idempotencyKey) {
      const stored = this.captureByKey.get(idempotencyKey);
      if (stored) return stored;
    }

    const result = { success: true, status: 'CAPTURED' as const };
    if (idempotencyKey) {
      this.captureByKey.set(idempotencyKey, result);
    }
    return result;
  }

  async refundStub(
    paymentId: string,
    amount: string,
    idempotencyKey?: string,
  ): Promise<{ success: boolean; status: string; error_message?: string }> {
    if (idempotencyKey) {
      const stored = this.refundByKey.get(idempotencyKey);
      if (stored) return stored;
    }

    const result = { success: true, status: 'REFUNDED' as const };
    if (idempotencyKey) {
      this.refundByKey.set(idempotencyKey, result);
    }
    return result;
  }
}
