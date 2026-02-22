## Огляд Docker-конфігурації

### Додані файли


| Файл                 | Призначення                                                                             |
| -------------------- | --------------------------------------------------------------------------------------- |
| `Dockerfile`         | Multi-stage збірка (6 stages: deps → dev → build → migrations → prod → prod-distroless) |
| `docker-compose.yml` | Production-like: api + postgres, Docker secrets, internal network                       |
| `compose.dev.yml`    | Development: hot reload, bind mounts, postgres exposed                                  |
| `.dockerignore`      | Виключає src/, .env, secrets/, tests з image                                            |
| `.env.example`       | Шаблон змінних для dev                                                                  |
| `secrets/*.example`  | Шаблони Docker secrets для prod                                                         |


### Dev vs Prod-like


| Аспект          | Development (`compose.dev.yml`) | Production (`docker-compose.yml`) |
| --------------- | ------------------------------- | --------------------------------- |
| **API image**   | `dev` target + bind mount       | `prod` або `prod-distroless`      |
| **Hot reload**  | `npm run start:dev`             | compiled JS                       |
| **Source code** | Bind-mounted `./src:/app/src`   | Скомпільовано в image             |
| **Postgres**    | Exposed (port 5432)             | Internal network only             |
| **Secrets**     | `.env` file                     | Docker secrets files              |
| **User**        | root (для bind mounts)          | node (1000) / nonroot (65532)     |


### Міграції та Seed

```bash
# Development
docker compose -f compose.dev.yml run --rm migrate
docker compose -f compose.dev.yml run --rm seed

# Production
docker compose run --rm migrate
docker compose run --rm seed
```

- Запускаються як **one-off контейнери** (профіль `tools`)
- Використовують `migrations` target (має shell для TypeORM CLI)
- `seed` залежить від `migrate` (`service_completed_successfully`)

### Порівняння образів

```bash
# Після збірки всіх targets
docker build --target dev -t nestjs-shop:dev .
docker build --target prod -t nestjs-shop:prod .
docker build --target prod-distroless -t nestjs-shop:distroless .

# Порівняти розміри
docker image ls | grep nestjs-shop
```


| Image                    | Розмір | Склад                                 |
| ------------------------ | ------ | ------------------------------------- |
| `nestjs-shop:dev`        | ~400MB | node:alpine + devDependencies + tools |
| `nestjs-shop:prod`       | ~250MB | node:alpine + prod deps only          |
| `nestjs-shop:distroless` | ~180MB | distroless + prod deps only           |


```bash
# Аналіз шарів
docker history nestjs-shop:prod --no-trunc
docker history nestjs-shop:distroless --no-trunc
```

**Висновок**: `prod-distroless` найменший і найбезпечніший:

- Немає shell → неможливо exec/injection
- Немає package manager → неможливо встановити malware
- Мінімум бінарників → менше CVE

---

## Local Development (без Docker)

```bash
npm install
npm run start:dev
```

