# Секрети — як воно у нас влаштовано

Не енциклопедія по Vault, а практичний опис: звідки беруться значення, як вони потрапляють у процес, і що не варто логувати.

## Звідки взагалі беруться значення

**Локально** — `.env` (в git не йде) або експорт у shell. У Docker ще зручний варіант: секрет як файл і `VAR_FILE` — це вже підхоплює наш `loadSecretsFromFiles`.

**Compose «як ближче до прода»** — те саме: env з `.env` або secrets mount; пароль до Postgres інколи читається з `/run/secrets/db_password` — дивись `docker-compose.yml`.

**Kubernetes** — `Secret` (у нас задумано `app-secrets`) для чутливого, `ConfigMap` для решти. Реальний Secret з паролями в репозиторій не комітимо; збирається в кластері, наприклад:

```bash
kubectl -n <namespace> create secret generic app-secrets \
  --from-literal=db-password='<...>' \
  --from-literal=jwt-secret='<...>'
```

Шаблон без значень — `.env.example`. Реальні паролі / ключі — тільки зовні git.

**Про сід:** пароль для початкового `admin@example.com` задається через `SEED_ADMIN_PASSWORD` при запуску сіду. Не залишай там прод-пароль і не коміть `.env` з ним.

## Як це доїжджає до Node

### Локально / compose (orders + worker)

На старті в `main.ts` і `main.worker.ts` **до** `NestFactory.create` викликається `loadSecretsFromFiles()` (`src/config/secrets.util.ts`).

Для `DB_PASSWORD`, `JWT_SECRET`, `AWS_SECRET_ACCESS_KEY` логіка така: якщо є `*_FILE` і файл існує — читаємо файл і, якщо змінна ще порожня, кладемо в `process.env`. Якщо файлу немає — лишається те, що вже в env (dotenv / compose).

Далі `ConfigModule` і все інше читають звичні змінні — через `ConfigService` або напряму `process.env`. Тобто ланцюжок: файл або `.env` → `process.env` → Nest → сервіси.

### Kubernetes

TLS на edge описаний у `TRANSPORT-TLS.md`.

У `k8s/deployments.yaml` для `orders-api` і `worker`: нечутливе тягнеться `envFrom` з `app-config`, секретне — `secretKeyRef` з `app-secrets` (`db-password` → `DB_PASSWORD`, `jwt-secret` → `JWT_SECRET`).

Після зміни Secret в реальному житті зазвичай робиш rollout (`kubectl rollout restart deployment/orders-api` тощо), щоб поди підхопили нові env.

### Payments / AWS

gRPC payments у проєкті — внутрішній стаб, окремих merchant keys у коді немає.

Для presigned upload потрібні `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`; для секретного ключа також працює `AWS_SECRET_ACCESS_KEY_FILE` після `loadSecretsFromFiles`.

## Що не логувати (і чому)

Паролі користувачів, `DB_PASSWORD`, вміст `JWT_SECRET`, повні `Authorization: Bearer …`, AWS secret key, приватні ключі — очевидно ні.

Не варто світити повний AMQP URL з паролем у логах; у `rabbitmq.service` URL збирається всередині — логувати хост/порт ок, пароль ні.

Raw body login/register у debug — теж погана ідея, там пароль.

Нормально: «JWT_SECRET заданий», id сутностей, коди помилок, в dev інколи sanitized stack.

## Мінімальний чеклист «щоб не зганьбитись»

1. `.env` у git не потрапляє — є в `.gitignore`.
2. Без `JWT_SECRET` (або значення з файлу після load) застосунок **не стартує** — захардкоженого signing secret у коді немає, див. `resolveJwtSigningSecret` у `secrets.util.ts`.
3. Різні середовища — різні секрети. Не reuse продовий JWT або пароль БД на stage.

Для stage в `docker-compose.stage.yml` треба явно виставити `STAGE_JWT_SECRET` — дефолтного JWT в compose навмисно немає.

## Як би хотілось у «справжньому» prod

Vault / Secrets Manager / GCP Secret Manager — або хоча б K8s Secret + нормальний RBAC на namespace. Доставка — sidecar, CSI, external-secrets — щоб у контейнер прилітав той самий `*_FILE`, який ми вже вміємо читати.

Ротація — окремо по типах:

**JWT signing** — згенерував новий довгий рядок (CSPRNG), оновив Secret, рестартнув API. Ідеальний світ — dual-key на перехідний період; у поточному коді цього немає, тому після зміни секрету всі access-токени по суті мертві — користувачі логіняться знову. Якщо TTL короткий — зазвичай ок.

**БД** — новий юзер або зміна пароля в Postgres, оновив secret у k8s/compose, рестарт **і** API, **і** worker (обидва ходять в БД). Старий пароль тримай у secret manager якийсь час, якщо раптом треба відкотитись.

**AWS** — краще роль + IRSA / instance profile без довгоживучих ключів; якщо ключі — мінімальні права, ротація в консолі, оновлення Secret, rollout.

Детальніший security backlog — `security-homework/SECURITY-BASELINE.md`, секція про secrets посилається сюди ж.
