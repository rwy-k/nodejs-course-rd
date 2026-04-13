import {
  BadRequestException,
  ConflictException,
  GatewayTimeoutException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

export const GrpcStatusCode = {
  CANCELLED: 1,
  UNKNOWN: 2,
  INVALID_ARGUMENT: 3,
  DEADLINE_EXCEEDED: 4,
  NOT_FOUND: 5,
  ALREADY_EXISTS: 6,
  PERMISSION_DENIED: 7,
  RESOURCE_EXHAUSTED: 8,
  FAILED_PRECONDITION: 9,
  ABORTED: 10,
  OUT_OF_RANGE: 11,
  UNIMPLEMENTED: 12,
  INTERNAL: 13,
  UNAVAILABLE: 14,
  DATA_LOSS: 15,
  UNAUTHENTICATED: 16,
} as const;

export const TRANSIENT_CODES: number[] = [
  GrpcStatusCode.UNAVAILABLE,
  GrpcStatusCode.DEADLINE_EXCEEDED,
  GrpcStatusCode.RESOURCE_EXHAUSTED,
];

export function isTransientGrpcCode(code: number): boolean {
  return TRANSIENT_CODES.includes(code);
}

export class PaymentGrpcError extends Error {
  constructor(
    message: string,
    public readonly code: number,
  ) {
    super(message);
    this.name = 'PaymentGrpcError';
    Object.setPrototypeOf(this, PaymentGrpcError.prototype);
  }
}

export function getGrpcCodeFromError(
  unknownError: unknown,
): number | undefined {
  if (unknownError == null) return undefined;
  if (typeof (unknownError as { code?: number }).code === 'number')
    return (unknownError as { code: number }).code;
  const details = (unknownError as { details?: unknown }).details;
  if (details != null && typeof details === 'object' && 'code' in details)
    return (details as { code: number }).code;
  return undefined;
}

export function paymentGrpcErrorToHttp(
  paymentGrpcError: PaymentGrpcError,
): HttpException {
  const message = paymentGrpcError.message || 'Payment service error';
  switch (paymentGrpcError.code) {
    case GrpcStatusCode.INVALID_ARGUMENT:
      return new BadRequestException(`Invalid payment request: ${message}`);
    case GrpcStatusCode.NOT_FOUND:
      return new NotFoundException(`Payment not found: ${message}`);
    case GrpcStatusCode.ALREADY_EXISTS:
      return new ConflictException(`Payment conflict: ${message}`);
    case GrpcStatusCode.FAILED_PRECONDITION:
      return new BadRequestException(`Payment precondition failed: ${message}`);
    case GrpcStatusCode.DEADLINE_EXCEEDED:
      return new GatewayTimeoutException(
        `Payment service did not respond in time: ${message}`,
      );
    case GrpcStatusCode.UNAVAILABLE:
    case GrpcStatusCode.RESOURCE_EXHAUSTED:
      return new ServiceUnavailableException(
        `Payment service temporarily unavailable: ${message}`,
      );
    case GrpcStatusCode.PERMISSION_DENIED:
    case GrpcStatusCode.UNAUTHENTICATED:
      return new BadRequestException(
        `Payment authorization failed: ${message}`,
      );
    default:
      return new ServiceUnavailableException(
        `Payment service error: ${message}`,
      );
  }
}
