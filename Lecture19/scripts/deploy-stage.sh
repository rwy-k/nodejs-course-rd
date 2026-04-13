set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LECTURE19_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="${LECTURE19_DIR}/docker-compose.stage.yml"
PROJECT_NAME="${STAGE_PROJECT_NAME:-stage}"
ORDERS_PORT="${STAGE_ORDERS_PORT:-8080}"
HEALTH_URL="http://127.0.0.1:${ORDERS_PORT}/health"
ROOT_URL="http://127.0.0.1:${ORDERS_PORT}/"
MAX_WAIT=120
SLEEP=5

cd "$LECTURE19_DIR"

STAGE_ENV_FILE="${LECTURE19_DIR}/.env.stage"
if [ -f "$STAGE_ENV_FILE" ]; then
  echo "==> Loading ${STAGE_ENV_FILE}"
  set -a
  # shellcheck disable=SC1090
  source "$STAGE_ENV_FILE"
  set +a
fi

: "${STAGE_JWT_SECRET:?Set STAGE_JWT_SECRET (export, CI secret, or copy .env.stage.example to .env.stage — no default in docker-compose.stage.yml)}"

export STAGE_IMAGE_TAG="${STAGE_IMAGE_TAG:-latest}"
if [ "${STAGE_IMAGE_TAG}" = "latest" ]; then
  echo "STAGE_IMAGE_TAG not set, using 'latest' for stage images."
fi

echo "==> Stage deploy: project=$PROJECT_NAME image_tag=$STAGE_IMAGE_TAG port=$ORDERS_PORT"

echo "==> Starting stack..."

set +e
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" up -d
up_exit=$?
set -e

if [ $up_exit -ne 0 ]; then
  echo "==> ERROR: docker compose up failed with exit code $up_exit"
  echo "==> docker compose ps:"
  docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" ps || true
  echo "==> docker compose logs for migrate service (if any):"
  docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" logs migrate --tail 100 || true
  exit $up_exit
fi

echo "==> Waiting for orders-api health (max ${MAX_WAIT}s)..."
elapsed=0
while [ $elapsed -lt $MAX_WAIT ]; do
  if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
    echo "==> orders-api is healthy."
    break
  fi
  echo "  waiting... ${elapsed}s"
  sleep $SLEEP
  elapsed=$((elapsed + SLEEP))
done

if [ $elapsed -ge $MAX_WAIT ]; then
  echo "==> ERROR: orders-api did not become healthy in time."
  docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" ps
  docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" logs orders-api --tail 50
  exit 1
fi

echo "==> Post-deploy: health check"
health_resp=$(curl -sf "$HEALTH_URL")
echo "  $HEALTH_URL => $health_resp"
if ! echo "$health_resp" | grep -q '"status"'; then
  echo "  ERROR: health response unexpected"
  exit 1
fi

echo "==> Post-deploy: smoke test (GET /)"
root_resp=$(curl -sf -o /dev/null -w "%{http_code}" "$ROOT_URL")
echo "  $ROOT_URL => HTTP $root_resp"
if [ "$root_resp" != "200" ]; then
  echo "  ERROR: expected HTTP 200"
  exit 1
fi

echo "==> Stage deploy and post-deploy checks passed."
