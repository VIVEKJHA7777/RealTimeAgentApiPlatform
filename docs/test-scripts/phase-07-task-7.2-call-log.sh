#!/bin/bash
# Task 7.2: every /v1 call lands in the call log (api_call_logs) AFTER the answer went out.
#   what came in (query, body ≤ 4 KB, headers WITHOUT secrets, ids, _meta, the request check) ·
#   what we sent (status, headers AS SENT, body ≤ 4 KB, ms) · who (token name, ip, user agent) ·
#   failures too (401 / 400 / 405) · no ETag / 304 any more · secrets never stored · sizes capped ·
#   self-check not logged · 200 parallel calls all logged, newest 500 kept · a deleted API's entries
#   don't block the rest.
# Usage (backend running with `npm run dev`), from the project folder:
#   DB_URL="$(grep -o 'postgresql://[^"]*' backend/.env)" API=localhost:4001/api bash docs/test-scripts/phase-07-task-7.2-call-log.sh
API="${API:-localhost:4000/api}"
V="${API%/api}/v1"; [[ "$V" == http* ]] || V="http://$V"
DB="${DB_URL:-postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV="$SCRIPT_DIR/../test-data/csv"
H='content-type: application/json'
curl -s -o /dev/null --max-time 3 "$API/health" || { echo "Backend not reachable at $API"; exit 1; }

T=$(mktemp -d); PASS=0; FAIL=0
check() { if [ "$2" == "$3" ]; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1  (expected: $2, got: $3)"; fi; }
ex() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);const v=eval(process.argv[1]);console.log(typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('JSON-ERROR')}})" "$1"; }
b() { ex "$1" < $T/body; }
code() { cat $T/code; }
req() { if [ -n "$3" ]; then curl -s -o $T/body -w '%{http_code}' -b $T/a -X $1 "$API/organizations/$S/$2" -H "$H" -d @"$3" > $T/code; else curl -s -o $T/body -w '%{http_code}' -b $T/a -X $1 "$API/organizations/$S/$2" > $T/code; fi; }
json() { printf '%s' "$2" > "$1"; }
sql() { psql "$DB" -qtAc "$1"; }
# The log entry of the call tagged "x-test-n: N" (waits up to 3 s for the batch to be written)
waitrow() { for i in $(seq 1 30); do [ "$(sql "SELECT count(*) FROM api_call_logs WHERE request_headers->>'x-test-n' = '$1'")" -ge 1 ] && return; sleep 0.1; done; }
lr() { sql "SELECT $2 FROM api_call_logs WHERE request_headers->>'x-test-n' = '$1' ORDER BY id DESC LIMIT 1"; }
# v1 N [curl args…]: a /v1 call tagged N; answer in $T/v1, headers in $T/v1h, status in $T/v1c
v1() { local n=$1; shift; curl -s -o $T/v1 -D $T/v1h -w '%{http_code}' -H "x-test-n: $n" "$@" > $T/v1c; waitrow "$n"; }

EMAIL="cl-$RANDOM$RANDOM@test.com"
curl -s -o /dev/null -c $T/a -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
S=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d "{\"name\":\"Call log\",\"slug\":\"call-log-$RANDOM\"}" | ex 'o.organization.slug')
B=$(curl -s -b $T/a -X POST "$API/organizations/$S/data-sources" -F "file=@$CSV/e2e-products-v1.csv" -F "idColumn=sku" -F "name=Products")
DS=$(echo "$B" | ex 'o.dataSource.id')
for i in $(seq 1 100); do s=$(curl -s -b $T/a "$API/organizations/$S/data-sources/$DS/imports/$(echo "$B" | ex 'o.import.id')" | ex 'o.import.status'); [ "$s" == succeeded ] && break; sleep 0.1; done
FIELDS='[{"jivoxColumn":"sub_title","sourceColumn":"Product Name","responseKey":"sub","type":"string"},{"jivoxColumn":"category","sourceColumn":"category","responseKey":"category","type":"string"}]'
# api SLUG REQUEST → a published API with a token ($TOK); its id in $AID
api() {
  json $T/api.json "{\"name\":\"$1\",\"slug\":\"$1\",\"dataSourceId\":\"$DS\"}"; req POST apis $T/api.json
  json $T/d.json "{\"version\":0,\"idField\":{\"responseKey\":\"id\"},\"fields\":$FIELDS,\"request\":$2}"; req PUT "apis/$1/design" $T/d.json
  json $T/t.json '{"name":"Jivox axas"}'; req POST "apis/$1/tokens" $T/t.json; TOK=$(b 'o.token')
  req POST "apis/$1/publish"
  AID=$(sql "SELECT a.id FROM apis a JOIN organizations o ON o.id = a.organization_id WHERE o.slug = '$S' AND a.slug = '$1'")
}
P=live-get; api $P '{"method":"GET","query":{"ids":"{item_id}","market":"US","locale":"{_meta.openai/locale}"},"maxIdsPerCall":25}'; PTOK=$TOK; PID=$AID
Q=live-post; api $Q '{"method":"POST","body":{"items":[{"sku":"{item_id}","cat":"{category}"}],"currency":"USD","context":{"locale":"{_meta.openai/locale}"}},"maxIdsPerCall":25}'; QTOK=$TOK; QID=$AID

echo "1. A good GET call: everything in, everything out"
v1 1 -H "X-Api-Key: $PTOK" -H "Cookie: sid=abc" -A "python-httpx/0.28.1" "$V/$S/$P?ids=SKU-1001,SKU-1002,NOPE&market=US&locale=en-US"
check "answered 200; logged: 200 success, 3 ids asked, 2 found, NOT_FOUND for the third" "200 | 200 | success | 3 | 2 | {SKU-1001,SKU-1002,NOPE} | {NOT_FOUND}" "$(cat $T/v1c) | $(lr 1 "concat_ws(' | ', status, envelope_status, id_count, found, ids, error_codes)")"
check "  token NAME + header style + caller (never the token)" "this_api|Jivox axas|x_api_key|python-httpx/0.28.1" "$(lr 1 "concat_ws('|', token_kind, token_name, header, user_agent)")"
check "  request headers kept, WITHOUT x-api-key / cookie" "yes f f" "$(lr 1 "CASE WHEN request_headers ? 'user-agent' AND request_headers ? 'host' THEN 'yes' END, request_headers ? 'x-api-key', request_headers ? 'cookie'" | tr '|' ' ')"
check "  OUR headers as sent: Cache-Control no-store, JSON, no ETag" "no-store|application/json; charset=utf-8|f" "$(lr 1 "concat_ws('|', response_headers->>'cache-control', response_headers->>'content-type', response_headers ? 'etag')")"
check "  our body = exactly what the caller received; Content-Length matches" "yes yes" "$( [ "$(lr 1 response_body)" == "$(cat $T/v1)" ] && echo yes || echo no) $( [ "$(lr 1 "response_headers->>'content-length'")" == "$(wc -c < $T/v1 | tr -d ' ')" ] && echo yes || echo no)"
check "  query + _meta: market=US, locale en-US (from {_meta.openai/locale})" "US en-US" "$(lr 1 "query->>'market'") $(lr 1 "meta->>'openai/locale'")"
check "  request check ✓: ids (3) · market = US · locale" "true | ids:3:true,market:US:true,locale (openai/locale):en-US:true" "$(lr 1 "request_check->>'ok'") | $(lr 1 "(SELECT string_agg(concat_ws(':', i->>'name', i->>'got', i->>'ok'), ',') FROM jsonb_array_elements(request_check->'items') i)")"
check "  time taken recorded, the X-Request-Id we sent too" "yes yes" "$(lr 1 "CASE WHEN duration_ms > 0 THEN 'yes' END") $( [ "$(lr 1 "response_headers->>'x-request-id'")" == "$(grep -i '^x-request-id' $T/v1h | cut -d' ' -f2 | tr -d '\r')" ] && echo yes || echo no)"

echo "2. A call that differs from the template: still answered, the log says how"
v1 2 -H "X-Api-Key: $PTOK" "$V/$S/$P?ids=SKU-1001&market=UK&debug=1"
check "answered 200; check ✗: market expected US got UK · locale missing · extra: debug" "200 false | market:US:UK:false · locale (openai/locale):::false | [\"debug\"]" "$(cat $T/v1c) $(lr 2 "request_check->>'ok'") | $(lr 2 "(SELECT string_agg(concat_ws(':', i->>'name', coalesce(i->>'expected',''), coalesce(i->>'got',''), i->>'ok'), ' · ') FROM jsonb_array_elements(request_check->'items') i WHERE i->>'ok' = 'false')") | $(lr 2 "request_check->'extra'")"
check "  no context sent → no _meta" "" "$(lr 2 meta)"

echo "3. No ETag, no 304"
v1 3 -H "X-Api-Key: $PTOK" -H 'If-None-Match: *' "$V/$S/$P?ids=SKU-1001&market=US&locale=en-US"
check "If-None-Match: * → 200 with the data (Express' default would have sent an EMPTY 304)" "200 1 0" "$(cat $T/v1c) $(ex 'o.data.length' < $T/v1) $(grep -ci '^etag' $T/v1h)"
v1 3b -H "X-Api-Key: $PTOK" -H 'If-None-Match: W/"abc"' -H "If-Modified-Since: $(date -u '+%a, %d %b %Y %H:%M:%S GMT')" "$V/$S/$P?ids=SKU-1001&market=US&locale=en-US"
check "  any If-None-Match / If-Modified-Since → 200 with the data" "200 1" "$(cat $T/v1c) $(ex 'o.data.length' < $T/v1)"
check "  failures carry no ETag either (401)" "401 0" "$(curl -s -o /dev/null -D $T/h -w '%{http_code}' "$V/$S/$P?ids=SKU-1001") $(grep -ci '^etag' $T/h)"

echo "4. Secrets never stored"
v1 4 -H "Authorization: Bearer $PTOK" "$V/$S/$P?ids=SKU-1001&note=$PTOK"
check "token in the wrong header + in the URL → 401, logged on the API, token name known" "401 | this_api | Jivox axas | bearer | {UNAUTHORIZED}" "$(cat $T/v1c) | $(lr 4 "concat_ws(' | ', token_kind, token_name, header, error_codes)")"
check "  no authorization header stored; the token in path / query is scrubbed" "f yes yes" "$(lr 4 "request_headers ? 'authorization'") $(lr 4 "CASE WHEN path LIKE '%rtk_[Redacted]%' THEN 'yes' END") $(lr 4 "CASE WHEN query->>'note' = 'rtk_[Redacted]' THEN 'yes' END")"
check "  failed before the API's design was read → no request check" "" "$(lr 4 request_check)"
v1 4b -X POST -H "X-Api-Key: $QTOK" -H "$H" "$V/$S/$Q" -d "{\"items\":[{\"sku\":\"SKU-1001\",\"cat\":\"$QTOK\"}],\"currency\":\"USD\"}"
check "  a token inside the BODY → scrubbed in the stored body and in the request check" "yes 0" "$(lr 4b "CASE WHEN body LIKE '%rtk_[Redacted]%' THEN 'yes' END") $(lr 4b "(SELECT count(*) FROM jsonb_array_elements(request_check->'items') i WHERE i::text LIKE '%${QTOK:10:20}%')")"

echo "5. Failures are logged too"
v1 5 "$V/$S/$P?ids=SKU-1001"
check "no token → 401, matched to the API by its address" "401 | $PID | none | {UNAUTHORIZED}" "$(cat $T/v1c) | $(lr 5 "concat_ws(' | ', api_id, token_kind, error_codes)")"
v1 6 -X POST -H "X-Api-Key: $QTOK" -H "$H" "$V/$S/$Q" -d '{bad json'
check "invalid JSON → 400 BAD_REQUEST, the body as sent, token not checked" "400 | {bad json | not_checked | {BAD_REQUEST}" "$(cat $T/v1c) | $(lr 6 "concat_ws(' | ', body, token_kind, error_codes)")"
v1 7 -H "X-Api-Key: $QTOK" "$V/$S/$Q?ids=SKU-1001"
check "GET on a POST API → 405 with Allow: POST; check ✗ method (expected POST)" "405 | POST | false | method:POST:GET" "$(cat $T/v1c) | $(lr 7 "concat_ws(' | ', response_headers->>'allow', request_check->>'ok', (SELECT concat_ws(':', i->>'name', i->>'expected', i->>'got') FROM jsonb_array_elements(request_check->'items') i))")"
curl -s -o /dev/null -H "x-test-n: 8" "$V/$S/no-such-api?ids=1"; curl -s -o /dev/null -H "x-test-n: 8" "$V/no-such-brand-$RANDOM/x?ids=1"; sleep 1
check "an address with no API → not logged anywhere" "0" "$(sql "SELECT count(*) FROM api_call_logs WHERE request_headers->>'x-test-n' = '8'")"

echo "6. POST: the request check per row"
v1 9 -X POST -H "X-Api-Key: $QTOK" -H "$H" "$V/$S/$Q" -d '{"items":[{"sku":"SKU-1001","cat":"shoes"},{"sku":"SKU-1002"},{"sku":"SKU-2049","cat":""}],"currency":"EUR","context":{"locale":"de-DE"},"trace":1}'
check "200; ids (3) ✓ · cat missing for SKU-1002 + SKU-2049 ✗ · currency expected USD got EUR ✗ · locale ✓" "200 | false | items[].sku:3:true · items[].cat (category):[\"SKU-1002\", \"SKU-2049\"]:missing in 2 of 3:false · currency:USD:EUR:false · context.locale (openai/locale):de-DE:true" "$(cat $T/v1c) | $(lr 9 "request_check->>'ok'") | $(lr 9 "(SELECT string_agg(concat_ws(':', i->>'name', i->>'missingFor', i->>'expected', i->>'got', i->>'ok'), ' · ') FROM jsonb_array_elements(request_check->'items') i)")"
check "  _meta from the body; extra top-level key named" "de-DE [\"trace\"]" "$(lr 9 "meta->>'openai/locale'") $(lr 9 "request_check->'extra'")"
v1 10 -X POST -H "X-Api-Key: $QTOK" -H "$H" "$V/$S/$Q" -d '{"items":[{"sku":"SKU-1001","cat":"shoes"}],"currency":"USD","context":{"locale":"en-GB"}}'
check "  a matching POST → check ✓" "200 true" "$(cat $T/v1c) $(lr 10 "request_check->>'ok'")"

echo "7. Sizes"
node -e "console.log(JSON.stringify({items:[{sku:'SKU-1001',cat:'shoes'}],currency:'USD',context:{locale:'en'},pad:'é'.repeat(6000)}))" > $T/big.json
v1 11 -X POST -H "X-Api-Key: $QTOK" -H "$H" "$V/$S/$Q" --data-binary @$T/big.json
check "a 12 KB body → first 4 096 characters kept, real size noted" "200 4096 $(wc -c < $T/big.json | tr -d ' ')" "$(cat $T/v1c) $(lr 11 "char_length(body)") $(lr 11 body_bytes)"
check "  Recent calls (Test tab) still keep 2 KB of it" "2048" "$(curl -s -b $T/a "$API/organizations/$S/apis/$Q/recent-calls" | ex 'o.calls.find(c=>c.bodyBytes>10000).body.length')"
HDRS=(); for i in $(seq 1 200); do HDRS+=(-H "x-h-$i: $(printf 'v%.0s' $(seq 1 40))"); done
v1 12 -H "X-Api-Key: $PTOK" "${HDRS[@]}" "$V/$S/$P?ids=SKU-1001&market=US&locale=en"
check "200 extra headers → 200; at most 50 kept + a \"…N more left out\" note, under 8 KB" "200 51 yes yes" "$(cat $T/v1c) $(lr 12 "(SELECT count(*) FROM jsonb_object_keys(request_headers))") $(lr 12 "CASE WHEN request_headers->>'…' LIKE '% more left out' THEN 'yes' END") $(lr 12 "CASE WHEN octet_length(request_headers::text) <= 8192 THEN 'yes' END")"
IDS=$(for i in $(seq 1 25); do printf "NOPE-%s-$i," $(printf 'x%.0s' $(seq 1 190)); done | sed 's/,$//')
v1 13 -H "X-Api-Key: $PTOK" "$V/$S/$P?ids=$IDS&market=US&locale=en"
check "a 25-id answer (> 4 KB: unknown 200-character ids) → 4 096 characters kept, the real Content-Length noted" "200 4096 $(wc -c < $T/v1 | tr -d ' ')" "$(cat $T/v1c) $(lr 13 "char_length(response_body)") $(lr 13 "response_headers->>'content-length'")"
v1 14 -H "X-Api-Key: $PTOK" "$V/$S/$P?ids=$IDS,SKU-1001&market=US&locale=en"
check "too many ids → 400 TOO_MANY_IDS logged" "400 {TOO_MANY_IDS}" "$(cat $T/v1c) $(lr 14 error_codes)"

echo "8. The app's own self-check is not logged"
sleep 1; BEFORE=$(sql "SELECT count(*) FROM api_call_logs WHERE api_id = '$PID'")
req POST "apis/$P/self-check"; SC=$(code); sleep 1.5
check "self-check ran (200) and added no log entry" "200 $BEFORE" "$SC $(sql "SELECT count(*) FROM api_call_logs WHERE api_id = '$PID'")"

echo "9. Load: 200 parallel calls, then 400 more → all logged, newest 500 kept"
cat > $T/load.mjs <<'EOF'
const [url, token, n, tag] = process.argv.slice(2);
const times = [];
const t0 = performance.now();
const codes = await Promise.all(Array.from({ length: Number(n) }, async (_, i) => {
  const s = performance.now();
  const r = await fetch(`${url}&n=${i}`, { headers: { 'X-Api-Key': token, 'x-test-n': tag } });
  await r.text();
  times.push(performance.now() - s);
  return r.status;
}));
times.sort((a, b) => a - b);
console.log(codes.every((c) => c === 200) ? 'all-200' : 'NOT-ALL', Math.round(performance.now() - t0), Math.round(times[Math.floor(times.length / 2)]), Math.round(times[Math.floor(times.length * 0.95)]));
EOF
sql "DELETE FROM api_call_logs WHERE api_id = '$PID'" >/dev/null
read OK1 WALL1 P50 P95 <<< "$(node $T/load.mjs "$V/$S/$P?ids=SKU-1001,SKU-1002&market=US&locale=en" "$PTOK" 200 load1)"
for i in $(seq 1 30); do [ "$(sql "SELECT count(*) FROM api_call_logs WHERE api_id = '$PID'")" -ge 200 ] && break; sleep 0.1; done
check "200 at once → all 200 and ALL 200 logged (whole burst ${WALL1} ms, p50 ${P50} ms, p95 ${P95} ms)" "all-200 200" "$OK1 $(sql "SELECT count(*) FROM api_call_logs WHERE api_id = '$PID' AND request_headers->>'x-test-n' = 'load1'")"
read OK2 WALL2 _ <<< "$(node $T/load.mjs "$V/$S/$P?ids=SKU-1001&market=US&locale=en" "$PTOK" 400 load2)"
sleep 1.5
check "  400 more → only the newest 500 stay (100 of the first burst + all 400 of the second)" "all-200 500 100 400" "$OK2 $(sql "SELECT count(*), count(*) FILTER (WHERE request_headers->>'x-test-n' = 'load1'), count(*) FILTER (WHERE request_headers->>'x-test-n' = 'load2') FROM api_call_logs WHERE api_id = '$PID'" | tr '|' ' ')"
check "  the other API's log untouched" "yes" "$( [ "$(sql "SELECT count(*) FROM api_call_logs WHERE api_id = '$QID'")" -ge 6 ] && echo yes || echo no)"

echo "10. An API deleted while its calls wait in the queue"
for i in $(seq 1 30); do curl -s -o /dev/null -X POST -H "X-Api-Key: $QTOK" -H "$H" "$V/$S/$Q" -d '{"items":[{"sku":"SKU-1001","cat":"x"}],"currency":"USD"}' & done
sleep 0.05; sql "DELETE FROM apis WHERE id = '$QID'" >/dev/null; wait $(jobs -p)
v1 15 -H "X-Api-Key: $PTOK" "$V/$S/$P?ids=SKU-1001&market=US&locale=en"
check "the other API's next call is still logged; nothing left of the deleted one" "200 1 0" "$(cat $T/v1c) $(sql "SELECT count(*) FROM api_call_logs WHERE request_headers->>'x-test-n' = '15'") $(sql "SELECT count(*) FROM api_call_logs WHERE api_id = '$QID'")"

echo "11. Nothing secret anywhere in this run's log"
check "no token (either API's) in any stored entry" "0" "$(sql "SELECT count(*) FROM api_call_logs l WHERE l.api_id IN ('$PID', '$QID') AND (row_to_json(l)::text LIKE '%${PTOK:4:30}%' OR row_to_json(l)::text LIKE '%${QTOK:4:30}%')")"

echo "12. Stopping the server writes what's still waiting"
# ITS OWN extra backend (port SHUT_PORT, default 4101): called, then stopped at once; only that one is stopped.
SP="${SHUT_PORT:-4101}"; BACKEND="$SCRIPT_DIR/../../backend"
if lsof -nP -iTCP:$SP -sTCP:LISTEN >/dev/null; then echo "  (skipped: port $SP is busy; set SHUT_PORT)"; else
  (cd "$BACKEND" && DATABASE_URL="$DB" PORT=$SP LOG_LEVEL=warn exec node_modules/.bin/tsx src/index.ts > $T/shut.log 2>&1) & OWN=$!
  for i in $(seq 1 100); do curl -s -o /dev/null --max-time 1 "localhost:$SP/api/health" && break; sleep 0.1; done
  for i in $(seq 1 30); do curl -s -o /dev/null -H "x-test-n: shut" -H "X-Api-Key: $PTOK" "localhost:$SP/v1/$S/$P?ids=SKU-1001&market=US&locale=en" & done; wait $(jobs -p | grep -v "^$OWN$")
  INQ=$(sql "SELECT count(*) FROM api_call_logs WHERE request_headers->>'x-test-n' = 'shut'")
  kill -TERM $OWN; for i in $(seq 1 50); do kill -0 $OWN 2>/dev/null || break; sleep 0.1; done
  check "30 calls, then SIGTERM straight away ($INQ written before it) → all 30 in the log; the server stopped cleanly" "30 stopped" "$(sql "SELECT count(*) FROM api_call_logs WHERE request_headers->>'x-test-n' = 'shut'") $(kill -0 $OWN 2>/dev/null && echo running || echo stopped)"
fi

sql "DELETE FROM users WHERE email='$EMAIL'" >/dev/null
sql "DELETE FROM organizations WHERE slug='$S'" >/dev/null
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
