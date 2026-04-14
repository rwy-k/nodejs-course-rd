# Lecture 17 — Orders + Payments + Worker (gRPC, deploy)

Це наш NestJS-бекенд із трьома «підопічними», які реально деплояться окремо: **orders-api**, **payments**, **worker**. Є production Dockerfile, Docker Compose і за бажанням Kubernetes/Minikube для локального підняття.

По суті: **Orders** (HTTP) дзвонить у **Payments** (gRPC) по одному `.proto`. **Worker** слухає чергу `orders.process` у RabbitMQ.

**Security homework:** [security-homework/SECURITY-BASELINE.md](security-homework/SECURITY-BASELINE.md) і [security-homework/security-evidence/](security-homework/security-evidence/). Якщо треба поганяти curl-ами — [docs/HARDENING-EVIDENCE.md](docs/HARDENING-EVIDENCE.md).

**Performance homework:** [docs/homework-report.md](docs/homework-report.md) — там мій сценарій, baseline, bottleneck (включно з SQL `EXPLAIN`: [docs/PERFORMANCE-SQL-AND-TRACE.md](docs/PERFORMANCE-SQL-AND-TRACE.md)), другий bottleneck — паралельний `create` / lock: [docs/PERFORMANCE-CREATE-LOCK-BENCHMARK.md](docs/PERFORMANCE-CREATE-LOCK-BENCHMARK.md), дві зміни, Before/After, trade-offs + FinOps; плюс таблиця, [docs/homework-screenshots/metrics-dashboard.html](docs/homework-screenshots/metrics-dashboard.html) для швидкого скріну, PNG Grafana/Prometheus у [docs/homework-screenshots/](docs/homework-screenshots/). **Prometheus + Grafana:** [docs/OBSERVABILITY.md](docs/OBSERVABILITY.md), `npm run observability:up`.

### Hardening — що я б сказала на планінгу

- **До:** чутливі публічні штуки (логін/реєстрація, `request-payment` без перевірки власника, admin payments) тримались переважно на бізнес-логіці, без послідовного throttling по типу трафіку, нормального audit, чіткої політики секретів/TLS на edge і базових security headers — типовий «CRUD без defence in depth».
- **Після:** глобальний + точкові throttles (auth / payments / admin / GraphQL), Helmet + trust proxy для IP за gateway, audit на важливі події без чутливих payload’ів, bootstrap секретів (`*_FILE`, обов’язковий `JWT_SECRET`, пароль сідів лише з env), опис TLS на edge (Ingress / nginx), документація + evidence.
- **Backlog (свідомо не все влізло):** IDOR на `request-payment`, TLS/mTLS для gRPC між сервісами, immutable audit sink / SIEM, captcha / anomaly detection на логін, fine-grained scopes замість лише ADMIN, CORS whitelist, GraphQL depth/cost, Vault / зовнішній secret manager як наступний рівень зрілості.

---

## Структура (де що лежить)

| Роль | Що | Де |
|------|-----|-----|
| **gRPC server** | Payments service | `apps/payments-service/` (окремий процес, свій `src/main.ts`) |
| **gRPC client** | Клієнт до Payments | У orders: `src/payment-client/` |
| **Контракт .proto** | Сервіс + повідомлення | `packages/contracts/proto/payments.proto` |

Orders **не** імпортує код з `apps/payments-service` — тільки шлях до `.proto` і свої інтерфейси під контракт.

---

## Запуск двох сервісів локально

**1. Payments** (gRPC + HTTP):

```bash
cd apps/payments-service && npm install && npm run start:dev
```

- **gRPC:** порт `5001` (за замовчуванням)
- **HTTP:** порт `3001` (за замовчуванням)
- **Env (опційно):** `GRPC_URL=0.0.0.0:5001`, `HTTP_PORT=3001`

**2. Orders** (HTTP API):

```bash
npm install && npm run start:dev
```

- **HTTP:** порт `3000`
- **Env:** обов’язковий **`JWT_SECRET`** у `.env` (інакше процес не стартує); для сіду — **`SEED_ADMIN_PASSWORD`** (див. `.env.example`).
- **Env для Payments-клієнта:**  
  `PAYMENTS_GRPC_URL=localhost:5001`  
  Опційно: `PAYMENTS_GRPC_TIMEOUT_MS=5000`, `PAYMENTS_GRPC_RETRY_ATTEMPTS=3`, `PAYMENTS_GRPC_RETRY_INITIAL_MS=200`, `PAYMENTS_GRPC_RETRY_MAX_MS=5000`.

Обидва сервіси мають бути запущені для наскрізного сценарію.

---

## Idempotency, retry, помилки

- **Idempotency key:** Authorize, Capture, Refund приймають опційний `idempotency_key`. Payments тримає результат по ключу in-memory і при повторі з тим самим ключем повертає той самий результат.
- **Retry (лише transient):** у Orders gRPC-клієнт ретраїть лише тимчасові коди (UNAVAILABLE, DEADLINE_EXCEEDED, RESOURCE_EXHAUSTED). Backoff експоненційний від `PAYMENTS_GRPC_RETRY_INITIAL_MS` з капом `PAYMENTS_GRPC_RETRY_MAX_MS`, кількість спроб — `PAYMENTS_GRPC_RETRY_ATTEMPTS`.
- **Мапінг gRPC → HTTP:** INVALID_ARGUMENT → 400, NOT_FOUND → 404, ALREADY_EXISTS → 409, DEADLINE_EXCEEDED → 504, UNAVAILABLE/RESOURCE_EXHAUSTED → 503 тощо — див. `OrdersService.mapPaymentGrpcErrorToHttp` і `src/payment-client/grpc-errors.ts`.

---

## Happy path (перевірка сценарію)

У **`.env`** задай **`JWT_SECRET`** і **`SEED_ADMIN_PASSWORD`** — шаблон у **`.env.example`**, нюанси в **`docs/SECRETS.md`**. Реальні значення не комітимо.

**Варіант A — скрипт:**

```bash
export SEED_ADMIN_PASSWORD='те саме значення що в .env для сіду'
chmod +x scripts/e2e-payment-flow.sh
./scripts/e2e-payment-flow.sh
```

Скрипт: логін → створення замовлення → `POST /orders/:id/request-payment` → у відповіді `paymentId` і `status`. Перед цим — міграції та seed.

**Варіант B — curl вручну:**

1. Логін: `POST http://localhost:3000/auth/login` з тілом `{"email":"admin@example.com","password":"<SEED_ADMIN_PASSWORD з .env>"}` → зберегти `accessToken`.
2. Створити замовлення: `POST http://localhost:3000/orders` з `Authorization: Bearer <token>` і тілом `{"userId":1,"items":[{"productId":1,"quantity":1}]}` → зберегти `data.id`.
3. Оплата: `POST http://localhost:3000/orders/<orderId>/request-payment`.

На кроці 3 очікую: `{"paymentId":"pay_...","status":"AUTHORIZED",...}`.

**Postman:** ті самі три кроки.

---

## Де лежить .proto і як підключений

```
packages/contracts/proto/payments.proto
```

- **Package:** `payments`
- **Service:** `Payments` (RPC: Authorize, GetPaymentStatus, Capture, Refund)

**Orders (клієнт):**

- CWD при старті — корінь репо.
- Шлях до proto: `process.cwd() + '/packages/contracts/proto/payments.proto'`.
- Підключення: `src/payment-client/payment-client.module.ts` через `ClientProxyFactory.create({ transport: Transport.GRPC, options: { package: 'payments', protoPath, url } })`.

**Payments (сервер):**

- CWD — `apps/payments-service/`.
- Шлях до proto: `process.cwd() + '/../../packages/contracts/proto/payments.proto'`.
- Підключення: `apps/payments-service/src/main.ts` через `connectMicroservice({ transport: Transport.GRPC, options: { package: 'payments', protoPath, url } })`.

Один файл контракту в репо, без дублювання в кожен сервіс.

---

## CI/CD (GitHub Actions)

У репозиторії піднятий pipeline для Lecture21 через GitHub Actions — нижче коротко, **що** за workflow, без маркетингу.

### 1. PR checks

- Workflow: `.github/workflows/pr-checks.yml`
- Тригер: `pull_request` у `develop` і `main`
- Jobs: **Lint** → `npm run lint`; **Unit tests** → `npm run test`; **Docker build validation** → образи `orders-api` і `payments`; **Migration / schema check** → `npm run build` + `npm run migration:run:prod` проти тимчасового Postgres
- Я б у **Settings → Branches** увімкнула required checks для `develop`/`main`, щоб merge без зелених джобів не проходив.

### 2. Build + Stage deploy

- Workflow: `.github/workflows/build-and-stage.yml`
- Тригер: `push` у `develop` і `main`
- Jobs: build/push образів у GHCR (`sha-<SHORT_SHA>`, `<FULL_SHA>`); quality gate (`npm ci`, lint, test); contract tests (`scripts/contract-test-payments.mjs`); `release-manifest.json` як artifact; для `develop` — **Deploy to Stage** через `Lecture21/scripts/deploy-stage.sh` (compose stage, health, smoke, потім down).

### 3. Production build + deploy

- Build + push: `.github/workflows/build-push-images.yml` (`push` у `main` або `workflow_dispatch`) → GHCR + artifact `release-manifest`.
- Deploy без rebuild: `.github/workflows/deploy-prod.yml` (`workflow_run` після успішного build на `main`) — читає manifest і логить образи/digest; manual approval через GitHub **Environment `production`**.

### 4. Ручний stage / prod deploy

- Stage: `.github/workflows/deploy-stage.yml` на `push` у `develop`.
- Production standalone: `.github/workflows/deploy-production.yml` на `workflow_dispatch` — нагадування, що канонічний шлях через `build-push-images.yml` + manifest.

### 5. Приклад flow

1. Гілка від `develop`, зміни в Lecture21, PR у `develop`.
2. На PR — `PR Checks`.
3. Merge у `develop` → `build-and-stage.yml` → stage.
4. Після перевірки — у `main` → build + manifest → `deploy-prod.yml` з approval на `production`.
