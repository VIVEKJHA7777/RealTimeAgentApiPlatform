#!/bin/bash
# Task 4.9: Phase 4 end to end, as a brand owner and Jivox would live it, on the real HTTP endpoints:
#   1 an API that can't be published yet (reasons) · 2 its design (empty values → "" or left out)
#   3 a token with an expiry; Show = the token made; only the owner · 4 Try it on the draft;
#   the live URL is 404 · 5 publish · 6 Jivox calls GET + POST (Bearer) = Try it, no-store,
#   unknown ids, wrong header · 7 self-check live: passes; flags "" in a float field
#   8 expiry → TOKEN_EXPIRED → Extend → Renew (old 401, new 200) · 9 new data / new design live at once
#   10 Recent calls: the last 5, failures with reasons, no self-checks, Clear
#   11 revoke every token: stays published, calls 401, publish-check says why · 12 unpublish, delete
#
# Usage (backend running with `npm run dev`), from any folder:
#   DB_URL="postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_mine" \
#   API=localhost:4001/api bash docs/test-scripts/phase-04-task-4.9-end-to-end.sh
# Optional: LOG_FILE=<backend log file> adds "no token anywhere in the log" (needs LOG_OUTPUT=file in your copy).
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
wait_import() { local st; for i in $(seq 1 150); do st=$(curl -s -b $T/a "$API/organizations/$S/data-sources/$1/imports/$2" | ex 'o.import.status'); [ "$st" == succeeded ] || [ "$st" == failed ] && break; sleep 0.1; done; echo "$st"; }
# live CALL: v1 METHOD API "header" [body] → status in $T/code, answer in $T/v1, headers in $T/h
v1() { local args=(-s -o $T/v1 -D $T/h -w '%{http_code}' -A 'Jivox-Verifier/1.0' -X "$1" "$BASE/v1/$S/$2"); [ -n "$3" ] && args+=(-H "$3"); [ -n "$4" ] && args+=(-d "$4"); curl "${args[@]}" > $T/code; }
v1body() { cat $T/v1; }
st() { body | ex "(o.checks.find(c=>c.id==='$1')||{}).status"; }
detail() { body | ex "(o.checks.find(c=>c.id==='$1')||{}).detail"; }
recent() { curl -s -b $T/a "$API/organizations/$S/apis/$1/recent-calls" > $T/rc; }
tokid() { curl -s -b $T/a "$API/organizations/$S/apis/$1/tokens" | ex "o.tokens.find(t=>t.name==='$2'&&t.state!=='revoked').id"; }

EMAIL="e2e4-$RANDOM$RANDOM@test.com"
curl -s -o /dev/null -c $T/a -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
curl -s -o /dev/null -c $T/b -X POST $API/auth/signup -H "$H" -d "{\"email\":\"other-$EMAIL\",\"password\":\"password123\"}"
S=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"Acme Shoes","slug":"acme-shoes"}' | ex 'o.organization.slug')
B=$(curl -s -b $T/a -X POST "$API/organizations/$S/data-sources" -F "file=@$CSV/e2e-products-v1.csv" -F "idColumn=sku" -F "name=Products")
DS=$(echo "$B" | ex 'o.dataSource.id')
[ "$(wait_import $DS $(echo "$B" | ex 'o.import.id'))" == succeeded ] || { echo "Setup failed: import"; exit 1; }

echo "1. A new API can't be published yet, and says why"
json $T/a1.json "{\"name\":\"Live prices\",\"slug\":\"live-prices\",\"dataSourceId\":\"$DS\"}"; req a POST "$S/apis" $T/a1.json
json $T/a2.json "{\"name\":\"Product feed\",\"slug\":\"product-feed\",\"dataSourceId\":\"$DS\"}"; req a POST "$S/apis" $T/a2.json
req a GET "$S/apis/live-prices/publish-check"
check "publish-check: draft, can't publish: NO_DESIGN + NO_ACTIVE_TOKEN" "draft false NO_DESIGN,NO_ACTIVE_TOKEN" "$(body | ex 'o.status+" "+o.canPublish+" "+o.reasons.map(r=>r.code).join()')"
req a POST "$S/apis/live-prices/publish"
check "Publish → 409 PUBLISH_BLOCKED listing both reasons" "409 PUBLISH_BLOCKED 2" "$(code) $(body | ex 'o.error.code') $(body | ex 'o.error.details.length')"

echo "2. The design: what Jivox gets, and how it asks"
# live-prices: GET ?ids=…&market=US, X-Api-Key. price float (empty → "" by default), stock boolean (empty → key left out)
json $T/d1.json '{"idField":{"responseKey":"sku"},"fields":[
 {"jivoxColumn":"current_price","sourceColumn":"priceUSD","responseKey":"price","type":"float"},
 {"jivoxColumn":"product_name","sourceColumn":"Product Name","responseKey":"name","type":"string"},
 {"jivoxColumn":"is_active","sourceColumn":"in_stock","responseKey":"inStock","type":"boolean","onEmpty":"omit"}],
 "request":{"method":"GET","query":{"ids":"{item_id}","market":"US"},"maxIdsPerCall":5}}'
save live-prices $T/d1.json
check "saved; fields keep onEmpty (price default \"\", inStock omit)" "200 empty_string,empty_string,omit" "$(code) $(curl -s -b $T/a "$API/organizations/$S/apis/live-prices/design" | ex 'o.design.fields.map(f=>f.onEmpty).join()')"
# product-feed: POST {"items":[{"id":…}]}, Bearer, different keys from the same data
json $T/d2.json '{"idField":{"responseKey":"productId"},"fields":[
 {"jivoxColumn":"product_name","sourceColumn":"Product Name","responseKey":"title","type":"string"},
 {"jivoxColumn":"product_image","sourceColumn":"img","responseKey":"image","type":"image"}],
 "request":{"method":"POST","body":{"items":[{"id":"{item_id}"}]},"maxIdsPerCall":20}}'
save product-feed $T/d2.json
json $T/st.json '{"style":"bearer"}'; req a PUT "$S/apis/product-feed/auth-header" $T/st.json
check "product-feed asks for Bearer" "200 bearer" "$(code) $(body | ex 'o.authHeader')"
req a GET "$S/apis/live-prices/publish-check"
check "publish-check now only misses a token" "NO_ACTIVE_TOKEN" "$(body | ex 'o.reasons.map(r=>r.code).join()')"

echo "3. Tokens: made with an expiry, shown again any time, only to the owner"
json $T/t1.json "{\"name\":\"Jivox qa3\",\"expiresAt\":\"$(node -e 'console.log(new Date(Date.now()+30*864e5).toISOString())')\"}"
req a POST "$S/apis/live-prices/tokens" $T/t1.json; TP=$(body | ex 'o.token'); TPID=$(body | ex 'o.tokenInfo.id')
check "created (201): rtk_ + 43 characters, active, expires in 30 days" "201 47 active 30" "$(code) ${#TP} $(body | ex 'o.tokenInfo.state') $(body | ex 'Math.round((Date.parse(o.tokenInfo.expiresAt)-Date.now())/864e5)')"
check "the list shows only the hint, never the token" "yes 0" "$(curl -s -b $T/a "$API/organizations/$S/apis/live-prices/tokens" | ex "o.tokens[0].hint==='${TP:0:8}'?'yes':'no'") $(curl -s -b $T/a "$API/organizations/$S/apis/live-prices/tokens" | grep -cF -e "${TP:8}")"
req a GET "$S/apis/live-prices/tokens/$TPID/reveal"
check "Show → the same token, no-store" "same" "$(body | ex "o.token==='$TP'?'same':'different'")"
check "another account → 404 for Show and the list" "404 404" "$(req b GET "$S/apis/live-prices/tokens/$TPID/reveal"; code) $(req b GET "$S/apis/live-prices/tokens"; code)"
json $T/t2.json '{"name":"Jivox qa3"}'; req a POST "$S/apis/product-feed/tokens" $T/t2.json; TF=$(body | ex 'o.token')
check "same name on another API is fine (never expires)" "201 null" "$(code) $(body | ex 'o.tokenInfo.expiresAt')"

echo "4. Before publishing: Try it works, the live URL doesn't"
json $T/try.json '{"ids":["SKU-1001","SKU-1004"]}'; req a POST "$S/apis/live-prices/try" $T/try.json
TRY=$(body | ex 'JSON.stringify(o.response.body.data)')
check "Try it (draft): 200; empty price → \"\"; empty-able stock kept (TRUE → true)" '[{"sku":"SKU-1001","price":79.99,"name":"Red Runner","inStock":true},{"sku":"SKU-1004","price":"","name":"City Sandal","inStock":true}]' "$TRY"
check "  the request Jivox will send: GET with the ids and the literal" "GET yes" "$(body | ex 'o.request.method') $(body | ex "o.request.url.endsWith('/v1/$S/live-prices?ids=SKU-1001%2CSKU-1004&market=US')?'yes':'no'")"
v1 GET "live-prices?ids=SKU-1001&market=US" "X-Api-Key: $TP"
check "live URL with a good token → 404 NOT_FOUND (draft), envelope, no-store" "404 failure NOT_FOUND yes" "$(code) $(v1body | ex 'o.status') $(v1body | ex 'o.errors[0].error_code') $(grep -qi '^cache-control: no-store' $T/h && echo yes || echo no)"

echo "5. Publish"
req a POST "$S/apis/live-prices/publish"
check "Publish → 200, published, with a date" "200 published yes" "$(code) $(body | ex 'o.api.status') $(body | ex '!isNaN(Date.parse(o.api.publishedAt))?"yes":"no"')"
req a POST "$S/apis/product-feed/publish"; check "product-feed published too" "200" "$(code)"

echo "6. Jivox calls the live URL"
v1 GET "live-prices?ids=SKU-1001,SKU-1004&market=US" "X-Api-Key: $TP"
check "GET with X-Api-Key → 200, the SAME data as Try it" "200 $TRY" "$(code) $(v1body | ex 'JSON.stringify(o.data)')"
check "  envelope success, generated_at, errors [], Cache-Control no-store, JSON" "success yes [] yes yes" "$(v1body | ex 'o.status') $(v1body | ex '/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(o.generated_at)?"yes":"no"') $(v1body | ex 'o.errors') $(grep -qi '^cache-control: no-store' $T/h && echo yes || echo no) $(grep -qi '^content-type: application/json' $T/h && echo yes || echo no)"
v1 GET "live-prices?ids=SKU-1003,SKU-9999" "X-Api-Key: $TP"
check "\"n/a\" sent as written (R10); unknown id in errors[]" '"n/a" SKU-9999:NOT_FOUND' "$(v1body | ex 'JSON.stringify(o.data[0].price)') $(v1body | ex 'o.errors.map(e=>e.error_id+":"+e.error_code).join()')"
v1 GET "live-prices?ids=a,b,c,d,e,f" "X-Api-Key: $TP"
check "6 ids (max 5) → 400 TOO_MANY_IDS" "400 TOO_MANY_IDS" "$(code) $(v1body | ex 'o.errors[0].error_code')"
v1 GET "live-prices?ids=SKU-1001" "Authorization: Bearer $TP"
check "right token in the wrong header (Bearer) → 401 naming X-Api-Key" "401 yes" "$(code) $(v1body | ex 'o.errors[0].error_message.includes("X-Api-Key")?"yes":"no"')"
v1 GET "live-prices?ids=SKU-1001" "X-Api-Key: $TF"
check "the other API's token → 401" "401 UNAUTHORIZED" "$(code) $(v1body | ex 'o.errors[0].error_code')"
v1 POST product-feed "Authorization: Bearer $TF" '{"items":[{"id":"SKU-1004"},{"id":"SKU-1001"}]}'
check "POST with Bearer → 200, asked order, its own keys" '200 [{"productId":"SKU-1004","title":"City Sandal","image":"not-a-url"},{"productId":"SKU-1001","title":"Red Runner","image":"https://cdn.example.com/p/1001.png"}]' "$(code) $(v1body | ex 'JSON.stringify(o.data)')"
v1 GET "product-feed?ids=SKU-1001" "Authorization: Bearer $TF"
check "GET on the POST API → 405, Allow: POST" "405 yes" "$(code) $(grep -qi '^allow: POST' $T/h && echo yes || echo no)"
OUT=$(bash -c "$(curl -s -b $T/a -X POST "$API/organizations/$S/apis/product-feed/try" -H "$H" -d '{"ids":["SKU-1001"]}' | ex 'o.curl' | sed "s/<your token>/$TF/")")
check "the curl from the Test tab, with the token put in, works as written" "SKU-1001" "$(echo "$OUT" | ex 'o.data[0].productId')"
sleep 1.2 # last_used_at is written right after the answer
check "the token now shows when it was last used" "yes" "$(curl -s -b $T/a "$API/organizations/$S/apis/live-prices/tokens" | ex "o.tokens.find(t=>t.id==='$TPID').lastUsedAt?'yes':'no'")"

echo "7. Self-check (live)"
json $T/sc.json '{}'; req a POST "$S/apis/live-prices/self-check" $T/sc.json
check "default ids → live, passed, every check ✓ (reachable may warn on localhost)" "live true" "$(body | ex 'o.mode+" "+o.passed')"
check "  needs_token ✓ (a call without a token is refused)" "pass" "$(st needs_token)"
json $T/sc.json '{"ids":["SKU-1004"]}'; req a POST "$S/apis/live-prices/self-check" $T/sc.json
check "SKU-1004 (empty price → \"\") → fields ✗ \"is text \\\"\\\", the contract says float\"" "fail yes false" "$(st fields_typed) $(detail fields_typed | grep -qF 'SKU-1004: "price" is text "", the contract says float' && echo yes || echo no) $(body | ex 'o.passed')"

echo "8. Expiry, Extend, Renew"
sql "UPDATE api_tokens SET expires_at = now() - interval '1 minute' WHERE id='$TPID'" > /dev/null
v1 GET "live-prices?ids=SKU-1001" "X-Api-Key: $TP"
check "expired → 401 TOKEN_EXPIRED with the date; the list says expired" "401 TOKEN_EXPIRED yes expired" "$(code) $(v1body | ex 'o.errors[0].error_code') $(v1body | ex '/expired on \d{4}-\d\d-\d\d \d\d:\d\d UTC/.test(o.errors[0].error_message)?"yes":"no"') $(curl -s -b $T/a "$API/organizations/$S/apis/live-prices/tokens" | ex "o.tokens.find(t=>t.id==='$TPID').state")"
req a GET "$S/apis/live-prices/publish-check"
check "  the API stays published; publish-check says no active token" "published NO_ACTIVE_TOKEN" "$(body | ex 'o.status') $(body | ex 'o.reasons.map(r=>r.code).join()')"
json $T/ext.json "{\"expiresAt\":\"$(node -e 'console.log(new Date(Date.now()+90*864e5).toISOString())')\"}"; req a PATCH "$S/apis/live-prices/tokens/$TPID" $T/ext.json
v1 GET "live-prices?ids=SKU-1001" "X-Api-Key: $TP"
check "Extend 90 days → the SAME token works again" "200 active" "$(code) $(curl -s -b $T/a "$API/organizations/$S/apis/live-prices/tokens" | ex "o.tokens.find(t=>t.id==='$TPID').state")"
json $T/ren.json '{"expiresAt":null}'; req a POST "$S/apis/live-prices/tokens/$TPID/renew" $T/ren.json; TP2=$(body | ex 'o.token')
check "Renew → 201, a new token, same name, never expires" "201 yes Jivox qa3 null" "$(code) $([ "$TP2" != "$TP" ] && [ ${#TP2} == 47 ] && echo yes || echo no) $(body | ex 'o.tokenInfo.name') $(body | ex 'o.tokenInfo.expiresAt')"
v1 GET "live-prices?ids=SKU-1001" "X-Api-Key: $TP"; OLD=$(code)
v1 GET "live-prices?ids=SKU-1001" "X-Api-Key: $TP2"
check "  old token 401 at once, the new one 200" "401 200" "$OLD $(code)"
json $T/sc.json '{}'; req a POST "$S/apis/live-prices/self-check" $T/sc.json
check "  self-check passes with the new token" "live true" "$(body | ex 'o.mode+" "+o.passed')"

echo "9. New data and a new design are live at once"
curl -s -o $T/body -b $T/a -X POST "$API/organizations/$S/data-sources/$DS/imports" -F "file=@$CSV/e2e-products-v3.csv" -F "mode=replace"
check "data replaced (v3: SKU-1001 now 69.99, SKU-1003 gone, SKU-1006 new)" "succeeded" "$(wait_import $DS $(body | ex 'o.import.id'))"
v1 GET "live-prices?ids=SKU-1001,SKU-1003,SKU-1006" "X-Api-Key: $TP2"
check "  live: new price, removed id → NOT_FOUND, new id answered" "69.99 SKU-1003 SKU-1006" "$(v1body | ex 'o.data[0].price') $(v1body | ex 'o.errors.map(e=>e.error_id).join()') $(v1body | ex 'o.data[1].sku')"
json $T/d1b.json '{"idField":{"responseKey":"sku"},"fields":[
 {"jivoxColumn":"current_price","sourceColumn":"priceUSD","responseKey":"amount","type":"float"}],
 "request":{"method":"GET","query":{"ids":"{item_id}","market":"US"},"maxIdsPerCall":5}}'
save live-prices $T/d1b.json
v1 GET "live-prices?ids=SKU-1001" "X-Api-Key: $TP2"
check "design saved (price → amount, 1 field) → the next call has the new shape" '[{"sku":"SKU-1001","amount":69.99}]' "$(v1body | ex 'JSON.stringify(o.data)')"

echo "10. Recent calls"
v1 GET "live-prices?ids=SKU-1002" ""
v1 GET "live-prices?ids=SKU-1002" "X-Api-Key: $TP"
v1 GET "live-prices?ids=SKU-1002,SKU-7777" "X-Api-Key: $TP2"
json $T/sc.json '{}'; req a POST "$S/apis/live-prices/self-check" $T/sc.json
recent live-prices
check "the last 5 calls, newest first; the self-check's calls aren't there" "5 200,401,401,200,200" "$(ex 'o.calls.length' < $T/rc) $(ex 'o.calls.map(c=>c.status).join()' < $T/rc)"
check "  newest: token by name, ids, 1 found · 1 not found, GET + path, user agent" "Jivox qa3 SKU-1002,SKU-7777 1/2 GET yes Jivox-Verifier/1.0" "$(ex 'o.calls[0].tokenName' < $T/rc) $(ex 'o.calls[0].ids.join()' < $T/rc) $(ex 'o.calls[0].found+"/"+o.calls[0].idCount' < $T/rc) $(ex 'o.calls[0].method' < $T/rc) $(ex "o.calls[0].path.startsWith('/v1/$S/live-prices?ids=')?'yes':'no'" < $T/rc) $(ex 'o.calls[0].userAgent' < $T/rc)"
check "  the renewed-away token: by name, UNAUTHORIZED; no token: 'none'" "Jivox qa3 UNAUTHORIZED none UNAUTHORIZED" "$(ex 'o.calls[1].tokenName+" "+o.calls[1].errorCode' < $T/rc) $(ex 'o.calls[2].tokenKind+" "+o.calls[2].errorCode' < $T/rc)"
check "  no token text anywhere in the list" "0 0 0" "$(grep -cF -e "${TP:4:20}" $T/rc) $(grep -cF -e "${TP2:4:20}" $T/rc) $(grep -cF -e "${TF:4:20}" $T/rc)"
recent product-feed
check "product-feed has its own list (its POST bodies kept)" 'yes {"items":[{"id":"SKU-1004"},{"id":"SKU-1001"}]}' "$(ex 'o.calls.length>=2?"yes":"no"' < $T/rc) $(ex 'o.calls.find(c=>c.status===200&&c.method==="POST"&&c.idCount===2).body' < $T/rc)"
check "another account → 404" "404" "$(req b GET "$S/apis/live-prices/recent-calls"; code)"
req a DELETE "$S/apis/live-prices/recent-calls"
v1 GET "live-prices?ids=SKU-1001" "X-Api-Key: $TP2"; recent live-prices
check "Clear → empty; the next call is the only one" "1 200" "$(ex 'o.calls.length' < $T/rc) $(ex 'o.calls[0].status' < $T/rc)"

echo "11. Revoking every token: the API stays published, calls are refused"
TP2ID=$(tokid live-prices "Jivox qa3"); req a DELETE "$S/apis/live-prices/tokens/$TP2ID"
check "revoke → 200 revoked; doing it again → same answer" "200 revoked 200" "$(code) $(body | ex 'o.tokenInfo.state') $(req a DELETE "$S/apis/live-prices/tokens/$TP2ID"; code)"
v1 GET "live-prices?ids=SKU-1001" "X-Api-Key: $TP2"
check "  calls → 401; API still published; publish-check: NO_ACTIVE_TOKEN" "401 published NO_ACTIVE_TOKEN" "$(code) $(req a GET "$S/apis/live-prices/publish-check"; body | ex 'o.status') $(body | ex 'o.reasons.map(r=>r.code).join()')"
check "  a revoked token can't be shown, extended or renewed (409)" "409 409 409" "$(req a GET "$S/apis/live-prices/tokens/$TP2ID/reveal"; code) $(req a PATCH "$S/apis/live-prices/tokens/$TP2ID" $T/ext.json; code) $(req a POST "$S/apis/live-prices/tokens/$TP2ID/renew" $T/ren.json; code)"
json $T/t3.json '{"name":"Jivox qa3"}'; req a POST "$S/apis/live-prices/tokens" $T/t3.json; TP3=$(body | ex 'o.token')
v1 GET "live-prices?ids=SKU-1001" "X-Api-Key: $TP3"
check "a new token (same name allowed after revoke) → works at once, no re-publish" "200" "$(code)"

echo "12. Unpublish and delete"
req a POST "$S/apis/live-prices/unpublish"
v1 GET "live-prices?ids=SKU-1001" "X-Api-Key: $TP3"; LIVE=$(code)
check "unpublish → draft; live → 404; Try it still works" "draft 404 200" "$(req a GET "$S/apis/live-prices"; body | ex 'o.api.status') $LIVE $(req a POST "$S/apis/live-prices/try" $T/try.json; code)"
recent live-prices
check "  the 404 is in Recent calls" "404 NOT_FOUND" "$(ex 'o.calls[0].status+" "+o.calls[0].errorCode' < $T/rc)"
LPID=$(sql "SELECT id FROM apis WHERE slug='live-prices' AND organization_id=(SELECT id FROM organizations WHERE slug='$S')")
req a DELETE "$S/apis/live-prices"; DEL=$(code); sleep 1.2
v1 GET "live-prices?ids=SKU-1001" "X-Api-Key: $TP3"
check "delete → 204; live → 401 (its tokens went with it); tokens + recent calls rows gone" "204 401 0 0" "$DEL $(code) $(sql "SELECT count(*) FROM api_tokens WHERE api_id='$LPID'") $(sql "SELECT count(*) FROM api_recent_calls WHERE api_id='$LPID'")"
v1 POST product-feed "Authorization: Bearer $TF" '{"items":[{"id":"SKU-1006"}]}'
check "the other API on the same data still answers (with the new data)" "200 Hiking Pole" "$(code) $(v1body | ex 'o.data[0].title')"

if [ -n "$LOG_FILE" ]; then
  echo "Logs"
  N=0; for t in "$TP" "$TP2" "$TP3" "$TF"; do N=$((N + $(grep -cF -e "${t:4}" "$LOG_FILE"))); done
  check "no token (4 checked) anywhere in $LOG_FILE" "0" "$N"
fi

psql "$DB" -qtAc "DELETE FROM users WHERE email IN ('$EMAIL','other-$EMAIL')" >/dev/null
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
