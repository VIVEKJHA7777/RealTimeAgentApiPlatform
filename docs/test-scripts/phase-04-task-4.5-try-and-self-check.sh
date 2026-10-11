#!/bin/bash
# Task 4.5 scenario tests: "Try it" and the self-check (the Test tab's backend).
# Try it: in-app answer = live /v1 answer = Design preview; the request Jivox would send; the curl
# command really works when you put a token in; drafts work; failures shown as /v1 would give them.
# Self-check: in-app on drafts (published / token ✗, network skipped); live once published (real
# HTTP call + a call without token); every content check passing AND failing with its reason;
# the check never counts as token use.
#
# Usage (backend running with `npm run dev`), from any folder:
#   DB_URL="postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_mine" \
#   API=localhost:4001/api bash docs/test-scripts/phase-04-task-4.5-try-and-self-check.sh
# The backend's PUBLIC_BASE_URL must reach the backend itself (default http://localhost:<PORT> does).
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
# try API [IDS_JSON] / selfcheck API [IDS_JSON] → answer in $T/body
body_of_ids() { if [ -n "$1" ]; then json $T/t.json "{\"ids\":$1}"; else json $T/t.json '{}'; fi; }
try() { body_of_ids "$2"; req a POST "$S/apis/$1/try" $T/t.json; }
selfcheck() { body_of_ids "$2"; req a POST "$S/apis/$1/self-check" $T/t.json; }
# st ID → that check's status (pass / fail / warn / skip)
st() { body | ex "(o.checks.find(c=>c.id==='$1')||{}).status"; }
detail() { body | ex "(o.checks.find(c=>c.id==='$1')||{}).detail"; }

EMAIL="try-$RANDOM$RANDOM@test.com"
curl -s -o /dev/null -c $T/a -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
curl -s -o /dev/null -c $T/b -X POST $API/auth/signup -H "$H" -d "{\"email\":\"other-$EMAIL\",\"password\":\"password123\"}"
S=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"Try Test","slug":"try-test"}' | ex 'o.organization.slug')
B=$(curl -s -b $T/a -X POST "$API/organizations/$S/data-sources" -F "file=@$CSV/e2e-products-v1.csv" -F "idColumn=sku" -F "name=Products")
DS=$(echo "$B" | ex 'o.dataSource.id'); IMP=$(echo "$B" | ex 'o.import.id')
for i in $(seq 1 100); do st=$(curl -s -b $T/a "$API/organizations/$S/data-sources/$DS/imports/$IMP" | ex 'o.import.status'); [ "$st" == succeeded ] && break; sleep 0.1; done
for a in prices feed empty-api; do json $T/api.json "{\"name\":\"$a\",\"slug\":\"$a\",\"dataSourceId\":\"$DS\"}"; req a POST "$S/apis" $T/api.json; done
json $T/d1.json '{"idField":{"responseKey":"sku"},"fields":[
 {"jivoxColumn":"current_price","sourceColumn":"priceUSD","responseKey":"price","type":"float","default":"0","onMismatch":"default"},
 {"jivoxColumn":"is_active","sourceColumn":"in_stock","responseKey":"inStock","type":"boolean"}],
 "request":{"method":"GET","query":{"ids":"{item_id}","market":"US"},"maxIdsPerCall":3}}'
save prices $T/d1.json
# POST: amount and image are SENT AS WRITTEN when they don't fit (R10) → the self-check must flag them
json $T/d2.json '{"idField":{"responseKey":"productId"},"fields":[
 {"jivoxColumn":"product_name","sourceColumn":"Product Name","responseKey":"name","type":"string"},
 {"jivoxColumn":"product_image","sourceColumn":"img","responseKey":"image","type":"image"},
 {"jivoxColumn":"current_price","sourceColumn":"priceUSD","responseKey":"amount","type":"float"},
 {"jivoxColumn":"category","sourceColumn":"category","responseKey":"category","type":"int","typeInContract":false}],
 "request":{"method":"POST","body":{"items":[{"sku":"{item_id}","cat":"{category}"}],"currency":"USD"},"maxIdsPerCall":20}}'
save feed $T/d2.json
json $T/st.json '{"style":"bearer"}'; req a PUT "$S/apis/feed/auth-header" $T/st.json
[ "$(curl -s -b $T/a "$API/organizations/$S/apis" | ex 'o.apis.map(a=>a.designVersion).sort().join()')" == "0,1,1" ] || { echo "Setup failed: designs not saved"; exit 1; }

echo "A. Try it (draft, no token)"
try prices
check "draft → 200 in-app, status draft, the answer /v1 would give (200)" "200 in-app draft 200" "$(code) $(body | ex 'o.mode+" "+o.status+" "+o.response.status')"
check "  says which ids it used (the first 2 rows, for the ids box)" '["SKU-1001","SKU-1002"]' "$(body | ex 'o.ids')"
check "  default ids = the first 2 rows" '[{"sku":"SKU-1001","price":79.99,"inStock":true},{"sku":"SKU-1002","price":129,"inStock":false}]' "$(body | ex 'o.response.body.data')"
check "  the request Jivox would send (public URL, ids joined, literal kept)" "GET yes <your token>" "$(body | ex 'o.request.method') $(body | ex "o.request.url.endsWith('/v1/$S/prices?ids=SKU-1001%2CSKU-1002&market=US')?'yes':'no'") $(body | ex 'o.request.headers["X-Api-Key"]')"
check "  headers no-store + JSON, a duration" "no-store yes" "$(body | ex 'o.response.headers["Cache-Control"]') $(body | ex 'Number.isInteger(o.durationMs)?"yes":"no"')"
check "  curl: the URL + the X-Api-Key header with a placeholder" "yes" "$(body | ex 'o.curl.startsWith("curl -s '"'"'http") && o.curl.includes("-H '"'"'X-Api-Key: <your token>'"'"'") ? "yes" : "no"')"
CURL_GET=$(body | ex 'o.curl'); TRY_DATA=$(body | ex 'JSON.stringify(o.response.body.data)')
json $T/pv.json '{"ids":["SKU-1001","SKU-1002"]}'; req a POST "$S/apis/prices/design/preview" $T/pv.json
check "  = the Design preview's answer" "$TRY_DATA" "$(body | ex 'JSON.stringify(o.response.data)')"
try prices '["SKU-1003","SKU-9999"]'
check "chosen ids: n/a → strict default 0; unknown → NOT_FOUND" '[{"sku":"SKU-1003","price":0,"inStock":true}] SKU-9999' "$(body | ex 'o.response.body.data') $(body | ex 'o.response.body.errors.map(e=>e.error_id).join()')"
try prices '["a","b","c","d"]'
check "4 ids (max 3) → shows the 400 TOO_MANY_IDS envelope /v1 would give" "200 400 TOO_MANY_IDS failure" "$(code) $(body | ex 'o.response.status+" "+o.response.body.errors[0].error_code+" "+o.response.body.status')"
try prices '["x,y"]'
check "an id with a comma on GET → split in two, like live (both NOT_FOUND)" "x,y" "$(body | ex 'o.response.body.errors.map(e=>e.error_id).join()')"
try feed '["SKU-1004","SKU-1003"]'
check "POST: body with one object per id, {category} filled from our data, literal kept" '{"items":[{"sku":"SKU-1004","cat":"sandals"},{"sku":"SKU-1003","cat":"boots"}],"currency":"USD"}' "$(body | ex 'o.request.body')"
check "  Bearer header + JSON content type in the request" "Bearer <your token> application/json" "$(body | ex 'o.request.headers.Authorization+" "+o.request.headers["Content-Type"]')"
check "  curl has -X POST, Authorization, Content-Type and the body" "yes" "$(body | ex 'o.curl.includes("-X POST") && o.curl.includes("Authorization: Bearer <your token>") && o.curl.includes("Content-Type: application/json") && o.curl.includes("-d '"'"'{" + JSON.stringify("items")) ? "yes" : "no"')"
CURL_POST=$(body | ex 'o.curl'); TRY_POST=$(body | ex 'JSON.stringify(o.response.body.data)')
check "  answer: values that don't fit are sent as written (R10)" '[{"productId":"SKU-1004","name":"City Sandal","image":"not-a-url","amount":"","category":"sandals"},{"productId":"SKU-1003","name":"Trail Boot","image":"https://cdn.example.com/p/1003.png","amount":"n/a","category":"boots"}]' "$TRY_POST"
try feed '["it'"'"'s,1"]'
check "POST: an id with a quote and a comma stays one id" "it's,1" "$(body | ex 'o.response.body.errors[0].error_id')"
check "no design yet → 409 NO_DESIGN" "409 NO_DESIGN" "$(try empty-api; code) $(body | ex 'o.error.code')"
json $T/t.json '{"ids":[]}'; req a POST "$S/apis/prices/try" $T/t.json; R1=$(code)
json $T/t.json '{"ids":[" "]}'; req a POST "$S/apis/prices/try" $T/t.json; R2=$(code)
node -e 'console.log(JSON.stringify({ids:Array.from({length:101},(_, i)=>"x"+i)}))' > $T/t.json; req a POST "$S/apis/prices/try" $T/t.json; R3=$(code)
check "ids [] / blank / 101 ids → 400" "400 400 400" "$R1 $R2 $R3"
check "another account → 404; logged out → 401" "404 401" "$(req b POST "$S/apis/prices/try"; code) $(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/organizations/$S/apis/prices/try")"

echo "B. Self-check on a draft (in-app)"
selfcheck prices
check "mode in-app, not passed: published ✗, token ✗, network checks skipped" "in-app false fail fail skip skip" "$(body | ex 'o.mode+" "+o.passed') $(st published) $(st token) $(st reachable) $(st needs_token)"
check "  content checks all ✓ (2xx, no-store, envelope, success, ids, fields, fast)" "pass pass pass pass pass pass pass" "$(st status_2xx) $(st no_store) $(st envelope) $(st success) $(st ids_once) $(st fields_typed) $(st fast)"
check "  reasons say what to do" "yes yes" "$(detail published | grep -q Publish && echo yes || echo no) $(detail token | grep -q 'Create a token' && echo yes || echo no)"

echo "C. Live self-check (published, real HTTP call)"
TP=$(new_token prices '{"name":"Jivox qa3"}'); TPID=$(body | ex 'o.tokenInfo.id')
TF=$(new_token feed '{"name":"Jivox qa3"}')
req a POST "$S/apis/prices/publish"; req a POST "$S/apis/feed/publish"
selfcheck prices
check "published + token → mode live, passed" "live true" "$(body | ex 'o.mode+" "+o.passed')"
check "  every check ✓ (reachable may warn on localhost)" "pass pass pass pass pass pass pass pass pass pass" "$(for c in published token needs_token status_2xx no_store envelope success ids_once fields_typed fast; do st $c; done | tr '\n' ' ' | sed 's/ $//')"
check "  reachable: ✓ on a public address, ⚠ on localhost (Jivox on qa3 can't reach it)" "yes" "$(R=$(st reachable); D=$(detail reachable); { [ "$R" == pass ] || { [ "$R" == warn ] && echo "$D" | grep -q "can't reach localhost"; }; } && echo yes || echo no)"
check "  token used is named; the token itself isn't in the answer" "yes 0" "$(detail token | grep -q 'Jivox qa3' && echo yes || echo no) $(grep -cF -e "${TP:4}" $T/body)"
check "  the live answer = Try it's answer" "$TRY_DATA" "$(body | ex 'JSON.stringify(o.response.body.data)')"
check "the self-check doesn't count as token use (lastUsedAt still empty)" "null" "$(curl -s -b $T/a "$API/organizations/$S/apis/prices/tokens" | ex 'o.tokens[0].lastUsedAt')"
selfcheck feed
check "POST + Bearer, default ids → live, passed" "live true" "$(body | ex 'o.mode+" "+o.passed')"
selfcheck feed '["SKU-1003","SKU-1004"]'
check "values sent as written / empty sent as "" → fields ✗, with each reason" "fail yes yes yes" "$(st fields_typed) $(detail fields_typed | grep -q 'SKU-1003: "amount" is text "n/a", the contract says float' && echo yes || echo no) $(detail fields_typed | grep -q 'SKU-1004: "image" is text "not-a-url", the contract says image' && echo yes || echo no) $(detail fields_typed | grep -qF 'SKU-1004: "amount" is text "", the contract says float' && echo yes || echo no)"
check "  a field kept out of the contract's types (category as int, typeInContract false) isn't flagged" "no" "$(detail fields_typed | grep -q category && echo yes || echo no)"
check "  ids ✓, passed false" "pass false" "$(st ids_once) $(body | ex 'o.passed')"
selfcheck prices '["SKU-1001","SKU-9999"]'
check "an id not in the data → ids ✗ \"isn't in your data\"" "fail SKU-9999 isn't in your data" "$(st ids_once) $(detail ids_once)"
selfcheck prices '["a","b","c","d"]'
check "too many ids → 2xx ✗ with the /v1 reason, success ✗" "fail fail yes" "$(st status_2xx) $(st success) $(detail status_2xx | grep -q 'HTTP 400: TOO_MANY_IDS' && echo yes || echo no)"

echo "D. The curl from Try it works as written (with a real token)"
OUT=$(bash -c "${CURL_GET//<your token>/$TP}")
check "GET curl → the same data as Try it" "$TRY_DATA" "$(echo "$OUT" | ex 'JSON.stringify(o.data)')"
OUT=$(bash -c "${CURL_POST//<your token>/$TF}")
check "POST curl (Bearer, JSON body) → the same data as Try it" "$TRY_POST" "$(echo "$OUT" | ex 'JSON.stringify(o.data)')"

echo "E. Token problems in the self-check"
sql "UPDATE api_tokens SET expires_at = now() - interval '1 minute' WHERE id='$TPID'" > /dev/null
selfcheck prices
check "only token expired → in-app, token ✗, passed false, reachable skipped (says why)" "in-app fail false skip yes" "$(body | ex 'o.mode') $(st token) $(body | ex 'o.passed') $(st reachable) $(detail reachable | grep -q 'no readable active token' && echo yes || echo no)"
json $T/x.json '{"expiresAt":null}'; req a PATCH "$S/apis/prices/tokens/$TPID" $T/x.json
sql "UPDATE api_tokens SET token_encrypted = 'v1.AAAA.BBBB.CCCC' WHERE id='$TPID'" > /dev/null
selfcheck prices
check "active but unreadable (other encryption key) → token ⚠ 'renew it', in-app" "warn yes in-app" "$(st token) $(detail token | grep -q 'renew it' && echo yes || echo no) $(body | ex 'o.mode')"
check "  …content all ✓, but not 'passed': passed needs the live call Jivox would make" "pass false" "$(st fields_typed) $(body | ex 'o.passed')"
req a POST "$S/apis/prices/tokens/$TPID/renew" $T/x.json
selfcheck prices
check "renew → live again, passed" "live true" "$(body | ex 'o.mode+" "+o.passed')"
req a POST "$S/apis/prices/unpublish"
selfcheck prices
check "unpublished → in-app, published ✗" "in-app fail" "$(body | ex 'o.mode') $(st published)"

echo "F. Who can"
check "another account → 404 (try and self-check)" "404 404" "$(req b POST "$S/apis/prices/self-check"; code) $(req b POST "$S/apis/prices/try"; code)"

psql "$DB" -qtAc "DELETE FROM users WHERE email IN ('$EMAIL','other-$EMAIL')" >/dev/null
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
