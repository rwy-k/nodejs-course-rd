# Секрети — як у нас це влаштовано (без енциклопедії по Vault)

Не конспект з усіх хмар, а те, що я сама хотіла б прочитати в перший день на проєкті: звідки беруться значення, як вони потрапляють у процес, і що не варто світити в логах.

## Звідки взагалі беруться значення

**Локально** — `.env` (не в git) або експорт у shell. У Docker зручно: секрет файлом і `VAR_FILE` — це вже їсть наш `loadSecretsFromFiles`.

**Compose «ближче до прода»** — те саме: env з `.env` або secrets mount; пароль до Postgres інколи з `/run/secrets/db_password` — дивись `docker-compose.yml`.

**Kubernetes** — `Secret` (задумано `app-secrets`) для чутливого, `ConfigMap` для решти. Реальний Secret з паролями в репозиторій не кладемо; у кластері збирається наприклад так:

```bash
kubectl -n <namespace> create secret generic app-secrets \
  --from-literal=db-password='<...>' \
  --from-literal=jwt-secret='<...>'
```

Шаблон без значень — `.env.example`. Реальні паролі / ключі — тільки зовні git.

**Про сід:** пароль для початкового `admin@example.com` — через `SEED_ADMIN_PASSWORD`. Я б не залишала там прод-пароль і не комітила `.env` з ним.

## Як це доїжджає до Node

### Локально / compose (orders + worker)

У `main.ts` і `main.worker.ts` **до** `NestFactory.create` викликається `loadSecretsFromFiles()` (`src/config/secrets.util.ts`).

Для `DB_PASSWORD`, `JWT_SECRET`, `AWS_SECRET_ACCESS_KEY`: якщо є `*_FILE` і файл існує — читаємо файл і, якщо змінна ще порожня, кладемо в `process.env`. Якщо файлу немає — лишається те, що вже в env (dotenv / compose).

Далі `ConfigModule` і все інше читають звичні змінні. Ланцюжок: файл або `.env` → `process.env` → Nest → сервіси.

### Kubernetes

TLS на edge — у `TRANSPORT-TLS.md`.

У `k8s/deployments.yaml` для `orders-api` і `worker`: нечутливе тягнеться `envFrom` з `app-config`, секретне — `secretKeyRef` з `app-secrets` (`db-password` → `DB_PASSWORD`, `jwt-secret` → `JWT_SECRET`).

Після зміни Secret у реальному житті я б зробила rollout (`kubectl rollout restart deployment/orders-api` тощо), щоб поди підхопили нові env.

### Payments / AWS

gRPC payments у нас внутрішній стаб, окремих merchant keys у коді немає.

Для presigned upload потрібні `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`; для секретного ключа також працює `AWS_SECRET_ACCESS_KEY_FILE` після `loadSecretsFromFiles`.

## Що не логую (і чому)

Паролі користувачів, `DB_PASSWORD`, вміст `JWT_SECRET`, повний `Authorization: Bearer …`, AWS secret key, приватні ключі — очевидно ні.

Не варто світити повний AMQP URL з паролем у логах; у `rabbitmq.service` URL збирається всередині — хост/порт ок, пароль ні.

Raw body login/register у debug — теж погана ідея, там пароль.

Нормально: «JWT_SECRET заданий», id сутностей, коди помилок, у dev інколи sanitized stack.

## Мій мінімальний чеклист

1. `.env` у git не потрапляє — є в `.gitignore`.
2. Без `JWT_SECRET` (або значення з файлу після load) застосунок **не стартує** — захардкоженого signing secret у коді немає, див. `resolveJwtSigningSecret` у `secrets.util.ts`.
3. Різні середовища — різні секрети. Не reuse продовий JWT або пароль БД на stage.

Для stage в `docker-compose.stage.yml` треба явно виставити `STAGE_JWT_SECRET` — дефолтного JWT в compose навмисно немає.

## Як би хотілось у «справжньому» prod

Vault / Secrets Manager / GCP Secret Manager — або хоча б K8s Secret + нормальний RBAC на namespace. Доставка — sidecar, CSI, external-secrets — щоб у контейнер прилітав той самий `*_FILE`, який ми вже вміємо читати.

Ротація — окремо по типах:

**JWT signing** — новий довгий рядок (CSPRNG), оновила Secret, рестартнула API. Ідеальний світ — dual-key на перехідний період; у поточному коді цього немає, тому після зміни секрету access-токени по суті мертві — люди логіняться знову. Якщо TTL короткий — зазвичай ок.

**БД** — новий юзер або зміна пароля в Postgres, оновила secret у k8s/compose, рестарт **і** API, **і** worker. Старий пароль можна тримати в secret manager якийсь час для відкату.

**AWS** — краще роль + IRSA / instance profile без довгоживучих ключів; якщо ключі — мінімальні права, ротація в консолі, оновлення Secret, rollout.

Детальніший security backlog — `security-homework/SECURITY-BASELINE.md`, секція про secrets посилається сюди ж.
