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

- Робоча директорія при старті — корінь репо (`Lecture14/`).
- Шлях до proto: `process.cwd() + '/packages/contracts/proto/payments.proto'`.
- Підключення: у `src/payment-client/payment-client.module.ts` через `ClientProxyFactory.create({ transport: Transport.GRPC, options: { package: 'payments', protoPath, url } })`. Код Payments не імпортується — лише цей шлях і локальні інтерфейси під контракт.

**Payments (сервер):**

- Робоча директорія при старті — `apps/payments-service/`.
- Шлях до proto: `process.cwd() + '/../../packages/contracts/proto/payments.proto'`.
- Підключення: у `apps/payments-service/src/main.ts` через `connectMicroservice({ transport: Transport.GRPC, options: { package: 'payments', protoPath, url } })`.

Обидва сервіси використовують один і той самий файл з репо; окремого копіювання в кожен сервіс немає.

---

## Як перевірити, що все працює коректно

### 1. Локально (без GitHub)

У корені проєкту (Lecture17):

```bash
npm ci
npm run lint          # має пройти без помилок
npm run test          # unit-тести зелені
npm run build         # збірка без помилок
```

Contract test (потрібен запущений payments):

```bash
# Термінал 1: запустити payments
docker run -d --name pay -p 5001:5001 -e GRPC_URL=0.0.0.0:5001 $(docker build -q -f apps/payments-service/Dockerfile --target prod .)

# Термінал 2: перевірка контракту
npm run test:contract

docker rm -f pay
```

Локальний стек (compose):

```bash
cp .env.example .env   # заповнити DB_PASSWORD, JWT_SECRET тощо
./scripts/deploy-local.sh
# Міграції: docker compose -f docker-compose.local.yml --profile tools run --rm migrate
# Seed:      docker compose -f docker-compose.local.yml --profile tools run --rm seed
curl -s http://localhost:8080/health   # має повернути {"status":"ok"}
```

### 2. PR workflow (pr-checks)

1. Створити гілку від `develop`, внести зміни, відкрити **Pull Request** у `develop` або `main`.
2. У PR мають запуститися jobs: **Lint**, **Unit tests**, **Docker build validation**, **Migration / schema check**.
3. Усі мають бути зеленими. Якщо хоча б один червоний — merge має бути заблоковано (якщо в Settings → Branches увімкнені required status checks).

### 3. Build + Stage (develop)

1. Змержити PR у гілку **develop** (або push напряму у develop).
2. Запуститься workflow **Build and Stage**: build orders-api, build payments, quality-gate (lint+unit), contract-tests, release-manifest, **Deploy to Stage** (environment: stage).
3. У Actions перевірити, що всі jobs зелені; у job **Deploy to Stage** у логах має бути «Stage deploy and post-deploy checks passed».

### 4. Production (main + approval)

1. Змержити (наприклад з develop) у гілку **main**.
2. Запуститься **Build and Stage** на main: build, contract-tests, release-manifest, upload artifact (без deploy-stage).
3. Після успішного завершення запуститься **Deploy Production** (workflow `deploy-prod.yml`): job має перейти в стан **Waiting for approval** (якщо в Settings → Environments → production увімкнені Required reviewers).
4. Після **Review deployments** і approve job виконається: завантажиться artifact release-manifest, у логах будуть commit_sha, image_tag, target_environment, services.

### 5. Швидкий чек-лист

| Що перевірити | Як |
|---------------|-----|
| Lint і тести | `npm run lint && npm run test` |
| Збірка | `npm run build` |
| Contract test | Запустити payments контейнер, далі `npm run test:contract` |
| Docker-образи | `docker build -t orders-api:test --target prod .` і аналогічно для payments |
| Stage deploy | Push у develop → переглянути run **Build and Stage**, job **Deploy to Stage** |
| Prod approval | Push у main → переглянути **Deploy Production** → має чекати approval |
| Секрети не в репо | Переконатися, що `.env` і `secrets/` у `.gitignore`, у репо немає файлів з паролями |
