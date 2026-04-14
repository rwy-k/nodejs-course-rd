import { randomUUID } from 'crypto';
import { performance } from 'node:perf_hooks';
import { readFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnvFile() {
  const envPath = resolve(__dirname, '..', '.env');
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile();

const base = process.env.BASE_URL || 'http://127.0.0.1:3000';
const password = process.env.SEED_ADMIN_PASSWORD;
const n = Math.min(
  60,
  Math.max(4, Number(process.env.LOCK_BENCH_CONCURRENCY || '12')),
);
const stock = Number(process.env.LOCK_BENCH_STOCK || '500');
const fetchTimeoutMs = Number(process.env.LOCK_BENCH_FETCH_MS || '120000');

if (!password) {
  console.error('Set SEED_ADMIN_PASSWORD (or add it to .env)');
  process.exit(1);
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function abortableSignal(ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, cancel: () => clearTimeout(t) };
}

async function login() {
  const { signal, cancel } = abortableSignal(fetchTimeoutMs);
  let loginRes;
  try {
    loginRes = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@example.com',
        password,
      }),
      signal,
    });
  } finally {
    cancel();
  }
  const loginJson = await loginRes.json();
  const token = loginJson.accessToken || loginJson.access_token;
  if (!token) {
    console.error('Login failed', loginRes.status, loginJson);
    process.exit(1);
  }
  return token;
}

async function createOrder(token, productId, idempotencyKey) {
  const t0 = performance.now();
  const { signal, cancel } = abortableSignal(fetchTimeoutMs);
  let res;
  try {
    res = await fetch(`${base}/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        userId: 1,
        items: [{ productId, quantity: 1 }],
      }),
      signal,
    });
  } catch (e) {
    cancel();
    const t1 = performance.now();
    return {
      ok: false,
      status: 0,
      ms: t1 - t0,
      bodyJson: { error: String(e?.message || e) },
    };
  }
  cancel();
  const t1 = performance.now();
  const bodyText = await res.text();
  let bodyJson;
  try {
    bodyJson = JSON.parse(bodyText);
  } catch {
    bodyJson = { raw: bodyText };
  }
  return {
    ok: res.ok,
    status: res.status,
    ms: t1 - t0,
    bodyJson,
  };
}

async function resetStocksDb() {
  const client = new pg.Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME || process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'shop',
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  await client.query(
    'UPDATE products SET stock = $1 WHERE id IN (1, 2, 3, 4)',
    [stock],
  );
  await client.end();
}

/**
 * @param {'hot' | 'spread'} mode
 */
async function runScenario(token, mode) {
  const keys = Array.from({ length: n }, () => randomUUID());
  const productIds =
    mode === 'hot'
      ? Array(n).fill(2)
      : Array.from({ length: n }, (_, i) => (i % 4) + 1);

  const wall0 = performance.now();
  const results = await Promise.all(
    keys.map((key, i) => createOrder(token, productIds[i], key)),
  );
  const wall1 = performance.now();

  const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
  const oks = results.filter((r) => r.ok).length;

  return {
    mode,
    n,
    wallMs: wall1 - wall0,
    success: oks,
    failed: n - oks,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    max: latencies[latencies.length - 1] ?? 0,
    throughput: n / ((wall1 - wall0) / 1000),
    errors: results
      .filter((r) => !r.ok)
      .map((r) => ({ status: r.status, snippet: JSON.stringify(r.bodyJson).slice(0, 120) })),
  };
}

async function main() {
  console.error(
    `[perf-create-lock] base=${base} n=${n} stock=${stock} (stderr progress)`,
  );
  const token = await login();
  console.error('[perf-create-lock] login OK, reset stocks…');
  await resetStocksDb();

  console.error('[perf-create-lock] scenario hot-SKU…');
  const hot = await runScenario(token, 'hot');
  await resetStocksDb();
  console.error('[perf-create-lock] scenario spread-SKUs…');
  const spread = await runScenario(token, 'spread');

  const out = {
    base,
    concurrency: n,
    stockReset: stock,
    hotSkuProductId: 2,
    spreadProductIds: 'cycle 1..4',
    hot,
    spread,
    ratioWallHotOverSpread: hot.wallMs / spread.wallMs,
    ratioP99HotOverSpread: hot.p99 / spread.p99,
  };

  console.log(JSON.stringify(out, null, 2));

  if (hot.failed > 0 || spread.failed > 0) {
    process.exit(1);
  }
}

void main();
