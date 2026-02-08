## 1. Транзакція
Всі операції створення замовлення виконуються в одній транзакції:
1. Блокування продуктів
2. Перевірка stock
3. Створення order
4. Списання stock
5. Створення order_items
6. Запис idempotencyKey

Гарантії:
- Атомарність — всі операції або виконуються, або відкочуються
- `rollback` при будь-якій помилці
- `release()` викликається завжди (finally)

---

## 2. Захист від Oversell (Pessimistic Locking)
Вибрано саме цей підхід, з наступних причин:
- Гарантує, що інші транзакції чекатимуть завершення блокування
- Запобігає race condition при одночасних замовленнях
- Сортування ID запобігає deadlock

## 3. Ідемпотентність
**Механізм:** унікальний `idempotencyKey` в таблиці orders
**Як працює:**
1. Клієнт передає ключ через header або body
2. Перед створенням — перевірка існування
3. Обробка конкурентних запитів (unique violation)

**HTTP коди:**
| Сценарій | Код |
|----------|-----|
| Нове замовлення | 201 Created |
| Повторний запит (ідемпотентний) | 200 OK |
| Недостатній stock | 409 Conflict |
| Продукт не знайдено | 404 Not Found |

Обрано код помилки 409, тому що 400 означає, що помилка присутня в самому запиті (напр. невалідний JSON). Тоді як 409 значить, що запит валідний, але конфліктує з поточним станом сервера
---

## 4. Оптимізація "Гарячого" Запиту
### 4.1 SQL-запит
```sql
SELECT "p"."id", "p"."name", "p"."description", "p"."price", 
       "p"."stock", "p"."category", "p"."isAvailable", 
       "p"."createdAt", "p"."updatedAt"
FROM "products" "p"
WHERE "p"."name" ILIKE '%phone%'
  AND "p"."category" = 'electronics'
ORDER BY "p"."price" ASC
LIMIT 20;
```
### 4.2 План виконання ДО оптимізації
```
                                                      QUERY PLAN
----------------------------------------------------------------------------------------------------------------------
 Limit  (cost=25.88..25.93 rows=20 width=200) (actual time=0.845..0.852 rows=5 loops=1)
   ->  Sort  (cost=25.88..26.13 rows=100 width=200) (actual time=0.844..0.848 rows=5 loops=1)
         Sort Key: price
         Sort Method: quicksort  Memory: 25kB
         ->  Seq Scan on products p  (cost=0.00..22.50 rows=100 width=200) (actual time=0.025..0.812 rows=5 loops=1)
               Filter: ((name ~~* '%phone%'::text) AND ((category)::text = 'electronics'::text))
               Rows Removed by Filter: 995
 Planning Time: 0.156 ms
 Execution Time: 0.892 ms
```
**Проблеми:**
- `Seq Scan` — повне сканування таблиці (всі 1000 рядків)
- `Rows Removed by Filter: 995` — 99.5% даних відкинуто після читання
- Сортування в пам'яті після фільтрації
### 4.3 Додані індекси
```sql
-- B-tree індекси
CREATE INDEX idx_products_category ON products (category);
CREATE INDEX idx_products_price ON products (price);
CREATE INDEX idx_products_is_available ON products ("isAvailable");
CREATE INDEX idx_products_created_at ON products ("createdAt" DESC);
-- Composite індекс для типових запитів
CREATE INDEX idx_products_category_available_price 
  ON products (category, "isAvailable", price);
-- GIN індекс для ILIKE пошуку (потребує pg_trgm)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_products_name_trgm ON products USING GIN (name gin_trgm_ops);
```
### 4.4 План виконання ПІСЛЯ оптимізації
```
                                                      QUERY PLAN
----------------------------------------------------------------------------------------------------------------------
 Limit  (cost=12.45..12.50 rows=20 width=200) (actual time=0.125..0.132 rows=5 loops=1)
   ->  Sort  (cost=12.45..12.58 rows=50 width=200) (actual time=0.124..0.128 rows=5 loops=1)
         Sort Key: price
         Sort Method: quicksort  Memory: 25kB
         ->  Bitmap Heap Scan on products p  (cost=4.52..11.25 rows=50 width=200) (actual time=0.085..0.095 rows=5 loops=1)
               Recheck Cond: ((name ~~* '%phone%'::text) AND ((category)::text = 'electronics'::text))
               Heap Blocks: exact=1
               ->  BitmapAnd  (cost=4.52..4.52 rows=50 width=0) (actual time=0.072..0.073 rows=0 loops=1)
                     ->  Bitmap Index Scan on idx_products_name_trgm  (cost=0.00..2.00 rows=100 width=0) (actual time=0.045..0.045 rows=10 loops=1)
                           Index Cond: (name ~~* '%phone%'::text)
                     ->  Bitmap Index Scan on idx_products_category  (cost=0.00..2.25 rows=100 width=0) (actual time=0.022..0.022 rows=50 loops=1)
                           Index Cond: ((category)::text = 'electronics'::text)
 Planning Time: 0.312 ms
 Execution Time: 0.178 ms
```
### 4.5 Висновок
**Що покращилось:**
| Метрика | До | Після | Покращення |
|---------|-----|-------|------------|
| Execution Time | 0.892 ms | 0.178 ms | **5x швидше** |
| Тип сканування | Seq Scan | Bitmap Index Scan | Індексний доступ |
| Прочитано рядків | 1000 | ~60 | **~17x менше I/O** |
| Cost | 25.88 | 12.45 | **2x менше** |

**Чому planner обрав цей план:**
1. **BitmapAnd** — PostgreSQL об'єднує результати двох індексів:
   - `idx_products_name_trgm` (GIN) для `ILIKE '%phone%'`
   - `idx_products_category` (B-tree) для `category = 'electronics'`
2. **GIN + pg_trgm** — дозволяє використовувати індекс для `ILIKE` з wildcard на початку (`%phone%`), що неможливо з B-tree
3. **Bitmap Heap Scan** — після об'єднання бітмапів, PostgreSQL читає лише потрібні сторінки з heap (1 block замість повного сканування)
4. **Selectivity** — planner оцінив, що фільтри відсікають ~95% даних, тому індексний доступ вигідніший за Seq Scan

---

## Запуск

```bash
# PostgreSQL через Docker
docker compose up -d

# Залежності
npm install

# Міграції
npm run migration:run

# Сервер
npm run start:dev
```
