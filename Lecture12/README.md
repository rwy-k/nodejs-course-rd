# Lecture 12 — Orders + RabbitMQ (воркер, retry, DLQ, idempotency)

У цьому README описано: **як запустити** проєкт, **топологію** RabbitMQ, **обраний retry-механізм**, **як відтворити чотири сценарії** (happy path, retry, DLQ, idempotency) та **реалізацію ідемпотентності** воркера.

| Що | Де в README |
|----|-------------|
| **Як запустити** | [1. Швидкий старт (запуск)](#1-швидкий-старт-запуск) |
| **Яка топологія** | [2. RabbitMQ — топологія](#2-rabbitmq--топологія-exchanges-queues-routing) |
| **Який retry-механізм обрано** | [3. Retry-механізм](#3-retry-механізм-варіант-a--republish--ack) |
| **Як відтворити 4 сценарії** | [4. Перевірка сценаріїв](#4-перевірка-сценаріїв) |
| **Як реалізована idempotency** | [5. Ідемпотентність воркера](#5-ідемпотентність-воркера-at-least-once-delivery) |

---

## 1. Швидкий старт (запуск)

**Передумови:** Node.js, Docker і Docker Compose.

1. **Скопіюйте змінні середовища:**
   ```bash
   cp .env.example .env
   ```
   За потреби відредагуйте `.env` (пароль БД, JWT_SECRET тощо).

2. **Запуск інфраструктури (PostgreSQL + RabbitMQ):**
   - **Development** (API з hot reload):
     ```bash
     docker compose -f compose.dev.yml up -d
     ```
     API: http://localhost:3000  
     RabbitMQ Management: http://localhost:15672 (guest/guest)
   - **Production-like** (лише сервіси, без збірки API):
     ```bash
     docker compose up -d postgres rabbitmq
     ```

3. **Міграції та seed** (за потреби):
   ```bash
   # Dev
   docker compose -f compose.dev.yml run --rm migrate
   docker compose -f compose.dev.yml run --rm seed
   # Prod
   docker compose --profile tools run --rm migrate
   docker compose --profile tools run --rm seed
   ```

4. **Локальна розробка без Docker для API:**
   ```bash
   npm install
   npm run start:dev
   ```
   PostgreSQL і RabbitMQ мають бути доступні (наприклад, через `docker compose -f compose.dev.yml up -d postgres rabbitmq`).

   Для публікації в RabbitMQ потрібні залежності: `npm install amqplib` та `npm install -D @types/amqplib`.

---

## 2. RabbitMQ — топологія (exchanges, queues, routing)

Топологія задається вручну (assert при старті API). Мінімум: **orders.process**, **orders.dlq**. Окремої retry-черги немає (retry через republish у ту ж `orders.process`); якщо буде — іменування **orders.retry.***.

### Exchanges

| Exchange | Тип | Призначення |
|----------|-----|-------------|
| *(default)* `""` | direct | Публікація напряму в чергу: `sendToQueue(queueName)` = publish у default exchange з routing key = ім'я черги. |

Іменовані exchanges не використовуються: повідомлення йдуть у черги через default exchange.

### Queues

| Queue | Durable | Призначення |
|-------|---------|-------------|
| `orders.process` | ✓ | Основна черга обробки замовлень. Споживає воркер; після помилки (з retry) повідомлення republish сюди ж або летить у DLQ. |
| `orders.dlq` | ✓ | Dead Letter Queue: повідомлення, які перевищили ліміт спроб (attempt ≥ MAX_ATTEMPTS). |
| `orders.retry.*` | — | У поточній реалізації **немає** окремої retry-черги. Якщо з’явиться (наприклад, варіант з DLX/TTL) — використовувати іменування `orders.retry.*`. |

### Routing keys

При публікації через **default exchange** routing key = ім'я черги:

| Куди летить | Routing key | Хто публікує |
|-------------|-------------|--------------|
| `orders.process` | `orders.process` | API (`POST /orders`), воркер (republish при retry) |
| `orders.dlq` | `orders.dlq` | Воркер (після вичерпання спроб) |

### Що куди летить (потік)

1. **POST /orders** (успіх) → публікація в **orders.process** (attempt=0).
2. Воркер забирає з **orders.process** → обробка.
3. **Успіх** → ack; повідомлення зникає з черги.
4. **Помилка, attempt < MAX** → ack оригіналу → затримка → republish у **orders.process** (attempt+1) → знову крок 2.
5. **Помилка, attempt ≥ MAX** → публікація в **orders.dlq** (з `failedAt`, `reason`) → ack оригіналу.

### Як перевірити через Management UI

1. Відкрити **http://localhost:15672** (логін/пароль з `.env`: RABBITMQ_USER / RABBITMQ_PASSWORD, за замовчуванням guest/guest).
2. Вкладка **Queues** — мають бути черги **orders.process** та **orders.dlq** (Features: D).
3. Перевірити кількість повідомлень:
   - **Ready** — очікують споживання;
   - **Unacked** — взяті воркером, ще не ack.
4. Переглянути тіло повідомлення: вибрати чергу → **Get messages** (Get) → перевірити payload (messageId, orderId, attempt, тощо).
5. Після **POST /orders** у **orders.process** з’явиться 1 Ready (або Unacked, якщо воркер вже взяв). Після успішної обробки — Ready/Total зменшаться після ack.
6. Повідомлення після вичерпання retry потрапляють у **orders.dlq** — перевірити там наявність і вміст (failedAt, reason).

---

### Деталі по черзі orders.process

- **Хто створює:** API при старті викликає `channel.assertQueue('orders.process', { durable: true })`.
- **Producer:** `POST /orders` після успішного створення запису в БД публікує повідомлення; HTTP-відповідь повертається одразу.

**Формат повідомлення (тіло):**

```json
{
  "messageId": "uuid",
  "orderId": 123,
  "createdAt": "2025-02-28T12:00:00.000Z",
  "attempt": 0,
  "producer": "nestjs-shop-api",
  "eventName": "order.created"
}
```

Опційно можна додати `correlationId` для трасування запиту.

### Воркер обробки замовлень (orders.process)

Воркер реалізований як **окремий NestJS-сервіс** (`OrderProcessorModule`), що підписаний на чергу `orders.process`.

- **Manual ack:** використовується `noAck: false`; повідомлення підтверджується тільки після успішного commit у БД.
- **Воркфлоу:** отримав повідомлення → почав транзакцію → INSERT у `processed_messages` (або пропуск при duplicate) → основна логіка → commit → ack.
- **Обробка замовлення:** оновлюється `orders.status = PROCESSED`, встановлюється `orders.processedAt`. Симуляція зовнішнього сервісу: `ORDER_PROCESSOR_SLEEP_MS=300` (200–500 ms) у `.env`.
- **Prefetch:** 1 (одне повідомлення в обробці на воркера).

Запуск: воркер стартує разом з API (той самий процес). Для окремого процесу можна винести споживача в окремий entry point.

## 5. Ідемпотентність воркера (at-least-once delivery)

RabbitMQ гарантує at-least-once delivery, тому воркер має бути ідемпотентним. Використовується таблиця **`processed_messages`**:

| Колонка       | Опис                          |
|---------------|-------------------------------|
| `messageId`   | Унікальний ідентифікатор (PK) |
| `processedAt` | Час обробки                   |
| `orderId`     | ID замовлення                 |
| `handler`     | Опційно, назва handler (напр. `order.process`) |

**Алгоритм:**

1. Почати транзакцію.
2. Спробувати `INSERT INTO processed_messages (message_id, ...)`.
3. Якщо **unique violation** → ack, вийти без повторної обробки (повідомлення вже оброблялося).
4. Якщо insert успішний → виконати основну логіку (оновлення замовлення), commit, ack.

Захист працює при **паралельних воркерах** за рахунок unique constraint на `message_id`: лише один воркер зможе вставити запис для даного повідомлення.

## 3. Retry-механізм (варіант A — republish + ack)

Обрано **варіант A**: при помилці оригінал ack, потім або **republish** у `orders.process` з `attempt + 1` (з затримкою), або публікація в **orders.dlq** після вичерпання спроб. Окремої retry-черги (DLX/TTL) немає.

- **Максимум спроб:** 3 (за замовчуванням). Змінна середовища `ORDER_PROCESSOR_MAX_ATTEMPTS` (наприклад, 5).
- **Затримка між спробами:** 5 секунд (за замовчуванням). Змінна `ORDER_PROCESSOR_RETRY_DELAY_MS` (мс).
- **Поведінка при помилці:** якщо обробка впала — ack оригіналу (повідомлення з черги знімається). Якщо `attempt < MAX_ATTEMPTS` — чекаємо `RETRY_DELAY_MS`, потім republish у `orders.process` з `attempt + 1`. Якщо `attempt >= MAX_ATTEMPTS` — публікуємо повідомлення в **`orders.dlq`** і ack оригіналу.
- **Черга DLQ:** `orders.dlq` (durable). Топологія створюється при старті (assert). У повідомленні в DLQ зберігаються оригінальні поля плюс `failedAt` (ISO), `reason` (текст помилки).
- Retry і DLQ відтворювані та контрольовані: кількість спроб і затримка задаються через env; черги assert при підключенні.

---

## 4. Перевірка сценаріїв

Перед перевіркою: API та воркер запущені, PostgreSQL і RabbitMQ працюють. Можна використовувати REST (curl/Postman) та RabbitMQ Management UI (http://localhost:15672).

### 4.1 Happy path

**Мета:** створити замовлення → статус PENDING → воркер обробить → статус PROCESSED.

1. Створити замовлення: `POST /orders` (тіло: `userId`, `items`, опційно `shippingAddress`). Очікується `201 Created` і запис у БД з `status: "pending"`.
2. У БД перевірити: `orders.status = 'pending'` для нового замовлення.
3. Зачекати кілька секунд. У логах воркера має з’явитися рядок з `result=success` для відповідного `messageId` та `orderId`.
4. У БД перевірити: для цього замовлення `orders.status = 'processed'`, `orders.processedAt` заповнено.

### 4.2 Retry

**Мета:** змусити воркер падати й перевірити кількість спроб (retry).

1. Тимчасово змусити воркер падати (наприклад, у `OrderProcessorService` після insert у `processed_messages` додати `throw new Error('Test retry');` або тимчасово зламати з’єднання з БД).
2. Встановити `ORDER_PROCESSOR_MAX_ATTEMPTS=3`, `ORDER_PROCESSOR_RETRY_DELAY_MS=2000`.
3. Створити нове замовлення через `POST /orders`.
4. У логах воркера перевірити:
   - спроба 1: `result=retry reason=...` (або текст вашої помилки);
   - після затримки спроба 2: знову `result=retry`;
   - після третьої невдалої спроби: `result=dlq reason=...`.
5. Переконатися, що в логах є рівно три спроби (attempt 0, 1, 2) перед переходом у DLQ.

### 4.3 DLQ

**Мета:** після MAX спроб повідомлення потрапляє в `orders.dlq`.

1. Виконати сценарій 4.2 до кінця (або вручну опублікувати в `orders.process` повідомлення з `attempt: 2` і зламати обробку).
2. У логах воркера: рядок `result=dlq reason=...` з потрібним `messageId` та `orderId`.
3. У RabbitMQ Management UI: вкладка **Queues** → черга **orders.dlq** → збільшилось **Ready** (або **Total**).
4. У черзі **orders.dlq** натиснути **Get messages** → отримати повідомлення. Перевірити в payload: `messageId`, `orderId`, `attempt` (≥ MAX), `failedAt`, `reason`.

### 4.4 Idempotency

**Мета:** повторно надіслати те саме `messageId` і переконатися, що повторної обробки немає.

1. Взяти вже оброблене замовлення (або створити одне і дочекатися `result=success`).
2. З БД або з логів взяти `messageId` цього повідомлення (або з таблиці `processed_messages`).
3. Вручну опублікувати в чергу **orders.process** повідомлення з тим самим `messageId` і тим самим `orderId` (наприклад, через Management UI: Queues → orders.process → Publish message, payload JSON з цими полями + `attempt: 0`, `createdAt`, тощо).
4. У логах воркера: один рядок з `result=success reason=already processed (idempotent skip)` для цього `messageId`. Жодної повторної зміни замовлення в БД.
5. У БД: для цього `orderId` лише один запис у `processed_messages` з цим `messageId`; `orders` не змінювався повторно.

---

## Огляд Docker-конфігурації

### Додані файли


| Файл                 | Призначення                                                                             |
| -------------------- | --------------------------------------------------------------------------------------- |
| `Dockerfile`         | Multi-stage збірка (6 stages: deps → dev → build → migrations → prod → prod-distroless) |
| `docker-compose.yml` | Production-like: api + **PostgreSQL** + **RabbitMQ**, Docker secrets, internal network  |
| `compose.dev.yml`    | Development: hot reload, bind mounts, postgres + rabbitmq exposed                        |
| `.dockerignore`      | Виключає src/, .env, secrets/, tests з image                                            |
| `.env.example`       | Шаблон змінних для dev                                                                  |
| `secrets/*.example`  | Шаблони Docker secrets для prod                                                         |


### Dev vs Prod-like


| Аспект          | Development (`compose.dev.yml`) | Production (`docker-compose.yml`) |
| --------------- | ------------------------------- | --------------------------------- |
| **API image**   | `dev` target + bind mount       | `prod` або `prod-distroless`      |
| **Hot reload**  | `npm run start:dev`             | compiled JS                       |
| **Source code** | Bind-mounted `./src:/app/src`   | Скомпільовано в image             |
| **Postgres**    | Exposed (5432)                 | Internal network only             |
| **RabbitMQ**   | Exposed (5672, 15672 mgmt)     | Internal network only             |
| **Secrets**     | `.env` file                     | Docker secrets files              |
| **User**        | root (для bind mounts)          | node (1000) / nonroot (65532)     |


### Міграції та Seed

```bash
# Development
docker compose -f compose.dev.yml run --rm migrate
docker compose -f compose.dev.yml run --rm seed

# Production
docker compose run --rm migrate
docker compose run --rm seed
```

- Запускаються як **one-off контейнери** (профіль `tools`)
- Використовують `migrations` target (має shell для TypeORM CLI)
- `seed` залежить від `migrate` (`service_completed_successfully`)

### Порівняння образів

```bash
# Після збірки всіх targets
docker build --target dev -t nestjs-shop:dev .
docker build --target prod -t nestjs-shop:prod .
docker build --target prod-distroless -t nestjs-shop:distroless .

# Порівняти розміри
docker image ls | grep nestjs-shop
```


| Image                    | Розмір | Склад                                 |
| ------------------------ | ------ | ------------------------------------- |
| `nestjs-shop:dev`        | ~400MB | node:alpine + devDependencies + tools |
| `nestjs-shop:prod`       | ~250MB | node:alpine + prod deps only          |
| `nestjs-shop:distroless` | ~180MB | distroless + prod deps only           |


```bash
# Аналіз шарів
docker history nestjs-shop:prod --no-trunc
docker history nestjs-shop:distroless --no-trunc
```

**Висновок**: `prod-distroless` найменший і найбезпечніший:

- Немає shell → неможливо exec/injection
- Немає package manager → неможливо встановити malware
- Мінімум бінарників → менше CVE

---

## Local Development (без Docker)

```bash
npm install
npm run start:dev
```

