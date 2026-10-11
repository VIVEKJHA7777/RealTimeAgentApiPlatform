#!/bin/bash
# Task 2.4 scenario tests: list / get data sources, import history, records (keyset pages + id
# prefix search), streaming CSV download, delete (in use / import running / races), 500 000 rows.
#
# Usage (backend running with `npm run dev`), from any folder:
#   DB_URL="postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_mine" \
#   API=localhost:4001/api bash docs/test-scripts/phase-02-task-2.4-browse-download-delete.sh
#
# Creates its own test users and deletes ONLY them at the end.
# Needs the big files (once):
#   python3 docs/test-data/generate-big-csv.py 500000 /tmp/products-500k.csv
#   sed 's/,USD,/,EUR,/' /tmp/products-500k.csv > /tmp/products-500k-eur.csv
# Expects the default DOWNLOAD_CONCURRENCY=4 (section H).
API="${API:-localhost:4000/api}"
DB="${DB_URL:-postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV="${CSV_DIR:-$SCRIPT_DIR/../test-data/csv}"
H='content-type: application/json'
[ -f "$CSV/ids-special.csv" ] || { echo "Can't find the test CSVs in $CSV (set CSV_DIR)"; exit 1; }
curl -s -o /dev/null --max-time 3 "$API/health" || { echo "Backend not reachable at $API"; exit 1; }
for f in /tmp/products-500k.csv /tmp/products-500k-eur.csv; do
  [ -f "$f" ] || { echo "Missing $f (see the top of this script)"; exit 1; }
done

T=$(mktemp -d); PASS=0; FAIL=0
check() { if [ "$2" == "$3" ]; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1  (expected: $2, got: $3)"; fi; }
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);const v=eval('o'+process.argv[1]);console.log(typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('JSON-ERROR')}})" "$1"; }
sql() { psql "$DB" -tAc "$1"; }
now_ms() { perl -MTime::HiRes=time -e 'printf "%.0f", time*1000'; }
code() { cat $T/code; }
DSURL() { echo "$API/organizations/$SLUG/data-sources"; }
# create FILE [fields...] → JSON body (as account a)
create() { local f=$1; shift; curl -s -o $T/body -w '%{http_code}' -b $T/a -X POST "$(DSURL)" -F "file=@$f" "$@" > $T/code; cat $T/body; }
reimport() { local ds=$1 f=$2; shift 2; curl -s -o $T/body -w '%{http_code}' -b $T/a -X POST "$(DSURL)/$ds/imports" -F "file=@$f" "$@" > $T/code; cat $T/body; }
# get JAR PATH [curl args] → body; code in $T/code; response headers in $T/headers
get() { local jar=$1 p=$2; shift 2; curl -s -D $T/headers -o $T/body -w '%{http_code}' -b $T/$jar "$@" "$(DSURL)$p" > $T/code; cat $T/body; }
# recs DS [--data-urlencode k=v ...] → records page JSON (account a)
recs() { local ds=$1; shift; curl -s -o $T/body -w '%{http_code}' -b $T/a -G "$(DSURL)/$ds/records" "$@" > $T/code; cat $T/body; }
del() { curl -s -o $T/body -w '%{http_code}' -b $T/${2:-a} -X DELETE "$(DSURL)/$1" > $T/code; cat $T/body; }
download() { curl -s -o "$2" -w '%{http_code}' -b $T/a "$(DSURL)/$1/download"; }
ids() { json '.records.map(r=>r.id).join(",")'; }
wait_import() {
  local ds=$1 imp=$2 body st
  for i in $(seq 1 600); do
    body=$(curl -s -b $T/a "$(DSURL)/$ds/imports/$imp"); st=$(echo "$body" | json .import.status)
    if [ "$st" == "succeeded" ] || [ "$st" == "failed" ]; then echo "$body"; return; fi
    sleep 0.2
  done
  echo '{"import":{"status":"TIMEOUT"}}'
}
# new_ds FILE NAME [idColumn] → id of a data source whose first import has finished
new_ds() { local B; B=$(create "$1" -F idColumn=${3:-sku} -F "name=$2"); wait_import "$(echo "$B" | json .dataSource.id)" "$(echo "$B" | json .import.id)" > /dev/null; echo "$B" | json .dataSource.id; }
add_api() { sql "INSERT INTO apis (id, organization_id, data_source_id, name, slug, updated_at) SELECT 'api-'||md5(random()::text), organization_id, id, '$2', '$3', now() FROM data_sources WHERE id='$1'" > /dev/null; }

EMAIL="browse-$RANDOM$RANDOM@test.com"
curl -s -o /dev/null -c $T/a -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
curl -s -o /dev/null -c $T/b -X POST $API/auth/signup -H "$H" -d "{\"email\":\"other-$EMAIL\",\"password\":\"password123\"}"
SLUG=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"Browse Test","slug":"browse-test"}' | json .organization.slug)
SLUG_B=$(curl -s -b $T/b -X POST $API/organizations -H "$H" -d '{"name":"Other Brand","slug":"other-brand"}' | json .organization.slug)
echo "test brand: $SLUG"

echo "A. List, get, import history"
get a "" > /dev/null; check "new brand: list → 200, empty" '200 []' "$(code) $(cat $T/body | json .dataSources)"
check "  Cache-Control: no-store" yes "$(grep -qi '^cache-control: no-store' $T/headers && echo yes || echo no)"
DS1=$(new_ds $CSV/products-v1.csv Products)
B=$(create $CSV/products-duplicate-ids.csv -F idColumn=sku -F name=Broken); DSF=$(echo "$B" | json .dataSource.id)
wait_import $DSF $(echo "$B" | json .import.id) > /dev/null
L=$(get a "")
check "list: newest first" "Broken,Products" "$(echo "$L" | json '.dataSources.map(d=>d.name).join(",")')"
check "  Products: 5 rows, has data, not used, latest import succeeded" "5 true [] succeeded" "$(echo "$L" | json '.dataSources[1].rowCount+" "+o.dataSources[1].hasData+" "+JSON.stringify(o.dataSources[1].usedBy)+" "+o.dataSources[1].latestImport.status')"
check "  Broken: no data, latest import failed DUPLICATE_IDS" "false failed DUPLICATE_IDS" "$(echo "$L" | json '.dataSources[0].hasData+" "+o.dataSources[0].latestImport.status+" "+o.dataSources[0].latestImport.errorCode')"
check "  no internal fields (organizationId, activeGeneration, tempPath)" "undefined undefined undefined" "$(echo "$L" | json '.dataSources[1].organizationId+" "+o.dataSources[1].activeGeneration+" "+o.dataSources[1].latestImport.tempPath')"
G=$(get a "/$DS1")
check "get one → 200, same data source" "200 Products sku [\"sku\",\"name\",\"price\"]" "$(code) $(echo "$G" | json '.dataSource.name+" "+o.dataSource.idColumn+" "+JSON.stringify(o.dataSource.columns)')"
check "  Cache-Control: no-store" yes "$(grep -qi '^cache-control: no-store' $T/headers && echo yes || echo no)"
reimport $DS1 $CSV/products-v2.csv > /dev/null; wait_import $DS1 $(cat $T/body | json .import.id) > /dev/null
check "import history: newest first" "replace,initial" "$(get a "/$DS1/imports" | json '.imports.map(i=>i.mode).join(",")')"
check "  latest import in get = the replace" "replace 1 1 3 1" "$(get a "/$DS1" | json '.dataSource.latestImport.mode+" "+o.dataSource.latestImport.inserted+" "+o.dataSource.latestImport.updated+" "+o.dataSource.latestImport.unchanged+" "+o.dataSource.latestImport.deleted')"

echo "B. Records: pages in file order"
reimport $DS1 $CSV/products-v1.csv > /dev/null; wait_import $DS1 $(cat $T/body | json .import.id) > /dev/null
R=$(recs $DS1 -d limit=2)
check "page 1 (limit 2) → P-1,P-2 · next afterPosition 2 · total 5" '200 P-1,P-2 {"afterPosition":2} 5' "$(code) $(echo "$R" | ids) $(echo "$R" | json .next) $(echo "$R" | json .total)"
check "  values follow the columns (id in its own column)" '["sku","name","price"] ["P-2","Two","20"]' "$(echo "$R" | json .columns) $(echo "$R" | json .records[1].values)"
R=$(recs $DS1 -d limit=2 -d afterPosition=2); check "page 2 → P-3,P-4" 'P-3,P-4 {"afterPosition":4}' "$(echo "$R" | ids) $(echo "$R" | json .next)"
R=$(recs $DS1 -d limit=2 -d afterPosition=4); check "last page → P-5 · next null" 'P-5 null' "$(echo "$R" | ids) $(echo "$R" | json .next)"
R=$(recs $DS1 -d afterPosition=5); check "after the end → empty page" '200 0 null' "$(code) $(echo "$R" | json .records.length) $(echo "$R" | json .next)"
R=$(recs $DS1); check "default limit (50) → all 5, next null" '5 null' "$(echo "$R" | json .records.length) $(echo "$R" | json .next)"
R=$(recs $DSF); check "data source without data → 200, no rows, total 0" '200 0 0' "$(code) $(echo "$R" | json .records.length) $(echo "$R" | json .total)"
for q in "limit=0" "limit=501" "limit=abc" "afterPosition=-1" "afterPosition=1.5" "afterId=P-1" "search=P&afterPosition=2" "search=%20%20%20"; do
  curl -s -o $T/body -w '%{http_code}' -b $T/a "$(DSURL)/$DS1/records?$q" > $T/code
  check "  bad query $q → 400 VALIDATION_ERROR" "400 VALIDATION_ERROR" "$(code) $(cat $T/body | json .error.code)"
done
reimport $DS1 $CSV/products-v3-new-column.csv -F mode=merge > /dev/null; wait_import $DS1 $(cat $T/body | json .import.id) > /dev/null
R=$(recs $DS1 --data-urlencode search=P-2)
check "after a merge that added 'badge': old rows show null for it" '["sku","name","price","badge"] ["P-2","Two","20",null]' "$(echo "$R" | json .columns) $(echo "$R" | json .records[0].values)"

echo "C. Records: search by id prefix (exact text, case-sensitive, sorted by id)"
DSS=$(new_ds $CSV/ids-special.csv Special)
s() { recs $DSS --data-urlencode "search=$1" "${@:2}" | ids; }
check "search A_ → only A_1 (_ is not a wildcard)" "A_1" "$(s 'A_')"
check "search A% → A%%,A%1 (% is not a wildcard)" "A%%,A%1" "$(s 'A%')"
check "search A%% → A%%" "A%%" "$(s 'A%%')"
check 'search A\ → A\1 (backslash is plain text)' 'A\1' "$(s 'A\')"
check "search a → a_1 only (case-sensitive)" "a_1" "$(s 'a')"
check "search '  A_  ' → spaces trimmed" "A_1" "$(s '  A_  ')"
check "search Z → nothing" "" "$(s 'Z')"
R=$(recs $DSS --data-urlencode search=A -d limit=2)
check "search A, page 1 (limit 2) → sorted by id · next afterId · total null" 'A%%,A%1 {"afterId":"A%1"} null' "$(echo "$R" | ids) $(echo "$R" | json .next) $(echo "$R" | json .total)"
R=$(recs $DSS --data-urlencode search=A -d limit=2 --data-urlencode 'afterId=A%1'); check "  page 2" 'AB1,A\1 {"afterId":"A\\1"}' "$(echo "$R" | ids) $(echo "$R" | json .next)"
R=$(recs $DSS --data-urlencode search=A -d limit=2 --data-urlencode 'afterId=A\1'); check "  page 3 (last)" 'A_1 null' "$(echo "$R" | ids) $(echo "$R" | json .next)"

echo "D. Download (small files)"
for f in quoted.csv unicode.csv tricky-columns.csv products-v1.csv good.csv ids-special.csv; do
  D=$(new_ds $CSV/$f "dl-$f"); download $D $T/out.csv > $T/code
  check "download = upload, byte for byte: $f" "200 same" "$(code) $(cmp -s $T/out.csv $CSV/$f && echo same || echo different)"
done
D=$(new_ds $CSV/bom-crlf.csv "dl-bom"); download $D $T/out.csv > /dev/null
check "BOM + CRLF file → clean UTF-8 with LF line ends" "$(printf 'sku,price\nA-1,10\nA-2,20\n')" "$(cat $T/out.csv)"
D=$(new_ds $CSV/empty-cells.csv "dl-empty"); download $D $T/out.csv > /dev/null
check "trimmed values, empty cell = empty, empty rows dropped" "$(printf 'sku,price,note\nE-1,10,\nE-2,,\nE-3,30,hi\n')" "$(cat $T/out.csv)"
D=$(new_ds $CSV/semicolon.csv "dl-semi"); download $D $T/out.csv > /dev/null
check "semicolon file → comma CSV (values with commas quoted)" "$(printf 'sku,price,currency\nS-1,"10,50",EUR\nS-2,"7,25",EUR\n')" "$(cat $T/out.csv)"
D=$(new_ds $CSV/products-v1.csv "Größen Liste"); get a "/$D/download" > /dev/null
check "headers: text/csv · attachment with UTF-8 file name · no-store" "200|text/csv; charset=utf-8|attachment; filename=\"Gr__en Liste.csv\"; filename*=UTF-8''Gr%C3%B6%C3%9Fen%20Liste.csv|no-store" "$(code)|$(grep -i '^content-type:' $T/headers | cut -d' ' -f2- | tr -d '\r')|$(grep -i '^content-disposition:' $T/headers | cut -d' ' -f2- | tr -d '\r')|$(grep -i '^cache-control:' $T/headers | cut -d' ' -f2- | tr -d '\r')"
check "download before any successful import → 409 NO_DATA_YET" "409 NO_DATA_YET" "$(get a "/$DSF/download" > /dev/null; code) $(cat $T/body | json .error.code)"
check "merged data source downloads its new column" "$(printf 'sku,name,price,badge\nP-5,Five,50,sale\nP-1,One,10,\nP-2,Two,20,\nP-3,Three,30,\nP-4,Four,40,\n')" "$(download $DS1 $T/out.csv > /dev/null; cat $T/out.csv)"

echo "E. Other brands' data → 404"
DSO=$(curl -s -b $T/b -X POST "$API/organizations/$SLUG_B/data-sources" -F "file=@$CSV/products-v1.csv" -F idColumn=sku | json .dataSource.id)
for p in "" "/$DS1" "/$DS1/imports" "/$DS1/records" "/$DS1/download"; do
  check "other account: GET …/data-sources$p of my brand → 404 ORGANIZATION_NOT_FOUND" "404 ORGANIZATION_NOT_FOUND" "$(get b "$p" > /dev/null; code) $(cat $T/body | json .error.code)"
done
check "other account: DELETE my data source → 404" 404 "$(del $DS1 b > /dev/null; code)"
for p in "/$DSO" "/$DSO/records" "/$DSO/download" "/$DSO/imports"; do
  check "me: the other brand's data source under MY brand ($p) → 404 DATA_SOURCE_NOT_FOUND" "404 DATA_SOURCE_NOT_FOUND" "$(get a "$p" > /dev/null; code) $(cat $T/body | json .error.code)"
done
check "me: DELETE the other brand's data source → 404, it still exists" "404 1" "$(del $DSO > /dev/null; code) $(sql "SELECT count(*) FROM data_sources WHERE id='$DSO'")"
check "logged out → 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' "$(DSURL)")"

echo "F. 500 000 rows: pages, search, download"
DSB=$(new_ds /tmp/products-500k.csv Big)
check "500 000 rows imported" 500000 "$(get a "/$DSB" | json .dataSource.rowCount)"
t() { curl -s -o $T/body -w '%{time_total}' -b $T/a -G "$(DSURL)/$DSB/records" "$@" | awk '{printf "%d", $1*1000}'; }
MS=$(t -d limit=50); R=$(cat $T/body)
check "page 1 → positions 1–50" "1 50 SKU-0000001 {\"afterPosition\":50}" "$(echo "$R" | json '.records[0].position+" "+o.records.at(-1).position+" "+o.records[0].id') $(echo "$R" | json .next)"
echo "     page 1: ${MS} ms"
MS=$(t -d limit=50 -d afterPosition=499950); R=$(cat $T/body)
check "last page (after 499 950) → 499 951–500 000, next null" "499951 500000 SKU-0500000 null" "$(echo "$R" | json '.records[0].position+" "+o.records.at(-1).position+" "+o.records.at(-1).id') $(echo "$R" | json .next)"
check "  as fast as page 1 (< 300 ms)" yes "$([ $MS -lt 300 ] && echo yes || echo "no: $MS ms")"
echo "     last page: ${MS} ms"
MS=$(t -d limit=500 -d afterPosition=250000); R=$(cat $T/body)
check "middle page (500 rows after 250 000)" "500 250001 250500" "$(echo "$R" | json '.records.length+" "+o.records[0].position+" "+o.records.at(-1).position')"
echo "     500-row page: ${MS} ms"
MS=$(t --data-urlencode search=SKU-04999); R=$(cat $T/body)
check "search SKU-04999 → 50 matches, first SKU-0499900" "50 SKU-0499900 SKU-0499949 {\"afterId\":\"SKU-0499949\"}" "$(echo "$R" | json '.records.length+" "+o.records[0].id+" "+o.records.at(-1).id') $(echo "$R" | json .next)"
check "  fast (< 300 ms)" yes "$([ $MS -lt 300 ] && echo yes || echo "no: $MS ms")"
echo "     search: ${MS} ms"
MS=$(t --data-urlencode search=SKU-049999); check "search SKU-049999 → 10 matches, next null" "10 null" "$(cat $T/body | json .records.length) $(cat $T/body | json .next)"
MS=$(t --data-urlencode search=NOPE); check "search with no match on 500 000 rows → 0, fast (< 300 ms)" "0 yes" "$(cat $T/body | json .records.length) $([ $MS -lt 300 ] && echo yes || echo "no: $MS ms")"
GEN=$(sql "SELECT active_generation FROM data_sources WHERE id='$DSB'")
check "search uses the id index (no full table scan)" "index" "$(sql "EXPLAIN SELECT position FROM records WHERE data_source_id='$DSB' AND generation=$GEN AND external_id LIKE 'SKU-04999%' ORDER BY external_id LIMIT 51" | grep -q 'records_data_source_id_generation_external_id_key' && echo index || echo scan)"
PID=$(lsof -tiTCP:${API_PORT:-$(echo $API | sed -E 's/.*:([0-9]+).*/\1/')} -sTCP:LISTEN | head -1)
RSS0=$(ps -o rss= -p $PID | tr -d ' ')
S=$(now_ms); C=$(download $DSB $T/big.csv); E=$(now_ms)
RSS1=$(ps -o rss= -p $PID | tr -d ' ')
check "download 500 000 rows → 200, byte for byte the uploaded file" "200 same" "$C $(cmp -s $T/big.csv /tmp/products-500k.csv && echo same || echo different)"
echo "     download: $((E-S)) ms, $(wc -c < $T/big.csv | tr -d ' ') bytes · server memory before/after: $((RSS0/1024)) / $((RSS1/1024)) MB"

echo "G. Reads during an import always see ONE complete version"
B=$(reimport $DSB /tmp/products-500k-eur.csv); IE=$(echo "$B" | json .import.id)
for i in $(seq 1 200); do [ "$(sql "SELECT processed_rows FROM data_imports WHERE id='$IE'")" -ge 200000 ] 2>/dev/null && break; sleep 0.05; done
check "during the import: records show the old version (USD)" "USD" "$(recs $DSB -d limit=1 | json '.records[0].values[3]')"
# A slow download (≈ 3 MB/s → ~9 s) that starts BEFORE the switch and ends AFTER it.
curl -s -o $T/slow.csv --limit-rate 3M -b $T/a "$(DSURL)/$DSB/download" & SLOW=$!
sleep 0.3; ST=$(sql "SELECT status FROM data_imports WHERE id='$IE'")
R=$(wait_import $DSB $IE); wait $SLOW
check "  the import finished WHILE the download was running" "running succeeded" "$ST $(echo "$R" | json .import.status)"
check "  that download = the complete OLD version (no mix)" same "$(cmp -s $T/slow.csv /tmp/products-500k.csv && echo same || echo different)"
check "  a new download = the complete NEW version" same "$(download $DSB $T/new.csv > /dev/null; cmp -s $T/new.csv /tmp/products-500k-eur.csv && echo same || echo different)"
check "  records now show EUR" "EUR" "$(recs $DSB -d limit=1 | json '.records[0].values[3]')"
# The old version is removed just AFTER "succeeded" (takes ~1–2 s): wait for it, up to 10 s.
for i in $(seq 1 50); do [ "$(sql "SELECT count(*) FROM records WHERE data_source_id='$DSB'")" == 500000 ] && break; sleep 0.2; done
check "  the old version's rows are removed shortly after" 500000 "$(sql "SELECT count(*) FROM records WHERE data_source_id='$DSB'")"

echo "H. Download limits + cancelled downloads"
for n in 1 2 3 4 5 6; do curl -s -o /dev/null -w '%{http_code}\n' --limit-rate 100k --max-time 3 -b $T/a "$(DSURL)/$DSB/download" >> $T/par & done; wait
check "6 slow downloads at once → 4 start (200), 2 × 429 TOO_MANY_DOWNLOADS" "4×200 2×429 " "$(sort $T/par | uniq -c | awk '{printf "%s×%s ", $1, $2}')"
sleep 1
check "  cancelled downloads gave their slots + DB connections back (no COPY still running)" 0 "$(sql "SELECT count(*) FROM pg_stat_activity WHERE query LIKE 'COPY (%' AND state <> 'idle'")"
check "  a new download works again, complete" "200 same" "$(download $DSB $T/again.csv) $(cmp -s $T/again.csv /tmp/products-500k-eur.csv && echo same || echo different)"
check "  429 answer is JSON with the error shape" "TOO_MANY_DOWNLOADS" "$(for n in 1 2 3 4; do curl -s -o /dev/null --limit-rate 50k --max-time 3 -b $T/a "$(DSURL)/$DSB/download" & done; sleep 0.5; curl -s -b $T/a "$(DSURL)/$DSB/download" | json .error.code; wait)"

echo "I. Delete"
DX=$(new_ds $CSV/products-v1.csv DeleteMe)
check "unused data source → 204" 204 "$(del $DX > /dev/null; code)"
check "  gone: get → 404, rows 0, imports 0" "404 0 0" "$(get a "/$DX" > /dev/null; code) $(sql "SELECT count(*) FROM records WHERE data_source_id='$DX'") $(sql "SELECT count(*) FROM data_imports WHERE data_source_id='$DX'")"
check "  delete again → 404" 404 "$(del $DX > /dev/null; code)"
check "data source whose first import failed → 204" 204 "$(del $DSF > /dev/null; code)"
add_api $DS1 "Product feed" product-feed; add_api $DS1 "Another feed" another-feed
check "list shows which APIs use it (by name)" '["Another feed","Product feed"]' "$(get a "/$DS1" | json '.dataSource.usedBy.map(a=>a.name)')"
B=$(del $DS1)
check "used by APIs → 409 DATA_SOURCE_IN_USE naming them" "409 DATA_SOURCE_IN_USE This data is used by \"Another feed\", \"Product feed\". Delete those APIs or switch them to other data first." "$(code) $(echo "$B" | json .error.code) $(echo "$B" | json .error.message)"
check "  nothing deleted (rows still there)" 5 "$(sql "SELECT row_count FROM data_sources WHERE id='$DS1'")"
sql "DELETE FROM apis WHERE data_source_id='$DS1'" > /dev/null
# Race: an API is being created (transaction not committed yet) while the delete runs.
DR=$(new_ds $CSV/products-v1.csv Racy)
psql "$DB" -qtAc "BEGIN; INSERT INTO apis (id, organization_id, data_source_id, name, slug, updated_at) SELECT 'api-race-$RANDOM', organization_id, id, 'Late API', 'late-api', now() FROM data_sources WHERE id='$DR'; SELECT pg_sleep(2); COMMIT;" > /dev/null & TX=$!
sleep 0.5; S=$(now_ms); B=$(del $DR); E=$(now_ms); wait $TX
check "API created at the same moment → delete waits for it, then 409 DATA_SOURCE_IN_USE" "409 DATA_SOURCE_IN_USE \"Late API\"" "$(code) $(echo "$B" | json .error.code) $(echo "$B" | json '.error.message.match(/"[^"]+"/)[0]')"
echo "     delete waited $((E-S)) ms for the other transaction"
check "  data source still there with its rows" "1 5" "$(sql "SELECT count(*) FROM data_sources WHERE id='$DR'") $(sql "SELECT count(*) FROM records WHERE data_source_id='$DR'")"
sql "DELETE FROM apis WHERE data_source_id='$DR'" > /dev/null
B=$(reimport $DSB /tmp/products-500k.csv); IR=$(echo "$B" | json .import.id)
B=$(del $DSB); check "import running → 409 IMPORT_IN_PROGRESS" "409 IMPORT_IN_PROGRESS" "$(code) $(echo "$B" | json .error.code)"
R=$(wait_import $DSB $IR); check "  the import was not disturbed: succeeded, 500 000 rows" "succeeded 500000" "$(echo "$R" | json .import.status) $(get a "/$DSB" | json .dataSource.rowCount)"
# Right after "succeeded" the import is still deleting the OLD version's 500 000 rows (~1–2 s).
# Deleting now used to deadlock (500, P2034); now the delete waits for that clean-up.
check "  right after it: the old version is still being removed" yes "$([ "$(sql "SELECT count(*) FROM records WHERE data_source_id='$DSB'")" -gt 500000 ] && echo yes || echo "no (clean-up already done: this run can't show the race)")"
S=$(now_ms); del $DSB > /dev/null; E=$(now_ms)
check "delete the 500 000-row data source during that clean-up → 204 (no deadlock), every row removed" "204 0" "$(code) $(sql "SELECT count(*) FROM records WHERE data_source_id='$DSB'")"
echo "     delete of the data source (500 000 + old version's rows): $((E-S)) ms"
DP=$(new_ds $CSV/products-v1.csv Parallel)
R=$( (for n in $(seq 1 10); do curl -s -o /dev/null -w '%{http_code}\n' -b $T/a -X DELETE "$(DSURL)/$DP" & done; wait) | sort | uniq -c | awk '{printf "%s×%s ", $1, $2}')
check "10 parallel deletes → 1 × 204 + 9 × 404" "1×204 9×404 " "$R"
# Race: delete and a new upload at the same moment. Either may win; the end state must be clean.
DQ=$(new_ds $CSV/products-v1.csv Quarrel)
curl -s -o /dev/null -w '%{http_code}' -b $T/a -X POST "$(DSURL)/$DQ/imports" -F "file=@$CSV/products-v2.csv" > $T/c1 &
curl -s -o /dev/null -w '%{http_code}' -b $T/a -X DELETE "$(DSURL)/$DQ" > $T/c2 &
wait; sleep 1
EXISTS=$(sql "SELECT count(*) FROM data_sources WHERE id='$DQ'")
if [ "$EXISTS" == "0" ]; then STATE="deleted, rows $(sql "SELECT count(*) FROM records WHERE data_source_id='$DQ'"), imports $(sql "SELECT count(*) FROM data_imports WHERE data_source_id='$DQ'")"; EXP="deleted, rows 0, imports 0"
else STATE="kept, rows $(sql "SELECT count(*) FROM records WHERE data_source_id='$DQ'")"; EXP="kept, rows 5"; fi
check "delete + upload at the same moment → clean end state (upload $(cat $T/c1), delete $(cat $T/c2))" "$EXP" "$STATE"

echo "J. Clean-up"
UPLOAD_DIR="${UPLOAD_DIR:-$(node -e "console.log(require('path').join(require('os').tmpdir(),'api-platform-uploads'))")}"
check "upload folder empty (every upload's file removed)" 0 "$(ls "$UPLOAD_DIR" | wc -l | tr -d ' ')"
check "no rows outside the live generations" 0 "$(sql "SELECT count(*) FROM records r JOIN data_sources ds ON ds.id=r.data_source_id JOIN organizations o ON o.id=ds.organization_id WHERE o.slug='$SLUG' AND r.generation IS DISTINCT FROM ds.active_generation")"

psql "$DB" -qtAc "DELETE FROM users WHERE email IN ('$EMAIL','other-$EMAIL')" >/dev/null
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
