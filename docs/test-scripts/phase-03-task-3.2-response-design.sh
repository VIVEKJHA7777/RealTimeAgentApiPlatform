#!/bin/bash
# Task 3.2 scenario tests: GET / PUT /apis/:apiSlug/design (response design + every rule).
#
# Usage (backend running with `npm run dev`), from any folder:
#   DB_URL="postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_mine" \
#   API=localhost:4001/api bash docs/test-scripts/phase-03-task-3.2-response-design.sh
#
# Creates its own test users and deletes ONLY them at the end.
API="${API:-localhost:4000/api}"
DB="${DB_URL:-postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV="$SCRIPT_DIR/../test-data/csv"
H='content-type: application/json'
[ -f "$CSV/jivox-random-names.csv" ] || { echo "Can't find the test CSVs in $CSV"; exit 1; }
curl -s -o /dev/null --max-time 3 "$API/health" || { echo "Backend not reachable at $API"; exit 1; }

T=$(mktemp -d); PASS=0; FAIL=0
check() { if [ "$2" == "$3" ]; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1  (expected: $2, got: $3)"; fi; }
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);const v=eval('o'+process.argv[1]);console.log(typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('JSON-ERROR')}})" "$1"; }
# ex 'EXPR' → evaluates a whole expression with o = the JSON (for expressions not starting with . )
ex() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);const v=eval(process.argv[1]);console.log(typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('JSON-ERROR')}})" "$1"; }
sql() { psql "$DB" -tAc "$1"; }
code() { cat $T/code; }
# call JAR METHOD PATH [JSON] → body; status code in $T/code. PATH is under /organizations/
call() { local jar=$1 m=$2 p=$3 d=$4; if [ -n "$d" ]; then curl -s -o $T/body -w '%{http_code}' -b $T/$jar -X $m "$API/organizations/$p" -H "$H" -d "$d" > $T/code; else curl -s -o $T/body -w '%{http_code}' -b $T/$jar -X $m "$API/organizations/$p" > $T/code; fi; cat $T/body; }
# new_ds JAR BRAND FILE NAME IDCOLUMN → id of a data source whose first import has finished
new_ds() {
  local B ds imp; B=$(curl -s -b $T/$1 -X POST "$API/organizations/$2/data-sources" -F "file=@$3" -F "idColumn=$5" -F "name=$4")
  ds=$(echo "$B" | json .dataSource.id); imp=$(echo "$B" | json .import.id)
  for i in $(seq 1 100); do st=$(curl -s -b $T/$1 "$API/organizations/$2/data-sources/$ds/imports/$imp" | json .import.status); [ "$st" == succeeded ] || [ "$st" == failed ] && break; sleep 0.1; done
  echo "$ds"
}
# body VERSION FIELDS_JSON [ID_KEY] → a PUT body
body() { echo "{\"version\":$1,\"idField\":{\"responseKey\":\"${3:-code}\"},\"fields\":$2}"; }
# f JIVOX SOURCE KEY TYPE [EXTRA] → one field
f() { echo "{\"jivoxColumn\":\"$1\",\"sourceColumn\":\"$2\",\"responseKey\":\"$3\",\"type\":\"$4\"${5:+,$5}}"; }
# put_fields VERSION F1 F2 ... → PUT with these fields; body in $T/body
put_fields() { local v=$1; shift; local IFS=,; call a PUT "$S/apis/$A/design" "$(body $v "[$*]")" > /dev/null; }
problems() { cat $T/body | json '.error.details.map(d=>d.field).join(" ")'; }
latest() { call a GET "$S/apis/$A/design" | json .design.version; }

EMAIL="design-$RANDOM$RANDOM@test.com"
curl -s -o /dev/null -c $T/a -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
curl -s -o /dev/null -c $T/b -X POST $API/auth/signup -H "$H" -d "{\"email\":\"other-$EMAIL\",\"password\":\"password123\"}"
S=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"Design Test","slug":"design-test"}' | json .organization.slug)
# A feed whose column names have NOTHING in common with Jivox names (spaces, camelCase, etc.)
DS=$(new_ds a "$S" "$CSV/jivox-random-names.csv" "Random names" Code)
DS_SMALL=$(new_ds a "$S" "$CSV/products-v1.csv" "Small" sku)
DS_REV=$(new_ds a "$S" "$CSV/reviews-random-names.csv" "Reviews" rid)
A=live-prices
call a POST "$S/apis" "{\"name\":\"Live prices\",\"slug\":\"$A\",\"dataSourceId\":\"$DS\"}" > /dev/null

echo "A. Access"
check "logged out → 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' "$API/organizations/$S/apis/$A/design")"
check "another user → 404 (GET and PUT)" "404 404" "$(call b GET "$S/apis/$A/design" >/dev/null; code) $(call b PUT "$S/apis/$A/design" "$(body 0 '[]')" >/dev/null; code)"
call a GET "$S/apis/nope/design" > /dev/null
check "unknown API → 404 API_NOT_FOUND" "404 API_NOT_FOUND" "$(code) $(cat $T/body | json .error.code)"

echo "B. Before the first save: a starting design"
G=$(call a GET "$S/apis/$A/design")
check "200, no-store" "200" "$(code)"
check "version 0, saved false, no fields" "0 false 0" "$(echo "$G" | json '.design.version+" "+o.design.saved+" "+o.design.fields.length')"
check "id field: Jivox item_id (fixed), from the data's id column Code, key suggested 'Code'" "item_id Code Code" "$(echo "$G" | ex '[o.design.idField.jivoxColumn,o.design.idField.sourceColumn,o.design.idField.responseKey].join(" ")')"
check "the data's columns for the dropdown, in file order (any names)" 'Code|Product Title|priceUSD|pic|in stock|stars|Qty Left' "$(echo "$G" | json '.data.columns.join("|")')"
check "no problems; a warning lists the mandatory product fields not sent" "0 yes" "$(echo "$G" | json '.problems.length+" "+(o.warnings.some(w=>w.includes("product_name")&&w.includes("product_image"))?"yes":"no")')"

echo "C. Save: ANY column can feed ANY Jivox field"
FIELDS="[$(f product_name 'Product Title' title string),$(f current_price priceUSD price float),$(f product_image pic image image),$(f is_active 'in stock' inStock boolean),$(f rating_value stars rating float '"default":"0"'),$(f rating_count 'Qty Left' qty int '"typeInContract":false')]"
R=$(call a PUT "$S/apis/$A/design" "$(body 0 "$FIELDS" sku)")
check "200, version 0 → 1, saved true" "200 1 true" "$(code) $(echo "$R" | json '.design.version+" "+o.design.saved')"
check "6 fields kept in order, keys as chosen" "title price image inStock rating qty" "$(echo "$R" | json '.design.fields.map(f=>f.responseKey).join(" ")')"
check "omitted typeInContract → true; omitted default → ''" "true " "$(echo "$R" | json '.design.fields[0].typeInContract+" "+o.design.fields[0].default')"
check "  typeInContract false kept; default '0' kept" "false 0" "$(echo "$R" | json '.design.fields[5].typeInContract+" "+o.design.fields[4].default')"
check "id key changed to 'sku' (source still Code)" "sku Code" "$(echo "$R" | json '.design.idField.responseKey+" "+o.design.idField.sourceColumn')"
check "stored in the DB: version 1, 6 fields, no 'version' inside the JSON" "1 6 false" "$(sql "SELECT design_version||' '||json_array_length(design->'fields')||' '||(design::jsonb ? 'version') FROM apis WHERE slug='$A' AND organization_id=(SELECT id FROM organizations WHERE slug='$S')")"
check "GET returns the same design" "$(echo "$R" | json .design)" "$(call a GET "$S/apis/$A/design" | json .design)"
check "API answer: designVersion 1, no design inside" "1 undefined" "$(call a GET "$S/apis/$A" | json '.api.designVersion+" "+o.api.design')"
check "mapped mandatory fields leave the warning (product_name, product_image gone)" "no" "$(echo "$R" | ex '(o.warnings.some(w=>/mandatory.*(product_name|product_image)/.test(w))?"yes":"no")')"
check "all mandatory product fields mapped → no mandatory warning left (purchase_link_1_* are expected now, Jivox 5.0)" "no" "$(echo "$R" | ex '(o.warnings.some(w=>w.includes("mandatory")||w.includes("purchase_link_1_purchase_link"))?"yes":"no")')"
check "one column may feed two Jivox fields (Product Title → product_name + brand_name)" 200 "$(put_fields 1 "$(f product_name 'Product Title' title string)" "$(f brand_name 'Product Title' brand string)"; code)"
check "the id column itself may feed a normal field (Code → product_url)" 200 "$(put_fields 2 "$(f product_url Code link string)"; code)"
check "empty field list (only the id) is allowed" "200 0" "$(put_fields 3; code) $(cat $T/body | json .design.fields.length)"

echo "D. Version check (two people editing)"
V=$(latest)
check "saving with an old version → 409 DESIGN_CHANGED, says the latest" "409 DESIGN_CHANGED The latest version is $V" "$(put_fields 1; code) $(cat $T/body | json .error.code) $(cat $T/body | json .error.details[0].message)"
check "  nothing changed (version still $V)" "$V" "$(latest)"
check "a version from the future → 409" 409 "$(put_fields 999; code)"
# 10 saves at the SAME moment, all with the current version: exactly one may win.
for i in $(seq 1 10); do curl -s -o /dev/null -w '%{http_code}\n' -b $T/a -X PUT "$API/organizations/$S/apis/$A/design" -H "$H" -d "$(body $V "[$(f product_name 'Product Title' t$i string)]")" >> $T/race & done; wait
check "10 parallel saves with version $V → one 200, nine 409" "1 9" "$(grep -c 200 $T/race) $(grep -c 409 $T/race)"
check "  version is $((V+1)) (one save) and its key is in the DB" "$((V+1)) yes" "$(latest) $(sql "SELECT CASE WHEN design->'fields'->0->>'responseKey' ~ '^t[0-9]+$' THEN 'yes' ELSE 'no' END FROM apis WHERE slug='$A' AND organization_id=(SELECT id FROM organizations WHERE slug='$S')")"

echo "E. Rule problems → 400 DESIGN_INVALID, field path points at the input"
V=$(latest)
check "a field that isn't in the Jivox product feed" "400 DESIGN_INVALID fields.0.jivoxColumn" "$(put_fields $V "$(f price_now priceUSD p float)"; code) $(cat $T/body | json .error.code) $(problems)"
check "  a review-only field on a product API (review_text)" "fields.0.jivoxColumn" "$(put_fields $V "$(f review_text 'Product Title' p string)"; problems)"
check "  case matters: Current_Price" "fields.0.jivoxColumn" "$(put_fields $V "$(f Current_Price priceUSD p float)"; problems)"
check "the id column as a normal field (item_id)" "fields.0.jivoxColumn" "$(put_fields $V "$(f item_id Code x string)"; problems)"
check "  message says it's the id field" "yes" "$(cat $T/body | ex '(o.error.details[0].message.includes("id field")?"yes":"no")')"
check "the same Jivox field twice → the second one" "fields.1.jivoxColumn" "$(put_fields $V "$(f current_price priceUSD a float)" "$(f current_price stars b float)"; problems)"
check "a column that isn't in the data" "fields.0.sourceColumn" "$(put_fields $V "$(f current_price price p float)"; problems)"
check "  column names are exact (priceusd ≠ priceUSD)" "fields.0.sourceColumn" "$(put_fields $V "$(f current_price priceusd p float)"; problems)"
check "  message names the column" "yes" "$(cat $T/body | ex '(o.error.details[0].message.includes("\"priceusd\"")?"yes":"no")')"
check "two fields with the same key" "fields.1.responseKey" "$(put_fields $V "$(f current_price priceUSD p float)" "$(f brand_name 'Product Title' p string)"; problems)"
check "  same key in another case (Price / price)" "fields.1.responseKey" "$(put_fields $V "$(f current_price priceUSD Price float)" "$(f brand_name 'Product Title' price string)"; problems)"
check "  a field key equal to the id key" "fields.0.responseKey" "$(put_fields $V "$(f current_price priceUSD code float)"; problems)"
check "key with a dot (not flat) / a space / empty / 65 characters" "fields.0.responseKey fields.1.responseKey fields.2.responseKey fields.3.responseKey" "$(put_fields $V "$(f current_price priceUSD a.b float)" "$(f brand_name pic 'a b' string)" "$(f product_url pic '' string)" "$(f rating_value stars $(printf 'k%.0s' {1..65}) float)"; problems)"
check "64-character key is fine" 200 "$(put_fields $V "$(f current_price priceUSD $(printf 'k%.0s' {1..64}) float)"; code)"
V=$(latest)
check "bad id key" "idField.responseKey" "$(call a PUT "$S/apis/$A/design" "$(body $V '[]' 'my id')" > /dev/null; problems)"
check "unknown type (number)" "fields.0.type" "$(put_fields $V "$(f current_price priceUSD p number)"; problems)"
check "defaults must match the type: int 'abc', float '1,5', boolean 'maybe', image 'logo.png'" "fields.0.default fields.1.default fields.2.default fields.3.default" "$(put_fields $V "$(f rating_count stars a int '"default":"abc"')" "$(f current_price priceUSD b float '"default":"1,5"')" "$(f is_active 'in stock' c boolean '"default":"maybe"')" "$(f product_image pic d image '"default":"logo.png"')"; problems)"
check "  good defaults: int '4.0', float '-0.5', boolean 'Yes', image https URL, string anything" 200 "$(put_fields $V "$(f rating_count stars a int '"default":"4.0"')" "$(f current_price priceUSD b float '"default":"-0.5"')" "$(f is_active 'in stock' c boolean '"default":"Yes"')" "$(f product_image pic d image '"default":"https://cdn.example.com/x.png"')" "$(f brand_name pic e string '"default":"n/a"')"; code)"
V=$(latest)
check "every problem is listed at once (3 here)" 3 "$(put_fields $V "$(f nope priceUSD a float)" "$(f current_price missing b float)" "$(f brand_name pic a string)"; cat $T/body | json .error.details.length)"
check "  and nothing was saved" "$V" "$(latest)"
# (built outside "$(...)": bash 3.2 keeps \" literally inside a quoted command substitution)
NOT_A_LIST="{\"version\":$V,\"idField\":{\"responseKey\":\"x\"},\"fields\":{}}"
check "shape: no body / version missing / version -1 / version '1' / fields not a list" "400 400 400 400 400" "$(call a PUT "$S/apis/$A/design" > /dev/null; code) $(call a PUT "$S/apis/$A/design" '{"idField":{"responseKey":"x"},"fields":[]}' > /dev/null; code) $(put_fields -1; code) $(call a PUT "$S/apis/$A/design" '{"version":"1","idField":{"responseKey":"x"},"fields":[]}' > /dev/null; code) $(call a PUT "$S/apis/$A/design" "$NOT_A_LIST" > /dev/null; code)"
check "  shape problems use the same code" DESIGN_INVALID "$(cat $T/body | json .error.code)"
check "  a field missing its type → fields.0.type" "fields.0.type" "$(call a PUT "$S/apis/$A/design" "$(body $V '[{"jivoxColumn":"current_price","sourceColumn":"priceUSD","responseKey":"p"}]')" > /dev/null; problems)"
check "201 fields → 400 (at most 200)" 400 "$(call a PUT "$S/apis/$A/design" "$(body $V "[$(node -e 'console.log(Array.from({length:201},(_,i)=>JSON.stringify({jivoxColumn:"brand_name",sourceColumn:"pic",responseKey:"k"+i,type:"string"})).join(","))')]")" > /dev/null; code)"
call a PUT "$S/apis/$A/design" '{"version":' > /dev/null
check "invalid JSON → 400 INVALID_JSON" "400 INVALID_JSON" "$(code) $(cat $T/body | json .error.code)"

echo "F. Warnings (allowed, but shown)"
V=$(latest)
put_fields $V "$(f rating_count 'Qty Left' qty string '"typeInContract":false')" "$(f current_price priceUSD p float '"typeInContract":false')"
check "type left out of the contract AND different from Jivox's (string vs int) → warning" "200 1" "$(code) $(cat $T/body | json '.warnings.filter(w=>w.includes("left out of the contract")).length')"
check "  it names the field and Jivox's probable type" yes "$(cat $T/body | ex '(o.warnings.some(w=>w.startsWith("rating_count")&&w.includes("probably int"))?"yes":"no")')"
check "same type left out (float = float) → no warning for it" no "$(cat $T/body | ex '(o.warnings.some(w=>w.startsWith("current_price"))?"yes":"no")')"

echo "G. The design is re-checked against the CURRENT data and feed type"
V=$(latest)
put_fields $V "$(f current_price priceUSD price float)" "$(f product_name 'Product Title' title string)"
call a PATCH "$S/apis/$A" "{\"dataSourceId\":\"$DS_SMALL\"}" > /dev/null
check "switching to data without those columns is refused since 3.6 (409 DATA_MISSING_COLUMNS)" "409 DATA_MISSING_COLUMNS" "$(code) $(cat $T/body | json .error.code)"
put_fields $((V+1))
call a PATCH "$S/apis/$A" "{\"dataSourceId\":\"$DS_SMALL\"}" > /dev/null
check "  with an empty design first, the switch works; the id field now comes from sku" "200 sku" "$(code) $(call a GET "$S/apis/$A/design" | json .design.idField.sourceColumn)"
put_fields $((V+2)) "$(f current_price price price float)" "$(f product_name name title string)"
# A design that no longer matches its data (saved before the 3.6 guard existed): simulated in SQL.
sql "UPDATE apis SET design = json_build_object('idField', design->'idField', 'fields', json_build_array(json_build_object('jivoxColumn','current_price','sourceColumn','priceUSD','responseKey','price','type','float','typeInContract',true,'default','')), 'request', design->'request') WHERE slug='$A' AND organization_id=(SELECT id FROM organizations WHERE slug='$S')" > /dev/null
G=$(call a GET "$S/apis/$A/design")
check "a stale design (column priceUSD not in the data) → GET shows the problem" "fields.0.sourceColumn" "$(echo "$G" | json '.problems.map(p=>p.field).join(" ")')"
check "  saving it unchanged → 400 (fix first)" 400 "$(put_fields $((V+3)) "$(f current_price priceUSD price float)"; code)"
check "  fixed for the data → 200" 200 "$(put_fields $((V+3)) "$(f current_price price price float)" "$(f product_name name title string)"; code)"
V=$(latest)
call a PATCH "$S/apis/$A" '{"feedType":"store"}' > /dev/null
G=$(call a GET "$S/apis/$A/design")
check "feed type changed to store → current_price / product_name aren't store fields; the request's {item_id} isn't a store id (3.4)" "fields.0.jivoxColumn fields.1.jivoxColumn request.query.ids" "$(echo "$G" | json '.problems.map(p=>p.field).join(" ")')"
check "  id field is now store_id" store_id "$(echo "$G" | json .design.idField.jivoxColumn)"
call a PATCH "$S/apis/$A" '{"feedType":"product"}' > /dev/null
check "  back to product → no problems" 0 "$(call a GET "$S/apis/$A/design" | json .problems.length)"

echo "H. Review feed: id is review_id; item_id is a normal field there"
call a POST "$S/apis" "{\"name\":\"Reviews\",\"slug\":\"reviews\",\"feedType\":\"review\",\"dataSourceId\":\"$DS_REV\"}" > /dev/null
check "id field review_id from rid" "review_id rid" "$(call a GET "$S/apis/reviews/design" | json '.design.idField.jivoxColumn+" "+o.design.idField.sourceColumn')"
R=$(call a PUT "$S/apis/reviews/design" "$(body 0 "[$(f item_id product productId string),$(f rating_value stars stars int),$(f review_text text text string),$(f submission_date date date string)]" id)")
check "item_id + rating_value (int) + text + date → 200, no mandatory warning" "200 no" "$(code) $(echo "$R" | ex '(o.warnings.some(w=>w.includes("mandatory"))?"yes":"no")')"
check "review_id as a field → refused (it's the id)" "fields.0.jivoxColumn" "$(call a PUT "$S/apis/reviews/design" "$(body 1 "[$(f review_id rid x string)]" id)" > /dev/null; problems)"

echo "I. Published API: the change applies now, with a warning"
sql "UPDATE apis SET status='published', published_at=now() WHERE slug='$A' AND organization_id=(SELECT id FROM organizations WHERE slug='$S')" > /dev/null
V=$(latest)
put_fields $V "$(f current_price price price float)"
check "200 and the first warning says to make a new contract" "200 yes" "$(code) $(cat $T/body | ex '(o.warnings[0].includes("published")?"yes":"no")')"

echo "J. Locks: a save waits for a data switch in progress (never checks half-switched data)"
V=$(latest)
psql "$DB" -qtAc "BEGIN; SELECT 1 FROM data_sources WHERE id='$DS_SMALL' FOR UPDATE; SELECT pg_sleep(1.5); COMMIT;" > /dev/null &
sleep 0.3
START=$(node -e 'console.log(Date.now())')
put_fields $V "$(f current_price price price float)"
END=$(node -e 'console.log(Date.now())'); wait
check "the save waited for the lock (≥ 1 s) and then succeeded" "200 yes" "$(code) $( [ $((END-START)) -ge 1000 ] && echo yes || echo no)"
V=$(latest)
psql "$DB" -qtAc "BEGIN; SELECT 1 FROM apis WHERE slug='reviews' AND organization_id=(SELECT id FROM organizations WHERE slug='$S') FOR UPDATE; SELECT pg_sleep(1); COMMIT;" > /dev/null &
sleep 0.3
check "another API's lock doesn't slow this one" 200 "$(put_fields $V "$(f current_price price price float)"; code)"
wait

echo "K. Deleting the API deletes its design (it lives on the API row)"
check "DELETE → 204, design endpoint → 404" "204 404" "$(call a DELETE "$S/apis/reviews" > /dev/null; code) $(call a GET "$S/apis/reviews/design" > /dev/null; code)"

psql "$DB" -qtAc "DELETE FROM users WHERE email IN ('$EMAIL','other-$EMAIL')" >/dev/null
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
