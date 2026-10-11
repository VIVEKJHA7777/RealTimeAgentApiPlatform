#!/bin/bash
# Task 4.3 scenario tests: the live API that Jivox calls, /v1/<brand>/<api>.
# GET and POST designs, the answer = the Design preview's answer, every token problem (missing,
# wrong, revoked, expired, another API's, wrong header style), ids (order, duplicates, spaces,
# limits), body problems, draft / wrong method / unknown paths, envelope + no-store on EVERY
# answer, last_used_at, design and data changes picked up by the next call, logs.
#
# Usage (backend running with `npm run dev`), from any folder:
#   DB_URL="postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_mine" \
#   API=localhost:4001/api bash docs/test-scripts/phase-04-task-4.3-v1-endpoint.sh
# Optional: LOG_FILE=<backend log file> also checks that no token reaches the logs.
#
# Creates its own test users and deletes ONLY them at the end.
API="${API:-localhost:4000/api}"
BASE="${API%/api}"   # /v1 lives next to /api
DB="${DB_URL:-postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV="$SCRIPT_DIR/../test-data/csv"
H='content-type: application/json'
[ -f "$CSV/e2e-products-v1.csv" ] || { echo "Can't find the test CSVs in $CSV"; exit 1; }
curl -s -o /dev/null --max-time 3 "$API/health" || { echo "Backend not reachable at $API"; exit 1; }

T=$(mktemp -d); mkdir $T/pb; PASS=0; FAIL=0
check() { if [ "$2" == "$3" ]; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1  (expected: $2, got: $3)"; fi; }
ex() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);const v=eval(process.argv[1]);console.log(typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('JSON-ERROR')}})" "$1"; }
sql() { psql "$DB" -tAc "$1"; }
code() { cat $T/code; }
body() { cat $T/body; }
hdr() { grep -i "^$1:" $T/headers | head -1 | cut -d' ' -f2- | tr -d '\r'; }
req() { if [ -n "$4" ]; then curl -s -o $T/body -w '%{http_code}' -b $T/$1 -X $2 "$API/organizations/$3" -H "$H" -d @"$4" > $T/code; else curl -s -o $T/body -w '%{http_code}' -b $T/$1 -X $2 "$API/organizations/$3" > $T/code; fi; }
json() { printf '%s' "$2" > "$1"; }
save() { local v; v=$(curl -s -b $T/a "$API/organizations/$S/apis/$1/design" | ex 'o.design.version'); node -e "const f=require('fs');const d=JSON.parse(f.readFileSync(process.argv[1]));d.version=+process.argv[2];f.writeFileSync(process.argv[1]+'.v',JSON.stringify(d))" "$2" "$v"; req a PUT "$S/apis/$1/design" "$2.v"; }
# v1 METHOD PATH_AND_QUERY [curl args…] → status $T/code, body $T/body, headers $T/headers
v1() { local m=$1 p=$2; shift 2; curl -s -D $T/headers -o $T/body -w '%{http_code}' -X $m "$BASE/v1/$p" "$@" > $T/code; }
# failure envelope summary: "<status> <error_code>" + checks the shape (failure, data [], error_id "")
fail_of() { echo "$(code) $(body | ex 'o.status==="failure"&&o.data.length===0&&o.errors.length===1&&o.errors[0].error_id===""&&o.generated_at ? o.errors[0].error_code : "BAD-ENVELOPE"')"; }
# The real Publish (task 4.4): needs a valid design + an active token.
publish() { req a POST "$S/apis/$1/publish"; }
new_token() { json $T/nt.json "$2"; req a POST "$S/apis/$1/tokens" $T/nt.json; body | ex 'o.token'; }
style() { json $T/st.json "{\"style\":\"$2\"}"; req a PUT "$S/apis/$1/auth-header" $T/st.json; }
TOKENS_SEEN=$T/tokens-seen; : > $TOKENS_SEEN

EMAIL="v1-$RANDOM$RANDOM@test.com"
curl -s -o /dev/null -c $T/a -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
S=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"Acme Shoes","slug":"acme-shoes"}' | ex 'o.organization.slug')
B=$(curl -s -b $T/a -X POST "$API/organizations/$S/data-sources" -F "file=@$CSV/e2e-products-v1.csv" -F "idColumn=sku" -F "name=Products")
DS=$(echo "$B" | ex 'o.dataSource.id'); IMP=$(echo "$B" | ex 'o.import.id')
for i in $(seq 1 100); do st=$(curl -s -b $T/a "$API/organizations/$S/data-sources/$DS/imports/$IMP" | ex 'o.import.status'); [ "$st" == succeeded ] && break; sleep 0.1; done
for a in live-prices feed draft-api; do json $T/api.json "{\"name\":\"$a\",\"slug\":\"$a\",\"dataSourceId\":\"$DS\"}"; req a POST "$S/apis" $T/api.json; done
# GET API: strict price (n/a → default 0), stock as boolean, a literal + chat context in the request, at most 3 ids
json $T/d1.json '{"idField":{"responseKey":"sku"},"fields":[
 {"jivoxColumn":"current_price","sourceColumn":"priceUSD","responseKey":"price","type":"float","default":"0","onMismatch":"default"},
 {"jivoxColumn":"is_active","sourceColumn":"in_stock","responseKey":"inStock","type":"boolean"}],
 "request":{"method":"GET","query":{"ids":"{item_id}","market":"US","locale":"{_meta.openai/locale}"},"maxIdsPerCall":3}}'
save live-prices $T/d1.json
# POST API: other keys, image sent as written when it isn't a URL, per-row {category}, a literal
json $T/d2.json '{"idField":{"responseKey":"productId"},"fields":[
 {"jivoxColumn":"product_name","sourceColumn":"Product Name","responseKey":"name","type":"string"},
 {"jivoxColumn":"product_image","sourceColumn":"img","responseKey":"image","type":"image"}],
 "request":{"method":"POST","body":{"items":[{"sku":"{item_id}","cat":"{category}"}],"currency":"USD"},"maxIdsPerCall":20}}'
save feed $T/d2.json
save draft-api $T/d2.json
[ "$(curl -s -b $T/a "$API/organizations/$S/apis" | ex 'o.apis.map(a=>a.designVersion).join()')" == "1,1,1" ] || { echo "Setup failed: a design wasn't saved"; exit 1; }
TL=$(new_token live-prices '{"name":"Jivox qa3"}'); echo "$TL" >> $TOKENS_SEEN
TF=$(new_token feed '{"name":"Jivox qa3"}'); echo "$TF" >> $TOKENS_SEEN
TD=$(new_token draft-api '{"name":"Draft"}'); echo "$TD" >> $TOKENS_SEEN
[[ "$TL$TF$TD" =~ ^(rtk_[A-Za-z0-9_-]{43}){3}$ ]] || { echo "Setup failed: tokens not created"; exit 1; }
publish live-prices; P1=$(code); publish feed
[ "$P1 $(code)" == "200 200" ] || { echo "Setup failed: publish answered $P1 / $(code)"; exit 1; }
style feed bearer
P="$S/live-prices"; PF="$S/feed"

echo "A. GET: the real answer"
v1 GET "$P?ids=SKU-1001,SKU-1003,SKU-9999&market=US" -H "X-Api-Key: $TL"
check "200, status success" "200 success" "$(code) $(body | ex 'o.status')"
check "  items in asked order, own keys, types converted, strict default for n/a" '[{"sku":"SKU-1001","price":79.99,"inStock":true},{"sku":"SKU-1003","price":0,"inStock":true}]' "$(body | ex 'o.data')"
check "  unknown id in errors[] (NOT_FOUND)" '[{"error_id":"SKU-9999","error_code":"NOT_FOUND","error_message":"unknown id"}]' "$(body | ex 'o.errors')"
check "  Cache-Control: no-store; JSON; generated_at without ms" "no-store application/json; charset=utf-8 yes" "$(hdr cache-control) $(hdr content-type) $(body | ex '/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(o.generated_at)?"yes":"no"')"
check "  no cookies, no CORS headers" "0 0" "$(grep -ci '^set-cookie' $T/headers) $(grep -ci '^access-control' $T/headers)"
V1DATA=$(body | ex 'o.data'); V1ERR=$(body | ex 'o.errors')
json $T/pv.json '{"ids":["SKU-1001","SKU-1003","SKU-9999"]}'; req a POST "$S/apis/live-prices/design/preview" $T/pv.json
check "  = exactly what the Design preview shows (data + errors)" "$(body | ex 'JSON.stringify(o.response.data)+JSON.stringify(o.response.errors)')" "$V1DATA$V1ERR"
v1 GET "$P?ids=SKU-1003,SKU-1001,SKU-1003" -H "X-Api-Key: $TL"
check "duplicates answered once, first-seen order" "SKU-1003,SKU-1001" "$(body | ex 'o.data.map(d=>d.sku).join()')"
v1 GET "$P?ids=%20SKU-1001%20,,SKU-1002" -H "X-Api-Key: $TL"
check "spaces trimmed, empty ids dropped" "SKU-1001,SKU-1002" "$(body | ex 'o.data.map(d=>d.sku).join()')"
v1 GET "$P?ids=SKU-1001%2CSKU-1005" -H "X-Api-Key: $TL"
check "URL-encoded commas (%2C, how Jivox sends them)" "SKU-1001,SKU-1005" "$(body | ex 'o.data.map(d=>d.sku).join()')"
v1 GET "$P?ids=SKU-1001&ids=SKU-1002&locale=en-US&foo=bar" -H "X-Api-Key: $TL"
check "repeated ?ids= accepted; context + unknown params ignored" "200 SKU-1001,SKU-1002" "$(code) $(body | ex 'o.data.map(d=>d.sku).join()')"
v1 GET "$P?ids=SKU-9998,SKU-9999" -H "X-Api-Key: $TL"
check "only unknown ids → still 200 success, data [], 2 errors" "200 success 0 2" "$(code) $(body | ex 'o.status+" "+o.data.length+" "+o.errors.length')"
v1 GET "$P?ids=a,b,c,d" -H "X-Api-Key: $TL"
check "4 ids, max 3 → 400 TOO_MANY_IDS" "400 TOO_MANY_IDS" "$(fail_of)"
v1 GET "$P?ids=a,a,a,a,b" -H "X-Api-Key: $TL"
check "5 ids but only 2 different → allowed (counted after removing duplicates)" "200" "$(code)"
v1 GET "$P?market=US" -H "X-Api-Key: $TL"
check "no ids parameter → 400 BAD_REQUEST, says which parameter" "400 BAD_REQUEST yes" "$(fail_of) $(body | ex 'o.errors[0].error_message.includes("\"ids\"")?"yes":"no"')"
v1 GET "$P?ids=,%20," -H "X-Api-Key: $TL"
check "only empty ids → 400 BAD_REQUEST" "400 BAD_REQUEST" "$(fail_of)"

echo "B. POST"
json $T/b1.json '{"items":[{"sku":"SKU-1002","cat":"shoes"},{"sku":"SKU-1004"},{"sku":"SKU-1002"}],"currency":"USD","context":{"locale":"en"}}'
v1 POST "$PF" -H "Authorization: Bearer $TF" -H "$H" -d @$T/b1.json
check "200; one item per id, own keys in design order; image not a URL sent as written" '200 [{"productId":"SKU-1002","name":"Blue Runner","image":"https://cdn.example.com/p/1002.png"},{"productId":"SKU-1004","name":"City Sandal","image":"not-a-url"}]' "$(code) $(body | ex 'o.data')"
json $T/pv2.json '{"ids":["SKU-1002","SKU-1004"]}'; req a POST "$S/apis/feed/design/preview" $T/pv2.json
check "  = the Design preview" "$(body | ex 'JSON.stringify(o.response.data)')" "$(v1 POST "$PF" -H "Authorization: Bearer $TF" -H "$H" -d @$T/b1.json; body | ex 'JSON.stringify(o.data)')"
v1 POST "$PF" -H "Authorization: Bearer $TF" -H 'content-type: text/plain' -d @$T/b1.json
check "any content type is read as JSON" "200 2" "$(code) $(body | ex 'o.data.length')"
v1 POST "$PF" -H "Authorization: bearer $TF" -d '{"items":[{"sku":1001}]}'
check "a number id → as text; 'bearer' in small letters works" '200 1001' "$(code) $(body | ex 'o.errors[0].error_id')"
v1 POST "$PF" -H "Authorization: Bearer $TF" -d '{"products":[{"sku":"SKU-1001"}]}'
check "ids not where the design says → 400, names the place" '400 BAD_REQUEST yes' "$(fail_of) $(body | ex 'o.errors[0].error_message.includes("\"items\"")?"yes":"no"')"
v1 POST "$PF" -H "Authorization: Bearer $TF" -d '{"items":{"sku":"SKU-1001"}}'
check "items not a list → 400" "400 BAD_REQUEST" "$(fail_of)"
v1 POST "$PF" -H "Authorization: Bearer $TF" -d '{"items":[{"sku":"SKU-1001"},{"id":"SKU-1002"}]}'
check "a row without the id key → 400, says which row" '400 BAD_REQUEST yes' "$(fail_of) $(body | ex 'o.errors[0].error_message.includes("items[1]")?"yes":"no"')"
v1 POST "$PF" -H "Authorization: Bearer $TF" -d '{"items":[{"sku":'
check "invalid JSON → 400 envelope (not the app's error format)" "400 BAD_REQUEST" "$(fail_of)"
v1 POST "$PF" -H "Authorization: Bearer $TF"
check "no body → 400" "400 BAD_REQUEST" "$(fail_of)"
node -e 'const items=[];for(let i=0;i<21;i++)items.push({sku:"S"+i});console.log(JSON.stringify({items}))' > $T/b21.json
v1 POST "$PF" -H "Authorization: Bearer $TF" -d @$T/b21.json
check "21 ids, max 20 → 400 TOO_MANY_IDS" "400 TOO_MANY_IDS" "$(fail_of)"
node -e 'console.log(JSON.stringify({items:[{sku:"x"}],pad:"x".repeat(1100000)}))' > $T/big.json
v1 POST "$PF" -H "Authorization: Bearer $TF" -d @$T/big.json
check "body over 1 MB → 413 envelope" "413 PAYLOAD_TOO_LARGE" "$(fail_of)"

echo "C. Tokens"
v1 GET "$P?ids=SKU-1001"
check "no token → 401 UNAUTHORIZED, no-store" "401 UNAUTHORIZED no-store" "$(fail_of) $(hdr cache-control)"
v1 GET "$P?ids=SKU-1001" -H "X-Api-Key: hello"
check "garbage token → 401" "401 UNAUTHORIZED" "$(fail_of)"
v1 GET "$P?ids=SKU-1001" -H "X-Api-Key: rtk_$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64url"))')"
check "well-formed but unknown token → 401" "401 UNAUTHORIZED" "$(fail_of)"
v1 GET "$P?ids=SKU-1001&api_key=$TL&token=$TL"
check "token in the URL is NOT accepted → 401" "401 UNAUTHORIZED" "$(fail_of)"
v1 GET "$P?ids=SKU-1001" -H "X-Token: $TL"
check "token in an unknown header (X-Token) → 401" "401 UNAUTHORIZED" "$(fail_of)"
v1 GET "$P?ids=SKU-1001" -H "X-Api-Key: $TF"
check "another API's token → 401 'different API'" "401 UNAUTHORIZED yes" "$(fail_of) $(body | ex '/different API/.test(o.errors[0].error_message)?"yes":"no"')"
v1 GET "nope-brand/nope-api?ids=1"
check "unknown brand/API WITHOUT a token → 401 (same as a real path: nothing to probe)" "401 UNAUTHORIZED" "$(fail_of)"
v1 GET "nope-brand/nope-api?ids=1" -H "X-Api-Key: $TL"
check "unknown path WITH a valid token → 401 (token is for another path)" "401 UNAUTHORIZED" "$(fail_of)"
v1 GET "$P?ids=SKU-1001" -H "Authorization: Bearer $TL"
check "right token, wrong header style (Bearer on an X-Api-Key API) → 401, names the right header" '401 UNAUTHORIZED yes' "$(fail_of) $(body | ex 'o.errors[0].error_message.includes("X-Api-Key: <token>")?"yes":"no"')"
v1 POST "$PF" -H "X-Api-Key: $TF" -d @$T/b1.json
check "X-Api-Key on a Bearer API → 401, names Authorization: Bearer" '401 UNAUTHORIZED yes' "$(fail_of) $(body | ex 'o.errors[0].error_message.includes("Authorization: Bearer")?"yes":"no"')"
style live-prices bearer
v1 GET "$P?ids=SKU-1001" -H "Authorization: Bearer $TL"; A1=$(code)
v1 GET "$P?ids=SKU-1001" -H "X-Api-Key: $TL"; A2=$(code)
check "switch the API to Bearer → Bearer works at once, X-Api-Key now refused" "200 401" "$A1 $A2"
style live-prices x-api-key
TLID=$(curl -s -b $T/a "$API/organizations/$S/apis/live-prices/tokens" | ex 'o.tokens[0].id')
sql "UPDATE api_tokens SET expires_at = '2026-01-15T10:30:00Z' WHERE id='$TLID'" > /dev/null
v1 GET "$P?ids=SKU-1001" -H "X-Api-Key: $TL"
check "expired token → 401 TOKEN_EXPIRED with the date" "401 TOKEN_EXPIRED yes" "$(fail_of) $(body | ex 'o.errors[0].error_message.includes("expired on 2026-01-15 10:30 UTC")?"yes":"no"')"
json $T/ext.json '{"expiresAt":null}'; req a PATCH "$S/apis/live-prices/tokens/$TLID" $T/ext.json
v1 GET "$P?ids=SKU-1001" -H "X-Api-Key: $TL"
check "Extend → the SAME token works again at once" "200" "$(code)"
json $T/ren.json '{}'; req a POST "$S/apis/live-prices/tokens/$TLID/renew" $T/ren.json; TL2=$(body | ex 'o.token'); echo "$TL2" >> $TOKENS_SEEN
v1 GET "$P?ids=SKU-1001" -H "X-Api-Key: $TL"; R1="$(fail_of) $(body | ex '/revoked/.test(o.errors[0].error_message)?"revoked":"?"')"
v1 GET "$P?ids=SKU-1001" -H "X-Api-Key: $TL2"
check "Renew → old token 401 'revoked', new token 200" "401 UNAUTHORIZED revoked 200" "$R1 $(code)"
TL=$TL2

echo "D. Status, method, paths"
v1 POST "$S/draft-api" -H "X-Api-Key: $TD" -d @$T/b1.json
check "draft API (its own valid token) → 404 'isn't published'" "404 NOT_FOUND yes" "$(fail_of) $(body | ex '/published/.test(o.errors[0].error_message)?"yes":"no"')"
v1 POST "$P" -H "X-Api-Key: $TL" -d '{"ids":["SKU-1001"]}'
check "POST to a GET API → 405, Allow: GET" "405 METHOD_NOT_ALLOWED GET" "$(fail_of) $(hdr allow)"
v1 GET "$PF?ids=SKU-1001" -H "Authorization: Bearer $TF"
check "GET to a POST API → 405, Allow: POST" "405 METHOD_NOT_ALLOWED POST" "$(fail_of) $(hdr allow)"
v1 PUT "$P?ids=SKU-1001" -H "X-Api-Key: $TL"
check "PUT → 405" "405 METHOD_NOT_ALLOWED" "$(fail_of)"
v1 GET "$S" -H "X-Api-Key: $TL"
check "/v1/<brand> only → 404 envelope" "404 NOT_FOUND no-store" "$(fail_of) $(hdr cache-control)"
v1 GET "$P/extra?ids=1" -H "X-Api-Key: $TL"
check "/v1/<brand>/<api>/extra → 404 envelope" "404 NOT_FOUND" "$(fail_of)"
v1 GET "$(echo $S | tr a-z A-Z)/LIVE-PRICES?ids=SKU-1001" -H "X-Api-Key: $TL"
check "slugs in capitals still match (slugs are lower-case)" "200" "$(code)"
json $T/ren.json '{"slug":"prices-v2"}'; req a PATCH "$S/apis/live-prices" $T/ren.json
v1 GET "$P?ids=SKU-1001" -H "X-Api-Key: $TL"; R1="$(fail_of)"
v1 GET "$S/prices-v2?ids=SKU-1001" -H "X-Api-Key: $TL"
check "API address renamed → old URL 401 (says the address may have changed), new URL 200" "401 UNAUTHORIZED 200" "$R1 $(code)"
json $T/ren.json '{"slug":"live-prices"}'; req a PATCH "$S/apis/prices-v2" $T/ren.json
req a POST "$S/apis/live-prices/unpublish"
v1 GET "$P?ids=SKU-1001" -H "X-Api-Key: $TL"; R1="$(fail_of)"; publish live-prices
v1 GET "$P?ids=SKU-1001" -H "X-Api-Key: $TL"
check "unpublished → 404 at once; published again → 200" "404 NOT_FOUND 200" "$R1 $(code)"

echo "E. Last used"
LU1=$(curl -s -b $T/a "$API/organizations/$S/apis/live-prices/tokens" | ex 'o.tokens.find(t=>t.state==="active").lastUsedAt')
check "a call records lastUsedAt on the token" "yes" "$([ "$LU1" != null ] && [ -n "$LU1" ] && echo yes || echo no)"
v1 GET "$P?ids=SKU-1001" -H "X-Api-Key: $TL"; sleep 0.3
check "  another call within a minute doesn't rewrite it (≤ 1 write a minute)" "$LU1" "$(curl -s -b $T/a "$API/organizations/$S/apis/live-prices/tokens" | ex 'o.tokens.find(t=>t.state==="active").lastUsedAt')"
TF2=$(new_token feed '{"name":"Unused"}'); echo "$TF2" >> $TOKENS_SEEN
v1 POST "$PF" -H "X-Api-Key: $TF2" -d @$T/b1.json   # wrong header style → 401
check "  a refused call (wrong header) doesn't count as use" "401 null" "$(code) $(curl -s -b $T/a "$API/organizations/$S/apis/feed/tokens" | ex 'o.tokens.find(t=>t.name==="Unused").lastUsedAt')"

echo "F. Changes reach the next call"
json $T/d1b.json '{"idField":{"responseKey":"sku"},"fields":[
 {"jivoxColumn":"current_price","sourceColumn":"priceUSD","responseKey":"price","type":"float","default":"0","onMismatch":"default"},
 {"jivoxColumn":"is_active","sourceColumn":"in_stock","responseKey":"inStock","type":"boolean"},
 {"jivoxColumn":"category","sourceColumn":"category","responseKey":"category","type":"string"}],
 "request":{"method":"GET","query":{"ids":"{item_id}","market":"US"},"maxIdsPerCall":3}}'
save live-prices $T/d1b.json
v1 GET "$P?ids=SKU-1001" -H "X-Api-Key: $TL"
check "design saved → the next call sends the new field" '{"sku":"SKU-1001","price":79.99,"inStock":true,"category":"shoes"}' "$(body | ex 'o.data[0]')"
curl -s -o $T/up -b $T/a -X POST "$API/organizations/$S/data-sources/$DS/imports" -F "file=@$CSV/e2e-products-v3.csv" -F "mode=replace"
IMP=$(cat $T/up | ex 'o.import.id')
for i in $(seq 1 100); do st=$(curl -s -b $T/a "$API/organizations/$S/data-sources/$DS/imports/$IMP" | ex 'o.import.status'); [ "$st" == succeeded ] && break; sleep 0.1; done
v1 GET "$P?ids=SKU-1001,SKU-1003,SKU-1006" -H "X-Api-Key: $TL"
check "data replaced → new price, removed row NOT_FOUND, new row found" "69.99 SKU-1006 SKU-1003" "$(body | ex 'o.data[0].price+" "+o.data[1].sku+" "+o.errors.map(e=>e.error_id).join()')"

echo "G. Many calls"
START=$(node -e 'console.log(Date.now())')
for i in $(seq 1 50); do curl -s -o $T/pb/c$i -w '%{http_code}\n' "$BASE/v1/$P?ids=SKU-1001,SKU-1002" -H "X-Api-Key: $TL" >> $T/many & done; wait
MS=$(( $(node -e 'console.log(Date.now())') - START ))
check "50 calls at once → all 200 with the same data" "50 1" "$(grep -c '^200$' $T/many) $(for f in $T/pb/c*; do ex 'JSON.stringify(o.data)' < $f; done | sort -u | wc -l | tr -d ' ')"
check "  all 50 answered within 3 s (Jivox's limit per call)" "yes" "$([ $MS -lt 3000 ] && echo yes || echo "no ($MS ms)")"
echo "    (50 parallel calls took $MS ms)"

if [ -n "$LOG_FILE" ] && [ -f "$LOG_FILE" ]; then
  echo "H. Logs"
  sleep 0.5
  check "no token used in this run appears in the backend log ($(grep -cE '^rtk_[A-Za-z0-9_-]{43}$' $TOKENS_SEEN) tokens checked)" "0" "$(grep -c -F -f <(grep -E '^rtk_[A-Za-z0-9_-]{43}$' $TOKENS_SEEN | sed 's/^rtk_//') "$LOG_FILE")"
  check "  a token sent in the URL / another header is logged as rtk_[Redacted]" "yes yes" "$(grep -F "/v1/$S/live-prices?ids=SKU-1001&api_key=rtk_[Redacted]" "$LOG_FILE" | grep -q . && echo yes || echo no) $(grep -F '"x-token":"rtk_[Redacted]"' "$LOG_FILE" | grep -q . && echo yes || echo no)"
  check "  /v1 calls are logged with the header redacted" "yes" "$(grep -F "/v1/$S/" "$LOG_FILE" | grep -q '"x-api-key":"\[Redacted\]"' && echo yes || echo no)"
fi

psql "$DB" -qtAc "DELETE FROM users WHERE email='$EMAIL'" >/dev/null
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
