## GraphQL Integration

### Чому обрано Code-First підхід
Для інтеграції GraphQL я обрала **code-first** підхід замість schema-first, бо code-first забезпечує тісну інтеграцію з TypeScript та NestJS — типи описуються через декоратори безпосередньо в коді, що дає type-safe резолвери та автоматичну генерацію GraphQL схеми. Це зменшує необхідність ручної синхронізації між `.graphql` файлами та TypeScript типами, пришвидшує розробку і знижує ймовірність помилок через невідповідність схеми та коду.

### Архітектура Orders Query
```
GraphQL Request
     │
┌─────────────────────────────────────────┐
│  OrderResolver (thin)                   │
│  - приймає filter, pagination args      │
│  - викликає ordersService               │
│  - формує OrdersConnection response     │
│  - НЕ містить бізнес-логіки             │
└─────────────────────────────────────────┘
     │
┌─────────────────────────────────────────┐
│  OrdersService.findAllFiltered()        │
│  - будує QueryBuilder з фільтрами       │
│  - застосовує status, dateFrom, dateTo  │
│  - виконує пагінацію (limit/offset)     │
│  - рахує totalCount                     │
│  - ВСЯ бізнес-логіка тут                │
└─────────────────────────────────────────┘
     │
┌─────────────────────────────────────────┐
│  TypeORM Repository                     │
│  - SQL запити до PostgreSQL             │
└─────────────────────────────────────────┘
```

### Pagination: Connection Pattern
Для пагінації замовлень я обрала **Connection pattern** замість простого масиву з аргументами. Цей підхід, як я розумію, відповідає Relay Connection Specification і надає клієнту більше інформації: `totalCount` дозволяє відображати загальну кількість елементів і будувати UI пагінації, а `pageInfo` з полями `hasNextPage`/`hasPreviousPage` спрощує логіку навігації — клієнт одразу знає, чи є ще сторінки.

### N+1 Problem Detection
Для демонстрації N+1 проблеми було:
1. **Увімкнено SQL логування** у `TypeOrmModule`
2. **Виконано запит:**
   ```graphql
   { orders { nodes { id items { product { id name } } } } }
   ```
3. **Результат у логах** (2 order items = 2 окремих запити до products):
   ```sql
   -- Основний запит (orders + items)
   query: SELECT ... FROM "orders" LEFT JOIN "order_items" ...

   -- N+1: окремий запит для кожного product
   query: SELECT ... FROM "products" WHERE "Product"."id" = 2
   query: SELECT ... FROM "products" WHERE "Product"."id" = 1
   ```

### DataLoader Solution: До / Після

| Метрика | До DataLoader | Після DataLoader |
|---------|---------------|------------------|
| SQL запитів до `products` | N (по одному на item) | 1 (батчований) |
| Приклад (2 items) | 2 SELECT | 1 SELECT |
| Приклад (100 items) | 100 SELECT | 1 SELECT |

**До (N+1 проблема):**
```sql
-- Окремий запит для КОЖНОГО order item
SELECT ... FROM "products" WHERE "Product"."id" = 2
SELECT ... FROM "products" WHERE "Product"."id" = 1
```
**Після (DataLoader):**
```sql
-- ОДИН батчований запит з WHERE ... IN (...)
SELECT ... FROM "products" WHERE "Product"."id" IN (1, 2)
```
**Що змінилось:**
- DataLoader (`src/graphql/loaders/product.loader.ts`) збирає всі `productId` з одного GraphQL запиту
- Замість N окремих `findOne(id)` викликається один `findByIds([...ids])` з `WHERE id IN (...)`
- `Scope.REQUEST` гарантує новий loader для кожного запиту (ізоляція кешу)
- Результати маппляться назад у правильному порядку: `keys[i] → results[i]`

### Приклади GraphQL Queries для перевірки
**1. Smoke-test:**
```graphql
{ hello }
```
**2. Список замовлень з пагінацією та фільтрацією:**
```graphql
query Orders($filter: OrdersFilterInput, $pagination: OrdersPaginationInput) {
  orders(filter: $filter, pagination: $pagination) {
    nodes {
      id
      status
      totalAmount
      createdAt
      items {
        quantity
        price
        product {
          id
          name
          price
        }
      }
      user {
        firstName
        lastName
        email
      }
    }
    totalCount
    pageInfo {
      hasNextPage
      hasPreviousPage
      startCursor
      endCursor
    }
  }
}
```
Variables:
```json
{
  "filter": { "status": "PENDING" },
  "pagination": { "first": 10 }
}
```
**3. Cursor-based пагінація (наступна сторінка):**
```graphql
{
  orders(pagination: { first: 5, after: "MnwyMDI2LTAyLTA4VDIxOjQzOjA5LjA0NVo=" }) {
    nodes { id status }
    pageInfo { hasNextPage endCursor }
  }
}
```
**4. Одне замовлення за ID:**
```graphql
{ order(id: 1) { id status items { product { name } } } }
```
**5. Всі продукти:**
```graphql
{ products { id name price stock isAvailable } }
```
**6. Перевірка max limit (має повернути помилку):**
```graphql
{ orders(pagination: { first: 100 }) { totalCount } }
```
Очікувана відповідь:
```json
{ "errors": [{ "message": "first cannot exceed 50 (query complexity limit)", "extensions": { "code": "VALIDATION_ERROR" } }] }
```

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```
