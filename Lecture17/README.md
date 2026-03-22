# Lecture 17 — Orders + Payments + Worker (gRPC, deploy)

Backend (NestJS) з трьома deployable units: **orders-api**, **payments**, **worker**. Production Dockerfile, Docker Compose та опційно Kubernetes/Minikube для локального деплою.

Два NestJS-сервіси: **Orders** (HTTP) викликає **Payments** (gRPC) через контракт `.proto`. **Worker** обробляє чергу `orders.process` (RabbitMQ).

---

## Структура (де що лежить)

| Роль | Що | Де |
|------|-----|-----|
| **gRPC server** | Payments service | `apps/payments-service/` (окремий процес, свій entrypoint `src/main.ts`) |
| **gRPC client** | Клієнт до Payments | У orders: `src/payment-client/` (модуль + сервіс), викликає лише по контракту .proto |
| **Контракт .proto** | Сервіс + повідомлення | `packages/contracts/proto/payments.proto` (один файл для обох сервісів) |

Orders не імпортує код з `apps/payments-service` — тільки шлях до `.proto` та локальні інтерфейси під контракт.

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
- **Env (потрібні для Payments-клієнта):**  
  `PAYMENTS_GRPC_URL=localhost:5001`  
  Опційно: `PAYMENTS_GRPC_TIMEOUT_MS=5000`, `PAYMENTS_GRPC_RETRY_ATTEMPTS=3`, `PAYMENTS_GRPC_RETRY_INITIAL_MS=200`, `PAYMENTS_GRPC_RETRY_MAX_MS=5000`.

Обидва сервіси мають бути запущені для наскрізного сценарію.

---

## Idempotency, retry, помилки

- **Idempotency key:** Authorize, Capture, Refund приймають опційний `idempotency_key`. Payments зберігає результат по ключу in-memory і при повторному запиті з тим самим ключем повертає той самий результат (без повторної обробки).
- **Retry (лише transient):** У Orders gRPC-клієнт робить retry тільки для тимчасових помилок (UNAVAILABLE, DEADLINE_EXCEEDED, RESOURCE_EXHAUSTED). Backoff: експоненційний від `PAYMENTS_GRPC_RETRY_INITIAL_MS` з обмеженням `PAYMENTS_GRPC_RETRY_MAX_MS`, ліміт спроб — `PAYMENTS_GRPC_RETRY_ATTEMPTS` (з env/config).
- **Мапінг gRPC → HTTP:** Помилки від Payments у Orders перетворюються на зрозумілі HTTP-відповіді: INVALID_ARGUMENT → 400, NOT_FOUND → 404, ALREADY_EXISTS → 409, DEADLINE_EXCEEDED → 504, UNAVAILABLE/RESOURCE_EXHAUSTED → 503 тощо (див. `OrdersService.mapPaymentGrpcErrorToHttp` і `src/payment-client/grpc-errors.ts`).

---

## Happy path (перевірка сценарію)

**Варіант A — скрипт:**

```bash
chmod +x scripts/e2e-payment-flow.sh
./scripts/e2e-payment-flow.sh
```

Скрипт: логін → створення замовлення → `POST /orders/:id/request-payment` → у відповіді `paymentId` та `status`. Перед цим потрібні міграції та seed (admin + продукти).

**Варіант B — curl вручну:**

1. Логін: `POST http://localhost:3000/auth/login` з тілом `{"email":"admin@example.com","password":"admin123"}` → зберегти `accessToken`.
2. Створити замовлення: `POST http://localhost:3000/orders` з заголовком `Authorization: Bearer <token>` і тілом `{"userId":1,"items":[{"productId":1,"quantity":1}]}` → зберегти `data.id`.
3. Запит оплати: `POST http://localhost:3000/orders/<orderId>/request-payment` (без обов’язкового заголовка).

У відповіді на крок 3 очікується: `{"paymentId":"pay_...","status":"AUTHORIZED",...}`.

**Postman:** ті самі кроки: `POST /auth/login` → `POST /orders` (з Bearer) → `POST /orders/:id/request-payment`.

---

## Де лежить .proto і як підключений

**Файл контракту (один на обидва сервіси):**

```
packages/contracts/proto/payments.proto
```

- **Package:** `payments`
- **Service:** `Payments` (RPC: Authorize, GetPaymentStatus, Capture, Refund)

**Orders (клієнт):**

- Робоча директорія при старті — корінь репо.
- Шлях до proto: `process.cwd() + '/packages/contracts/proto/payments.proto'`.
- Підключення: у `src/payment-client/payment-client.module.ts` через `ClientProxyFactory.create({ transport: Transport.GRPC, options: { package: 'payments', protoPath, url } })`. Код Payments не імпортується — лише цей шлях і локальні інтерфейси під контракт.

**Payments (сервер):**

- Робоча директорія при старті — `apps/payments-service/`.
- Шлях до proto: `process.cwd() + '/../../packages/contracts/proto/payments.proto'`.
- Підключення: у `apps/payments-service/src/main.ts` через `connectMicroservice({ transport: Transport.GRPC, options: { package: 'payments', protoPath, url } })`.

Обидва сервіси використовують один і той самий файл з репо; окремого копіювання в кожен сервіс немає.

---

## CI/CD (GitHub Actions)

У репозиторії налаштований повний CI/CD pipeline для Lecture17 через GitHub Actions.

### 1. PR checks

- Workflow: `.github/workflows/pr-checks.yml`
- Тригер: `pull_request` у `develop` і `main`
- Jobs:
  - **Lint** → `npm run lint`
  - **Unit tests** → `npm run test`
  - **Docker build validation** → збірка Docker-образів `orders-api` і `payments` (перевірка Dockerfile)
  - **Migration / schema check** → `npm run build` + `npm run migration:run:prod` проти тимчасового Postgres
- Рекомендація: у **Settings → Branches** для `develop` і `main` додати required checks з цих jobs, щоб merge PR був можливий лише коли всі зелені.

### 2. Build + Stage deploy

- Workflow: `.github/workflows/build-and-stage.yml`
- Тригер: `push` у `develop` і `main`
- Jobs:
  - **Build orders-api / payments** → збірка та пуш Docker-образів у GHCR з immutable тегом:
    - `sha-<SHORT_SHA>` (short commit)
    - `<FULL_SHA>` (повний commit)
  - **Quality gate** → `npm ci`, `npm run lint`, `npm run test`
  - **Contract tests** → збірка образу payments, запуск контейнера, gRPC contract test (`scripts/contract-test-payments.mjs`)
  - **Coordinated release manifest** → створює `release-manifest.json` з `commit`, `tag`, образами `orders-api`, `payments`, `worker` (з digest) і вантажить як artifact
  - **Deploy to Stage** (тільки для `develop`) → запускає `Lecture17/scripts/deploy-stage.sh`, який:
    - будує локальні образи для stage
    - піднімає stack через `docker-compose.stage.yml` (Postgres, RabbitMQ, migrate, orders, payments, worker)
    - чекає health + виконує smoke-тести
    - після перевірки гасить stack

### 3. Production build + deploy

- Build + push:
  - Workflow: `.github/workflows/build-push-images.yml`
  - Тригер: `push` у `main` або `workflow_dispatch`
  - Збирає та пушить образи `orders-api` і `payments` у GHCR з immutable тегами (як вище)
  - Створює `release-manifest.json` з образами (включно з `worker`) і завантажує як artifact `release-manifest`
- Production deploy (без rebuild):
  - Workflow: `.github/workflows/deploy-prod.yml` (`workflow_run` після успішного `Build and Stage` на `main`)
  - Читає artifact `release-manifest` і логрує, які саме образи/дизести деплояться
  - Коментарі у workflow підказують, що далі потрібно використати ці теги/дизести у вашому реальному кластері (kubectl/ECS тощо)
  - Manual approval реалізується через GitHub **Environment `production`** з Required reviewers (у Settings → Environments)

### 4. Ручний stage / prod deploy

- Stage:
  - Workflow: `.github/workflows/deploy-stage.yml`
  - Тригер: `push` у `develop`
  - Самостійно виконує build образів і викликає `scripts/deploy-stage.sh` (аналогічно job-у `Deploy to Stage` з `build-and-stage.yml`)
- Production (standalone):
  - Workflow: `.github/workflows/deploy-production.yml`
  - Тригер: `workflow_dispatch`
  - Використовується як ручний вхід у production deploy: показує, що канонічний шлях — через `build-push-images.yml` + `release-manifest`

### 5. End-to-end flow (приклад)

1. Розробка → створити гілку від `develop`, зробити зміни в Lecture17, відкрити PR у `develop`.
2. На PR проходить `PR Checks` (Lint, Unit tests, Docker build validation, Migration / schema check).
3. Після green checks PR merge у `develop`:
   - `build-and-stage.yml` будує образи, запускає quality gate + contract tests і автоматично деплоїть на **stage**.
4. Після перевірки на stage (e2e або мануально) merge/реліз у `main`:
   - `build-and-stage.yml` + `build-push-images.yml` створюють/оновлюють `release-manifest` з immutable тегами.
   - `deploy-prod.yml` (або `deploy-production.yml` за потреби) використовує цей manifest для **production deploy** з manual approval через Environment `production`.
