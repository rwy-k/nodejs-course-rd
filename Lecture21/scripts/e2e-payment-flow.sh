set -e
BASE_URL="${ORDER_SERVICE_URL:-http://localhost:3000}"
: "${SEED_ADMIN_PASSWORD:?Set SEED_ADMIN_PASSWORD to the same value as in .env used for npm run seed:prod / seed admin}"

echo "=== 1. Login (Orders)"
LOGIN_BODY=$(SEED_ADMIN_PASSWORD="$SEED_ADMIN_PASSWORD" node -e "console.log(JSON.stringify({email:'admin@example.com',password:process.env.SEED_ADMIN_PASSWORD}))")
LOGIN_RESP=$(curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "$LOGIN_BODY")
TOKEN=$(echo "$LOGIN_RESP" | node -e "const d=require('fs').readFileSync(0,'utf8'); const j=JSON.parse(d); console.log(j.accessToken||j.access_token||'')")
if [ -z "$TOKEN" ]; then
  echo "Login failed. Response: $LOGIN_RESP"
  exit 1
fi
echo "Token received."

echo "=== 2. Create order (Orders)"
CREATE_RESP=$(curl -s -X POST "$BASE_URL/orders" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId":1,"items":[{"productId":1,"quantity":1}]}')
ORDER_ID=$(echo "$CREATE_RESP" | node -e "const d=require('fs').readFileSync(0,'utf8'); const j=JSON.parse(d); console.log(j.data?.id||'')")
if [ -z "$ORDER_ID" ]; then
  echo "Create order failed. Response: $CREATE_RESP"
  exit 1
fi
echo "Order created: id=$ORDER_ID"

echo "=== 3. Request payment (Orders -> Payments.Authorize)"
PAYMENT_RESP=$(curl -s -X POST "$BASE_URL/orders/$ORDER_ID/request-payment")
echo "$PAYMENT_RESP" | node -e "
const d=require('fs').readFileSync(0,'utf8');
const j=JSON.parse(d);
const status = j.status;
const pid = (j.paymentId || j.payment_id || '').toString();
if (!status || status !== 'AUTHORIZED') {
  console.error('Expected status AUTHORIZED, got:', status, 'Response:', d);
  process.exit(1);
}
if (!pid) {
  console.error('Expected paymentId in response:', d);
  process.exit(1);
}
console.log('paymentId:', pid);
console.log('status:', status);
console.log('E2E OK: Orders -> Payments.Authorize -> paymentId + status');
"
