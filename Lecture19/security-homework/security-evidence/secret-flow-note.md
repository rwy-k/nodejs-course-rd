# Секрети — як вони потрапляють у процес

Коротко, без дублювання всього `docs/SECRETS.md`:

1. На старті **`loadSecretsFromFiles()`** в `main.ts` і `main.worker.ts` викликається **до** `NestFactory.create`. Якщо задані `DB_PASSWORD_FILE`, `JWT_SECRET_FILE`, `AWS_SECRET_ACCESS_KEY_FILE` і файли існують — підставляємо в `process.env`, якщо змінна ще порожня.

2. **`resolveJwtSigningSecret()`** у `src/config/secrets.util.ts`: без валідного `JWT_SECRET` (або значення, яке вже підтягнулось з `JWT_SECRET_FILE`) застосунок **не стартує**. Жодного «default secret» у коді.

3. Шаблон без секретів — `.env.example`. Живі значення — тільки поза git (`.env` у `.gitignore`).

4. У k8s дивись `k8s/deployments.yaml`: `secretKeyRef` на `DB_PASSWORD` і `JWT_SECRET`. Ротація і деталі — у `docs/SECRETS.md`.

**Не світити в логах:** значення секретів, паролі, raw JWT (дублює `docs/AUDIT.md`).
