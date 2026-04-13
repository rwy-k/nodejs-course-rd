# Як я перевіряла, що hardening реально працює

Цей файл — мій «чеклист для рук»: швидко відтворити перевірку й зібрати скрін/лог для домашки. Частина того ж лежить у `security-homework/security-evidence/` (headers, rate limit, приклад audit, нотатки по секретам і TLS). Детальніше по темах: `RATE-LIMIT-AND-HEADERS.md`, `SECRETS.md`, `TRANSPORT-TLS.md`, `AUDIT.md`.

**Перед тестами** треба підняти API: наприклад `docker compose -f docker-compose.local.yml up -d` і сервіс `orders-api`, або `npm run start:dev` з нормальним `.env`. Нижче я пишу порт як у локальному compose для API: **`http://localhost:8080`**.

---

## 1. Security headers

У `main.ts` підключений Helmet. У dev CSP вимкнений (типовий Express+Helmet компроміс), щоб не ламати дев-тули; у production CSP знову вмикається.

Нижче — приклад того, що я бачила на Express 4 + `helmet@8` (той самий пакет, що в Nest):

```http
HTTP/1.1 200 OK
cross-origin-opener-policy: same-origin
cross-origin-resource-policy: same-origin
origin-agent-cluster: ?1
referrer-policy: no-referrer
strict-transport-security: max-age=31536000; includeSubDomains
x-content-type-options: nosniff
x-dns-prefetch-control: off
x-download-options: noopen
x-frame-options: SAMEORIGIN
x-permitted-cross-domain-policies: none
x-xss-protection: 0
```

На живому Nest:

```bash
curl -sI "http://localhost:8080/health" | grep -iE '^(x-|referrer|strict|cross-origin)'
```

Має бути видно щось на кшталт `x-content-type-options`, `x-frame-options`, `referrer-policy`.

У `NODE_ENV=production` CSP увімкнений за замовчуванням з Helmet; у dev вимкнений, щоб Swagger і Playground не страждали.

---

## 2. Rate limit → 429

Глобально є ліміт, плюс окремий жорсткий на логін: **`THROTTLE_AUTH_STRICT`** = **10** / 60 с на IP (`src/config/throttle.config.ts`).

Швидкий стрес:

```bash
BASE=http://localhost:8080
for i in $(seq 1 12); do
  code=$(curl -s -o /tmp/rl_body.txt -w "%{http_code}" -X POST "$BASE/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"nobody@example.invalid","password":"wrong"}')
  echo "attempt $i -> HTTP $code"
done
```

Спочатку будуть **401** (не той пароль), потім почнуть сипатись **429** з тілом на кшталт `ThrottlerException: Too Many Requests`.

Якщо йти через nginx — треба перевірити, що летить `X-Forwarded-For` (див. `docker/nginx/local-gateway.conf`), інакше ліміт може рахуватись не по клієнту. У коді для цього є `trust proxy` + `clientIpTracker`, розписано в `RATE-LIMIT-AND-HEADERS.md`.

---

## 3. Audit (кілька «важливих» подій)

Логер **`Audit`**, один JSON на рядок через `AuditService`. У коді є зокрема `auth.login` / `auth.register`, `payment.capture` / `payment.refund`, `payment.authorize_request`, `user.role_change` — дивись `auth.service`, `payments.controller`, `orders.service`, `users.service`.

**Невдалий логін (юзера немає):**

```json
{
  "type": "audit",
  "action": "auth.login",
  "actorId": null,
  "actorRole": null,
  "targetType": "User",
  "targetId": null,
  "outcome": "denied",
  "timestamp": "2026-04-11T20:45:00.000Z",
  "correlationId": null,
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "reason": "user_not_found",
  "ip": "127.0.0.1",
  "userAgentTruncated": "curl/8.7.1"
}
```

**Успішний capture (адмін):**

```json
{
  "type": "audit",
  "action": "payment.capture",
  "actorId": 1,
  "actorRole": "admin",
  "targetType": "Payment",
  "targetId": "pay_1733942400_abc12",
  "outcome": "success",
  "timestamp": "2026-04-11T20:46:00.000Z",
  "correlationId": "my-request-id",
  "requestId": "660e8400-e29b-41d4-a716-446655440001",
  "reason": "status:CAPTURED",
  "ip": "127.0.0.1",
  "userAgentTruncated": null
}
```

**Зміна ролі:**

```json
{
  "type": "audit",
  "action": "user.role_change",
  "actorId": 1,
  "actorRole": "admin",
  "targetType": "User",
  "targetId": 2,
  "outcome": "success",
  "timestamp": "2026-04-11T20:47:00.000Z",
  "correlationId": null,
  "requestId": "770e8400-e29b-41d4-a716-446655440002",
  "reason": "from:user;to:admin",
  "ip": "127.0.0.1",
  "userAgentTruncated": null
}
```

У консолі треба шукати префікс логера `Audit` або `"type":"audit"`. Що саме не логуємо — в `AUDIT.md`.

---

## 4. Секрети (шматок коду як доказ)

Без `JWT_SECRET` процес не підніметься — fallback-рядка в коді немає.

```3:9:src/config/secrets.util.ts
export function resolveJwtSigningSecret(): string {
  const v = process.env.JWT_SECRET?.trim();
  if (v) return v;
  throw new Error(
    'JWT_SECRET is required in every environment (set env or JWT_SECRET_FILE before bootstrap; see .env.example and docs/SECRETS.md).',
  );
}
```

Читання з файлів (Docker secrets тощо):

```14:27:src/config/secrets.util.ts
export function getSecret(envVar: string): string | undefined {
  const fileEnvVar = `${envVar}_FILE`;
  const filePath = process.env[fileEnvVar];

  if (filePath && existsSync(filePath)) {
    try {
      return readFileSync(filePath, 'utf8').trim();
    } catch {
      console.warn(`Warning: Could not read secret from ${filePath}`);
    }
  }

  return process.env[envVar];
}
```

Решта flow і ротація — у `SECRETS.md`. `.env` не в git.

---

## 5. TLS коротко

- TLS закінчується на edge: Ingress (`k8s/ingress.yaml`, ssl-redirect + tls) або локальний nginx за прикладом `docker/nginx/local-gateway.tls.example.conf`.
- До `orders-api` всередині — зазвичай HTTP по довіреній мережі.
- Деталі — `TRANSPORT-TLS.md`.
