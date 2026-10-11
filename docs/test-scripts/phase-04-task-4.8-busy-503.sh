#!/bin/bash
# Task 4.8: when /v1 can't get a database connection within 3 s it must answer 503 SERVICE_BUSY
# (contract envelope, Retry-After: 1, no-store), never a 500.
# Starts ITS OWN extra backend (port BUSY_PORT, default 4100, with DB_POOL_MAX=2), holds a lock on
# api_tokens for 6 s so the 2 connections stay busy, fires 10 calls, then stops ONLY that backend.
#
#   DB_URL="postgresql://…/api_platform_mine" API=localhost:4001/api bash docs/test-scripts/phase-04-task-4.8-busy-503.sh
# (run from anywhere; API = your normal backend, used to set up the test API)
API="${API:-localhost:4000/api}"
DB="${DB_URL:-postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev}"
PORT="${BUSY_PORT:-4100}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$SCRIPT_DIR/../../backend"
CSV="$SCRIPT_DIR/../test-data/csv/e2e-products-v1.csv"
H='content-type: application/json'
curl -s -o /dev/null --max-time 3 "$API/health" || { echo "Backend not reachable at $API"; exit 1; }
lsof -ti tcp:$PORT -sTCP:LISTEN > /dev/null && { echo "Port $PORT is in use: set BUSY_PORT to a free port"; exit 1; }
PASS=0; FAIL=0; T=$(mktemp -d)
check() { if [ "$2" == "$3" ]; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1  (expected: $2, got: $3)"; fi; }
j() { node -pe "JSON.parse(require('fs').readFileSync(0))$1"; }

(cd "$BACKEND" && DATABASE_URL="$DB" PORT=$PORT DB_POOL_MAX=2 LOG_LEVEL=warn exec node_modules/.bin/tsx src/index.ts > $T/server.log 2>&1) &
for i in $(seq 1 40); do curl -s -o /dev/null --max-time 1 localhost:$PORT/api/health && break; sleep 0.5; done
OWN=$(lsof -ti tcp:$PORT -sTCP:LISTEN)
stop() { [ -n "$OWN" ] && kill $OWN 2>/dev/null; }
trap stop EXIT

EMAIL="busy-$RANDOM$RANDOM@test.com"
curl -s -o /dev/null -c $T/a -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
S=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"Busy","slug":"busy-test"}' | j .organization.slug)
DS=$(curl -s -b $T/a -X POST "$API/organizations/$S/data-sources" -F "file=@$CSV" -F idColumn=sku -F name=P | j .dataSource.id); sleep 1
curl -s -o /dev/null -b $T/a -X POST $API/organizations/$S/apis -H "$H" -d "{\"name\":\"B\",\"slug\":\"busy\",\"dataSourceId\":\"$DS\"}"
curl -s -o /dev/null -b $T/a -X PUT $API/organizations/$S/apis/busy/design -H "$H" -d '{"version":0,"idField":{"responseKey":"sku"},"fields":[],"request":{"method":"GET","query":{"ids":"{item_id}"},"maxIdsPerCall":10}}'
TK=$(curl -s -b $T/a -X POST $API/organizations/$S/apis/busy/tokens -H "$H" -d '{"name":"t"}' | j .token)
curl -s -o /dev/null -b $T/a -X POST $API/organizations/$S/apis/busy/publish
URL="localhost:$PORT/v1/$S/busy?ids=SKU-1001"
check "test backend (2 connections) answers normally" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$URL" -H "X-Api-Key: $TK")"

psql "$DB" -qc "BEGIN; LOCK TABLE api_tokens IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(6); COMMIT;" > /dev/null &
LOCKER=$!
sleep 0.3
# Wait for THESE jobs only: a bare `wait` would also wait for the test backend (forever).
CALLS=""
for i in $(seq 1 10); do curl -s --max-time 15 -D $T/h$i -o $T/b$i -w '%{http_code}' "$URL" -H "X-Api-Key: $TK" > $T/c$i & CALLS="$CALLS $!"; done
wait $CALLS $LOCKER
summary=$(for i in $(seq 1 10); do echo "$(cat $T/c$i) $(node -pe 'try{const o=JSON.parse(require("fs").readFileSync(process.argv[1]));o.status+" "+(o.errors[0]?.error_code||"ok")}catch(e){"NOT-JSON"}' $T/b$i) $(grep -i '^retry-after' $T/h$i | cut -d' ' -f2 | tr -d '\r') $(grep -ic '^cache-control: no-store' $T/h$i)"; done | sort | uniq -c | sed 's/^ *//' | tr '\n' '|')
check "10 calls while both connections are stuck: 2 wait and succeed, 8 get 503 SERVICE_BUSY (Retry-After 1, no-store)" "2 200 success ok  1|8 503 failure SERVICE_BUSY 1 1|" "$summary"
check "  logged as busy, never as an unexpected error" "8 0" "$(grep -c 'v1: busy' $T/server.log) $(grep -c 'unexpected error' $T/server.log)"
check "right after: answers normally again" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$URL" -H "X-Api-Key: $TK")"

psql "$DB" -qtAc "DELETE FROM users WHERE email='$EMAIL'" > /dev/null
stop; trap - EXIT; sleep 0.5
check "the extra backend was stopped" "free" "$(lsof -ti tcp:$PORT -sTCP:LISTEN > /dev/null && echo busy || echo free)"
rm -rf $T
echo; echo "RESULT: $PASS passed, $FAIL failed"
