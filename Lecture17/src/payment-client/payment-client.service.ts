import { Injectable, Inject, OnModuleDestroy } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { PAYMENT_CLIENT } from './constants';
import {
  PaymentGrpcError,
  getGrpcCodeFromError,
  isTransientGrpcCode,
  GrpcStatusCode,
} from './grpc-errors';

export interface AuthorizeInput {
  order_id: string;
  amount: string;
  currency: string;
  idempotency_key?: string;
}

export interface AuthorizeResult {
  payment_id: string;
  status: string;
  error_message?: string;
}

export interface GetPaymentStatusInput {
  payment_id: string;
}

export interface GetPaymentStatusResult {
  payment_id: string;
  status: string;
  error_message?: string;
}

interface PaymentsClient {
  authorize(data: AuthorizeInput): import('rxjs').Observable<AuthorizeResult>;
  getPaymentStatus(
    data: GetPaymentStatusInput,
  ): import('rxjs').Observable<GetPaymentStatusResult>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class PaymentClientService implements OnModuleDestroy {
  private payments: PaymentsClient;
  private readonly timeoutMs: number;
  private readonly retryAttempts: number;
  private readonly retryInitialMs: number;
  private readonly retryMaxMs: number;

  constructor(
    @Inject(PAYMENT_CLIENT) private readonly client: ClientGrpc,
    private readonly config: ConfigService,
  ) {
    this.timeoutMs = this.config.get<number>('paymentsClient.grpcTimeoutMs')!;
    this.retryAttempts = this.config.get<number>(
      'paymentsClient.retryAttempts',
    );
    this.retryInitialMs = this.config.get<number>(
      'paymentsClient.retryInitialMs',
    );
    this.retryMaxMs = this.config.get<number>('paymentsClient.retryMaxMs');
  }

  onModuleInit() {
    this.payments = this.client.getService<PaymentsClient>('Payments');
  }

  private async executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retryAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        const code =
          err instanceof TimeoutError
            ? GrpcStatusCode.DEADLINE_EXCEEDED
            : getGrpcCodeFromError(err);
        const isTransient = code !== undefined && isTransientGrpcCode(code);
        if (!isTransient || attempt >= this.retryAttempts) {
          break;
        }
        const backoffMs = Math.min(
          this.retryMaxMs,
          this.retryInitialMs * Math.pow(2, attempt),
        );
        await delay(backoffMs);
      }
    }
    const code =
      lastError instanceof TimeoutError
        ? GrpcStatusCode.DEADLINE_EXCEEDED
        : getGrpcCodeFromError(lastError);
    const message =
      lastError instanceof Error
        ? lastError.message
        : typeof lastError === 'string'
          ? lastError
          : JSON.stringify(lastError);
    throw new PaymentGrpcError(message, code ?? GrpcStatusCode.UNKNOWN);
  }

  async authorize(input: AuthorizeInput): Promise<AuthorizeResult> {
    const raw = await this.executeWithRetry(() =>
      firstValueFrom(
        this.payments.authorize(input).pipe(timeout(this.timeoutMs)),
      ).catch((err) => {
        if (err instanceof TimeoutError) {
          throw Object.assign(new Error('Payments gRPC call timed out'), {
            code: GrpcStatusCode.DEADLINE_EXCEEDED,
          });
        }
        throw err;
      }),
    );
    return this.normalizeAuthorizeResult(raw);
  }

  private normalizeAuthorizeResult(raw: unknown): AuthorizeResult {
    const r = raw as Record<string, unknown>;
    return {
      payment_id: (r.payment_id ?? r.paymentId ?? '') as string,
      status: (r.status ?? '') as string,
      error_message: (r.error_message ?? r.errorMessage) as string | undefined,
    };
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput,
  ): Promise<GetPaymentStatusResult> {
    const raw = await this.executeWithRetry(() =>
      firstValueFrom(
        this.payments.getPaymentStatus(input).pipe(timeout(this.timeoutMs)),
      ).catch((err) => {
        if (err instanceof TimeoutError) {
          throw Object.assign(new Error('Payments gRPC call timed out'), {
            code: GrpcStatusCode.DEADLINE_EXCEEDED,
          });
        }
        throw err;
      }),
    );
    const r = raw as unknown as Record<string, unknown>;
    return {
      payment_id: (r.payment_id ?? r.paymentId ?? '') as string,
      status: (r.status ?? '') as string,
      error_message: (r.error_message ?? r.errorMessage) as string | undefined,
    };
  }

  onModuleDestroy() {
    const client = this.client as ClientGrpc & { close?: () => void };
    client.close?.();
  }
}
