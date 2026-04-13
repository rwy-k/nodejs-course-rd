set -e
cd "$(dirname "$0")/.."
if [ ! -f .env ]; then
  echo "Create .env from .env.example and set DB_PASSWORD, JWT_SECRET, etc."
  exit 1
fi
echo "Starting stack (orders-api, payments, worker, postgres, rabbitmq)..."
docker compose -f docker-compose.local.yml up -d --build
echo "Run migrations: docker compose -f docker-compose.local.yml --profile tools run --rm migrate"
echo "Run seed:       docker compose -f docker-compose.local.yml --profile tools run --rm seed"
echo "API: http://localhost:8080"
