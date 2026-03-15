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

export function getGrpcCodeFromError(err: unknown): number | undefined {
  if (err == null) return undefined;
  if (typeof (err as { code?: number }).code === 'number')
    return (err as { code: number }).code;
  const details = (err as { details?: unknown }).details;
  if (details != null && typeof details === 'object' && 'code' in details)
    return (details as { code: number }).code;
  return undefined;
}
