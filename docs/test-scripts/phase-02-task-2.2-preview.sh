#!/bin/bash
# Task 2.2 scenario tests: source connectors, CSV connector, uploads, preview endpoint.
#
# Usage (backend running with `npm run dev`), from any folder:
#   DB_URL="postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_mine" \
#   bash docs/test-scripts/phase-02-task-2.2-preview.sh
#
# Creates its own test user + brand and deletes ONLY that user at the end.
# Needs the big files (generated once, ~290 MB in /tmp):
#   python3 docs/test-data/generate-big-csv.py 500000  /tmp/products-500k.csv
#   python3 docs/test-data/generate-big-csv.py 1100000 /tmp/products-1.1m.csv
#   python3 -c "f=open('/tmp/too-big.csv','w');f.write('sku,blob\n');[f.write('X,'+'a'*1000+'\n') for _ in range(215000)]"
API="${API:-localhost:4000/api}"   # e.g. API=localhost:4001/api for a copy on port 4001
DB="${DB_URL:-postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev}"
# Test CSVs: found relative to THIS script (docs/test-scripts → docs/test-data/csv), so the
# script works from any folder. Override with CSV_DIR=/path/to/csv if your layout differs.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV="${CSV_DIR:-$SCRIPT_DIR/../test-data/csv}"
if [ ! -f "$CSV/good.csv" ]; then
  echo "Can't find the test CSVs in: $CSV"
  echo "Run from the project folder, or set CSV_DIR, e.g.:  CSV_DIR=docs/test-data/csv bash $0"
  exit 1
fi
curl -s -o /dev/null --max-time 3 "$API/health" || {
  echo "Backend not reachable at $API: start it first (npm run dev in backend/), or set API=host:port/api"; exit 1; }
for f in /tmp/products-500k.csv /tmp/products-1.1m.csv /tmp/too-big.csv; do
  [ -f "$f" ] || { echo "Missing $f: generate the big files first (see the top of this script)"; exit 1; }
done
UPLOAD_DIR="${UPLOAD_DIR:-$(node -e "console.log(require('path').join(require('os').tmpdir(),'api-platform-uploads'))")}"
H='content-type: application/json'
T=$(mktemp -d); PASS=0; FAIL=0
check() { if [ "$2" == "$3" ]; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1  (expected: $2, got: $3)"; fi; }
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);const v=eval('o'+process.argv[1]);console.log(typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('JSON-ERROR')}})" "$1"; }
# preview FILE [extra curl args...] → body; HTTP code in $T/code
preview() { local f="$1"; shift; curl -s -o $T/body -w '%{http_code}' -b $T/jar -X POST "$API/organizations/$SLUG/data-sources/preview" -F "file=@$f" "$@" > $T/code; cat $T/body; }
code() { cat $T/code; }
temp_files() { ls "$UPLOAD_DIR" 2>/dev/null | wc -l | tr -d ' '; }

EMAIL="preview-$RANDOM$RANDOM@test.com"
curl -s -o /dev/null -c $T/jar -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
SLUG=$(curl -s -b $T/jar -X POST $API/organizations -H "$H" -d '{"name":"Preview Test","slug":"preview-test"}' | json .organization.slug)
curl -s -o /dev/null -c $T/other -X POST $API/auth/signup -H "$H" -d "{\"email\":\"other-$EMAIL\",\"password\":\"password123\"}"
echo "test brand: $SLUG   upload dir: $UPLOAD_DIR"

echo "A. Happy path (good.csv: 7 columns, 12 rows)"
B=$(preview $CSV/good.csv)
check "200" 200 "$(code)"
check "columns in file order" '["sku","name","price","currency","in_stock","color","category"]' "$(echo "$B" | json '.preview.columns')"
check "values kept as text exactly as written (no type guessing)" '["SKU-1001","Product 1","20.99","USD","true","blue","apparel"]' "$(echo "$B" | json .preview.sampleRows[0].values)"
check "exact total rows 12" 12 "$(echo "$B" | json .preview.totalRows)"
check "10 sample rows" 10 "$(echo "$B" | json .preview.sampleRows.length)"
check "first sample row = spreadsheet row 2" 2 "$(echo "$B" | json .preview.sampleRows[0].rowNumber)"
check "suggested id column: sku" sku "$(echo "$B" | json .preview.suggestedIdColumn)"
check "no problems" 0 "$(echo "$B" | json .preview.problems.length)"
check "kind csv, file name kept" "csv good.csv" "$(echo "$B" | json '.preview.kind+" "+o.preview.fileName')"

echo "B. Tricky but valid files"
B=$(preview $CSV/bom-crlf.csv)
check "BOM removed from first header" '"sku"' "$(echo "$B" | json '.preview.columns[0]' | sed 's/^/"/;s/$/"/')"
check "Windows line endings: 2 rows, no \\r in values" '["A-1","10"]' "$(echo "$B" | json .preview.sampleRows[0].values)"
B=$(preview $CSV/quoted.csv)
check "quoted comma kept in value" "Shoes, red" "$(echo "$B" | json .preview.sampleRows[0].values[1])"
check "doubled quotes → one quote" 'He said "wow"' "$(echo "$B" | json .preview.sampleRows[0].values[2])"
check "line break inside a quoted cell kept" 'line one|line two' "$(echo "$B" | json '.preview.sampleRows[1].values[2].replace("\n","|")')"
check "row numbers count records, not text lines (Q-3 is row 4)" 4 "$(echo "$B" | json .preview.sampleRows[2].rowNumber)"
B=$(preview $CSV/unicode.csv)
check "unicode values intact" "Café Ünïcode|जूते|Sneakers 👟" "$(echo "$B" | json '.preview.sampleRows.map(r=>r.values[1]).join("|")')"
B=$(preview "$CSV/prodüct-हिंदी.csv")
check "unicode file name intact" "prodüct-हिंदी.csv" "$(echo "$B" | json .preview.fileName)"
B=$(preview $CSV/semicolon.csv)
check "semicolon delimiter detected" '["sku","price","currency"]' "$(echo "$B" | json '.preview.columns')"
check "decimal comma stays text as written" "10,50" "$(echo "$B" | json .preview.sampleRows[0].values[1])"
B=$(preview $CSV/tab.csv)
check "tab delimiter detected" '["sku","price"]' "$(echo "$B" | json '.preview.columns')"
B=$(preview $CSV/empty-cells.csv)
check "spaces trimmed, empty cells → null" '["E-1","10",null]' "$(echo "$B" | json .preview.sampleRows[0].values)"
check "all-empty row and empty line skipped (3 rows)" 3 "$(echo "$B" | json .preview.totalRows)"
B=$(preview $CSV/id-candidates.csv)
check "id candidates: item_id first, name also unique; code (duplicate) and ref (empty cell) excluded" '["item_id","name"]' "$(echo "$B" | json .preview.idCandidates)"

echo "C. Problems inside the data (200, listed with row numbers)"
B=$(preview $CSV/ragged.csv)
check "ragged rows → 200" 200 "$(code)"
check "rows 3 and 4 reported" "Row 3 has 3 values, but the header has 2 columns|Row 4 has 1 value, but the header has 2 columns" "$(echo "$B" | json '.preview.problems.map(p=>p.message).join("|")')"
B=$(preview $CSV/unclosed-quote.csv)
check "unclosed quote reported with its row" 'Row 4: a quote (") is opened but never closed' "$(echo "$B" | json .preview.problems[0].message)"

echo "D. Files that are rejected"
B=$(preview $CSV/duplicate-headers.csv); check "duplicate header (case-insensitive) → 400" "400 SOURCE_INVALID" "$(code) $(echo "$B" | json .error.code)"
check "  message names both columns" 'Column "price" appears twice (columns 2 and 3)' "$(echo "$B" | json .error.details[0].message)"
B=$(preview $CSV/empty-header-name.csv); check "unnamed column → 400" "400 Column 2 has no name" "$(code) $(echo "$B" | json .error.details[0].message)"
B=$(preview $CSV/header-only.csv); check "header only → 400" "400 The file has a header row but no data rows" "$(code) $(echo "$B" | json .error.message)"
B=$(preview $CSV/empty.csv); check "empty file → 400" "400 The file is empty" "$(code) $(echo "$B" | json .error.message)"
B=$(preview $CSV/whitespace-only.csv); check "whitespace-only file → 400" "400 The file is empty" "$(code) $(echo "$B" | json .error.message)"
B=$(preview $CSV/image-renamed.csv); check "PNG renamed to .csv → 415" "415 UNSUPPORTED_FILE" "$(code) $(echo "$B" | json .error.code)"
B=$(preview $CSV/products.xlsx); check ".xlsx → 415" "415 UNSUPPORTED_FILE" "$(code) $(echo "$B" | json .error.code)"
B=$(preview $CSV/products.txt); check ".txt → 415" "415" "$(code)"
B=$(preview $CSV/latin1-header.csv); check "not UTF-8 (header) → 400" "400" "$(code)"
B=$(preview $CSV/latin1.csv); check "not UTF-8 (row 2) → problem listed" "Row 2: contains characters that aren't UTF-8. Save the file as \"CSV UTF-8\"." "$(echo "$B" | json .preview.problems[0].message)"
B=$(preview $CSV/too-many-columns.csv); check "201 columns → 400" "400 The file has 201 columns; the limit is 200" "$(code) $(echo "$B" | json .error.details[0].message)"
B=$(preview $CSV/good.csv -F kind=json); check "unknown source kind → 400 UNSUPPORTED_SOURCE" "400 UNSUPPORTED_SOURCE" "$(code) $(echo "$B" | json .error.code)"

echo "E. Bad requests"
curl -s -o $T/body -w '%{http_code}' -b $T/jar -X POST "$API/organizations/$SLUG/data-sources/preview" > $T/code
check "no file → 400 FILE_REQUIRED" "400 FILE_REQUIRED" "$(code) $(cat $T/body | json .error.code)"
curl -s -o $T/body -w '%{http_code}' -b $T/jar -X POST "$API/organizations/$SLUG/data-sources/preview" -F "file=@$CSV/good.csv" -F "file=@$CSV/tab.csv" > $T/code
check "two files → 400 UPLOAD_INVALID" "400 UPLOAD_INVALID" "$(code) $(cat $T/body | json .error.code)"
curl -s -o $T/body -w '%{http_code}' -b $T/jar -X POST "$API/organizations/$SLUG/data-sources/preview" -F "data=@$CSV/good.csv" > $T/code
check "wrong field name → 400 UPLOAD_INVALID" "400 UPLOAD_INVALID" "$(code) $(cat $T/body | json .error.code)"

echo "F. Access control (and no file written to disk for strangers)"
BEFORE=$(temp_files)
check "no cookie → 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/organizations/$SLUG/data-sources/preview" -F "file=@/tmp/products-500k.csv")"
check "other account → 404 (brand not theirs)" 404 "$(curl -s -o /dev/null -w '%{http_code}' -b $T/other -X POST "$API/organizations/$SLUG/data-sources/preview" -F "file=@/tmp/products-500k.csv")"
check "no temp file created by rejected uploads" "$BEFORE" "$(temp_files)"

echo "G. Big files"
S=$(perl -MTime::HiRes=time -e 'print time'); B=$(preview /tmp/products-500k.csv); E=$(perl -MTime::HiRes=time -e 'print time')
check "500 000 rows (26 MB) → 200" 200 "$(code)"
check "  only 1 000 rows scanned" 1000 "$(echo "$B" | json .preview.rowsScanned)"
check "  totalRows null (not read to the end)" null "$(echo "$B" | json .preview.totalRows)"
EST=$(echo "$B" | json .preview.estimatedTotalRows)
check "  estimated rows within 10% of 500 000" yes "$([ "$EST" -gt 450000 ] && [ "$EST" -lt 550000 ] && echo yes || echo "no ($EST)")"
echo "     estimate: $EST rows · upload + preview took $(perl -e "printf '%.0f', ($E-$S)*1000") ms"
B=$(preview /tmp/products-1.1m.csv)
check "1 100 000 rows → 200 with a 'limit is 1,000,000' problem" yes "$(echo "$B" | json '.preview.problems.some(p=>p.message.includes("the limit is 1,000,000"))' | sed 's/true/yes/')"
B=$(preview /tmp/too-big.csv); check "206 MB file → 413 FILE_TOO_LARGE" "413 FILE_TOO_LARGE" "$(code) $(echo "$B" | json .error.code)"

echo "H. Concurrency: 20 previews of the 500 000-row file at once"
R=$(for i in $(seq 1 20); do curl -s -o /dev/null -w '%{http_code}\n' -b $T/jar -X POST "$API/organizations/$SLUG/data-sources/preview" -F "file=@/tmp/products-500k.csv" & done; wait)
check "20 × 200" 20 "$(echo "$R" | grep -c 200)"

echo "I. Clean-up"
sleep 1
check "upload folder is empty again (every temp file deleted)" 0 "$(temp_files)"

psql "$DB" -qtAc "DELETE FROM users WHERE email IN ('$EMAIL','other-$EMAIL')" >/dev/null
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
