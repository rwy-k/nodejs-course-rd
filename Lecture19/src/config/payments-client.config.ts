import { registerAs } from '@nestjs/config';

export default registerAs('paymentsClient', () => ({
  grpcUrl: process.env.PAYMENTS_GRPC_URL || 'localhost:5001',
  grpcTimeoutMs: parseInt(process.env.PAYMENTS_GRPC_TIMEOUT_MS || '5000', 10),
  retryAttempts: parseInt(process.env.PAYMENTS_GRPC_RETRY_ATTEMPTS || '3', 10),
  retryInitialMs: parseInt(
    process.env.PAYMENTS_GRPC_RETRY_INITIAL_MS || '200',
    10,
  ),
  retryMaxMs: parseInt(process.env.PAYMENTS_GRPC_RETRY_MAX_MS || '5000', 10),
}));
