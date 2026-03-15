import * as grpc from '@grpc/grpc-js';
import { loadPackageDefinition } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const protoPath = resolve(__dirname, '../packages/contracts/proto/payments.proto');
const url = process.env.PAYMENTS_GRPC_URL || 'localhost:5001';

const packageDefinition = loadSync(protoPath, { keepCase: true });
const proto = loadPackageDefinition(packageDefinition).payments;
const client = new proto.Payments(url, grpc.credentials.createInsecure());

const payload = { order_id: 'contract-test-order', amount: '10.00', currency: 'USD' };

client.Authorize(payload, (err, result) => {
  if (err) {
    console.error('Contract test failed:', err.message);
    process.exit(1);
  }
  if (!result || typeof result.payment_id !== 'string' || typeof result.status !== 'string') {
    console.error('Contract test failed: response must have payment_id and status', result);
    process.exit(1);
  }
  console.log('Contract test passed:', { payment_id: result.payment_id, status: result.status });
  process.exit(0);
});
