import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const smokeBaseUrl = process.env.SMOKE_BASE || 'http://127.0.0.1:9080';
const seedAdminPassword = process.env.SEED_ADMIN_PASSWORD;
if (!seedAdminPassword) {
  console.error('SEED_ADMIN_PASSWORD missing in .env');
  process.exit(1);
}

async function sendHttpRequest(method, path, { headers = {}, body } = {}) {
  const url = `${smokeBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const requestHeaders = { ...headers };
  if (body !== undefined) {
    requestHeaders['Content-Type'] = 'application/json';
  }
  const fetchResponse = await fetch(url, {
    method,
    headers: requestHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await fetchResponse.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: fetchResponse.status, json, text };
}

function line(method, path, status, { expectStatuses, note } = {}) {
  const requestSucceeded = expectStatuses?.length
    ? expectStatuses.includes(status)
    : status >= 200 && status < 300;
  const tag = requestSucceeded ? 'OK' : '!!';
  console.log(
    `${tag}\t${status}\t${method}\t${path}${note ? `\t${note}` : ''}`,
  );
  return requestSucceeded;
}

let failed = 0;
function expect(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed++;
  }
}

const results = [];

async function main() {
  let httpResult = await sendHttpRequest('GET', '/');
  results.push(line('GET', '/', httpResult.status));
  httpResult = await sendHttpRequest('GET', '/health');
  results.push(line('GET', '/health', httpResult.status));
  httpResult = await sendHttpRequest('GET', '/admin');
  results.push(line('GET', '/admin', httpResult.status));

  httpResult = await sendHttpRequest('POST', '/auth/login', {
    body: { email: 'admin@example.com', password: seedAdminPassword },
  });
  results.push(line('POST', '/auth/login', httpResult.status));
  expect(
    (httpResult.status === 200 || httpResult.status === 201) &&
      httpResult.json?.accessToken,
    'login token',
  );
  const adminToken = httpResult.json?.accessToken;
  const auth = { Authorization: `Bearer ${adminToken}` };

  httpResult = await sendHttpRequest('GET', '/auth/profile', { headers: auth });
  results.push(line('GET', '/auth/profile', httpResult.status));

  httpResult = await sendHttpRequest('POST', '/auth/refresh', { body: {} });
  results.push(
    line('POST', '/auth/refresh', httpResult.status, { expectStatuses: [501] }),
  );
  expect(httpResult.status === 501, 'refresh not implemented');

  httpResult = await sendHttpRequest('GET', '/products');
  results.push(line('GET', '/products', httpResult.status));
  httpResult = await sendHttpRequest('GET', '/products/search?limit=2');
  results.push(line('GET', '/products/search', httpResult.status));
  httpResult = await sendHttpRequest('GET', '/products/available');
  results.push(line('GET', '/products/available', httpResult.status));
  httpResult = await sendHttpRequest('GET', '/products/1');
  results.push(line('GET', '/products/1', httpResult.status));

  httpResult = await sendHttpRequest('GET', '/users', { headers: auth });
  results.push(line('GET', '/users', httpResult.status));
  httpResult = await sendHttpRequest('GET', '/users/1', { headers: auth });
  results.push(line('GET', '/users/1', httpResult.status));

  httpResult = await sendHttpRequest('GET', '/orders/user/1', { headers: auth });
  results.push(line('GET', '/orders/user/1', httpResult.status));

  httpResult = await sendHttpRequest('POST', '/orders', {
    headers: auth,
    body: { userId: 1, items: [{ productId: 1, quantity: 1 }] },
  });
  results.push(line('POST', '/orders', httpResult.status));
  const orderId = httpResult.json?.data?.id;
  expect(orderId, 'order id from create');

  httpResult = await sendHttpRequest('GET', `/orders/${orderId}`, { headers: auth });
  results.push(line('GET', `/orders/${orderId}`, httpResult.status));

  httpResult = await sendHttpRequest('GET', '/orders', { headers: auth });
  results.push(line('GET', '/orders (admin)', httpResult.status));

  httpResult = await sendHttpRequest('POST', `/orders/${orderId}/request-payment`, {});
  results.push(line('POST', `/orders/${orderId}/request-payment`, httpResult.status));
  const paymentId = httpResult.json?.paymentId || httpResult.json?.payment_id;
  expect(paymentId, 'payment id');

  httpResult = await sendHttpRequest('POST', '/payments/capture', {
    headers: auth,
    body: {
      payment_id: paymentId,
      amount: '1000',
      idempotency_key: `smoke-cap-${Date.now()}`,
    },
  });
  results.push(line('POST', '/payments/capture', httpResult.status));

  httpResult = await sendHttpRequest('POST', '/payments/refund', {
    headers: auth,
    body: {
      payment_id: paymentId,
      amount: '500',
      idempotency_key: `smoke-ref-${Date.now()}`,
    },
  });
  results.push(line('POST', '/payments/refund', httpResult.status));

  httpResult = await sendHttpRequest('POST', '/graphql', {
    headers: { 'Content-Type': 'application/json' },
    body: { query: '{ hello }' },
  });
  results.push(line('POST', '/graphql', httpResult.status));
  expect(
    httpResult.status === 200 &&
      !httpResult.json?.errors &&
      httpResult.json?.data?.hello,
    'graphql hello',
  );

  httpResult = await sendHttpRequest('POST', '/graphql', {
    headers: { 'Content-Type': 'application/json' },
    body: { query: 'mutation { clientPing }' },
  });
  results.push(line('POST', '/graphql mutation', httpResult.status));
  expect(
    httpResult.status === 200 &&
      !httpResult.json?.errors &&
      httpResult.json?.data?.clientPing === 'pong',
    'graphql clientPing',
  );

  httpResult = await sendHttpRequest('GET', '/upload/files/user/1', { headers: auth });
  results.push(line('GET', '/upload/files/user/1', httpResult.status));

  httpResult = await sendHttpRequest('GET', '/upload/files/product/1', { headers: auth });
  results.push(line('GET', '/upload/files/product/1', httpResult.status));

  httpResult = await sendHttpRequest('PATCH', '/products/1', {
    headers: auth,
    body: {},
  });
  results.push(line('PATCH', '/products/1', httpResult.status));

  httpResult = await sendHttpRequest('PATCH', `/orders/${orderId}`, {
    headers: auth,
    body: {},
  });
  results.push(line('PATCH', `/orders/${orderId}`, httpResult.status));

  console.log('\n--- summary ---');
  const failedRowCount = results.filter((rowOk) => rowOk === false).length;
  if (failed > 0 || failedRowCount > 0) {
    console.error(
      `Checks failed: explicit=${failed}, http_row_fail=${failedRowCount}`,
    );
    process.exit(1);
  }
  console.log('All smoke checks passed.');
}

main().catch((fatalError) => {
  console.error(fatalError);
  process.exit(1);
});
