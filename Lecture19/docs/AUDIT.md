# Audit — що саме пишемо в лог

Коротко: є окремий логер **`Audit`**, один JSON на рядок. Зручно, коли в Loki/CloudWatch фільтруєш по префіксу.

## Які події є

| `action` | Коли спрацьовує | Хто в `actor` |
|----------|-----------------|---------------|
| `auth.login` | Логін ок або ні | Якщо залогінились — юзер; якщо відмова — зазвичай `null` (крім inactive — тоді `actorId` все ж відомий) |
| `auth.register` | Реєстрація пройшла | Новий користувач |
| `user.role_change` | `PATCH /users/:id` змінив `role` | Адмін, який викликав API |
| `payment.capture` / `payment.refund` | Після успішного gRPC | Адмін |
| `payment.authorize_request` | Після `requestPaymentForOrder` | Публічний виклик — `actorId` часто буде `null` |

Якщо щось з цього списку не бачиш у логах — дивись `src/audit/audit.service.ts` і місця виклику в auth/payments/orders/users.

## Що в кожному записі

Мінімум: `action`, `actorId`, `actorRole`, `targetType`, `targetId`, `outcome`, `timestamp`, `correlationId`, `requestId` (унікальний id самого audit-рядка).

Якщо є сенс: `reason`, `ip`, `userAgentTruncated` (обрізаний UA, щоб не роздувати рядок).

## Що свідомо не кладемо

Тут без сюрпризів: ніяких raw JWT, паролів, секретів з env.

По платежах — не PAN/CVV і всяке таке; в audit лишаються id (`payment_id`, `order_id`) і щось узагальнене на кшталт `reason` або gRPC code.

Тіло DTO в audit не летить — тільки те, що збирається в `AuditEventPayload` у `audit.service.ts`. Так менше шансів випадково злити зайве.
