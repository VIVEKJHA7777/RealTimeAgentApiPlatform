#!/bin/bash
# Task 3.5 scenario tests: POST /apis/:apiSlug/design/preview (sample request + the real answer).
#
# Usage (backend running with `npm run dev`), from any folder:
#   DB_URL="postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_mine" \
#   API=localhost:4001/api bash docs/test-scripts/phase-03-task-3.5-preview.sh
#
# Creates its own test users and deletes ONLY them at the end.
API="${API:-localhost:4000/api}"
DB="${DB_URL:-postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV="$SCRIPT_DIR/../test-data/csv"
H='content-type: application/json'
[ -f "$CSV/value-types.csv" ] || { echo "Can't find the test CSVs in $CSV"; exit 1; }
curl -s -o /dev/null --max-time 3 "$API/health" || { echo "Backend not reachable at $API"; exit 1; }

T=$(mktemp -d); PASS=0; FAIL=0
check() { if [ "$2" == "$3" ]; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1  (expected: $2, got: $3)"; fi; }
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);const v=eval('o'+process.argv[1]);console.log(typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('JSON-ERROR')}})" "$1"; }
ex() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);const v=eval(process.argv[1]);console.log(typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('JSON-ERROR')}})" "$1"; }
code() { cat $T/code; }
call() { local jar=$1 m=$2 p=$3 d=$4; if [ -n "$d" ]; then curl -s -o $T/body -w '%{http_code}' -b $T/$jar -X $m "$API/organizations/$p" -H "$H" -d "$d" > $T/code; else curl -s -o $T/body -w '%{http_code}' -b $T/$jar -X $m "$API/organizations/$p" > $T/code; fi; cat $T/body; }
new_ds() {
  local B ds imp; B=$(curl -s -b $T/$1 -X POST "$API/organizations/$2/data-sources" -F "file=@$3" -F "idColumn=$5" -F "name=$4")
  ds=$(echo "$B" | json .dataSource.id); imp=$(echo "$B" | json .import.id)
  for i in $(seq 1 100); do st=$(curl -s -b $T/$1 "$API/organizations/$2/data-sources/$ds/imports/$imp" | json .import.status); [ "$st" == succeeded ] || [ "$st" == failed ] && break; sleep 0.1; done
  echo "$ds"
}
# preview API 'BODY_JSON' → body in $T/body
preview() { call a POST "$S/apis/$1/design/preview" "$2" > /dev/null; }
item() { cat $T/body | json ".response.data[$1]"; }

EMAIL="preview-$RANDOM$RANDOM@test.com"
curl -s -o /dev/null -c $T/a -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
curl -s -o /dev/null -c $T/b -X POST $API/auth/signup -H "$H" -d "{\"email\":\"other-$EMAIL\",\"password\":\"password123\"}"
S=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"Preview Test","slug":"preview-test"}' | json .organization.slug)
DS=$(new_ds a "$S" "$CSV/value-types.csv" "Value types" sku)
A=typed
call a POST "$S/apis" "{\"name\":\"Typed\",\"slug\":\"$A\",\"dataSourceId\":\"$DS\"}" > /dev/null
# The design used below: every type, a default, a column that is always empty, a no-default image.
FIELDS='[{"jivoxColumn":"current_price","sourceColumn":"price","responseKey":"price","type":"float","default":"0"},
 {"jivoxColumn":"rating_count","sourceColumn":"qty","responseKey":"qty","type":"int"},
 {"jivoxColumn":"is_active","sourceColumn":"active","responseKey":"active","type":"boolean"},
 {"jivoxColumn":"product_image","sourceColumn":"img","responseKey":"image","type":"image"},
 {"jivoxColumn":"product_name","sourceColumn":"note","responseKey":"name","type":"string"},
 {"jivoxColumn":"brand_name","sourceColumn":"blank","responseKey":"brand","type":"string","default":"n/a"},
 {"jivoxColumn":"custom_badge_1_value","sourceColumn":"flag01","responseKey":"badge","type":"boolean"}]'
call a PUT "$S/apis/$A/design" "{\"version\":0,\"idField\":{\"responseKey\":\"sku\"},\"fields\":$FIELDS}" > /dev/null
check "(setup) design saved" 200 "$(code)"

echo "A. Access"
check "logged out → 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/organizations/$S/apis/$A/design/preview")"
check "another user → 404" 404 "$(call b POST "$S/apis/$A/design/preview" '{}' > /dev/null; code)"

echo "B. Default: the saved design, the first 2 rows"
preview $A '{}'
check "200, GET /v1/<brand>/<api>?ids=V-1%2CV-2 (commas encoded)" "200 /v1/$S/$A?ids=V-1%2CV-2" "$(code) $(cat $T/body | json .request.url)"
check "  sample query: the ids joined by commas" '{"ids":"V-1,V-2"}' "$(cat $T/body | json .request.query)"
check "V-1: id first, then fields in design order, every type converted, defaults applied" '{"sku":"V-1","price":1.5,"qty":1,"active":false,"image":"https://cdn.example.com/p/1.png?w=200","name":"Note 1","brand":"n/a","badge":true}' "$(item 0)"
check "V-2: \"3.00\" → 3 (a number), TRUE → true, 0 → false" '3 number true false' "$(cat $T/body | ex '[o.response.data[1].price, typeof o.response.data[1].price, o.response.data[1].active, o.response.data[1].badge].join(" ")')"
check "envelope: status success, errors [], generated_at ISO without ms" 'success [] yes' "$(cat $T/body | json .response.status) $(cat $T/body | json .response.errors) $(cat $T/body | ex '/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(o.response.generated_at)?"yes":"no"')"
check "response headers: Cache-Control no-store" no-store "$(cat $T/body | json '.responseHeaders["Cache-Control"]')"
check "notes: the empty brand column → default n/a, once per row" '2 brand default "n/a"' "$(cat $T/body | ex 'o.notes.filter(n=>n.responseKey==="brand").length+" "+o.notes[0].responseKey+" "+o.notes[0].used')"

echo "C. Chosen ids: wrong values, unknown and repeated ids"
preview $A '{"ids":["V-7","V-9","NOPE","V-7"]}'
check "items for V-7, V-9 (asked order, each once); NOPE in errors" 'V-7,V-9 [{"error_id":"NOPE","error_code":"NOT_FOUND","error_message":"unknown id"}]' "$(cat $T/body | ex 'o.response.data.map(d=>d.sku).join()') $(cat $T/body | json .response.errors)"
check "V-7 price \"abc\" (not a float) → SENT AS WRITTEN (onMismatch send, the default), with a note" '"abc" {"id":"V-7","responseKey":"price","column":"price","value":"abc","used":"sent as written (text, not float)"}' "$(item 0 | ex 'JSON.stringify(o.price)') $(cat $T/body | ex 'o.notes.find(n=>n.id==="V-7"&&n.responseKey==="price")')"
check "V-9 image \"logo.png\" → sent as written too" '"logo.png"' "$(item 1 | ex 'JSON.stringify(o.image)')"
check "  a warning names the fields sent with the wrong type" yes "$(cat $T/body | ex 'o.warnings.some(w=>w.startsWith("price, image")&&w.includes("sent as written"))?"yes":"no"')"
STRICT='{"design":{"idField":{"responseKey":"sku"},"fields":[{"jivoxColumn":"current_price","sourceColumn":"price","responseKey":"price","type":"float","default":"0","onMismatch":"default"},{"jivoxColumn":"product_image","sourceColumn":"img","responseKey":"image","type":"image","onMismatch":"default"}]},"ids":["V-7","V-9"]}'
preview $A "$STRICT"
check "onMismatch default (strict): V-7 \"abc\" → default 0, with a note" '0 default 0' "$(item 0 | json .price) $(cat $T/body | ex 'o.notes.find(n=>n.id==="V-7").used')"
check "  V-9 \"logo.png\" with no default → sent as \"\" (onEmpty empty_string, the default)" '"" sent as "" (no default)' "$(item 1 | ex 'JSON.stringify(o.image)') $(cat $T/body | ex 'o.notes.find(n=>n.id==="V-9"&&n.responseKey==="image").used')"
check "  …a warning says \"\" in an image field may be rejected" "yes" "$(cat $T/body | ex 'o.warnings.some(w=>w.startsWith("image: empty values are sent as \"\""))?"yes":"no"')"
check "  no wrong-type warning in strict mode" no "$(cat $T/body | ex 'o.warnings.some(w=>w.includes("sent as written"))?"yes":"no"')"
OMIT='{"design":{"idField":{"responseKey":"sku"},"fields":[{"jivoxColumn":"product_image","sourceColumn":"img","responseKey":"image","type":"image","onMismatch":"default","onEmpty":"omit"}]},"ids":["V-7","V-9"]}'
preview $A "$OMIT"
check "  onEmpty omit (strict): V-9 → key LEFT OUT, no \"\" warning" 'false left out (no default) no' "$(item 1 | ex '"image" in o') $(cat $T/body | ex 'o.notes.find(n=>n.id==="V-9"&&n.responseKey==="image").used') $(cat $T/body | ex 'o.warnings.some(w=>w.includes("sent as \"\""))?"yes":"no"')"
check "onEmpty must be empty_string or omit" "400 design.fields.0.onEmpty" "$(preview $A '{"design":{"idField":{"responseKey":"sku"},"fields":[{"jivoxColumn":"current_price","sourceColumn":"price","responseKey":"price","type":"float","onEmpty":"null"}]}}'; code) $(cat $T/body | json .error.details[0].field)"
check "onMismatch must be send or default" "400 design.fields.0.onMismatch" "$(preview $A '{"design":{"idField":{"responseKey":"sku"},"fields":[{"jivoxColumn":"current_price","sourceColumn":"price","responseKey":"price","type":"float","onMismatch":"drop"}]}}'; code) $(cat $T/body | json .error.details[0].field)"
preview $A '{"ids":["V-7","V-9","NOPE","V-7"]}'
check "sample request has each id once" '{"ids":"V-7,V-9,NOPE"}' "$(cat $T/body | json .request.query)"
check "ids are exact (v-1 ≠ V-1)" 'v-1' "$(preview $A '{"ids":["v-1"]}'; cat $T/body | ex 'o.response.errors.map(e=>e.error_id).join()')"

echo "D. An unsaved design (the one being edited) — nothing is saved"
V=$(call a GET "$S/apis/$A/design" | json .design.version)
preview $A '{"design":{"idField":{"responseKey":"id"},"fields":[{"jivoxColumn":"current_price","sourceColumn":"price","responseKey":"amount","type":"string"}]},"ids":["V-1"]}'
check "uses the sent design (keys id + amount, price as text)" '{"id":"V-1","amount":"1.50"}' "$(item 0)"
check "  design version unchanged ($V), saved keys unchanged" "$V sku" "$(call a GET "$S/apis/$A/design" | json .design.version) $(cat $T/body | json .design.idField.responseKey)"
preview $A '{"design":{"idField":{"responseKey":"id"},"fields":[{"jivoxColumn":"nope","sourceColumn":"missing","responseKey":"ab","type":"float","default":"x"}]}}'
check "an edited design breaking 3 rules → 400 DESIGN_INVALID listing all 3 (like a save)" "400 DESIGN_INVALID fields.0.jivoxColumn fields.0.sourceColumn fields.0.default" "$(code) $(cat $T/body | json .error.code) $(cat $T/body | json '.error.details.map(d=>d.field).join(" ")')"
check "  a shape error (key a.b) → 400 DESIGN_INVALID on design.fields.0.responseKey" "400 DESIGN_INVALID design.fields.0.responseKey" "$(preview $A '{"design":{"idField":{"responseKey":"id"},"fields":[{"jivoxColumn":"current_price","sourceColumn":"price","responseKey":"a.b","type":"float"}]}}'; code) $(cat $T/body | json .error.code) $(cat $T/body | json .error.details[0].field)"
IDS101="{\"ids\":[$(node -e 'console.log(Array.from({length:101},(_,i)=>`"V-${i}"`).join())')]}"
check "bad shapes: ids [] / an empty id / 101 ids / ids not a list → 400" "400 400 400 400" "$(preview $A '{"ids":[]}'; code) $(preview $A '{"ids":[""]}'; code) $(preview $A "$IDS101"; code) $(preview $A '{"ids":"V-1"}'; code)"

echo "E. GET with literals and chat context"
REQ='{"method":"GET","query":{"market":"US","skus":"{item_id}","locale":"{_meta.openai/locale}","limit":5},"maxIdsPerCall":2}'
call a PUT "$S/apis/$A/design" "{\"version\":$V,\"idField\":{\"responseKey\":\"sku\"},\"fields\":$FIELDS,\"request\":$REQ}" > /dev/null
preview $A '{}'
check "sample: literals kept in order, context left out (never sent at verification)" '{"market":"US","skus":"V-1,V-2","limit":5}' "$(cat $T/body | json .request.query)"
check "  url" "/v1/$S/$A?market=US&skus=V-1%2CV-2&limit=5" "$(cat $T/body | json .request.url)"
check "  a warning explains the context" yes "$(cat $T/body | ex 'o.warnings.some(w=>w.includes("context"))?"yes":"no"')"
check "3 ids with maxIdsPerCall 2 → 400 on ids" "400 ids" "$(preview $A '{"ids":["V-1","V-2","V-3"]}'; code) $(cat $T/body | json .error.details[0].field)"

echo "F. POST: one object per id, {column} from our mapped data, context dropped"
V=$(call a GET "$S/apis/$A/design" | json .design.version)
REQ='{"method":"POST","body":{"items":[{"sku":"{item_id}","name":"{product_name}","badge2":"{custom_badge_2_value}","loc":"{_meta.openai/locale}","fixed":7}],"context":{"locale":"{_meta.openai/locale}"},"currency":"USD"}}'
call a PUT "$S/apis/$A/design" "{\"version\":$V,\"idField\":{\"responseKey\":\"sku\"},\"fields\":$FIELDS,\"request\":$REQ}" > /dev/null
preview $A '{}'
check "sample body: {product_name} from OUR mapped column, unmapped {custom_badge_2_value} → \"\", context object dropped entirely (like Jivox's Sample B), literals kept" '{"items":[{"sku":"V-1","name":"Note 1","badge2":"","fixed":7},{"sku":"V-2","name":"Note 2","badge2":"","fixed":7}],"currency":"USD"}' "$(cat $T/body | json .request.body)"
check "  no url for POST; path given" "undefined /v1/$S/$A" "$(cat $T/body | json .request.url) $(cat $T/body | json .request.path)"
V=$(call a GET "$S/apis/$A/design" | json .design.version)
call a PUT "$S/apis/$A/design" "{\"version\":$V,\"idField\":{\"responseKey\":\"sku\"},\"fields\":$FIELDS,\"request\":{\"method\":\"POST\",\"body\":[{\"id\":\"{item_id}\"}]}}" > /dev/null
check "the body itself is the list" '[{"id":"V-3"}]' "$(preview $A '{"ids":["V-3"]}'; cat $T/body | json .request.body)"
check "an edited design without a request uses the SAVED request (POST)" POST "$(preview $A '{"design":{"idField":{"responseKey":"x"},"fields":[]}}'; cat $T/body | json .request.method)"

echo "G. Ids that are hard to send"
DSC=$(new_ds a "$S" "$CSV/ids-comma.csv" "Commas" sku)
call a POST "$S/apis" "{\"name\":\"Commas\",\"slug\":\"commas\",\"dataSourceId\":\"$DSC\"}" > /dev/null
preview commas '{"ids":["C&D=1","é-1","has space"]}'
check "GET url encodes & = é space; ids found" "/v1/$S/commas?ids=C%26D%3D1%2C%C3%A9-1%2Chas+space 3" "$(cat $T/body | json .request.url) $(cat $T/body | json .response.data.length)"
check "  an id with a comma in the data → warning (GET can't ask for it)" yes "$(cat $T/body | ex 'o.warnings.some(w=>w.startsWith("1 id contains a comma"))?"yes":"no"')"
call a PUT "$S/apis/commas/design" '{"version":0,"idField":{"responseKey":"sku"},"fields":[],"request":{"method":"POST","body":{"items":[{"sku":"{item_id}"}]}}}' > /dev/null
preview commas '{"ids":["A,1"]}'
check "POST: the comma id works, no warning" '1 0' "$(cat $T/body | json .response.data.length) $(cat $T/body | ex 'o.warnings.filter(w=>w.includes("comma")).length')"

echo "H. No data yet"
DSF=$(new_ds a "$S" "$CSV/products-duplicate-ids.csv" "Broken" sku)
call a POST "$S/apis" "{\"name\":\"Empty\",\"slug\":\"empty\",\"dataSourceId\":\"$DSF\"}" > /dev/null
check "first import failed (repeating ids) → preview 409 NO_DATA" "409 NO_DATA" "$(preview empty '{}'; code) $(cat $T/body | json .error.code)"

echo "I. One version of the data per answer, even during a replace"
DSV=$(new_ds a "$S" "$CSV/products-v1.csv" "Versions" sku)
call a POST "$S/apis" "{\"name\":\"Versions\",\"slug\":\"versions\",\"dataSourceId\":\"$DSV\"}" > /dev/null
# v1 has P-3 (not P-6); v2 has P-6 (not P-3). A mixed answer would find both or neither.
for i in 1 2 3; do curl -s -o /dev/null -b $T/a -X POST "$API/organizations/$S/data-sources/$DSV/imports" -F "file=@$CSV/products-v$((i%2+1)).csv" -F mode=replace; done &
for i in $(seq 1 30); do curl -s -b $T/a -X POST "$API/organizations/$S/apis/versions/design/preview" -H "$H" -d '{"ids":["P-3","P-6"]}' | ex 'o.response.data.length+"/"+o.response.errors.length' >> $T/versions; done; wait
check "30 previews during 3 replaces: always exactly 1 found + 1 unknown" "30" "$(grep -c '^1/1$' $T/versions)"

psql "$DB" -qtAc "DELETE FROM users WHERE email IN ('$EMAIL','other-$EMAIL')" >/dev/null
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
