#!/bin/bash
# Task 4.8b scenario tests: "Recent calls", the last 5 calls to an API's live URL.
# Every kind of call is recorded on the right API with the right reason (success, no token, unknown
# token, wrong header, expired, revoked, another API's token, not published, wrong method, too many
# ids, invalid JSON, too large); self-checks and unknown addresses aren't; only the newest 5 are
# kept (in memory at once, in the database within ~1 s, at most one save a second); tokens never
# stored; Clear (also while calls arrive); deleting the API; who can see / clear.
#
# Usage (backend running with `npm run dev`), from any folder:
#   DB_URL="postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_mine" \
#   API=localhost:4001/api bash docs/test-scripts/phase-04-task-4.8b-recent-calls.sh
#
# Creates its own test users and deletes ONLY them at the end.
API="${API:-localhost:4000/api}"; BASE="${API%/api}"
DB="${DB_URL:-postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV="$SCRIPT_DIR/../test-data/csv"
H='content-type: application/json'
[ -f "$CSV/e2e-products-v1.csv" ] || { echo "Can't find the test CSVs in $CSV"; exit 1; }
curl -s -o /dev/null --max-time 3 "$API/health" || { echo "Backend not reachable at $API"; exit 1; }

T=$(mktemp -d); PASS=0; FAIL=0
check() { if [ "$2" == "$3" ]; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1  (expected: $2, got: $3)"; fi; }
ex() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);const v=eval(process.argv[1]);console.log(typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('JSON-ERROR')}})" "$1"; }
sql() { psql "$DB" -tAc "$1"; }
code() { cat $T/code; }
body() { cat $T/body; }
req() { if [ -n "$4" ]; then curl -s -o $T/body -w '%{http_code}' -b $T/$1 -X $2 "$API/organizations/$3" -H "$H" -d @"$4" > $T/code; else curl -s -o $T/body -w '%{http_code}' -b $T/$1 -X $2 "$API/organizations/$3" > $T/code; fi; }
json() { printf '%s' "$2" > "$1"; }
save() { local v; v=$(curl -s -b $T/a "$API/organizations/$S/apis/$1/design" | ex 'o.design.version'); node -e "const f=require('fs');const d=JSON.parse(f.readFileSync(process.argv[1]));d.version=+process.argv[2];f.writeFileSync(process.argv[1]+'.v',JSON.stringify(d))" "$2" "$v"; req a PUT "$S/apis/$1/design" "$2.v"; }
new_token() { json $T/nt.json "$2"; req a POST "$S/apis/$1/tokens" $T/nt.json; body | ex 'o.token'; }
# recent API → its list in $T/rc ; first FIELD → the newest call's field
recent() { curl -s -b $T/a "$API/organizations/$S/apis/$1/recent-calls" > $T/rc; }
newest() { ex "with(o.calls[0]){$1}" < $T/rc; }
v1() { curl -s -o /dev/null -w '%{http_code}' -A 'Jivox-Verifier/1.0' "$@"; }

EMAIL="recent-$RANDOM$RANDOM@test.com"
curl -s -o /dev/null -c $T/a -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
curl -s -o /dev/null -c $T/b -X POST $API/auth/signup -H "$H" -d "{\"email\":\"other-$EMAIL\",\"password\":\"password123\"}"
S=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"Recent Test","slug":"recent-test"}' | ex 'o.organization.slug')
B=$(curl -s -b $T/a -X POST "$API/organizations/$S/data-sources" -F "file=@$CSV/e2e-products-v1.csv" -F "idColumn=sku" -F "name=Products")
DS=$(echo "$B" | ex 'o.dataSource.id'); IMP=$(echo "$B" | ex 'o.import.id')
for i in $(seq 1 100); do st=$(curl -s -b $T/a "$API/organizations/$S/data-sources/$DS/imports/$IMP" | ex 'o.import.status'); [ "$st" == succeeded ] && break; sleep 0.1; done
for a in prices feed gone; do json $T/api.json "{\"name\":\"$a\",\"slug\":\"$a\",\"dataSourceId\":\"$DS\"}"; req a POST "$S/apis" $T/api.json; done
json $T/d1.json '{"idField":{"responseKey":"sku"},"fields":[{"jivoxColumn":"current_price","sourceColumn":"priceUSD","responseKey":"price","type":"float","default":"0","onMismatch":"default"}],
 "request":{"method":"GET","query":{"ids":"{item_id}"},"maxIdsPerCall":3}}'
json $T/d2.json '{"idField":{"responseKey":"sku"},"fields":[{"jivoxColumn":"product_name","sourceColumn":"Product Name","responseKey":"name","type":"string"}],
 "request":{"method":"POST","body":{"items":[{"sku":"{item_id}"}]},"maxIdsPerCall":20}}'
save prices $T/d1.json; save feed $T/d2.json; save gone $T/d1.json
json $T/st.json '{"style":"bearer"}'; req a PUT "$S/apis/feed/auth-header" $T/st.json
TP=$(new_token prices '{"name":"Jivox qa3"}'); TPID=$(body | ex 'o.tokenInfo.id')
TP2=$(new_token prices '{"name":"Old one"}'); TP2ID=$(body | ex 'o.tokenInfo.id')
TF=$(new_token feed '{"name":"Feed token"}')
TG=$(new_token gone '{"name":"g"}')
req a POST "$S/apis/prices/publish"; req a POST "$S/apis/gone/publish"
[ "$(code)" == 200 ] && [ ${#TP} == 47 ] || { echo "Setup failed"; exit 1; }
URL="$BASE/v1/$S/prices"; FURL="$BASE/v1/$S/feed"

echo "A. Empty at first; a successful call shows at once"
recent prices
check "new API → [] (keeps 5)" "[] 5 null" "$(ex 'o.calls' < $T/rc) $(ex 'o.kept' < $T/rc) $(ex 'o.clearedAt' < $T/rc)"
check "a 200 call (1 known id, 1 unknown)" "200" "$(v1 "$URL?ids=SKU-1001,SKU-9999" -H "X-Api-Key: $TP")"
recent prices
check "  listed at once (before it's saved)" "1" "$(ex 'o.calls.length' < $T/rc)"
check "  GET, path with query, 200, no error" "GET /v1/$S/prices?ids=SKU-1001,SKU-9999 200 null" "$(newest method) $(newest path) $(newest status) $(newest errorCode)"
check "  token: this API's, by name, X-Api-Key" "this_api Jivox qa3 x_api_key" "$(newest tokenKind) $(newest tokenName) $(newest header)"
check "  ids asked, how many found" '2 ["SKU-1001","SKU-9999"] 1' "$(newest idCount) $(newest ids) $(newest found)"
check "  user agent, an IP, a duration, no body, an id and time" "Jivox-Verifier/1.0 yes yes null 0 yes" "$(newest userAgent) $(newest '!!ip?"yes":"no"') $(newest 'durationMs>=0&&durationMs<5000?"yes":"no"') $(newest body) $(newest bodyBytes) $(newest '/^[0-9a-f]{12}$/.test(id)&&!isNaN(Date.parse(at))?"yes":"no"')"
check "  the list holds no token" "0" "$(grep -cF -e "${TP:4:20}" $T/rc)"

echo "B. Failures are recorded on the API of the URL, with the reason"
call_and_newest() { local c; c=$(v1 "$@"); recent prices; echo "$c $(newest status) $(newest errorCode) $(newest tokenKind) $(newest tokenName) $(newest header)"; }
check "no token → 401 UNAUTHORIZED, none" "401 401 UNAUTHORIZED none null null" "$(call_and_newest "$URL?ids=SKU-1001")"
check "unknown token (token-shaped) → unknown, header kept" "401 401 UNAUTHORIZED unknown null x_api_key" "$(call_and_newest "$URL?ids=SKU-1001" -H "X-Api-Key: rtk_$(head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=')")"
check "garbage token → unknown" "401 401 UNAUTHORIZED unknown null x_api_key" "$(call_and_newest "$URL?ids=SKU-1001" -H "X-Api-Key: hello")"
check "right token, wrong header (Bearer) → this API's, by name, header bearer" "401 401 UNAUTHORIZED this_api Jivox qa3 bearer" "$(call_and_newest "$URL?ids=SKU-1001" -H "Authorization: Bearer $TP")"
check "  …the message says which header it expects" "yes" "$(newest 'errorMessage.includes("X-Api-Key")?"yes":"no"')"
sql "UPDATE api_tokens SET expires_at = now() - interval '1 minute' WHERE id='$TP2ID'" > /dev/null
check "expired token → TOKEN_EXPIRED, by name" "401 401 TOKEN_EXPIRED this_api Old one x_api_key" "$(call_and_newest "$URL?ids=SKU-1001" -H "X-Api-Key: $TP2")"
req a DELETE "$S/apis/prices/tokens/$TP2ID"
check "revoked token → UNAUTHORIZED, still by name" "401 401 UNAUTHORIZED this_api Old one x_api_key" "$(call_and_newest "$URL?ids=SKU-1001" -H "X-Api-Key: $TP2")"
check "another API's token → other_api, no name" "401 401 UNAUTHORIZED other_api null bearer" "$(call_and_newest "$URL?ids=SKU-1001" -H "Authorization: Bearer $TF")"
check "wrong method (POST) → 405" "405 405 METHOD_NOT_ALLOWED this_api Jivox qa3 x_api_key" "$(call_and_newest -X POST "$URL" -H "X-Api-Key: $TP" -d '{}')"
check "  …its body is kept (2 bytes)" '{} 2' "$(newest body) $(newest bodyBytes)"
check "too many ids → TOO_MANY_IDS, ids not counted" "400 400 TOO_MANY_IDS null" "$(call_and_newest "$URL?ids=a,b,c,d" -H "X-Api-Key: $TP" | cut -d' ' -f1-3) $(newest idCount)"
check "no ids → BAD_REQUEST" "400 400 BAD_REQUEST" "$(call_and_newest "$URL" -H "X-Api-Key: $TP" | cut -d' ' -f1-3)"
recent feed; FEED_BEFORE=$(ex 'o.calls.length' < $T/rc)
check "the feed API's list is untouched by calls to prices (also the other_api one)" "0" "$FEED_BEFORE"
check "draft feed, its own token → 404 NOT_FOUND on feed" "404" "$(v1 -X POST "$FURL" -H "Authorization: Bearer $TF" -d '{"items":[{"sku":"SKU-1001"}]}')"
recent feed
check "  recorded on feed: 404 NOT_FOUND, Feed token, body as sent" '404 NOT_FOUND Feed token {"items":[{"sku":"SKU-1001"}]}' "$(newest status) $(newest errorCode) $(newest tokenName) $(newest body)"
check "invalid JSON → 400, body kept as sent, token 'not checked'" '400 400 BAD_REQUEST not_checked {"items": [' "$(v1 -X POST "$FURL" -H "Authorization: Bearer $TF" -d '{"items": [') $(recent feed; newest status) $(newest errorCode) $(newest tokenKind) $(newest body)"
head -c 1100000 /dev/zero | tr '\0' 'a' > $T/big
check "too large (1.1 MB) → 413, size known, no body kept" "413 413 PAYLOAD_TOO_LARGE 1100000 null" "$(v1 -X POST "$FURL" -H "Authorization: Bearer $TF" --data-binary @$T/big) $(recent feed; newest status) $(newest errorCode) $(newest bodyBytes) $(newest body)"
req a POST "$S/apis/feed/publish"
node -e 'console.log(JSON.stringify({items:Array.from({length:12},(_, i)=>({sku:"SKU-"+(1001+i)}))}))' > $T/12.json
check "POST 12 ids → 200; 12 counted, first 10 shown" "200 12 10 SKU-1001 5" "$(v1 -X POST "$FURL" -H "Authorization: Bearer $TF" -d @$T/12.json) $(recent feed; newest idCount) $(newest ids.length) $(newest 'ids[0]') $(newest found)"
node -e 'console.log(JSON.stringify({items:[{sku:"SKU-1001"}],note:"x".repeat(5000)}))' > $T/5k.json
v1 -X POST "$FURL" -H "Authorization: Bearer $TF" -d @$T/5k.json > /dev/null; recent feed
check "5 KB body → first 2,048 characters kept, real size known" "2048 $(( $(wc -c < $T/5k.json) - 1 ))" "$(newest body.length) $(newest bodyBytes)"

echo "C. Not recorded"
recent prices; BEFORE=$(ex 'o.calls.map(c=>c.id).join()' < $T/rc)
json $T/sc.json '{}'; req a POST "$S/apis/prices/self-check" $T/sc.json
check "the self-check ran live (it calls /v1)…" "live" "$(body | ex 'o.mode')"
check "  …but isn't in the list" "$BEFORE" "$(recent prices; ex 'o.calls.map(c=>c.id).join()' < $T/rc)"
check "unknown API / brand / short path → 401 / 401 / 404, no list for them" "401 401 404 0" "$(v1 "$BASE/v1/$S/nope?ids=1") $(v1 "$BASE/v1/no-such-brand-xyz/prices?ids=1") $(v1 "$BASE/v1/$S") $(sql "SELECT count(*) FROM api_recent_calls r JOIN apis a ON a.id=r.api_id WHERE a.slug='nope'")"

echo "D. Tokens are never stored"
v1 "$URL?ids=SKU-1001&api_key=$TP" -H "X-Api-Key: $TP" > /dev/null; recent prices
check "token in the query → scrubbed from the path" "/v1/$S/prices?ids=SKU-1001&api_key=rtk_[Redacted]" "$(newest path)"
v1 -X POST "$FURL" -H "Authorization: Bearer $TF" -d "{\"items\":[{\"sku\":\"SKU-1001\"}],\"key\":\"$TF\"}" > /dev/null; recent feed
check "token in the body → scrubbed" '{"items":[{"sku":"SKU-1001"}],"key":"rtk_[Redacted]"}' "$(newest body)"
# a token cut by the 2 KB limit: no part of it may stay
node -e 'console.log(JSON.stringify({items:[{sku:"SKU-1001"}],pad:"x".repeat(2048-48-30),key:process.argv[1]}))' "$TF" > $T/cut.json
v1 -X POST "$FURL" -H "Authorization: Bearer $TF" -d @$T/cut.json > /dev/null; recent feed
check "token right at the 2 KB cut → scrubbed whole, no part of it kept" "0 yes" "$(newest "body.includes('${TF:4:10}')?1:0") $(newest "body.includes('rtk_[Redacted]')&&body.length<=2048?'yes':'no'")"
sleep 1.5
check "the saved lists hold no token text (any of the 4)" "0" "$(sql "SELECT count(*) FROM api_recent_calls WHERE calls::text LIKE '%${TP:4:16}%' OR calls::text LIKE '%${TF:4:16}%' OR calls::text LIKE '%${TP2:4:16}%' OR calls::text LIKE '%${TG:4:16}%'")"

echo "E. Only the newest 5, saved within a second"
recent prices
check "prices had more than 5 calls → 5, newest first" "5 yes" "$(ex 'o.calls.length' < $T/rc) $(ex 'o.calls.every((c,i,a)=>i===0||a[i-1].at>=c.at)?"yes":"no"' < $T/rc)"
check "  the database row = the list (what a restarted server shows)" "$(ex 'o.calls.map(c=>c.id).join()' < $T/rc)" "$(sql "SELECT string_agg(c->>'id', ',' ORDER BY n) FROM api_recent_calls r, jsonb_array_elements(r.calls) WITH ORDINALITY x(c,n) WHERE r.api_id=(SELECT id FROM apis WHERE slug='prices' AND organization_id=(SELECT id FROM organizations WHERE slug='$S'))")"
check "the database refuses a 6th call in the list" "refused" "$(psql "$DB" -tAc "UPDATE api_recent_calls SET calls = calls || '[1,2,3,4,5,6]'::jsonb WHERE api_id=(SELECT id FROM apis WHERE slug='prices' AND organization_id=(SELECT id FROM organizations WHERE slug='$S'))" >/dev/null 2>&1 && echo allowed || echo refused)"
PID_API=$(sql "SELECT id FROM apis WHERE slug='prices' AND organization_id=(SELECT id FROM organizations WHERE slug='$S')")
# Count saves with a temporary trigger (Postgres' own counters are updated too lazily); removed below.
psql "$DB" -q >/dev/null <<SQL
CREATE TABLE test_recent_saves_$$ (at timestamptz);
CREATE FUNCTION test_recent_saves_$$() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN INSERT INTO test_recent_saves_$$ VALUES (clock_timestamp()); RETURN NULL; END';
CREATE TRIGGER test_recent_saves_$$ AFTER INSERT OR UPDATE ON api_recent_calls FOR EACH ROW WHEN (NEW.api_id = '$PID_API') EXECUTE FUNCTION test_recent_saves_$$();
SQL
START=$(node -e 'console.log(Date.now())')
for i in $(seq 1 200); do curl -s -o /dev/null "$URL?ids=SKU-100$((i % 5 + 1))" -H "X-Api-Key: $TP" & done; wait
ELAPSED=$(( $(node -e 'console.log(Date.now())') - START ))
sleep 1.5
SAVES=$(sql "SELECT count(*) FROM test_recent_saves_$$"); GAP=$(sql "SELECT coalesce(min(gap), 9999) FROM (SELECT extract(epoch FROM at - lag(at) OVER (ORDER BY at)) * 1000 AS gap FROM test_recent_saves_$$) g WHERE gap IS NOT NULL")
psql "$DB" -q >/dev/null <<SQL
DROP TRIGGER test_recent_saves_$$ ON api_recent_calls; DROP FUNCTION test_recent_saves_$$(); DROP TABLE test_recent_saves_$$;
SQL
SECONDS_TAKEN=$(( ELAPSED / 1000 + 3 )) # first save at once, then one per second (+ the wait)
check "200 calls at once (${ELAPSED} ms) → $SAVES saves (≤ $SECONDS_TAKEN), ≥ 1 s apart (closest ${GAP%.*} ms)" "yes yes" "$([ "$SAVES" -ge 1 ] && [ "$SAVES" -le $SECONDS_TAKEN ] && echo yes || echo no) $(node -e 'console.log(+process.argv[1] >= 990 ? "yes" : "no")' -- "$GAP")"
recent prices
check "  the list = the 5 newest of them, all 200 by Jivox qa3" "5 200 Jivox qa3" "$(ex 'o.calls.length' < $T/rc) $(ex '[...new Set(o.calls.map(c=>c.status))].join()' < $T/rc) $(ex '[...new Set(o.calls.map(c=>c.tokenName))].join()' < $T/rc)"

echo "F. Clear"
req a DELETE "$S/apis/prices/recent-calls"
check "Clear → 200, [] with the time" "200 [] yes" "$(code) $(body | ex 'o.calls') $(body | ex '!isNaN(Date.parse(o.clearedAt))?"yes":"no"')"
check "  list empty, also in the database" "0 0" "$(recent prices; ex 'o.calls.length' < $T/rc) $(sql "SELECT jsonb_array_length(calls) FROM api_recent_calls WHERE api_id='$PID_API'")"
v1 "$URL?ids=SKU-1002" -H "X-Api-Key: $TP" > /dev/null
check "a call after Clear shows" "1 SKU-1002" "$(recent prices; ex 'o.calls.length' < $T/rc) $(newest 'ids[0]')"
# Clear while 100 calls arrive: afterwards only calls that ARRIVED after the Clear may show
for i in $(seq 1 100); do curl -s -o /dev/null "$URL?ids=SKU-1003" -H "X-Api-Key: $TP" & done
sleep 0.05; req a DELETE "$S/apis/prices/recent-calls"; CLEARED=$(body | ex 'o.clearedAt'); wait; sleep 1.5
recent prices
check "Clear during 100 calls → nothing from before the Clear comes back (memory and database)" "yes yes" "$(ex "o.calls.every(c=>c.at>'$CLEARED')?'yes':'no'" < $T/rc) $(sql "SELECT bool_and((c->>'at')::timestamptz > cleared_at) IS NOT FALSE FROM api_recent_calls r LEFT JOIN jsonb_array_elements(r.calls) c ON true WHERE api_id='$PID_API'" | sed 's/t/yes/;s/f/no/')"
check "  at most 5" "yes" "$([ "$(ex 'o.calls.length' < $T/rc)" -le 5 ] && echo yes || echo no)"
check "Clear twice → fine" "200" "$(req a DELETE "$S/apis/prices/recent-calls"; code)"

echo "G. Deleting the API while calls wait to be saved"
GURL="$BASE/v1/$S/gone"; GID=$(sql "SELECT id FROM apis WHERE slug='gone' AND organization_id=(SELECT id FROM organizations WHERE slug='$S')")
for i in 1 2 3; do v1 "$GURL?ids=SKU-1001" -H "X-Api-Key: $TG" > /dev/null; done
req a DELETE "$S/apis/gone"; DEL=$(code); sleep 1.5
check "API deleted right after calls → 204, no list left, server fine" "204 0 200" "$DEL $(sql "SELECT count(*) FROM api_recent_calls WHERE api_id='$GID'") $(v1 "$URL?ids=SKU-1001" -H "X-Api-Key: $TP")"
check "  its address now → 401, nothing recorded" "401 0" "$(v1 "$GURL?ids=SKU-1001") $(sql "SELECT count(*) FROM api_recent_calls WHERE api_id='$GID'")"

echo "H. Who can"
check "another account → 404 (list and clear)" "404 404" "$(req b GET "$S/apis/prices/recent-calls"; code) $(req b DELETE "$S/apis/prices/recent-calls"; code)"
check "logged out → 401" "401 401" "$(curl -s -o /dev/null -w '%{http_code}' "$API/organizations/$S/apis/prices/recent-calls") $(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$API/organizations/$S/apis/prices/recent-calls")"
check "answers aren't cached" "no-store" "$(curl -s -D - -o /dev/null -b $T/a "$API/organizations/$S/apis/prices/recent-calls" | grep -i '^cache-control' | tr -d '\r' | cut -d' ' -f2)"

psql "$DB" -qtAc "DELETE FROM users WHERE email IN ('$EMAIL','other-$EMAIL')" >/dev/null
check "cleanup: the brand's lists went with it" "0" "$(sql "SELECT count(*) FROM api_recent_calls WHERE api_id IN ('$PID_API','$GID')")"
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
