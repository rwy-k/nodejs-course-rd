# Audit — що ми пишемо в лог і чому так

Коротко: окремий логер **`Audit`**, один JSON на рядок. Мені так зручніше — у Loki чи CloudWatch можна фільтрувати по `type` / `action`, не копатись у загальному `console.log`.

## Які події я очікую побачити

| `action` | Коли спрацьовує | Хто в `actor` |
|----------|-----------------|---------------|
| `auth.login` | Логін ок або відмова | Якщо зайшли — юзер; якщо ні — часто `null` (крім inactive — тоді `actorId` може бути відомий) |
| `auth.register` | Реєстрація пройшла | Новий користувач |
| `user.role_change` | Адмін змінив `role` через `PATCH /users/:id` | Той адмін, хто викликав |
| `payment.capture` / `payment.refund` | Після успішного gRPC | Адмін |
| `payment.authorize_request` | Після `requestPaymentForOrder` | Публічний виклик — `actorId` часто `null` |

Якщо чогось з таблиці немає в логах — я б пішла в `src/audit/audit.service.ts` і в місця виклику в auth / payments / orders / users.

## Що в кожному записі

Мінімум: `action`, `actorId`, `actorRole`, `targetType`, `targetId`, `outcome`, `timestamp`, `correlationId`, `requestId` (унікальний id самого audit-рядка).

Якщо є сенс: `reason`, `ip`, `userAgentTruncated` (UA обрізаємо, щоб рядок не роздувався).

## Що я свідомо не кладу в audit

Без сюрпризів: ніяких raw JWT, паролів, значень секретів з env.

По платежах — не PAN/CVV; лишаються id (`payment_id`, `order_id`) і щось узагальнене на кшталт `reason` або gRPC code.

Тіло DTO в audit не летить — лише те, що збирається в `AuditEventPayload` у `audit.service.ts`. Так менше шансу випадково злити зайве.
