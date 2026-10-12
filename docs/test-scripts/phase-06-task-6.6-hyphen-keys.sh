#!/bin/bash
# Task 6.6 fix: response keys Jivox can read. Jivox's first real answer on qa3 (2026-10-12) refused a
# contract with BAD_DOCUMENT: "'$.data[*].sub-category' does not match '^\$\.data\[\*\]\.[A-Za-z0-9_]+$'".
# Our design allowed (and suggested) "-" in keys. Now:
#   a new key with "-" can't be saved or previewed · a design saved earlier with one shows a problem on
#   the Design tab while /v1 keeps answering · the checklist's "Follows contract/1" turns ✗ naming the key
#   (fix: Design tab) · the fake Jivox refuses it exactly like Jivox and our hint points to the Design tab
#   · renamed to "_" → ✓ and verified · suggested keys turn "-" into "_".
# Usage (backend running with `npm run dev`), from the project folder:
#   DB_URL="$(grep -o 'postgresql://[^"]*' backend/.env)" API=localhost:4001/api bash docs/test-scripts/phase-06-task-6.6-hyphen-keys.sh
API="${API:-localhost:4000/api}"
DB="${DB_URL:-postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV="$SCRIPT_DIR/../test-data/csv"
FAKE_PORT="${FAKE_PORT:-4805}"
H='content-type: application/json'
curl -s -o /dev/null --max-time 3 "$API/health" || { echo "Backend not reachable at $API"; exit 1; }
lsof -nP -iTCP:$FAKE_PORT -sTCP:LISTEN >/dev/null && { echo "Port $FAKE_PORT is busy: set FAKE_PORT"; exit 1; }

T=$(mktemp -d); PASS=0; FAIL=0
check() { if [ "$2" == "$3" ]; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1  (expected: $2, got: $3)"; fi; }
ex() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);const v=eval(process.argv[1]);console.log(typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('JSON-ERROR')}})" "$1"; }
b() { ex "$1" < $T/body; }
code() { cat $T/code; }
req() { if [ -n "$3" ]; then curl -s -o $T/body -w '%{http_code}' -b $T/a -X $1 "$API/organizations/$S/$2" -H "$H" -d @"$3" > $T/code; else curl -s -o $T/body -w '%{http_code}' -b $T/a -X $1 "$API/organizations/$S/$2" > $T/code; fi; }
json() { printf '%s' "$2" > "$1"; }
version() { curl -s -b $T/a "$API/organizations/$S/apis/$P/design" | ex 'o.design.version'; }
# design KEY → a design whose sub_category field answers under KEY
design() { json $T/d.json "{\"version\":$(version),\"idField\":{\"responseKey\":\"id\"},\"fields\":[{\"jivoxColumn\":\"sub_title\",\"sourceColumn\":\"Product Name\",\"responseKey\":\"sub\",\"type\":\"string\"},{\"jivoxColumn\":\"sub_category\",\"sourceColumn\":\"category\",\"responseKey\":\"$1\",\"type\":\"string\"}],\"request\":{\"method\":\"GET\",\"query\":{\"ids\":\"{item_id}\"},\"maxIdsPerCall\":25}}"; }

export MCP_KEY="bWNwLWF1dGgvZmFrZS0$(openssl rand -hex 12)"
node "$SCRIPT_DIR/phase-05-fake-jivox-mcp.mjs" $FAKE_PORT $T/fake.log "$MCP_KEY" > $T/fake.out 2>&1 & FAKE=$!
trap 'kill $FAKE 2>/dev/null' EXIT
for i in $(seq 1 50); do grep -q "fake MCP" $T/fake.out && break; sleep 0.1; done
F="http://127.0.0.1:$FAKE_PORT"; AP=/bound/sub_title,sub_category

EMAIL="hy-$RANDOM$RANDOM@test.com"
curl -s -o /dev/null -c $T/a -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
S=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"Hyphens","slug":"hyphens-66"}' | ex 'o.organization.slug')
B=$(curl -s -b $T/a -X POST "$API/organizations/$S/data-sources" -F "file=@$CSV/e2e-products-v1.csv" -F "idColumn=sku" -F "name=Products")
DS=$(echo "$B" | ex 'o.dataSource.id')
for i in $(seq 1 100); do s=$(curl -s -b $T/a "$API/organizations/$S/data-sources/$DS/imports/$(echo "$B" | ex 'o.import.id')" | ex 'o.import.status'); [ "$s" == succeeded ] && break; sleep 0.1; done
P=category-subtitle
json $T/api.json "{\"name\":\"Category subtitle\",\"slug\":\"$P\",\"dataSourceId\":\"$DS\"}"; req POST apis $T/api.json

echo "1. A new key with \"-\" can't be saved or previewed"
design sub-category; req PUT "apis/$P/design" $T/d.json
check "save with key \"sub-category\" → 400 DESIGN_INVALID on that field, saying why" "400 DESIGN_INVALID fields.1.responseKey yes" "$(code) $(b 'o.error.code') $(b 'o.error.details[0].field') $(b '/letters, numbers or _ .*Jivox can.t read a key with -/.test(o.error.details[0].message)?"yes":"no"')"
json $T/pv.json "$(node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1]));delete d.version;console.log(JSON.stringify({design:d}))" $T/d.json)"; req POST "apis/$P/design/preview" $T/pv.json
check "  preview of it → 400 too (the Design tab shows it under the row while editing)" "400 design.fields.1.responseKey" "$(code) $(b 'o.error.details[0].field')"
json $T/idd.json "{\"version\":$(version),\"idField\":{\"responseKey\":\"item-id\"},\"fields\":[]}"; req PUT "apis/$P/design" $T/idd.json
check "  an id key with \"-\" → refused as well" "400 idField.responseKey" "$(code) $(b 'o.error.details[0].field')"
check "  spaces / dots / accents still refused; letters, digits, _ fine" "400 400 400 200" "$(for k in 'sub category' 'sub.category' 'catégorie' 'Sub_Category_2'; do design "$k"; req PUT "apis/$P/design" $T/d.json; printf '%s ' $(code); done | sed 's/ $//')"

echo "2. A design saved BEFORE the rule (your live case)"
design sub_category; req PUT "apis/$P/design" $T/d.json
json $T/t.json '{"name":"Jivox axas"}'; req POST "apis/$P/tokens" $T/t.json; TOK=$(b 'o.token'); TID=$(b 'o.tokenInfo.id')
req POST "apis/$P/publish"   # published first, like the live API …
# … then the design as it was saved BEFORE the rule (apis.design is plain json: edit it as jsonb)
psql "$DB" -v ON_ERROR_STOP=1 -qtAc "UPDATE apis SET design = jsonb_set(design::jsonb, '{fields,1,responseKey}', '\"sub-category\"')::json WHERE slug = '$P' AND organization_id = (SELECT id FROM organizations WHERE slug = '$S')"
req GET "apis/$P/design"
check "the Design tab shows a problem on that key (nothing else changes)" "fields.1.responseKey yes" "$(b 'o.problems.map(p=>p.field).join()') $(b 'o.problems[0].message.includes("sub-category")?"yes":"no"')"
check "  the live /v1 keeps answering (still published) with the old key meanwhile" "200 shoes" "$(curl -s -o $T/v1 -w '%{http_code}' -H "X-Api-Key: $TOK" "${API%/api}/v1/$S/$P?ids=SKU-1001") $(ex 'o.data[0]["sub-category"]' < $T/v1)"
json $T/ag.json "{\"name\":\"axas · Agent 1\",\"tokenId\":\"$TID\",\"mcpUrl\":\"$F$AP\",\"accessKey\":\"$MCP_KEY\"}"; req POST "apis/$P/agents" $T/ag.json; A=$(b 'o.agent.id')
req POST "apis/$P/agents/$A/read-jivox"
req POST "apis/$P/agents/$A/contract/check"
check "checklist: \"Follows contract/1\" ✗ naming the key, fix on the Design tab" "fail design yes" "$(b 'o.checks.find(c=>c.id==="format").status') $(b 'o.checks.find(c=>c.id==="format").fix.place') $(b 'o.checks.find(c=>c.id==="format").detail.includes("sub_category → \"sub-category\"")?"yes":"no"')"
curl -s -o /dev/null -X POST "$F/__control" -H "Authorization: Bearer $MCP_KEY" -H "$H" -d "{\"path\":\"$AP\",\"studioToken\":\"$TOK\"}"
json $T/any.json '{"anyway":true}'; req POST "apis/$P/agents/$A/jivox/submit" $T/any.json
check "submit anyway → the fake answers like Jivox did: invalid, BAD_DOCUMENT, the same words" "invalid BAD_DOCUMENT yes" "$(b 'o.action.outcome') $(b 'o.action.problems[0].code') $(b 'o.action.problems[0].message===String.raw`'"'"'$.data[*].sub-category'"'"' does not match '"'"'^\$\.data\[\*\]\.[A-Za-z0-9_]+$'"'"'`?"yes":"no"')"
check "  our hint now points to the Design tab" "design" "$(b 'o.action.hints.map(h=>h.place).join()')"

req POST "apis/$P/unpublish"; req POST "apis/$P/publish"
check "  unpublish → publish again is refused until the key is renamed (the design has a problem)" "409 yes" "$(code) $(b 'JSON.stringify(o.error).includes("sub-category")||JSON.stringify(o.error).includes("Design")?"yes":"no"')"

echo "3. Renamed to \"_\" → fine again"
design sub_category; req PUT "apis/$P/design" $T/d.json
req POST "apis/$P/publish"
check "renamed and saved → publish works again; /v1 answers with sub_category" "200 shoes" "$(code) $(curl -s -H "X-Api-Key: $TOK" "${API%/api}/v1/$S/$P?ids=SKU-1001" | ex 'o.data[0].sub_category')"
req GET "apis/$P/design"; P1=$(b 'o.problems.length')
req POST "apis/$P/agents/$A/contract/check"
check "saved with sub_category → no problem, \"Follows contract/1\" ✓, the contract says \$.data[*].sub_category" "0 pass \$.data[*].sub_category" "$P1 $(b 'o.checks.find(c=>c.id==="format").status') $(b 'o.document.fields.find(f=>f.column_name==="sub_category").at')"
req POST "apis/$P/agents/$A/jivox/submit" $T/any.json
check "  submit → verified" "verified" "$(b 'o.action.outcome')"

echo "4. Suggested keys never contain \"-\""
check "backend suggestion: sub-category / Product-Name / -x- → sub_category / Product_Name / x" "sub_category Product_Name x" "$(cd "$SCRIPT_DIR/../../backend" && npx tsx -e "import('./src/modules/apis/design/design-rules.ts').then(m=>console.log(['sub-category','Product-Name','-x-'].map(m.suggestResponseKey).join(' ')))")"
check "frontend suggestion: the same" "sub_category Product_Name x" "$(cd "$SCRIPT_DIR/../../frontend" && npx tsx -e "import('./src/lib/design.ts').then(m=>console.log(['sub-category','Product-Name','-x-'].map(m.suggestKey).join(' ')))")"

psql "$DB" -qtAc "DELETE FROM users WHERE email='$EMAIL'" >/dev/null
kill $FAKE 2>/dev/null; wait $FAKE 2>/dev/null; trap - EXIT
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
