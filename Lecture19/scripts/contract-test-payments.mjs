import * as grpc from '@grpc/grpc-js';
import { loadPackageDefinition } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const paymentsProtoPath = resolve(
  __dirname,
  '../packages/contracts/proto/payments.proto',
);
const paymentsGrpcTargetUrl =
  process.env.PAYMENTS_GRPC_URL || 'localhost:5001';

const packageDefinition = loadSync(paymentsProtoPath, { keepCase: true });
const paymentsPackage = loadPackageDefinition(packageDefinition).payments;
const paymentsGrpcClient = new paymentsPackage.Payments(
  paymentsGrpcTargetUrl,
  grpc.credentials.createInsecure(),
);

const authorizeRequestPayload = {
  order_id: 'contract-test-order',
  amount: '10.00',
  currency: 'USD',
};

paymentsGrpcClient.Authorize(
  authorizeRequestPayload,
  (grpcError, authorizeResponse) => {
  if (grpcError) {
    console.error('Contract test failed:', grpcError.message);
    process.exit(1);
  }
  if (
    !authorizeResponse ||
    typeof authorizeResponse.payment_id !== 'string' ||
    typeof authorizeResponse.status !== 'string'
  ) {
    console.error(
      'Contract test failed: response must have payment_id and status',
      authorizeResponse,
    );
    process.exit(1);
  }
  console.log('Contract test passed:', {
    payment_id: authorizeResponse.payment_id,
    status: authorizeResponse.status,
  });
  process.exit(0);
});
