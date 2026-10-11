#!/bin/bash
# Task 3.3 scenario tests: type detection (GET /design/columns) + "can't convert" counts
# (POST /design/check-values) + the same conversion rules in JavaScript and in Postgres.
#
# Usage (backend running with `npm run dev`), from any folder:
#   DB_URL="postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_mine" \
#   API=localhost:4001/api bash docs/test-scripts/phase-03-task-3.3-value-types.sh
#
# Creates its own test users and deletes ONLY them at the end.
API="${API:-localhost:4000/api}"
DB="${DB_URL:-postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV="$SCRIPT_DIR/../test-data/csv"
BACKEND="$SCRIPT_DIR/../../backend"
H='content-type: application/json'
[ -f "$CSV/value-types.csv" ] || { echo "Can't find the test CSVs in $CSV"; exit 1; }
curl -s -o /dev/null --max-time 3 "$API/health" || { echo "Backend not reachable at $API"; exit 1; }

T=$(mktemp -d); PASS=0; FAIL=0
check() { if [ "$2" == "$3" ]; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1  (expected: $2, got: $3)"; fi; }
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);const v=eval('o'+process.argv[1]);console.log(typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('JSON-ERROR')}})" "$1"; }
code() { cat $T/code; }
call() { local jar=$1 m=$2 p=$3 d=$4; if [ -n "$d" ]; then curl -s -o $T/body -w '%{http_code}' -b $T/$jar -X $m "$API/organizations/$p" -H "$H" -d "$d" > $T/code; else curl -s -o $T/body -w '%{http_code}' -b $T/$jar -X $m "$API/organizations/$p" > $T/code; fi; cat $T/body; }
new_ds() {
  local B ds imp; B=$(curl -s -b $T/$1 -X POST "$API/organizations/$2/data-sources" -F "file=@$3" -F "idColumn=$5" -F "name=$4")
  ds=$(echo "$B" | json .dataSource.id); imp=$(echo "$B" | json .import.id)
  for i in $(seq 1 100); do st=$(curl -s -b $T/$1 "$API/organizations/$2/data-sources/$ds/imports/$imp" | json .import.status); [ "$st" == succeeded ] || [ "$st" == failed ] && break; sleep 0.1; done
  echo "$ds"
}
# col NAME EXPR → EXPR on the column NAME of the last GET /design/columns answer
col() { cat $T/cols | json ".columns.find(c=>c.name==='$1')$2"; }
# chk 'FIELDS_JSON' → POST check-values; body in $T/body
chk() { call a POST "$S/apis/$A/design/check-values" "{\"fields\":$1}" > /dev/null; }

EMAIL="types-$RANDOM$RANDOM@test.com"
curl -s -o /dev/null -c $T/a -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
curl -s -o /dev/null -c $T/b -X POST $API/auth/signup -H "$H" -d "{\"email\":\"other-$EMAIL\",\"password\":\"password123\"}"
S=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"Types Test","slug":"types-test"}' | json .organization.slug)
DS=$(new_ds a "$S" "$CSV/value-types.csv" "Value types" sku)
DS_SMALL=$(new_ds a "$S" "$CSV/products-v1.csv" "Small" sku)
A=typed
call a POST "$S/apis" "{\"name\":\"Typed\",\"slug\":\"$A\",\"dataSourceId\":\"$DS\"}" > /dev/null

echo "A. Access"
check "logged out → 401 (columns, check-values)" "401 401" "$(curl -s -o /dev/null -w '%{http_code}' "$API/organizations/$S/apis/$A/design/columns") $(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/organizations/$S/apis/$A/design/check-values")"
check "another user → 404 (columns, check-values)" "404 404" "$(call b GET "$S/apis/$A/design/columns" > /dev/null; code) $(call b POST "$S/apis/$A/design/check-values" '{"fields":[{"sourceColumn":"price","type":"float"}]}' > /dev/null; code)"

echo "B. Type detection (value-types.csv: 21 rows)"
call a GET "$S/apis/$A/design/columns" > $T/cols
check "200, 21 rows sampled, 9 columns in file order" "200 21 sku,price,qty,flag01,active,img,note,blank,mixed" "$(code) $(cat $T/cols | json .sampledRows) $(cat $T/cols | json '.columns.map(c=>c.name).join()')"
check "sku (the id): isId, string only" "true string" "$(col sku .isId) $(col sku '.candidates.join()')"
check "price (20 decimals + one 'abc'): float suggested (95% fit), fits.float 20" "float float,string 20" "$(col price .suggestedType) $(col price '.candidates.join()') $(col price .fits.float)"
check "qty (whole numbers): int, float, string" "int int,float,string" "$(col qty .suggestedType) $(col qty '.candidates.join()')"
check "flag01 (only 1 / 0): int first, boolean still possible" "int int,float,boolean,string" "$(col flag01 .suggestedType) $(col flag01 '.candidates.join()')"
check "active (yes / No / TRUE): boolean first" "boolean boolean,string" "$(col active .suggestedType) $(col active '.candidates.join()')"
check "img (20 URLs incl. HTTPS://CDN… upper case + one 'logo.png'): image" "image image,string 20" "$(col img .suggestedType) $(col img '.candidates.join()') $(col img .fits.image)"
check "note (text): string" "string string" "$(col note .suggestedType) $(col note '.candidates.join()')"
check "blank (every cell empty): no suggestion (the Jivox hint decides), 0 filled, 21 empty" "null 0 21" "$(col blank .suggestedType) $(col blank '.candidates.length') $(col blank .empty)"
check "mixed (half numbers, half text): string" "string string" "$(col mixed .suggestedType) $(col mixed '.candidates.join()')"
check "examples: first 3 distinct values in file order" '["1.50","3.00","4.50"]' "$(col price .examples)"
check "  blank column → no examples" '[]' "$(col blank .examples)"

echo "C. Can't-convert counts (every row)"
chk '[{"sourceColumn":"price","type":"float"},{"sourceColumn":"price","type":"int"},{"sourceColumn":"img","type":"image"},{"sourceColumn":"active","type":"boolean"},{"sourceColumn":"note","type":"string"},{"sourceColumn":"blank","type":"int"},{"sourceColumn":"sku","type":"int"}]'
check "200, rows 21, answers in the order asked" "200 21 price/float,price/int,img/image,active/boolean,note/string,blank/int,sku/int" "$(code) $(cat $T/body | json .rows) $(cat $T/body | json '.fields.map(f=>f.sourceColumn+"/"+f.type).join()')"
check "price as float: 1 can't convert = row 7, id V-7, value abc" '1 [{"row":7,"id":"V-7","value":"abc"}]' "$(cat $T/body | json .fields[0].cantConvert) $(cat $T/body | json .fields[0].examples)"
check "price as int: 11 can't (decimals + abc), first 5 shown, rows in file order" "11 5 1,3,5,7,9" "$(cat $T/body | json .fields[1].cantConvert) $(cat $T/body | json .fields[1].examples.length) $(cat $T/body | json '.fields[1].examples.map(e=>e.row).join()')"
check "img as image: 1 (logo.png, row 9)" "1 9 logo.png" "$(cat $T/body | json .fields[2].cantConvert) $(cat $T/body | json .fields[2].examples[0].row) $(cat $T/body | json .fields[2].examples[0].value)"
check "active as boolean: 0" 0 "$(cat $T/body | json .fields[3].cantConvert)"
check "note as string: never can't-convert" "0 []" "$(cat $T/body | json .fields[4].cantConvert) $(cat $T/body | json .fields[4].examples)"
check "blank as int: 21 empty, 0 can't (empty ≠ wrong)" "21 0" "$(cat $T/body | json .fields[5].empty) $(cat $T/body | json .fields[5].cantConvert)"
check "the id column (sku) works too: 21 can't be int" "21 V-1" "$(cat $T/body | json .fields[6].cantConvert) $(cat $T/body | json .fields[6].examples[0].value)"
chk '[{"sourceColumn":"price","type":"float"},{"sourceColumn":"price","type":"float"}]'
check "same column + type twice → same answer twice" "1 1" "$(cat $T/body | json .fields[0].cantConvert) $(cat $T/body | json .fields[1].cantConvert)"
chk '[{"sourceColumn":"nope","type":"float"},{"sourceColumn":"Price","type":"float"}]'
check "unknown columns (names are exact) → 400 listing both" "400 fields.0.sourceColumn fields.1.sourceColumn" "$(code) $(cat $T/body | json '.error.details.map(d=>d.field).join(" ")')"
check "bad bodies: no fields / empty list / bad type → 400" "400 400 400" "$(chk 'null'; code) $(chk '[]'; code) $(chk '[{"sourceColumn":"price","type":"number"}]'; code)"
check "201 fields → 400" 400 "$(chk "[$(node -e 'console.log(Array(201).fill(JSON.stringify({sourceColumn:"price",type:"float"})).join())')]"; code)"

echo "D. Follows the API's CURRENT data"
call a PATCH "$S/apis/$A" "{\"dataSourceId\":\"$DS_SMALL\"}" > /dev/null
call a GET "$S/apis/$A/design/columns" > $T/cols
check "switched to products-v1 (sku,name,price): its columns, price → int (10, 20)" "sku,name,price int" "$(cat $T/cols | json '.columns.map(c=>c.name).join()') $(col price .suggestedType)"
chk '[{"sourceColumn":"img","type":"image"}]'
check "  a column of the OLD data → 400" 400 "$(code)"
call a PATCH "$S/apis/$A" "{\"dataSourceId\":\"$DS\"}" > /dev/null

echo "E. The same rules in JavaScript (answers, defaults) and in Postgres (counts)"
# Every tricky value through convertValue() (JS) AND the SQL rule; the verdicts must be equal.
cat > $T/values.json <<'EOF'
["12","-3","+5","4.0","4.50","007","1,234","1e3","1E-2","1e999","1e99",".5","5.","-.5","12 €","١٢","0x1F","NaN","Infinity","",
 "123456789012345","1234567890123456","true","TRUE","Yes","no","0","1","on","y",
 "https://cdn.example.com/a.png","HTTPS://CDN.EXAMPLE.COM/A.PNG","http://a.b/x y","https://a.b/x y","http://","https:///x","ftp://a.b/c.png","//cdn.example.com/a.png","https://a.b?x=1","https://a.b#top","logo.png"]
EOF
VERDICT_JS=$(cd "$BACKEND" && npx tsx -e "
import { convertValue } from './src/modules/apis/design/convert.ts';
const values = JSON.parse(require('fs').readFileSync('$T/values.json','utf8')).filter(v => v !== '');
const types = ['int','float','boolean','image'];
console.log(types.map(t => values.map(v => convertValue(t, v).ok ? 1 : 0).join('')).join(' '));
" 2>&1)
VERDICT_SQL=$(cd "$BACKEND" && npx tsx -e "
import { PATTERNS, BOOLEAN_WORDS } from './src/modules/apis/design/convert.ts';
import pg from 'pg';
const values = JSON.parse(require('fs').readFileSync('$T/values.json','utf8')).filter(v => v !== '');
(async () => {
const c = new pg.Client({ connectionString: '$DB' }); await c.connect();
const q = (sql, p) => c.query('SELECT string_agg(CASE WHEN ' + sql + \" THEN '1' ELSE '0' END, '' ORDER BY i) AS r FROM unnest(\$1::text[]) WITH ORDINALITY AS t(v, i)\", [values, ...p]).then(r => r.rows[0].r);
const out = [await q('v ~ \$2', [PATTERNS.int]), await q('v ~ \$2', [PATTERNS.float]), await q('lower(v) = ANY(\$2)', [BOOLEAN_WORDS]), await q('v ~* \$2', [PATTERNS.image])];
console.log(out.join(' ')); await c.end();
})();
" 2>&1)
check "int / float / boolean / image verdicts identical on 40 tricky values" "$VERDICT_JS" "$VERDICT_SQL"
# Expected verdicts, worked out by hand from the rules (1 = can be sent as that type), in the order of values.json:
check "  int:   12 -3 +5 4.0 007, 15 digits, 0, 1 ✔ · 4.50 1,234 1e3 ١٢ 16 digits ✘" "1111010000000000000100000110000000000000" "$(echo $VERDICT_JS | cut -d' ' -f1)"
check "  float: + decimals, 1e3 1E-2 1e99 .5 5. -.5 ✔ · 1,234 1e999 12 € ١٢ 0x1F NaN Infinity ✘" "1111110110111100000110000110000000000000" "$(echo $VERDICT_JS | cut -d' ' -f2)"
check "  boolean: true TRUE Yes no 0 1 ✔ · on y ✘" "0000000000000000000001111110000000000000" "$(echo $VERDICT_JS | cut -d' ' -f3)"
check "  image: http(s) + host, any case, ?query #hash, inner no-break space ✔ · space, no host, ftp, // ✘" "0000000000000000000000000000011010000110" "$(echo $VERDICT_JS | cut -d' ' -f4)"

echo "F. Busy limit: more full checks at once than VALUE_CHECK_CONCURRENCY (4) → 429"
# On tiny data most finish before the next starts; the real overlap test is the by-hand 500k run
# in the phase doc. Here: a burst never breaks anything.
for i in $(seq 1 12); do curl -s -o /dev/null -w '%{http_code}\n' -b $T/a -X POST "$API/organizations/$S/apis/$A/design/check-values" -H "$H" -d '{"fields":[{"sourceColumn":"price","type":"float"}]}' >> $T/burst & done; wait
check "12 at once on tiny data: every answer is 200 or 429, never 500" "0" "$(grep -Evc '^(200|429)$' $T/burst)"

psql "$DB" -qtAc "DELETE FROM users WHERE email IN ('$EMAIL','other-$EMAIL')" >/dev/null
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
