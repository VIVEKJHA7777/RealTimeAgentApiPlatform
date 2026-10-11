#!/bin/bash
# Task 2.3 scenario tests: import engine (create data source, background import, replace / merge,
# all-or-nothing on errors, one active import per data source, 500 000 rows, parallel imports).
#
# Usage (backend running with `npm run dev`), from any folder:
#   DB_URL="postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_mine" \
#   bash docs/test-scripts/phase-02-task-2.3-import.sh
#
# Creates its own test users and deletes ONLY them at the end.
# Needs the big files (once):
#   python3 docs/test-data/generate-big-csv.py 500000 /tmp/products-500k.csv
#   python3 docs/test-data/generate-big-csv.py 500000 /tmp/products-500k-bad-row-400k.csv --bad-row 400001
#   python3 docs/test-data/generate-big-csv.py 500000 /tmp/products-500k-duplicate.csv --duplicate-at 300001
# The "restart during an import" check is done by hand (see the phase doc, task 2.3).
API="${API:-localhost:4000/api}"
DB="${DB_URL:-postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV="${CSV_DIR:-$SCRIPT_DIR/../test-data/csv}"
H='content-type: application/json'
[ -f "$CSV/products-v1.csv" ] || { echo "Can't find the test CSVs in $CSV (set CSV_DIR)"; exit 1; }
curl -s -o /dev/null --max-time 3 "$API/health" || { echo "Backend not reachable at $API"; exit 1; }
for f in /tmp/products-500k.csv /tmp/products-500k-bad-row-400k.csv /tmp/products-500k-duplicate.csv; do
  [ -f "$f" ] || { echo "Missing $f (see the top of this script)"; exit 1; }
done

T=$(mktemp -d); PASS=0; FAIL=0
check() { if [ "$2" == "$3" ]; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1  (expected: $2, got: $3)"; fi; }
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);const v=eval('o'+process.argv[1]);console.log(typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('JSON-ERROR')}})" "$1"; }
sql() { psql "$DB" -tAc "$1"; }
now_ms() { perl -MTime::HiRes=time -e 'printf "%.0f", time*1000'; }
# create JAR FILE [fields...] → JSON body, code in $T/code
create() { local jar=$1 f=$2; shift 2; curl -s -o $T/body -w '%{http_code}' -b $T/$jar -X POST "$API/organizations/$SLUG/data-sources" -F "file=@$f" "$@" > $T/code; cat $T/body; }
reimport() { local ds=$1 f=$2; shift 2; curl -s -o $T/body -w '%{http_code}' -b $T/a -X POST "$API/organizations/$SLUG/data-sources/$ds/imports" -F "file=@$f" "$@" > $T/code; cat $T/body; }
code() { cat $T/code; }
# wait DS IMPORT → final import JSON (polls every 200 ms, up to 120 s);
# progress values seen WHILE running are written to $T/seen (one per line)
wait_import() {
  local ds=$1 imp=$2 body st p
  : > $T/seen
  for i in $(seq 1 600); do
    body=$(curl -s -b $T/a "$API/organizations/$SLUG/data-sources/$ds/imports/$imp")
    st=$(echo "$body" | json .import.status); p=$(echo "$body" | json .import.processedRows)
    [ "$st" == "running" ] && echo "$p" >> $T/seen
    if [ "$st" == "succeeded" ] || [ "$st" == "failed" ]; then echo "$body"; return; fi
    sleep 0.2
  done
  echo '{"import":{"status":"TIMEOUT"}}'
}
active_rows() { sql "SELECT count(*) FROM records r JOIN data_sources ds ON ds.id=r.data_source_id AND r.generation=ds.active_generation WHERE ds.id='$1'"; }
all_rows() { sql "SELECT count(*) FROM records WHERE data_source_id='$1'"; }

EMAIL="import-$RANDOM$RANDOM@test.com"
curl -s -o /dev/null -c $T/a -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
curl -s -o /dev/null -c $T/b -X POST $API/auth/signup -H "$H" -d "{\"email\":\"other-$EMAIL\",\"password\":\"password123\"}"
SLUG=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"Import Test","slug":"import-test"}' | json .organization.slug)
echo "test brand: $SLUG"

echo "A. Create a data source (first import)"
B=$(create a $CSV/products-v1.csv -F idColumn=sku -F name=Products)
check "202 Accepted" 202 "$(code)"
check "import starts queued (or already running)" yes "$(echo "$B" | json .import.status | grep -qE 'queued|running|succeeded' && echo yes || echo no)"
check "no data yet in the response (hasData false)" false "$(echo "$B" | json .dataSource.hasData)"
check "no internal fields leaked (tempPath, generation)" "undefined undefined" "$(echo "$B" | json '.import.tempPath+" "+o.import.generation')"
DS1=$(echo "$B" | json .dataSource.id); I=$(echo "$B" | json .import.id)
R=$(wait_import $DS1 $I)
check "import succeeded" succeeded "$(echo "$R" | json .import.status)"
check "counts: 5 inserted" "5 0 0 0" "$(echo "$R" | json '.import.inserted+" "+o.import.updated+" "+o.import.unchanged+" "+o.import.deleted')"
check "DB: 5 live rows, row_count 5, generation 1" "5|1|5" "$(sql "SELECT (SELECT count(*) FROM records WHERE data_source_id='$DS1')||'|'||active_generation||'|'||row_count FROM data_sources WHERE id='$DS1'")"
check "values stored as text, id not repeated inside data" '{"name": "Two", "price": "20"}' "$(sql "SELECT data FROM records WHERE data_source_id='$DS1' AND external_id='P-2'")"
check "file order kept (positions 1..5)" "P-1,P-2,P-3,P-4,P-5" "$(sql "SELECT string_agg(external_id, ',' ORDER BY position) FROM records WHERE data_source_id='$DS1'")"
B=$(create a $CSV/good.csv -F idColumn=SKU); DSG=$(echo "$B" | json .dataSource.id)
check "name defaults to the file name; id column matched ignoring case (SKU → sku)" "good.csv sku" "$(echo "$B" | json '.dataSource.name+" "+o.dataSource.idColumn')"
wait_import $DSG $(echo "$B" | json .import.id) > /dev/null

echo "B. Rejected straight away (400/409, nothing created)"
N0=$(sql "SELECT count(*) FROM data_sources ds JOIN organizations o ON o.id=ds.organization_id WHERE o.slug='$SLUG'")
B=$(create a $CSV/products-v1.csv -F idColumn=sku -F name=Products); check "same name in the brand → 409 DATA_SOURCE_NAME_TAKEN" "409 DATA_SOURCE_NAME_TAKEN" "$(code) $(echo "$B" | json .error.code)"
B=$(create a $CSV/products-v1.csv -F idColumn=barcode -F name=X); check "id column not in the file → 400 ID_COLUMN_NOT_FOUND" "400 ID_COLUMN_NOT_FOUND" "$(code) $(echo "$B" | json .error.code)"
B=$(create a $CSV/products-v1.csv -F name=X); check "id column missing → 400 VALIDATION_ERROR" "400 VALIDATION_ERROR" "$(code) $(echo "$B" | json .error.code)"
B=$(create a $CSV/duplicate-headers.csv -F idColumn=sku -F name=X); check "bad header → 400 SOURCE_INVALID" "400 SOURCE_INVALID" "$(code) $(echo "$B" | json .error.code)"
B=$(create a $CSV/image-renamed.csv -F idColumn=sku -F name=X); check "not a CSV → 415" 415 "$(code)"
D_UP="${UPLOAD_DIR:-$(node -e "console.log(require('path').join(require('os').tmpdir(),'api-platform-uploads'))")}"
curl -s -o /dev/null -b $T/a --limit-rate 2M --max-time 1 -X POST "$API/organizations/$SLUG/data-sources" -F "file=@/tmp/products-500k.csv" -F idColumn=sku -F name=Cancelled; sleep 1
check "upload cancelled by the client (curl gives up after 1 s) → nothing created, no file left" "0 0" "$(sql "SELECT count(*) FROM data_sources WHERE name='Cancelled'") $(ls "$D_UP" | wc -l | tr -d ' ')"
check "no data source created by any of these" "$N0" "$(sql "SELECT count(*) FROM data_sources ds JOIN organizations o ON o.id=ds.organization_id WHERE o.slug='$SLUG'")"

echo "C. Row problems → import fails, NOTHING stored"
B=$(create a $CSV/products-duplicate-ids.csv -F idColumn=sku -F name=Dups); DSD=$(echo "$B" | json .dataSource.id)
R=$(wait_import $DSD $(echo "$B" | json .import.id))
check "duplicate ids → failed DUPLICATE_IDS" "failed DUPLICATE_IDS" "$(echo "$R" | json '.import.status+" "+o.import.errorCode')"
check "  both rows named" '"D-1" appears more than once (rows 2 and 4)|"D-2" appears more than once (rows 3 and 6)' "$(echo "$R" | json '.import.problems.map(p=>p.message).join("|")')"
check "  data source has no data, 0 rows stored" "false 0" "$(sql "SELECT (active_generation IS NOT NULL)||' '||(SELECT count(*) FROM records WHERE data_source_id='$DSD') FROM data_sources WHERE id='$DSD'")"
B=$(create a $CSV/products-missing-ids.csv -F idColumn=sku -F name=Missing); R=$(wait_import $(echo "$B" | json .dataSource.id) $(echo "$B" | json .import.id))
check "missing ids → failed, rows 3 and 5 named" 'Row 3 has no "sku"|Row 5 has no "sku"' "$(echo "$R" | json '.import.problems.map(p=>p.message).join("|")')"
B=$(create a $CSV/ragged.csv -F idColumn=sku -F name=Ragged); R=$(wait_import $(echo "$B" | json .dataSource.id) $(echo "$B" | json .import.id))
check "ragged rows → failed SOURCE_INVALID" "failed SOURCE_INVALID 2" "$(echo "$R" | json '.import.status+" "+o.import.errorCode+" "+o.import.problems.length')"
B=$(create a $CSV/unclosed-quote.csv -F idColumn=sku -F name=Quote); R=$(wait_import $(echo "$B" | json .dataSource.id) $(echo "$B" | json .import.id))
check "broken quote → failed with its row" 'Row 4: a quote (") is opened but never closed' "$(echo "$R" | json '.import.problems[0].message')"

echo "D. Replace and merge (new versions)"
B=$(reimport $DS1 $CSV/products-v2.csv); check "replace → 202" 202 "$(code)"
R=$(wait_import $DS1 $(echo "$B" | json .import.id))
check "replace counts: 1 added · 1 updated · 3 unchanged · 1 removed" "1 1 3 1" "$(echo "$R" | json '.import.inserted+" "+o.import.updated+" "+o.import.unchanged+" "+o.import.deleted')"
check "  live data = the file (P-3 gone, P-2 = 25, P-6 added)" "P-1,P-2,P-4,P-5,P-6|25" "$(sql "SELECT string_agg(external_id, ',' ORDER BY position) FROM records r JOIN data_sources ds ON ds.id=r.data_source_id AND r.generation=ds.active_generation WHERE ds.id='$DS1'")|$(sql "SELECT data->>'price' FROM records r JOIN data_sources ds ON ds.id=r.data_source_id AND r.generation=ds.active_generation WHERE ds.id='$DS1' AND external_id='P-2'")"
check "  old version deleted (only 5 rows in the table)" 5 "$(all_rows $DS1)"
reimport $DS1 $CSV/products-v1.csv > /dev/null; wait_import $DS1 $(cat $T/body | json .import.id) > /dev/null
B=$(reimport $DS1 $CSV/products-v2.csv -F mode=merge); R=$(wait_import $DS1 $(echo "$B" | json .import.id))
check "merge counts: 1 added · 1 updated · 3 unchanged · 0 removed" "1 1 3 0" "$(echo "$R" | json '.import.inserted+" "+o.import.updated+" "+o.import.unchanged+" "+o.import.deleted')"
check "  P-3 kept (not in the file), 6 rows, row_count 6" "6|6|yes" "$(active_rows $DS1)|$(sql "SELECT row_count FROM data_sources WHERE id='$DS1'")|$(sql "SELECT CASE WHEN count(*)=1 THEN 'yes' ELSE 'no' END FROM records r JOIN data_sources ds ON ds.id=r.data_source_id AND r.generation=ds.active_generation WHERE ds.id='$DS1' AND external_id='P-3'")"
B=$(reimport $DS1 $CSV/products-v3-new-column.csv -F mode=merge); wait_import $DS1 $(echo "$B" | json .import.id) > /dev/null
check "merge with a new column → columns = old + badge" '["sku","name","price","badge"]' "$(sql "SELECT columns FROM data_sources WHERE id='$DS1'" | tr -d ' ')"
B=$(reimport $DS1 $CSV/products-v3-new-column.csv); wait_import $DS1 $(echo "$B" | json .import.id) > /dev/null
check "replace → exactly the file's rows, in the file's order" "P-5,P-1" "$(sql "SELECT string_agg(external_id, ',' ORDER BY position) FROM records r JOIN data_sources ds ON ds.id=r.data_source_id AND r.generation=ds.active_generation WHERE ds.id='$DS1'")"
B=$(reimport $DS1 $CSV/products-no-sku.csv); check "new version without the id column → 400 ID_COLUMN_NOT_FOUND" "400 ID_COLUMN_NOT_FOUND" "$(code) $(echo "$B" | json .error.code)"
B=$(reimport $DS1 $CSV/products-v1.csv -F mode=append); check "unknown mode → 400" 400 "$(code)"

echo "E. Access control"
check "other account: start an import on my data source → 404" 404 "$(curl -s -o /dev/null -w '%{http_code}' -b $T/b -X POST "$API/organizations/$SLUG/data-sources/$DS1/imports" -F "file=@$CSV/products-v1.csv")"
check "unknown data source → 404 DATA_SOURCE_NOT_FOUND" DATA_SOURCE_NOT_FOUND "$(curl -s -b $T/a -X POST "$API/organizations/$SLUG/data-sources/nope/imports" -F "file=@$CSV/products-v1.csv" | json .error.code)"
check "import of another data source via my URL → 404 IMPORT_NOT_FOUND" IMPORT_NOT_FOUND "$(curl -s -b $T/a "$API/organizations/$SLUG/data-sources/$DSG/imports/$I" | json .error.code)"

echo "F. 500 000 rows"
S=$(now_ms); B=$(create a /tmp/products-500k.csv -F idColumn=sku -F name=Big); E=$(now_ms)
check "upload answers 202 quickly (doesn't wait for the import)" 202 "$(code)"
echo "     upload + 202 took $((E-S)) ms"
DSB=$(echo "$B" | json .dataSource.id); IB=$(echo "$B" | json .import.id)
S=$(now_ms); R=$(wait_import $DSB $IB); E=$(now_ms)
check "500 000-row import succeeded" succeeded "$(echo "$R" | json .import.status)"
check "  500 000 rows live, row_count 500000" "500000|500000" "$(active_rows $DSB)|$(sql "SELECT row_count FROM data_sources WHERE id='$DSB'")"
check "  estimatedRows exact at the end (500 000)" 500000 "$(echo "$R" | json .import.estimatedRows)"
check "  progress was visible while running (saw 0 < processed < 500 000)" yes "$(awk '$1>0 && $1<500000{f=1} END{print f?"yes":"no"}' $T/seen)"
echo "     import time: $((E-S)) ms · progress seen while running: $(sort -n -u $T/seen | tr '\n' ' ')"

echo "G. Broken big files change NOTHING"
B=$(reimport $DSB /tmp/products-500k-bad-row-400k.csv); IB2=$(echo "$B" | json .import.id)
sleep 1; MID=$(active_rows $DSB)
R=$(wait_import $DSB $IB2)
check "bad row 400 001 → failed, row named" "failed Row 400001 has 8 values, but the header has 7 columns" "$(echo "$R" | json '.import.status+" "+o.import.problems[0].message')"
check "  readers saw the old 500 000 rows DURING the import" 500000 "$MID"
check "  live data unchanged afterwards (500 000, same generation)" "500000|1" "$(active_rows $DSB)|$(sql "SELECT active_generation FROM data_sources WHERE id='$DSB'")"
check "  no half-written rows left (table holds exactly 500 000)" 500000 "$(all_rows $DSB)"
B=$(reimport $DSB /tmp/products-500k-duplicate.csv); R=$(wait_import $DSB $(echo "$B" | json .import.id))
check "duplicate id at row 300 001 → both rows named" '"SKU-0000001" appears more than once (rows 2 and 300001)' "$(echo "$R" | json .import.problems[0].message)"
check "  still 500 000 rows, nothing left over" "500000|500000" "$(active_rows $DSB)|$(all_rows $DSB)"

echo "H. Concurrency"
B1=$(reimport $DSB /tmp/products-500k.csv); C1=$(code); B2=$(reimport $DSB $CSV/products-v1.csv); C2=$(code)
check "2nd upload while one runs → 409 IMPORT_IN_PROGRESS (1st → 202)" "202 409 IMPORT_IN_PROGRESS" "$C1 $C2 $(echo "$B2" | json .error.code)"
R=$(wait_import $DSB $(echo "$B1" | json .import.id))
check "  the running import still succeeded: 500 000 unchanged" "succeeded 500000" "$(echo "$R" | json '.import.status+" "+o.import.unchanged')"
check "  then a new upload is accepted again" 202 "$(reimport $DSB $CSV/products-v1.csv > /dev/null; code)"
wait_import $DSB $(cat $T/body | json .import.id) > /dev/null
R=$( (for n in 1 2 3 4 5; do curl -s -o /dev/null -w '%{http_code}\n' -b $T/a -X POST "$API/organizations/$SLUG/data-sources" -F "file=@$CSV/products-v1.csv" -F idColumn=sku -F name=Same & done; wait) | sort | uniq -c | awk '{printf "%s×%s ", $1, $2}')
check "5 parallel creates with the same name → 1 × 202 + 4 × 409" "1×202 4×409 " "$R"
for n in 1 2 3; do B=$(create a /tmp/products-500k.csv -F idColumn=sku -F name=Par$n); echo "$(echo "$B" | json .dataSource.id) $(echo "$B" | json .import.id)" >> $T/par; done
S=$(now_ms); OK=0; while read ds imp; do [ "$(wait_import $ds $imp | json .import.status)" == "succeeded" ] && OK=$((OK+1)); done < $T/par; E=$(now_ms)
check "3 × 500 000-row imports into different data sources at once (2 run, 1 waits) → all succeed" 3 "$OK"
echo "     all three done in $((E-S)) ms"

echo "J. Data source deleted in the middle of a 500 000-row import"
B=$(create a /tmp/products-500k.csv -F idColumn=sku -F name=Doomed); DSX=$(echo "$B" | json .dataSource.id); IX=$(echo "$B" | json .import.id)
for i in $(seq 1 100); do [ "$(sql "SELECT processed_rows FROM data_imports WHERE id='$IX'")" -ge 50000 ] 2>/dev/null && break; sleep 0.1; done
sql "DELETE FROM data_sources WHERE id='$DSX'" >/dev/null   # (2.4 adds a delete endpoint; here we delete directly)
sleep 3
check "no rows left behind for the deleted data source" 0 "$(all_rows $DSX)"
check "import + data source both gone (cascade)" "0 0" "$(sql "SELECT (SELECT count(*) FROM data_imports WHERE id='$IX')||' '||(SELECT count(*) FROM data_sources WHERE id='$DSX')")"

echo "I. Clean-up"
UPLOAD_DIR="${UPLOAD_DIR:-$(node -e "console.log(require('path').join(require('os').tmpdir(),'api-platform-uploads'))")}"
check "upload folder empty (every import deleted its file)" 0 "$(ls "$UPLOAD_DIR" | wc -l | tr -d ' ')"
check "no rows outside the live generations" 0 "$(sql "SELECT count(*) FROM records r JOIN data_sources ds ON ds.id=r.data_source_id JOIN organizations o ON o.id=ds.organization_id WHERE o.slug='$SLUG' AND r.generation IS DISTINCT FROM ds.active_generation")"

psql "$DB" -qtAc "DELETE FROM users WHERE email IN ('$EMAIL','other-$EMAIL')" >/dev/null
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
