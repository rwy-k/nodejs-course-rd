# SQL і трейс

## 1. Як повторити у себе

1. Підняти Postgres (у мене був `docker-compose.local.yml`, можна свій), накатити міграції + seed, щоб у `orders` був хоч один рядок (часто `id = 1`).
2. Зайти `psql` у ту саму БД, що бачить Orders (`DATABASE_URL` або змінні з `.env`).
3. У скрипті нижче підставити свій `id` замовлення (якщо не 1 — змінити `\set`).

Готовий файл: [../scripts/perf-explain-order-queries.sql](../scripts/perf-explain-order-queries.sql).

## 2. Що я порівнюю

| Варіант | Що це за запит | Де в коді |
|--------|----------------|-----------|
| **Narrow** | Тільки `id`, `totalAmount`, `idempotencyKey` з `orders` | `findOrderForPaymentAuthorize` у `src/orders/orders.service.ts` |
| **Wide** | Один `SELECT` з `LEFT JOIN` на `order_items`, `products`, `users` | Наближений еквівалент того, що робить `findOne` з `relations: ['items', 'items.product', 'user']` |

## 3. Як читати `EXPLAIN (ANALYZE, BUFFERS)`

- **Narrow:** зазвичай один прохід по `orders`, мало рядків, скромні `Buffers: shared hit=...`.
- **Wide:** з’являються лупи/джойни до `order_items`, `products`, `users` — більше `actual rows` і читань з буфера; на великому замовленні це ще помітніше.
- Я порівнюю **`Execution Time`** на тому ж `id` — різниця має бути логічною навіть на маленькій dev-БД.

## 4. Лог SQL без окремого APM

У нас TypeORM у dev уже логує SQL:

```17:17:src/config/typeorm.config.ts
  logging: process.env.NODE_ENV === 'development',
```

Якщо підняти API з `NODE_ENV=development` і вдарити один раз по `request-payment`, у консолі видно, скільки «шуму» йде в БД.

## 5. Як це лягає на HTTP-цифри

У [PERFORMANCE-BEFORE-AFTER.md](PERFORMANCE-BEFORE-AFTER.md) я зафіксувала нижчий **p99** і вищий **throughput** на 80× `request-payment`. Цей файл про шар БД: менше роботи в Postgres узгоджується з тим, що хвіст latency став коротшим.
