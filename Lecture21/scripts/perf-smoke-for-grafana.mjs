const base = process.env.BASE_URL || 'http://127.0.0.1:3000';
const password = process.env.SEED_ADMIN_PASSWORD;
if (!password) {
  console.error('Set SEED_ADMIN_PASSWORD');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const loginRes = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@example.com',
      password,
    }),
  });
  const loginJson = await loginRes.json();
  const token = loginJson.accessToken || loginJson.access_token;
  if (!token) {
    console.error('Login failed', loginRes.status, loginJson);
    process.exit(1);
  }

  const createRes = await fetch(`${base}/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      userId: 1,
      items: [{ productId: 1, quantity: 1 }],
    }),
  });
  const createJson = await createRes.json();
  const orderId = createJson.data?.id;
  if (!orderId) {
    console.error('Create order failed', createRes.status, createJson);
    process.exit(1);
  }

  const n = Number(process.env.SMOKE_ITERATIONS || '18');
  const pauseMs = Number(process.env.SMOKE_PAUSE_MS || '4500');

  for (let i = 0; i < n; i += 1) {
    const r = await fetch(`${base}/orders/${orderId}/request-payment`, {
      method: 'POST',
    });
    if (!r.ok) {
      const t = await r.text();
      console.error(`request-payment ${i + 1}/${n} failed`, r.status, t);
      process.exit(1);
    }
    if (i + 1 < n) await sleep(pauseMs);
  }
  console.log(`OK: ${n}x request-payment on order`, orderId);
}

void main();
