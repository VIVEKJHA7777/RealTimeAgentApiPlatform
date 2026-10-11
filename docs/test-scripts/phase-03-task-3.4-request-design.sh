#!/bin/bash
# Task 3.4 scenario tests: the request design (contract/1 request template) in PUT/GET /design.
#
# Usage (backend running with `npm run dev`), from any folder:
#   DB_URL="postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_mine" \
#   API=localhost:4001/api bash docs/test-scripts/phase-03-task-3.4-request-design.sh
#
# Creates its own test user and deletes ONLY it at the end.
API="${API:-localhost:4000/api}"
DB="${DB_URL:-postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV="$SCRIPT_DIR/../test-data/csv"
H='content-type: application/json'
[ -f "$CSV/products-v1.csv" ] || { echo "Can't find the test CSVs in $CSV"; exit 1; }
curl -s -o /dev/null --max-time 3 "$API/health" || { echo "Backend not reachable at $API"; exit 1; }

T=$(mktemp -d); PASS=0; FAIL=0
check() { if [ "$2" == "$3" ]; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1  (expected: $2, got: $3)"; fi; }
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);const v=eval('o'+process.argv[1]);console.log(typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('JSON-ERROR')}})" "$1"; }
ex() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);const v=eval(process.argv[1]);console.log(typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('JSON-ERROR')}})" "$1"; }
sql() { psql "$DB" -tAc "$1"; }
code() { cat $T/code; }
call() { local jar=$1 m=$2 p=$3 d=$4; if [ -n "$d" ]; then curl -s -o $T/body -w '%{http_code}' -b $T/$jar -X $m "$API/organizations/$p" -H "$H" -d "$d" > $T/code; else curl -s -o $T/body -w '%{http_code}' -b $T/$jar -X $m "$API/organizations/$p" > $T/code; fi; cat $T/body; }
new_ds() {
  local B ds imp; B=$(curl -s -b $T/$1 -X POST "$API/organizations/$2/data-sources" -F "file=@$3" -F "idColumn=$5" -F "name=$4")
  ds=$(echo "$B" | json .dataSource.id); imp=$(echo "$B" | json .import.id)
  for i in $(seq 1 100); do st=$(curl -s -b $T/$1 "$API/organizations/$2/data-sources/$ds/imports/$imp" | json .import.status); [ "$st" == succeeded ] || [ "$st" == failed ] && break; sleep 0.1; done
  echo "$ds"
}
latest() { call a GET "$S/apis/${1:-$A}/design" | json .design.version; }
# req 'REQUEST_JSON' [API] → PUT the design with only this request (no fields); answer in $T/body
req() { local api=${2:-$A}; call a PUT "$S/apis/$api/design" "{\"version\":$(latest $api),\"idField\":{\"responseKey\":\"id\"},\"fields\":[],\"request\":$1}" > /dev/null; }
problems() { cat $T/body | json '.error.details.map(d=>d.field).join(" ")'; }
msg() { cat $T/body | json '.error.details[0].message'; }
summary() { cat $T/body | json .requestSummary; }

EMAIL="request-$RANDOM$RANDOM@test.com"
curl -s -o /dev/null -c $T/a -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
S=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"Request Test","slug":"request-test"}' | json .organization.slug)
DS=$(new_ds a "$S" "$CSV/products-v1.csv" "Products" sku)
DS_REV=$(new_ds a "$S" "$CSV/reviews-random-names.csv" "Reviews" rid)
A=live
call a POST "$S/apis" "{\"name\":\"Live\",\"slug\":\"$A\",\"dataSourceId\":\"$DS\"}" > /dev/null

echo "A. The starting request"
G=$(call a GET "$S/apis/$A/design")
check "GET ?ids={item_id}, 100 ids per call" '{"method":"GET","query":{"ids":"{item_id}"},"maxIdsPerCall":100}' "$(echo "$G" | json .design.request)"
check "summary: id parameter 'ids', no context" '{"method":"GET","idParam":"ids","context":[]}' "$(echo "$G" | json .requestSummary)"

echo "B. GET requests that pass"
req '{"method":"GET","query":{"ids":"{item_id}","locale":"{_meta.openai/locale}","market":"US"}}'
check "Sample A (ids + locale context + literal market) → 200" 200 "$(code)"
check "  summary: idParam ids, context locale ← _meta.openai/locale" '{"method":"GET","idParam":"ids","context":[{"param":"locale","source":"_meta.openai/locale"}]}' "$(summary)"
check "  maxIdsPerCall left out → 100" 100 "$(cat $T/body | json .design.request.maxIdsPerCall)"
req '{"method":"GET","query":{"zeta":"1","skus":"{item_id}","alpha":2,"debug":true,"where":"{_meta.openai/userLocation}"},"maxIdsPerCall":25}'
check "numbers / true-false literals, any param name for the ids, 25 per call → 200" "200 skus 25" "$(code) $(cat $T/body | json .requestSummary.idParam) $(cat $T/body | json .design.request.maxIdsPerCall)"
check "  parameters keep the order written (zeta, skus, alpha, debug, where)" "zeta,skus,alpha,debug,where" "$(cat $T/body | ex 'Object.keys(o.design.request.query).join()')"
check "  …in the database too (json column, not jsonb)" '{"zeta":"1","skus":"{item_id}","alpha":2,"debug":true,"where":"{_meta.openai/userLocation}"}' "$(sql "SELECT (design->'request'->'query')::text FROM apis WHERE slug='$A' AND organization_id=(SELECT id FROM organizations WHERE slug='$S')" | tr -d ' ')"
check "literal text that only LOOKS like JSON / has braces without a name → fine" 200 "$(req '{"method":"GET","query":{"ids":"{item_id}","note":"{}","x":"a{ b }"}}'; code)"

echo "C. GET requests that are refused (400 DESIGN_INVALID, the field points at the spot)"
check "no ids parameter" "400 DESIGN_INVALID request.query" "$(req '{"method":"GET","query":{"market":"US"}}'; code) $(cat $T/body | json .error.code) $(problems)"
check "{item_id} twice → the second" "request.query.b" "$(req '{"method":"GET","query":{"a":"{item_id}","b":"{item_id}"}}'; problems)"
check "a per-row column {brand_name} on GET (POST only)" "request.query.brand" "$(req '{"method":"GET","query":{"ids":"{item_id}","brand":"{brand_name}"}}'; problems)"
check "placeholder inside text: \"id-{item_id}\" (+ no whole {item_id} left)" "request.query.ids request.query" "$(req '{"method":"GET","query":{"ids":"id-{item_id}"}}'; problems)"
check "unknown context {_meta.openai/timezone}" "request.query.tz" "$(req '{"method":"GET","query":{"ids":"{item_id}","tz":"{_meta.openai/timezone}"}}'; problems)"
check "  message lists the two allowed ones" yes "$(msg | grep -q 'openai/locale.*openai/userLocation' && echo yes || echo no)"
check "unknown placeholder {foo}" "request.query.f" "$(req '{"method":"GET","query":{"ids":"{item_id}","f":"{foo}"}}'; problems)"
check "another feed's id {store_id} on a product API: one clear message" "request.query.ids" "$(req '{"method":"GET","query":{"ids":"{store_id}"}}'; problems)"
check "  …saying which id to use" yes "$(msg | grep -q 'its ids are {item_id}' && echo yes || echo no)"
check "a body on GET" "request.body" "$(req '{"method":"GET","query":{"ids":"{item_id}"},"body":{"a":1}}'; problems)"
check "GET without query" "request.query" "$(req '{"method":"GET"}'; problems)"
check "shape: nested value / null / empty name in a GET parameter" "request.query.x request.query.y request.query." "$(req '{"method":"GET","query":{"ids":"{item_id}","x":{"a":1},"y":null,"":"z"}}'; problems)"
MANY="{\"method\":\"GET\",\"query\":{\"ids\":\"{item_id}\",$(node -e 'console.log(Array.from({length:50},(_,i)=>`"p${i}":"v"`).join())')}}"
check "51 parameters → 400 DESIGN_INVALID (not a JSON error)" "400 DESIGN_INVALID" "$(req "$MANY"; code) $(cat $T/body | json .error.code)"
for m in 0 101 1.5 '"10"'; do R="{\"method\":\"GET\",\"query\":{\"ids\":\"{item_id}\"},\"maxIdsPerCall\":$m}"; req "$R"; printf '%s %s|' $(code) $(cat $T/body | json '.error.details[0].field') >> $T/max; done
check "maxIdsPerCall 0 / 101 / 1.5 / \"10\" → 400 on request.maxIdsPerCall each" "400 request.maxIdsPerCall|400 request.maxIdsPerCall|400 request.maxIdsPerCall|400 request.maxIdsPerCall|" "$(cat $T/max)"
check "  maxIdsPerCall 1 and 100 → 200" "200 200" "$(req '{"method":"GET","query":{"ids":"{item_id}"},"maxIdsPerCall":1}'; code) $(req '{"method":"GET","query":{"ids":"{item_id}"},"maxIdsPerCall":100}'; code)"
check "method PUT / get (lower case) → 400" "400 400" "$(req '{"method":"PUT","query":{"ids":"{item_id}"}}'; code) $(req '{"method":"get","query":{"ids":"{item_id}"}}'; code)"

echo "D. POST requests that pass"
req '{"method":"POST","body":{"items":[{"sku":"{item_id}","cat":"{brand_name}"}],"context":{"locale":"{_meta.openai/locale}","location":"{_meta.openai/userLocation}"},"currency":"USD","include_promotions":true},"maxIdsPerCall":50}'
check "Sample B (per-row object, context, literals, 50 per call) → 200" 200 "$(code)"
check "  summary: rows at items, id key sku, column cat ← brand_name, 2 context values" '{"method":"POST","rowsPath":["items"],"idKey":"sku","columns":[{"key":"cat","column":"brand_name"}],"context":[{"path":["context","locale"],"source":"_meta.openai/locale"},{"path":["context","location"],"source":"_meta.openai/userLocation"}]}' "$(summary)"
check "  body keys keep the order written" "items,context,currency,include_promotions" "$(cat $T/body | ex 'Object.keys(o.design.request.body).join()')"
req '{"method":"POST","body":[{"id":"{item_id}"}]}'
check "the body itself is the list: [ { \"id\": \"{item_id}\" } ] → rows at the top" '200 []' "$(code) $(cat $T/body | json .requestSummary.rowsPath)"
req '{"method":"POST","body":{"data":{"rows":[{"id":"{item_id}","loc":"{_meta.openai/locale}"}]},"meta":null,"n":[1,2,3]}}'
check "deeper list (data.rows), context inside the per-row object, null + plain lists as literals" '200 ["data","rows"] id' "$(code) $(cat $T/body | json .requestSummary.rowsPath) $(cat $T/body | json .requestSummary.idKey)"

echo "E. POST requests that are refused"
check "bare \"{item_id}\" (not in a per-row object)" "request.body.ids" "$(req '{"method":"POST","body":{"ids":"{item_id}"}}'; problems)"
check "  [\"{item_id}\"] (a plain list)" "request.body.ids.0" "$(req '{"method":"POST","body":{"ids":["{item_id}"]}}'; problems)"
check "  the body is just \"{item_id}\" → must be an object or list" "request.body" "$(req '{"method":"POST","body":"{item_id}"}'; problems)"
check "the per-row list has 2 objects" "request.body.items" "$(req '{"method":"POST","body":{"items":[{"id":"{item_id}"},{"x":1}]}}'; problems)"
check "{item_id} in two places → the second" "request.body.more.0.id" "$(req '{"method":"POST","body":{"items":[{"id":"{item_id}"}],"more":[{"id":"{item_id}"}]}}'; problems)"
check "{brand_name} outside the per-row object" "request.body.cat" "$(req '{"method":"POST","body":{"items":[{"id":"{item_id}"}],"cat":"{brand_name}"}}'; problems)"
check "{brand_name} nested deeper inside the per-row object" "request.body.items.0.x.c" "$(req '{"method":"POST","body":{"items":[{"id":"{item_id}","x":{"c":"{brand_name}"}}]}}'; problems)"
check "{item_id} nested deeper than the per-row object" "request.body.items.0.x.id" "$(req '{"method":"POST","body":{"items":[{"x":{"id":"{item_id}"}}]}}'; problems)"
check "no {item_id} at all" "request.body" "$(req '{"method":"POST","body":{"items":[{"cat":"{brand_name}"}]}}'; problems | cut -d' ' -f1)"
check "query on POST / POST without body" "request.query request.body" "$(req '{"method":"POST","query":{"a":"1"},"body":[{"id":"{item_id}"}]}'; problems) $(req '{"method":"POST"}'; problems)"
check "a placeholder as a key name" "request.body.items.0.{item_id}" "$(req '{"method":"POST","body":{"items":[{"{item_id}":"x","id":"{item_id}"}]}}'; problems)"
DEEP=$(node -e 'let b={id:"{item_id}"};let o=[b];for(let i=0;i<11;i++)o={l:o};console.log(JSON.stringify(o))')
# (bodies with \" are built OUTSIDE "$(...)": bash 3.2 keeps the backslashes there)
DEEP_REQ="{\"method\":\"POST\",\"body\":$DEEP}"
check "nested 12 levels deep → only 'too deep' (no misleading 'add {item_id}')" "1 yes" "$(req "$DEEP_REQ"; cat $T/body | json .error.details.length) $(cat $T/body | json .error.details | grep -q 'too deep' && echo yes || echo no)"
BIG=$(node -e 'console.log(JSON.stringify({items:[{id:"{item_id}"}],x:Array(501).fill(1)}))')
BIG_REQ="{\"method\":\"POST\",\"body\":$BIG}"
check "more than 500 values" yes "$(req "$BIG_REQ"; cat $T/body | json .error.details | grep -q 'Too big' && echo yes || echo no)"
V=$(latest)
check "nothing was saved by any refused request (version still $V)" "$V" "$(latest)"

echo "F. Saving without a request keeps the saved one"
req '{"method":"POST","body":{"items":[{"sku":"{item_id}"}]}}'
V=$(latest)
call a PUT "$S/apis/$A/design" "{\"version\":$V,\"idField\":{\"responseKey\":\"id\"},\"fields\":[{\"jivoxColumn\":\"current_price\",\"sourceColumn\":\"price\",\"responseKey\":\"price\",\"type\":\"float\"}]}" > /dev/null
check "fields saved, request still the POST one" '200 1 POST' "$(code) $(cat $T/body | json .design.fields.length) $(cat $T/body | json .design.request.method)"
OLD="{\"version\":$V,\"idField\":{\"responseKey\":\"id\"},\"fields\":[],\"request\":{\"method\":\"GET\",\"query\":{\"ids\":\"{item_id}\"}}}"
check "an old version with a new request → 409 (requests are part of the design)" 409 "$(call a PUT "$S/apis/$A/design" "$OLD" > /dev/null; code)"

echo "G. Review feed: the id placeholder is {review_id}; {item_id} is a per-row column there"
call a POST "$S/apis" "{\"name\":\"Reviews\",\"slug\":\"rev\",\"feedType\":\"review\",\"dataSourceId\":\"$DS_REV\"}" > /dev/null
check "starting request: GET ?ids={review_id}" '{"ids":"{review_id}"}' "$(call a GET "$S/apis/rev/design" | json .design.request.query)"
check "{item_id} on a review GET → per-row column, POST only" "request.query.product" "$(req '{"method":"GET","query":{"ids":"{review_id}","product":"{item_id}"}}' rev; problems)"
req '{"method":"POST","body":{"reviews":[{"rid":"{review_id}","product":"{item_id}"}]}}' rev
check "POST per-row { rid: {review_id}, product: {item_id} } → 200" '200 rid [{"key":"product","column":"item_id"}]' "$(code) $(cat $T/body | json .requestSummary.idKey) $(cat $T/body | json .requestSummary.columns)"

echo "H. Changing the feed type flags the request"
call a PATCH "$S/apis/rev" '{"feedType":"store"}' > /dev/null
G=$(call a GET "$S/apis/rev/design")
check "review → store: {review_id} and {item_id} aren't store columns; no summary while broken" "request.body.reviews.0.rid request.body.reviews.0.product null" "$(echo "$G" | ex 'o.problems.filter(p=>p.field.startsWith("request")).map(p=>p.field).join(" ")') $(echo "$G" | json .requestSummary)"
call a PATCH "$S/apis/rev" '{"feedType":"review"}' > /dev/null
check "back to review → no problems" 0 "$(call a GET "$S/apis/rev/design" | json .problems.length)"

psql "$DB" -qtAc "DELETE FROM users WHERE email='$EMAIL'" >/dev/null
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
