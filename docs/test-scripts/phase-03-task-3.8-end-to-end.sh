#!/bin/bash
# Task 3.8: Phase 3 end to end. One realistic journey through everything Phase 3 built, checking
# the phase's "How to verify" list (phase-03-api-design.md §9):
#   upload a feed with any column names → Jivox field list → type detection → two APIs on ONE
#   data source sending different fields under different keys (one GET, one POST) → previews
#   with converted types, defaults, values sent as written, unknown ids → can't-convert counts →
#   every contract rule → two people saving at once → data guard (upload, merge, switch) →
#   feed type change → delete → another account sees nothing.
#
# Usage (backend running with `npm run dev`), from any folder:
#   DB_URL="postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_mine" \
#   API=localhost:4001/api bash docs/test-scripts/phase-03-task-3.8-end-to-end.sh
#
# Creates its own test users and deletes ONLY them at the end.
API="${API:-localhost:4000/api}"
DB="${DB_URL:-postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV="$SCRIPT_DIR/../test-data/csv"
H='content-type: application/json'
[ -f "$CSV/e2e-products-v1.csv" ] || { echo "Can't find the test CSVs in $CSV"; exit 1; }
curl -s -o /dev/null --max-time 3 "$API/health" || { echo "Backend not reachable at $API"; exit 1; }

T=$(mktemp -d); PASS=0; FAIL=0
check() { if [ "$2" == "$3" ]; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1  (expected: $2, got: $3)"; fi; }
# ex 'EXPR' → EXPR evaluated with o = the JSON read from stdin
ex() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);const v=eval(process.argv[1]);console.log(typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('JSON-ERROR')}})" "$1"; }
code() { cat $T/code; }
body() { cat $T/body; }
# req JAR METHOD PATH [FILE_WITH_JSON] → status in $T/code, answer in $T/body (PATH under /organizations/)
req() { if [ -n "$4" ]; then curl -s -o $T/body -w '%{http_code}' -b $T/$1 -X $2 "$API/organizations/$3" -H "$H" -d @"$4" > $T/code; else curl -s -o $T/body -w '%{http_code}' -b $T/$1 -X $2 "$API/organizations/$3" > $T/code; fi; }
# json FILE 'JSON' → writes the JSON to a file (bodies live in files: no shell quoting problems)
json() { printf '%s' "$2" > "$1"; }
# save API FILE → PUT the design in FILE with the API's CURRENT version
save() { local v; v=$(curl -s -b $T/a "$API/organizations/$S/apis/$1/design" | ex 'o.design.version'); node -e "const f=require('fs');const d=JSON.parse(f.readFileSync(process.argv[1]));d.version=+process.argv[2];f.writeFileSync(process.argv[1]+'.v',JSON.stringify(d))" "$2" "$v"; req a PUT "$S/apis/$1/design" "$2.v"; }
preview() { json $T/p.json "$2"; req a POST "$S/apis/$1/design/preview" $T/p.json; }
new_ds() {
  local B ds imp st; B=$(curl -s -b $T/a -X POST "$API/organizations/$S/data-sources" -F "file=@$1" -F "idColumn=$3" -F "name=$2")
  ds=$(echo "$B" | ex 'o.dataSource.id'); imp=$(echo "$B" | ex 'o.import.id')
  for i in $(seq 1 100); do st=$(curl -s -b $T/a "$API/organizations/$S/data-sources/$ds/imports/$imp" | ex 'o.import.status'); [ "$st" == succeeded ] || [ "$st" == failed ] && break; sleep 0.1; done
  echo "$ds"
}
upload() { curl -s -o $T/body -w '%{http_code}' -b $T/a -X POST "$API/organizations/$S/data-sources/$1/imports" -F "file=@$2" -F "mode=$3" > $T/code; }
wait_import() { local st; for i in $(seq 1 100); do st=$(curl -s -b $T/a "$API/organizations/$S/data-sources/$1/imports/$2" | ex 'o.import.status'); [ "$st" == succeeded ] || [ "$st" == failed ] && break; sleep 0.1; done; echo "$st"; }

EMAIL="e2e-$RANDOM$RANDOM@test.com"
curl -s -o /dev/null -c $T/a -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
curl -s -o /dev/null -c $T/b -X POST $API/auth/signup -H "$H" -d "{\"email\":\"other-$EMAIL\",\"password\":\"password123\"}"
S=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"Acme Shoes","slug":"acme-shoes"}' | ex 'o.organization.slug')

echo "1. A feed with its own column names, and the Jivox field list"
DS=$(new_ds "$CSV/e2e-products-v1.csv" "Products" sku)
check "data imported: 5 rows, columns as written (spaces, camelCase)" '5 ["sku","Product Name","priceUSD","in_stock","img","category"]' "$(curl -s -b $T/a "$API/organizations/$S/data-sources/$DS" | ex 'o.dataSource.rowCount+" "+JSON.stringify(o.dataSource.columns)')"
check "Jivox product schema: id item_id, 43 fields" "item_id 43" "$(curl -s -b $T/a $API/jivox/feed-schemas/product | ex 'o.feedSchema.idColumn+" "+o.feedSchema.fields.length')"

echo "2. Two APIs on the SAME data"
json $T/api1.json "{\"name\":\"Live prices\",\"slug\":\"live-prices\",\"dataSourceId\":\"$DS\"}"; req a POST "$S/apis" $T/api1.json
json $T/api2.json "{\"name\":\"Product details\",\"slug\":\"product-details\",\"dataSourceId\":\"$DS\"}"; req a POST "$S/apis" $T/api2.json
check "both created, no design yet (designVersion 0)" "0 0" "$(curl -s -b $T/a "$API/organizations/$S/apis" | ex 'o.apis.map(a=>a.designVersion).join(" ")')"
req a GET "$S/apis/live-prices/design/columns"
check "types: in_stock boolean, category string; priceUSD (3 of 4 numbers = 75%) and img (4 of 5 URLs) stay string: below the 95% rule" "string boolean string string" "$(body | ex '["priceUSD","in_stock","img","category"].map(n=>o.columns.find(c=>c.name===n).suggestedType).join(" ")')"
check "  the fit counts behind it: priceUSD float 3/4 filled, img image 4/5" "3/4 4/5" "$(body | ex '(c=>c("priceUSD").fits.float+"/"+c("priceUSD").filled+" "+c("img").fits.image+"/"+c("img").filled)(n=>o.columns.find(x=>x.name===n))')"

echo "3. API 1: GET, prices (strict) + stock, its own keys"
json $T/d1.json '{"idField":{"responseKey":"sku"},"fields":[
 {"jivoxColumn":"current_price","sourceColumn":"priceUSD","responseKey":"price","type":"float","default":"0","onMismatch":"default"},
 {"jivoxColumn":"is_active","sourceColumn":"in_stock","responseKey":"inStock","type":"boolean"}],
 "request":{"method":"GET","query":{"ids":"{item_id}","market":"US","locale":"{_meta.openai/locale}"},"maxIdsPerCall":50}}'
save live-prices $T/d1.json
check "saved: version 1" "200 1" "$(code) $(body | ex 'o.design.version')"
preview live-prices '{"ids":["SKU-1001","SKU-1003","SKU-1004","SKU-9999"]}'
check "sample request: ids joined + literal, context left out (verification never sends it)" "/v1/$S/live-prices?ids=SKU-1001%2CSKU-1003%2CSKU-1004%2CSKU-9999&market=US" "$(body | ex 'o.request.url')"
check "answer: 79.99 as a number, yes → true; 'n/a' → default 0 (strict); empty → default 0; TRUE → true" '[{"sku":"SKU-1001","price":79.99,"inStock":true},{"sku":"SKU-1003","price":0,"inStock":true},{"sku":"SKU-1004","price":0,"inStock":true}]' "$(body | ex 'o.response.data')"
check "unknown id → errors NOT_FOUND, the others still answered" "SKU-9999 NOT_FOUND" "$(body | ex 'o.response.errors.map(e=>e.error_id+" "+e.error_code).join()')"
check "notes say which rows used the default" "SKU-1003 default 0|SKU-1004 default 0" "$(body | ex 'o.notes.map(n=>n.id+" "+n.used).join("|")')"

echo "4. API 2: POST, other fields under other keys, values sent as written"
json $T/d2.json '{"idField":{"responseKey":"productId"},"fields":[
 {"jivoxColumn":"product_name","sourceColumn":"Product Name","responseKey":"name","type":"string"},
 {"jivoxColumn":"product_image","sourceColumn":"img","responseKey":"image","type":"image"},
 {"jivoxColumn":"current_price","sourceColumn":"priceUSD","responseKey":"amount","type":"float","typeInContract":false}],
 "request":{"method":"POST","body":{"items":[{"sku":"{item_id}","cat":"{category}"}],"currency":"USD"},"maxIdsPerCall":20}}'
save product-details $T/d2.json
check "saved: version 1" "200 1" "$(code) $(body | ex 'o.design.version')"
preview product-details '{"ids":["SKU-1003","SKU-1004"]}'
check "different keys from the same data; 'n/a' and 'not-a-url' SENT AS WRITTEN (default onMismatch); empty price → "" (onEmpty default)" '[{"productId":"SKU-1003","name":"Trail Boot","image":"https://cdn.example.com/p/1003.png","amount":"n/a"},{"productId":"SKU-1004","name":"City Sandal","image":"not-a-url","amount":""}]' "$(body | ex 'o.response.data')"
check "POST sample: one object per id, {category} empty (not mapped by a field), literal kept" '{"items":[{"sku":"SKU-1003","cat":""},{"sku":"SKU-1004","cat":""}],"currency":"USD"}' "$(body | ex 'o.request.body')"
check "warning: wrong-type values are sent as written (Jivox may reject them)" "yes" "$(body | ex 'o.warnings.some(w=>w.includes("amount")&&w.includes("image")&&w.includes("sent as written"))?"yes":"no"')"
check "  no 'type left out' warning: amount is float on both sides (our type = Jivox's)" "no" "$(body | ex 'o.warnings.some(w=>w.includes("left out of the contract"))?"yes":"no"')"

echo "5. Can't-convert counts over every row"
json $T/cv.json '{"fields":[{"sourceColumn":"priceUSD","type":"float"},{"sourceColumn":"img","type":"image"},{"sourceColumn":"in_stock","type":"boolean"}]}'
req a POST "$S/apis/live-prices/design/check-values" $T/cv.json
check "priceUSD: 1 can't (n/a, row 3) + 1 empty · img: 1 can't (row 4) · in_stock: 0 (format column:cant/first row/empty)" "priceUSD:1/3/1 img:1/4/0 in_stock:0/-/0" "$(body | ex 'o.fields.map(f=>f.sourceColumn+":"+f.cantConvert+"/"+(f.examples[0]?.row??"-")+"/"+f.empty).join(" ")')"

echo "6. Every contract rule is enforced (nothing saved)"
V=$(curl -s -b $T/a "$API/organizations/$S/apis/live-prices/design" | ex 'o.design.version')
rule() { json $T/r.json "{\"idField\":{\"responseKey\":\"sku\"},\"fields\":[],\"request\":$1}"; save live-prices $T/r.json; echo "$(code) $(body | ex 'o.error.details.map(d=>d.field).join(" ")')"; }
check "{item_id} twice" "400 request.query.b" "$(rule '{"method":"GET","query":{"a":"{item_id}","b":"{item_id}"}}')"
check "a per-row column on GET" "400 request.query.c" "$(rule '{"method":"GET","query":{"ids":"{item_id}","c":"{category}"}}')"
check "unknown chat context" "400 request.query.tz" "$(rule '{"method":"GET","query":{"ids":"{item_id}","tz":"{_meta.openai/timezone}"}}')"
check "POST: the id not in a one-item list of objects" "400 request.body.ids" "$(rule '{"method":"POST","body":{"ids":"{item_id}"}}')"
check "POST: {column} outside the per-row object" "400 request.body.cat" "$(rule '{"method":"POST","body":{"items":[{"id":"{item_id}"}],"cat":"{category}"}}')"
check "max ids per call 101" "400 request.maxIdsPerCall" "$(rule '{"method":"GET","query":{"ids":"{item_id}"},"maxIdsPerCall":101}')"
check "a Jivox field that doesn't exist / used twice / a column not in the data" "400 fields.0.jivoxColumn fields.1.sourceColumn fields.2.jivoxColumn" "$(json $T/r.json '{"idField":{"responseKey":"sku"},"fields":[{"jivoxColumn":"price_now","sourceColumn":"priceUSD","responseKey":"a","type":"float"},{"jivoxColumn":"brand_name","sourceColumn":"Brand","responseKey":"b","type":"string"},{"jivoxColumn":"brand_name","sourceColumn":"category","responseKey":"c","type":"string"}]}'; save live-prices $T/r.json; echo "$(code) $(body | ex 'o.error.details.map(d=>d.field).join(" ")')")"
check "  still version $V" "$V" "$(curl -s -b $T/a "$API/organizations/$S/apis/live-prices/design" | ex 'o.design.version')"

echo "7. Two people saving at once"
node -e "const f=require('fs');const d=JSON.parse(f.readFileSync(process.argv[1]));d.version=+process.argv[2];f.writeFileSync(process.argv[3],JSON.stringify(d))" $T/d1.json "$V" $T/same.json
for i in $(seq 1 8); do curl -s -o /dev/null -w '%{http_code}\n' -b $T/a -X PUT "$API/organizations/$S/apis/live-prices/design" -H "$H" -d @$T/same.json >> $T/race & done; wait
check "8 saves with the same version → exactly one 200, seven 409 DESIGN_CHANGED" "1 7" "$(grep -c '^200$' $T/race) $(grep -c '^409$' $T/race)"

echo "8. The data guard"
upload $DS "$CSV/e2e-products-no-price.csv" replace
check "replace without priceUSD → 409 naming BOTH APIs (both send it)" "409 COLUMNS_IN_USE live-prices,product-details" "$(code) $(body | ex 'o.error.code') $(body | ex 'o.error.details.map(d=>/\((.*?)\)/.exec(d.message)[1]).join()')"
upload $DS "$CSV/e2e-products-no-price.csv" merge
check "merge without priceUSD → allowed (keeps the old column)" "202 succeeded" "$(code) $(wait_import $DS $(body | ex 'o.import.id'))"
upload $DS "$CSV/e2e-products-v3.csv" replace
check "replace with every used column → succeeds" "202 succeeded" "$(code) $(wait_import $DS $(body | ex 'o.import.id'))"
preview live-prices '{"ids":["SKU-1001","SKU-1006","SKU-1003"]}'
check "previews read the NEW data: 69.99, the new SKU-1006, SKU-1003 gone" "69.99 35 SKU-1003" "$(body | ex 'o.response.data[0].price+" "+o.response.data[1].price+" "+o.response.errors.map(e=>e.error_id).join()')"
OTHER=$(new_ds "$CSV/e2e-other.csv" "Other" code)
json $T/sw.json "{\"dataSourceId\":\"$OTHER\"}"; req a PATCH "$S/apis/product-details" $T/sw.json
check "switching API 2 to data without its columns → 409 DATA_MISSING_COLUMNS" "409 DATA_MISSING_COLUMNS" "$(code) $(body | ex 'o.error.code')"

echo "9. Feed type change, delete, isolation"
json $T/ft.json '{"feedType":"store"}'; req a PATCH "$S/apis/product-details" $T/ft.json
req a GET "$S/apis/product-details/design"
check "API 2 → store feed: its product fields and POST id are flagged (not silently broken)" "yes store_id" "$(body | ex '(o.problems.some(p=>p.field==="fields.0.jivoxColumn")&&o.problems.some(p=>p.field.startsWith("request"))?"yes":"no")+" "+o.design.idField.jivoxColumn')"
req a DELETE "$S/apis/product-details"
check "delete API 2 → 204; its data stays (API 1 still answers)" "204 200" "$(code) $(preview live-prices '{}'; code)"
req b GET "$S/apis/live-prices/design"
check "another account: design / preview / check-values → 404" "404 404 404" "$(code) $(json $T/p.json '{}'; req b POST "$S/apis/live-prices/design/preview" $T/p.json; code) $(req b POST "$S/apis/live-prices/design/check-values" $T/cv.json; code)"

psql "$DB" -qtAc "DELETE FROM users WHERE email IN ('$EMAIL','other-$EMAIL')" >/dev/null
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
