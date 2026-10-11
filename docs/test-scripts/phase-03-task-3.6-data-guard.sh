#!/bin/bash
# Task 3.6 scenario tests: the data guard. Data an API answers from must keep every column its
# design sends: replace uploads (at once + again at the switch) and PATCH dataSourceId.
#
# Usage (backend running with `npm run dev`), from any folder:
#   DB_URL="postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_mine" \
#   API=localhost:4001/api bash docs/test-scripts/phase-03-task-3.6-data-guard.sh
#
# Creates its own test user and deletes ONLY it at the end.
API="${API:-localhost:4000/api}"
DB="${DB_URL:-postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV="$SCRIPT_DIR/../test-data/csv"
UPLOADS="$(node -e 'console.log(require("os").tmpdir())')/api-platform-uploads"
H='content-type: application/json'
[ -f "$CSV/products-no-price.csv" ] || { echo "Can't find the test CSVs in $CSV"; exit 1; }
curl -s -o /dev/null --max-time 3 "$API/health" || { echo "Backend not reachable at $API"; exit 1; }

T=$(mktemp -d); PASS=0; FAIL=0
check() { if [ "$2" == "$3" ]; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1  (expected: $2, got: $3)"; fi; }
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);const v=eval('o'+process.argv[1]);console.log(typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('JSON-ERROR')}})" "$1"; }
sql() { psql "$DB" -tAc "$1"; }
code() { cat $T/code; }
call() { local jar=$1 m=$2 p=$3 d=$4; if [ -n "$d" ]; then curl -s -o $T/body -w '%{http_code}' -b $T/$jar -X $m "$API/organizations/$p" -H "$H" -d "$d" > $T/code; else curl -s -o $T/body -w '%{http_code}' -b $T/$jar -X $m "$API/organizations/$p" > $T/code; fi; cat $T/body; }
new_ds() {
  local B ds imp; B=$(curl -s -b $T/a -X POST "$API/organizations/$S/data-sources" -F "file=@$1" -F "idColumn=$3" -F "name=$2")
  ds=$(echo "$B" | json .dataSource.id); imp=$(echo "$B" | json .import.id); wait_import "$ds" "$imp" > /dev/null; echo "$ds"
}
# wait_import DS IMPORT → final status
wait_import() { local st; for i in $(seq 1 300); do st=$(curl -s -b $T/a "$API/organizations/$S/data-sources/$1/imports/$2" | json .import.status); [ "$st" == succeeded ] || [ "$st" == failed ] && break; sleep 0.1; done; echo "$st"; }
# upload DS FILE MODE → body in $T/body, status in $T/code
upload() { curl -s -o $T/body -w '%{http_code}' -b $T/a -X POST "$API/organizations/$S/data-sources/$1/imports" -F "file=@$2" -F "mode=$3" > $T/code; }
# design API FIELDS_JSON → PUT (current version)
design() { local v; v=$(call a GET "$S/apis/$1/design" | json .design.version); call a PUT "$S/apis/$1/design" "{\"version\":$v,\"idField\":{\"responseKey\":\"id\"},\"fields\":$2}" > /dev/null; }
F_PRICE='{"jivoxColumn":"current_price","sourceColumn":"price","responseKey":"price","type":"float"}'
F_NAME='{"jivoxColumn":"product_name","sourceColumn":"name","responseKey":"name","type":"string"}'
ds_columns() { sql "SELECT columns::text FROM data_sources WHERE id='$1'" | tr -d ' '; }

EMAIL="guard-$RANDOM$RANDOM@test.com"
curl -s -o /dev/null -c $T/a -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
S=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"Guard Test","slug":"guard-test"}' | json .organization.slug)
DS=$(new_ds "$CSV/products-v1.csv" "Products" sku)
for a in live other bare; do call a POST "$S/apis" "{\"name\":\"API $a\",\"slug\":\"$a-api\",\"dataSourceId\":\"$DS\"}" > /dev/null; done
design live-api "[$F_PRICE,$F_NAME]"     # sends price + name
design other-api "[$F_NAME]"             # sends name
# bare-api: no design saved → never blocks anything

echo "A. Uploading a replace that drops a column → 409 at once"
BEFORE=$(ls "$UPLOADS" 2>/dev/null | wc -l | tr -d ' ')
upload $DS "$CSV/products-no-price.csv" replace
check "file without price → 409 COLUMNS_IN_USE" "409 COLUMNS_IN_USE" "$(code) $(cat $T/body | json .error.code)"
check "  names the API and the column (one line per API; other-api isn't affected)" 'API "API live" (live-api) sends "price", which the new data doesn'"'"'t have' "$(cat $T/body | json '.error.details.map(d=>d.message).join(" | ")')"
check "  no import was created, the uploaded file was removed" "1 $BEFORE" "$(sql "SELECT count(*) FROM data_imports WHERE data_source_id='$DS'") $(ls "$UPLOADS" 2>/dev/null | wc -l | tr -d ' ')"
upload $DS "$CSV/products-renamed.csv" replace
check "renamed columns (Name, Price): names are exact → both APIs listed, by name" '409 API "API live" (live-api) sends "price", "name"…|API "API other" (other-api) sends "name"…' "$(code) $(cat $T/body | json '.error.details.map(d=>d.message.replace(/, which.*/,"…")).join("|")')"
upload $DS "$CSV/products-v3-new-column.csv" replace
check "a file with every used column (+ a new one) → 202, succeeds" "202 succeeded" "$(code) $(wait_import $DS $(cat $T/body | json .import.id))"
upload $DS "$CSV/products-no-price.csv" merge
check "merge without price → allowed (merge keeps every old column)" "202 succeeded" "$(code) $(wait_import $DS $(cat $T/body | json .import.id))"
check "  price is still a column after the merge" yes "$(ds_columns $DS | grep -q '"price"' && echo yes || echo no)"

echo "B. Change the design first, then the replace goes through"
design live-api "[$F_NAME]"
upload $DS "$CSV/products-no-price.csv" replace
check "nobody sends price any more → 202, succeeds, price gone" '202 succeeded ["sku","name"]' "$(code) $(wait_import $DS $(cat $T/body | json .import.id)) $(ds_columns $DS)"
check "a design using price can't be saved now (3.2 rule)" 400 "$(design live-api "[$F_PRICE]"; code)"
upload $DS "$CSV/products-v1.csv" replace; wait_import $DS $(cat $T/body | json .import.id) > /dev/null

echo "C. A design saved WHILE the file imports → the switch refuses it, old data stays"
node -e 'let s="sku,name\n";for(let i=1;i<=200000;i++)s+=`P-${i},Name ${i}\n`;require("fs").writeFileSync(process.argv[1],s)' $T/big-no-price.csv
design live-api "[$F_NAME]"            # nobody uses price → the upload check passes
OLD_GEN=$(sql "SELECT active_generation FROM data_sources WHERE id='$DS'")
upload $DS $T/big-no-price.csv replace
IMP=$(cat $T/body | json .import.id)
check "upload accepted (no design uses price yet)" 202 "$(code)"
sleep 0.3
design live-api "[$F_PRICE,$F_NAME]"   # saved during the import: the CURRENT data still has price
check "  the design save (during the import) succeeds" 200 "$(code)"
check "  …and the import fails at the switch: COLUMNS_IN_USE" "failed COLUMNS_IN_USE" "$(wait_import $DS $IMP) $(call a GET "$S/data-sources/$DS/imports/$IMP" | json .import.errorCode)"
check "  its problem names the API and column" yes "$(call a GET "$S/data-sources/$DS/imports/$IMP" | json '.import.problems[0].message' | grep -q 'live-api.*"price"' && echo yes || echo no)"
# The import is marked failed first, then its half-written rows are deleted (~1 s for 200 000):
# wait for that clean-up instead of counting rows that are still being removed.
for _ in $(seq 1 50); do [ "$(sql "SELECT count(*) FROM records WHERE data_source_id='$DS' AND generation<>$OLD_GEN")" = 0 ] && break; sleep 0.2; done
check "  the old version is still live (same generation, 5 rows, price kept), new rows removed" "$OLD_GEN 5 yes 0" "$(sql "SELECT active_generation FROM data_sources WHERE id='$DS'") $(sql "SELECT row_count FROM data_sources WHERE id='$DS'") $(ds_columns $DS | grep -q '"price"' && echo yes || echo no) $(sql "SELECT count(*) FROM records WHERE data_source_id='$DS' AND generation<>$OLD_GEN")"
check "  the API still answers from the old data (preview finds P-1 with its price)" 10 "$(call a POST "$S/apis/live-api/design/preview" '{"ids":["P-1"]}' | json .response.data[0].price)"

echo "D. Switching an API to other data (PATCH dataSourceId)"
DS_REV=$(new_ds "$CSV/reviews-random-names.csv" "Reviews" rid)
DS_V2=$(new_ds "$CSV/products-v2.csv" "Products v2" sku)
call a PATCH "$S/apis/live-api" "{\"dataSourceId\":\"$DS_REV\"}" > /dev/null
check "to data without price + name → 409 DATA_MISSING_COLUMNS, both listed" '409 DATA_MISSING_COLUMNS dataSourceId Missing: "price", "name"' "$(code) $(cat $T/body | json .error.code) $(cat $T/body | json .error.details[0].field) $(cat $T/body | json .error.details[0].message)"
check "  the API still uses its old data" "$DS" "$(call a GET "$S/apis/live-api" | json .api.dataSource.id)"
check "  a rename in the same request isn't applied either (all or nothing)" "live-api" "$(call a PATCH "$S/apis/live-api" "{\"slug\":\"renamed-api\",\"dataSourceId\":\"$DS_REV\"}" > /dev/null; call a GET "$S/apis/live-api" | json .api.slug)"
call a PATCH "$S/apis/live-api" "{\"dataSourceId\":\"$DS_V2\"}" > /dev/null
check "to data that has both columns → 200" "200 $DS_V2" "$(code) $(cat $T/body | json .api.dataSource.id)"
check "an API without a design can move to any data" 200 "$(call a PATCH "$S/apis/bare-api" "{\"dataSourceId\":\"$DS_REV\"}" > /dev/null; code)"
design bare-api '[{"jivoxColumn":"product_url","sourceColumn":"rid","responseKey":"u","type":"string"}]'
check "a design using the id column (rid) → moving to data whose id is sku → missing rid" 'Missing: "rid"' "$(call a PATCH "$S/apis/bare-api" "{\"dataSourceId\":\"$DS\"}" | json .error.details[0].message)"
check "other changes (name) don't run the guard" 200 "$(call a PATCH "$S/apis/bare-api" '{"name":"Renamed"}' > /dev/null; code)"

echo "E. Races"
# 10 PATCHes switching other-api between two data sources while 10 design saves add a column
# only one of them has: whatever the order, the end state must be consistent (design ⊆ data).
DS_NOPRICE=$(new_ds "$CSV/products-no-price.csv" "No price" sku)
for i in $(seq 1 10); do
  if [ $((i%2)) -eq 0 ]; then D=$DS_NOPRICE; else D=$DS_V2; fi
  curl -s -o /dev/null -w 'patch %{http_code}\n' -b $T/a -X PATCH "$API/organizations/$S/apis/other-api" -H "$H" -d "{\"dataSourceId\":\"$D\"}" >> $T/race &
  # (own files per request: parallel requests must not share $T/body)
  ( v=$(curl -s -b $T/a "$API/organizations/$S/apis/other-api/design" | json .design.version)
    curl -s -o /dev/null -w 'save %{http_code}\n' -b $T/a -X PUT "$API/organizations/$S/apis/other-api/design" -H "$H" -d "{\"version\":$v,\"idField\":{\"responseKey\":\"id\"},\"fields\":[$F_PRICE,$F_NAME]}" >> $T/race ) &
done; wait
check "no 500s (patch 200/409, save 200/400/409)" 0 "$(grep -Evc '^(patch (200|409)|save (200|400|409))$' $T/race)"
END=$(call a GET "$S/apis/other-api/design")
check "end state consistent: the design's columns all exist in the API's data (no problems)" 0 "$(echo "$END" | json .problems.length)"

psql "$DB" -qtAc "DELETE FROM users WHERE email='$EMAIL'" >/dev/null
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
