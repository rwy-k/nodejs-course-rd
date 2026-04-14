# Що я побачила, коли знімала baseline (і де боліло)

Це мої нотатки з прогонів: умови, цифри й висновки. Я свідомо не писала «все ідеально» — де не виміряла, так і написала.

---

## Контекст: що саме я ганяла

**Гарячий сценарій для мене** — міні-checkout: `POST /orders` з одним товаром, потім `POST /orders/{id}/request-payment`, очікую `AUTHORIZED`.

**Звідки бив трафік:** через nginx gateway `http://127.0.0.1:9080` у контейнери з `docker-compose.local.yml` (префікс імен `lecture19_*_local`).

**Baseline-прогін:** один логін адміна на старті, далі **12 серійних** циклів create + request-payment, `productId: 2`, клієнт — простий Node `fetch` на хості.

**Про throttle:** на `/auth/login` у нас жорсткий ліміт (`THROTTLE_AUTH_STRICT`: 10/хв на IP). Якщо навантажувати паралельними логінами — отримаєш **429**, і це вже не SQL, а rate limit. Для тестів я тримала **один JWT** на весь прогін.

---

## Baseline з одного прогону (цифри як є)

| Метрика | Значення |
|--------|----------|
| Ітерацій | 12 |
| Успіх / помилки | 12 / 0 |
| Час стіни | ~0.936 s |
| Throughput | ~12.8 ітерацій/s |
| p50 (create + payment за раз) | ~40 ms |
| p95 | ~229 ms |
| p99 | зливалось з p95, бо n=12 — квантиль грубий |

**Черга `orders.process`:** після прогону порожньо, один consumer (дивилась у RabbitMQ Management).

**Docker stats** (зріз після, не пік під burst): orders-api ~78 MiB, payments ~24 MiB, worker ~35 MiB, CPU в момент зрізу низький.

**Чесно про обмеження:** event loop lag я не знімала — у репо не підключала `monitorEventLoopDelay` / APM. У compose на сервісах не було `resources.requests/limits`, тому «стеля» в `docker stats` — з боку Docker Desktop.

---

## Де bottleneck (як я це сформулювала)

### 1) Overfetch на `request-payment`

**Що бачу в коді:** `findOne` тягне `relations: ['items', 'items.product', 'user']`, а в `requestPaymentForOrder` для authorize по факту потрібні id, сума, idempotency key.

**Чому це болить:** зайві JOIN-и й дані з БД на **кожному** платіжному виклику — зайвий I/O і CPU на рівні, який можна прибрати.

**Чим підкріпила:** порівняла код «що читаємо» vs «що передаємо в `paymentClient.authorize`»; плюс на тому ж сценарії p50 сильно нижче за p95 — схоже на зайву роботу й варіативність підсистем, а не на один випадковий повільний запит.

### 2) Конкуренція за `Product` у `create`

**Що в коді:** у `create()` продукти читаються з `lock: { mode: 'pessimistic_write' }`.

**Чому це може стати вузьким місцем:** якщо багато паралельних ордерів на **один** `product.id`, Postgres серіалізує транзакції на рядку.

**Чим підкріпила:** семантика lock явна в коді; **плюс HTTP A/B** — 20 паралельних `POST /orders` «усі в SKU 2» vs «цикл SKU 1..4»: стіна ~**1021 ms** vs ~**324 ms**, p99 ~**996 ms** vs ~**318 ms** (деталі й умови — [PERFORMANCE-CREATE-LOCK-BENCHMARK.md](PERFORMANCE-CREATE-LOCK-BENCHMARK.md), скрипт [scripts/perf-create-lock-contention.mjs](../scripts/perf-create-lock-contention.mjs)). Щоб прогін не заклинював пул з’єднань після `commit`, post-commit `findOne` переведено на `queryRunner.manager` — описано в тому ж файлі.

---

## Як я це зводила в докази

| Джерело | Що побачила | Що з цього випливає |
|---------|-------------|---------------------|
| Код `findOne` → `requestPaymentForOrder` | Relations ширші, ніж потрібно для authorize | Overfetch — відтворюється читанням коду, не «відчуттям» |
| Baseline, 0 помилок | p50 ~40 ms, p95 ~229 ms | Є «хвіст», який хочеться розібрати |
| Паралельні логіни | 429 | Окремий клас bottleneck — throttle, не БД |
| `create()` + pessimistic lock | Код + бенч hot vs spread | Паралель на один SKU дає ~**3×** вищу стіну часу й p99, ніж рознесення по 4 SKU |

**Плюс шар БД:** я додала порівняння планів `EXPLAIN (ANALYZE, BUFFERS)` — [PERFORMANCE-SQL-AND-TRACE.md](PERFORMANCE-SQL-AND-TRACE.md) і скрипт [scripts/perf-explain-order-queries.sql](../scripts/perf-explain-order-queries.sql). У dev SQL TypeORM світиться в консолі при `NODE_ENV=development` — див. [typeorm.config.ts](../src/config/typeorm.config.ts).
