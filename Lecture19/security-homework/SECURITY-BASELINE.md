# Security baseline

Коротко: що це за сервіс, що вже зроблено, і що б я ще поклала у backlog, якби це був не курс, а прод.

## Що у Lecture19

По суті Nest-монорепа:

- **orders-service** — основний HTTP: JWT auth, users/products/orders, upload через S3 presign, GraphQL, RabbitMQ, окремий entry для worker, REST по платежах (`/payments/capture`, `/refund`), gRPC-клієнт у payments-service.
- **apps/payments-service** — окремий процес, gRPC-стаб (authorize/capture/refund).
- **Інфра** — compose-файли, `k8s/`*, nginx у `docker/nginx/`.

---

## Міні-review 

## Auth / сесії / JWT


|                  |                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Було**         | Логін → JWT (Passport), паролі через bcrypt, узагальнені 401/403. `refresh` поки заглушка.                                               |
| **Що турбувало** | Brute force на `/auth/`*; по логах важко відрізнити нормального юзера від бота; якщо не `trust proxy`, rate limit по IP з nginx — фігня. |
| **Зробили в ДЗ** | Жорсткіший throttle на login/register/refresh; audit на успіх/фейл логіну і реєстрації; Helmet + trust proxy.                            |
| **Далі б робив** | Нормальний refresh з ротацією / blacklist; captcha або хоча б risk-based step-up; MFA для адмінів — якщо колись знадобиться.             |


### Ролі / доступ


|                  |                                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Було**         | RBAC через `@Roles(ADMIN)` на чутливих штуках (payments, адмінські users).                                                                               |
| **Що турбувало** | Немає scopes — все зводиться до ролі; публічний `request-payment` пахне IDOR; немає явної перевірки «це замовлення саме цього юзера».                    |
| **Зробили в ДЗ** | Жорсткіший throttle на payment/admin; audit з `actorId` / `actorRole` на capture/refund і зміну ролі.                                                    |
| **Далі**         | Scopes або маленький policy engine; пофіксити IDOR на `POST /orders/:id/request-payment`; guards для GraphQL; dual-control на зміну ролі — якщо параноя. |


### Секрети


|                  |                                                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Було**         | Все через `.env` / compose: JWT, БД, AWS.                                                                                                                                                                     |
| **Що турбувало** | Теоретично можна було стартанути з кривим або порожнім JWT у prod; ризик випадкового коміту `.env`; немає єдиного secret store.                                                                               |
| **Зробили в ДЗ** | `resolveJwtSigningSecret()` — без нормального секрету процес не підніметься ніде; `*_FILE` для файлів; `.gitignore`; розписано в `docs/SECRETS.md` + коротка нотатка `security-evidence/secret-flow-note.md`. |
| **Далі**         | Vault / ESO, ротація, окремі ключі per-service, ніяких long-lived секретів у образі.                                                                                                                          |


### TLS / транспорт


|                  |                                                                                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Було**         | HTTP локально, типовий внутрішній HTTP між контейнерами.                                                                                                                            |
| **Що турбувало** | Без TLS на edge трафік читається; HSTS має сенс лише коли зовні вже HTTPS.                                                                                                          |
| **Зробили в ДЗ** | Ingress з TLS + redirect у `k8s/ingress.yaml`; приклад локального HTTPS у `docker/nginx/local-gateway.tls.example.conf`; `docs/TRANSPORT-TLS.md` + `security-evidence/tls-note.md`. |
| **Далі**         | TLS/mTLS на gRPC між сервісами; нормальні серти на Ingress; локально — mkcert, якщо прям болить.                                                                                    |


### Ввід / зловживання


|                  |                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Було**         | `ValidationPipe`, DTO, дефолтно захищені ендпоінти в Nest.                                                                                              |
| **Що турбувало** | Масові запити на auth/payments/upload; без baseline headers легше фінґерпринтити; CSP у prod треба буде піджати під реальний фронт, якщо він з’явиться. |
| **Зробили в ДЗ** | Глобальний + точковий throttling, IP з `X-Forwarded-For`, Helmet; деталі в `docs/RATE-LIMIT-AND-HEADERS.md`.                                            |
| **Далі**         | CORS whitelist; ліміти глибини/вартості для GraphQL; суворіший CSP; верифікація вебхуків PSP, коли буде не стаб.                                        |


### Логи / audit


|                  |                                                                                                                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Було**         | Загальні логи Nest без єдиної схеми для security-подій.                                                                                                                                                                 |
| **Що турбувало** | Важко відповісти на «хто натиснув refund і з якого IP».                                                                                                                                                                 |
| **Зробили в ДЗ** | `src/audit/`*: JSON на рядок, action, actor, target, outcome, correlation/request id, IP і обрізаний UA; підключено в auth, users, orders, payments — див. `docs/AUDIT.md` і `security-evidence/audit-log-example.txt`. |
| **Далі**         | Immutable sink / SIEM, retention, менше PII в полях audit.                                                                                                                                                              |


---

## Ризикові місця 


| Surface                             | Що лякає                | До ДЗ                         | Що додано                                  | Evidence                                                                                                             | Що лишилось                                 |
| ----------------------------------- | ----------------------- | ----------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `POST /auth/login`                  | brute force, stuffing   | JWT після успіху, generic 401 | Throttle 10/хв, audit, Helmet, trust proxy | [rate-limit.txt](security-evidence/rate-limit.txt), [audit-log-example.txt](security-evidence/audit-log-example.txt) | Немає captcha / anomaly                     |
| `POST /auth/register`               | спам акаунтами          | ValidationPipe, bcrypt        | Throttle + audit                           | [rate-limit.txt](security-evidence/rate-limit.txt)                                                                   | Немає email verify                          |
| `POST /auth/refresh`                | майбутній abuse         | заглушка                      | Throttle як у login                        | [rate-limit.txt](security-evidence/rate-limit.txt)                                                                   | Refresh не реалізований                     |
| `POST /payments/capture`, `/refund` | abuse, privilege        | RBAC ADMIN                    | Жорсткіший throttle, audit                 | [audit-log-example.txt](security-evidence/audit-log-example.txt)                                                     | Немає scopes / webhook verify               |
| `POST /orders/:id/request-payment`  | IDOR                    | публічний ендпоінт            | Throttle + audit authorize                 | [audit-log-example.txt](security-evidence/audit-log-example.txt)                                                     | Треба власник замовлення або не `@Public()` |
| `PATCH /users/:id` (`role`)         | підняття прав           | тільки ADMIN                  | Audit `user.role_change`                   | [audit-log-example.txt](security-evidence/audit-log-example.txt)                                                     | Немає dual-control                          |
| `GET /health`, решта API            | fingerprint, XSS assist | дефолти Nest                  | Helmet, CSP off у dev                      | [headers.txt](security-evidence/headers.txt)                                                                         | У prod звузити CSP                          |
| Секрети JWT/DB/AWS                  | витік, misconfig        | `.env`, compose               | Немає старту без JWT, `*_FILE`, доки       | [secret-flow-note.md](security-evidence/secret-flow-note.md)                                                         | Немає Vault                                 |
| Клієнт → API                        | без TLS                 | HTTP у dev                    | Ingress TLS + redirect, nginx example      | [tls-note.md](security-evidence/tls-note.md)                                                                         | gRPC без TLS; локально без серта            |


---

## Що зачіпили в коді / конфігу 

- Throttling: `@nestjs/throttler`, guard, `throttle.config.ts`, `client-ip.util.ts`, `@Throttle` на auth/payments/admin/upload.
- Заголовки: `helmet()`, `trust proxy` у `main.ts`.
- Audit: `src/audit/`*, виклики з auth/users/orders/payments.
- Секрети: `resolveJwtSigningSecret`, `.gitignore`, `docs/SECRETS.md`.
- TLS / proxy: `k8s/ingress.yaml`, `docker/nginx/*`, `docs/TRANSPORT-TLS.md`.
- Докази: ця папка + `docs/HARDENING-EVIDENCE.md`.

---

## Backlog одним списком

Деталі розкладені по таблицях вище

- API: CORS whitelist, ліміти GraphQL, guards для GraphQL, фікс IDOR на `request-payment`.
- Транспорт: TLS/mTLS на gRPC, нормальні серти на Ingress.
- Auth / audit: captcha або refresh по-людськи, immutable audit + SIEM.

---

## Шпаргалка: secrets, TLS, throttle, headers, audit


| Тема     | Де копати                                                  |
| -------- | ---------------------------------------------------------- |
| Secrets  | `security-evidence/secret-flow-note.md`, `docs/SECRETS.md` |
| TLS      | `security-evidence/tls-note.md`, `docs/TRANSPORT-TLS.md`   |
| Throttle | `docs/RATE-LIMIT-AND-HEADERS.md`                           |
| Headers  | `security-evidence/headers.txt`                            |
| Audit    | `docs/AUDIT.md`                                            |


---

## Evidence


| Файл                                                             | Що там                      |
| ---------------------------------------------------------------- | --------------------------- |
| [headers.txt](security-evidence/headers.txt)                     | Приклад заголовків з Helmet |
| [rate-limit.txt](security-evidence/rate-limit.txt)               | Як отримати 429 на логіні   |
| [audit-log-example.txt](security-evidence/audit-log-example.txt) | Приклади audit JSON         |
| [secret-flow-note.md](security-evidence/secret-flow-note.md)     | Потік секретів              |
| [tls-note.md](security-evidence/tls-note.md)                     | TLS на edge vs всередині    |


