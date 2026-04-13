# Rate limit + заголовки безпеки

Тут про те, як у нас заведено throttling і що робить Helmet. Якщо треба «докази» для домашки — дивіться сюди `security-homework/security-evidence/` і `HARDENING-EVIDENCE.md`.

## Throttling

Є **глобальний** ліміт і окремі «жорсткіші» місця через `@Throttle`.

Глобально за замовчуванням: **200 запитів / 60 с** на IP, все що не `@SkipThrottle()` і не перебите жорсткішим декоратором. Налаштування збираються в `ThrottlerModule`, guard лежить в `src/common/guards/app-throttler.guard.ts` (там же підтримка GraphQL, якщо раптом треба).

Окремі buckets (константи в `src/config/throttle.config.ts`):


| Що                          | Ліміт     | Де                                                                                                                                |
| --------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `THROTTLE_AUTH_STRICT`      | 10 / 60 с | `POST /auth/login`, `POST /auth/register`, `POST /auth/refresh` (refresh поки заглушка, але ліміт уже є)                          |
| `THROTTLE_PAYMENT_STRICT`   | 15 / 60 с | capture, refund, `POST /orders/:id/request-payment`                                                                               |
| `THROTTLE_ADMIN_WRITE`      | 30 / 60 с | адмінські PATCH/DELETE по orders/users/products + upload-мутації                                                                  |
| `THROTTLE_GRAPHQL_MUTATION` | 25 / 60 с | наприклад `clientPing` в `HelloResolver` — окремий bucket «на виріст» для чутливих мутацій. Queries живуть на глобальному ліміті. |


## Helmet

Підключено в `src/main.ts` через `helmet()`.

У **dev** CSP вимикаємо (`contentSecurityPolicy: false`), бо інакше страждають Swagger і GraphQL Playground (inline scripts). У **production** CSP залишаємо дефолтний від Helmet — Playground у prod у нас і так вимкнений в `app.module.ts`.

`crossOriginEmbedderPolicy: false` — щоб менше конфліктів з дев-тулами.

Решта заголовків — те, що Helmet ставить з коробки: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` і т.д. Окремого CDN під статику в цьому сервісі немає; S3 presign — це відповіді API, не file server у Nest.

## IP за nginx / ingress

Важливий момент: якщо все йде через reverse proxy, ліміт має рахуватись по **клієнту**, а не по IP контейнера проксі.

Що зроблено:

1. У `main.ts` стоїть `app.set('trust proxy', true)` — Express нормально читає `X-Forwarded-For`.
2. У `ThrottlerModule` передаємо `getTracker: clientIpTracker` з `src/config/client-ip.util.ts`: спочатку перший hop з `X-Forwarded-For`, інакше `req.ips[0]`, інакше `req.ip`.
3. У `docker/nginx/local-gateway.conf` вже проброшені `X-Forwarded-For` і `X-Forwarded-Proto`.

Швидка перевірка: багато разів `POST /auth/login` через gateway — після порогу Nest віддає **429** (`ThrottlerException`). Якщо ліміт «б’ється» не по тому IP — майже завжди проблема з forwarded headers або trust proxy.

Заголовки типу `X-RateLimit-`* ми поки не виставляємо; якщо знадобиться — це вже окремий storage / кастомний guard.

Про TLS на edge і внутрішній HTTP — в `TRANSPORT-TLS.md`. Загальний baseline — `SECURITY-BASELINE.md` у security-homework.