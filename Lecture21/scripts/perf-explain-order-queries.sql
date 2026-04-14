-- Порівняння планів Postgres: narrow (після оптимізації) vs wide (overfetch).
-- Запуск: psql "$DATABASE_URL" -f scripts/perf-explain-order-queries.sql
-- Змініть рядок \set на реальний id замовлення з вашої БД.

\set order_id 1

\echo '=== NARROW (findOrderForPaymentAuthorize) ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT o."id", o."totalAmount", o."idempotencyKey"
FROM "orders" o
WHERE o."id" = :order_id;

\echo '=== WIDE (еквівалент findOne + items + product + user) ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT
  o."id",
  o."totalAmount",
  o."idempotencyKey",
  o."status",
  oi."id" AS "orderItemId",
  p."id" AS "productId",
  u."id" AS "userId"
FROM "orders" o
LEFT JOIN "order_items" oi ON oi."orderId" = o."id"
LEFT JOIN "products" p ON p."id" = oi."productId"
LEFT JOIN "users" u ON u."id" = o."userId"
WHERE o."id" = :order_id;
