#!/bin/bash
# Task 5.3 scenario tests: each agent's contract/1 document, generated from the API's design, over HTTP
# with real data. One API + two agents (own fields, same URL); chosen / unknown sample ids; fields the
# design lacks; a POST + Bearer API with a {column} input; Jivox's live types / feed type (fake MCP
# server); download; a design change shows at once; and the contract's own sample_request sent to the
# live /v1 like Jivox's verification (every sample id once, every field's "at" resolves).
#
# Usage (backend running with `npm run dev`), from any folder:
#   DB_URL="postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_mine" \
#   API=localhost:4001/api bash docs/test-scripts/phase-05-task-5.3-contract.sh
# Creates its own test users and deletes ONLY them at the end.
API="${API:-localhost:4000/api}"; BASE="${API%/api}"
DB="${DB_URL:-postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV="$SCRIPT_DIR/../test-data/csv"
FAKE_PORT="${FAKE_PORT:-4792}" # not 4190 (fetch refuses it)
H='content-type: application/json'
[ -f "$CSV/e2e-products-v1.csv" ] || { echo "Can't find the test CSVs in $CSV"; exit 1; }
curl -s -o /dev/null --max-time 3 "$API/health" || { echo "Backend not reachable at $API"; exit 1; }
lsof -nP -iTCP:$FAKE_PORT -sTCP:LISTEN >/dev/null && { echo "Port $FAKE_PORT is busy: set FAKE_PORT"; exit 1; }

T=$(mktemp -d); PASS=0; FAIL=0
check() { if [ "$2" == "$3" ]; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1  (expected: $2, got: $3)"; fi; }
ex() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);const v=eval(process.argv[1]);console.log(typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('JSON-ERROR')}})" "$1"; }
code() { cat $T/code; }
body() { cat $T/body; }
req() { if [ -n "$4" ]; then curl -s -o $T/body -w '%{http_code}' -b $T/$1 -X $2 "$API/organizations/$3" -H "$H" -d @"$4" > $T/code; else curl -s -o $T/body -w '%{http_code}' -b $T/$1 -X $2 "$API/organizations/$3" > $T/code; fi; }
json() { printf '%s' "$2" > "$1"; }
save() { local v; v=$(curl -s -b $T/a "$API/organizations/$S/apis/$1/design" | ex 'o.design.version'); node -e "const f=require('fs');const d=JSON.parse(f.readFileSync(process.argv[1]));d.version=+process.argv[2];f.writeFileSync(process.argv[1]+'.v',JSON.stringify(d))" "$2" "$v"; req a PUT "$S/apis/$1/design" "$2.v"; confirm_drops "$2.v" "$S/apis/$1/design"; }
# 5.6: a save that takes fields away from agents answers 409 AGENT_FIELDS_DROPPED; these scripts mean it → confirm and resend.
confirm_drops() { if [ "$(code)" == 409 ] && [ "$(body | ex 'o.error.code')" == AGENT_FIELDS_DROPPED ]; then node -e "const f=require('fs');const d=JSON.parse(f.readFileSync(process.argv[1]));const e=JSON.parse(f.readFileSync(process.argv[2]));d.confirmDroppedFields=e.error.extra.agents.flatMap(a=>a.fields.map(field=>({agentId:a.id,field})));f.writeFileSync(process.argv[1],JSON.stringify(d))" "$1" $T/body; req a PUT "$2" "$1"; fi; }
agent() { json $T/ag.json "$2"; req a POST "$S/apis/$1/agents" $T/ag.json; body | ex 'o.agent.id'; }
contract() { req a GET "$S/apis/$1/agents/$2/contract"; cp $T/body $T/c; }
doc() { ex "o.document.$1" < $T/c; }
fieldsOf() { ex 'o.document.fields.map(f=>f.column_name+"@"+f.at.replace("$.data[*].","")+(f.type?":"+f.type:"")).join(" ")' < $T/c; }
notes() { ex 'o.notes.map(n=>n.level+":"+n.code).join(" ")' < $T/c; }

KEY="bWNwLWF1dGgvZmFrZS0$(openssl rand -hex 12)"
node "$SCRIPT_DIR/phase-05-fake-jivox-mcp.mjs" $FAKE_PORT $T/fake.log "$KEY" > $T/fake.out 2>&1 &
FAKE=$!
trap 'kill $FAKE 2>/dev/null' EXIT
for i in $(seq 1 50); do grep -q "fake MCP" $T/fake.out && break; sleep 0.1; done

EMAIL="contract-$RANDOM$RANDOM@test.com"
curl -s -o /dev/null -c $T/a -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
curl -s -o /dev/null -c $T/b -X POST $API/auth/signup -H "$H" -d "{\"email\":\"other-$EMAIL\",\"password\":\"password123\"}"
S=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"Contract Test","slug":"contract-test"}' | ex 'o.organization.slug')
B=$(curl -s -b $T/a -X POST "$API/organizations/$S/data-sources" -F "file=@$CSV/e2e-products-v1.csv" -F "idColumn=sku" -F "name=Products")
DS=$(echo "$B" | ex 'o.dataSource.id')
for i in $(seq 1 100); do st=$(curl -s -b $T/a "$API/organizations/$S/data-sources/$DS/imports/$(echo "$B" | ex 'o.import.id')" | ex 'o.import.status'); [ "$st" == succeeded ] && break; sleep 0.1; done
for a in prices feed empty-api; do json $T/api.json "{\"name\":\"$a\",\"slug\":\"$a\",\"dataSourceId\":\"$DS\"}"; req a POST "$S/apis" $T/api.json; done
# prices: GET ?ids=…&market=US. Feed columns → Jivox fields under OUR keys (the user's example: "sub" → subkey → sub_title)
json $T/d1.json '{"idField":{"responseKey":"id"},"fields":[
 {"jivoxColumn":"current_price","sourceColumn":"priceUSD","responseKey":"amount","type":"float"},
 {"jivoxColumn":"sub_title","sourceColumn":"Product Name","responseKey":"subkey","type":"string"},
 {"jivoxColumn":"currency","sourceColumn":"category","responseKey":"cur","type":"string","default":"USD"},
 {"jivoxColumn":"is_active","sourceColumn":"in_stock","responseKey":"active","type":"boolean","typeInContract":false}],
 "request":{"method":"GET","query":{"ids":"{item_id}","locale":"{_meta.openai/locale}","market":"US"},"maxIdsPerCall":25}}'
save prices $T/d1.json
# feed: POST with a {category} input next to the id, Bearer
# category is mapped in the design, so the sample's {category} input gets OUR real value (unmapped → "")
json $T/d2.json '{"idField":{"responseKey":"sku"},"fields":[{"jivoxColumn":"sub_title","sourceColumn":"Product Name","responseKey":"title","type":"string"},{"jivoxColumn":"category","sourceColumn":"category","responseKey":"category","type":"string"}],
 "request":{"method":"POST","body":{"items":[{"sku":"{item_id}","cat":"{category}"}],"context":{"locale":"{_meta.openai/locale}"},"currency":"USD"},"maxIdsPerCall":10}}'
save feed $T/d2.json
json $T/st.json '{"style":"bearer"}'; req a PUT "$S/apis/feed/auth-header" $T/st.json
json $T/t.json '{"name":"Jivox axas"}'; req a POST "$S/apis/prices/tokens" $T/t.json; TP=$(body | ex 'o.token'); TPID=$(body | ex 'o.tokenInfo.id')
json $T/t.json '{"name":"Jivox feed"}'; req a POST "$S/apis/feed/tokens" $T/t.json; TF=$(body | ex 'o.token')
PUB=$(curl -s -b $T/a -X POST "$API/organizations/$S/apis/prices/try" -H "$H" -d '{}' | ex 'o.request.url.split("/v1/")[0]')
[ ${#TP} == 47 ] && [ -n "$PUB" ] || { echo "Setup failed"; exit 1; }

echo "A. One API, two agents, one contract each"
A1=$(agent prices '{"name":"axas · Agent 1","fields":["sub_title"]}')
A2=$(agent prices "{\"name\":\"mswfeed18 · Agent 1\",\"fields\":[\"sub_title\",\"currency\",\"current_price\"],\"tokenId\":\"$TPID\"}")
contract prices $A1
check "agent 1 (sub_title) → 200; fields: the id + sub_title at OUR key subkey" "200 item_id@id:string sub_title@subkey:string" "$(code) $(fieldsOf)"
check "  base_url = PUBLIC_BASE_URL/v1/<brand>, path /prices, X-Api-Key {token}, service" "$PUB/v1/$S /prices X-Api-Key {token} service" "$(doc base_url) $(doc request.path) $(doc service_header) $(doc service_value_format) $(doc credential)"
check "  request template copied as saved (placeholder, chat context, literal)" '{"ids":"{item_id}","locale":"{_meta.openai/locale}","market":"US"}' "$(doc request.query)"
check "  sample_request: the first 2 rows, context dropped, literal kept" '{"ids":"SKU-1001,SKU-1002","market":"US"}' "$(doc sample_request)"
check "  response: OUR real answer for them (whole items)" 'success SKU-1001,SKU-1002 Red Runner 79.99' "$(doc response.status) $(doc 'response.data.map(d=>d.id).join()') $(doc 'response.data[0].subkey') $(doc 'response.data[0].amount')"
check "  call rules: max 25 from the design + dictated 3000 / 0 / no-store" '{"max_ids_per_call":25,"timeout_ms":3000,"retries":0,"response_must_be_no_store":true}' "$(doc call_rules)"
check "  notes: only 'fields picked by hand'" "info:FIELDS_NOT_FROM_JIVOX" "$(notes)"
check "  no token anywhere in the answer" "0" "$(grep -cF -e "${TP:4:16}" $T/c)"
contract prices $A2
check "agent 2 on the SAME API → its own 3 fields in design order (default USD kept), same URL" "item_id@id:string current_price@amount:float sub_title@subkey:string currency@cur:string|$PUB/v1/$S/prices" "$(fieldsOf)|$(doc base_url)$(doc request.path)"
check "  currency's default_value = the design's default" "USD" "$(doc 'fields.find(f=>f.column_name==="currency").default_value')"

echo "B. Sample ids and notes"
json $T/p.json '{"sampleIds":["SKU-1003","SKU-1004"]}'; req a PATCH "$S/apis/prices/agents/$A2" $T/p.json
contract prices $A2
check "chosen sample ids → used in sample_request and the response" 'SKU-1003,SKU-1004 SKU-1003,SKU-1004' "$(doc 'sample_request.ids') $(doc 'response.data.map(d=>d.id).join()')"
check "  real values as our API sends them: \"n/a\" as written (R10), empty price → \"\" (R11)" '"n/a" ""' "$(ex 'JSON.stringify(o.document.response.data[0].amount)' < $T/c) $(ex 'JSON.stringify(o.document.response.data[1].amount)' < $T/c)"
json $T/p.json '{"sampleIds":["SKU-1001","NOPE-1"]}'; req a PATCH "$S/apis/prices/agents/$A2" $T/p.json; contract prices $A2
check "a sample id not in the data → warning naming it" "warning:SAMPLE_IDS_UNKNOWN yes" "$(ex 'o.notes.filter(n=>n.code==="SAMPLE_IDS_UNKNOWN").map(n=>n.level+":"+n.code).join()' < $T/c) $(ex 'o.notes.some(n=>n.message.includes("NOPE-1"))?"yes":"no"' < $T/c)"
A3=$(agent prices '{"name":"partial","fields":["current_price","description"]}'); contract prices $A3
check "a field the design lacks → left out + warning; the other stays" "item_id@id:string current_price@amount:float warning:FIELD_NOT_IN_DESIGN" "$(fieldsOf) $(ex 'o.notes.filter(n=>n.level!=="info").map(n=>n.level+":"+n.code).join()' < $T/c)"
A4=$(agent prices '{"name":"none"}'); contract prices $A4
check "no fields → blocker NO_FIELDS, contract = the id only" "blocker:NO_FIELDS 1" "$(ex 'o.notes.filter(n=>n.level==="blocker").map(n=>n.level+":"+n.code).join()' < $T/c) $(doc fields.length)"
A5=$(agent prices '{"name":"not-in-contract","fields":["is_active"]}'); contract prices $A5
check "a field kept out of the contract's types (R5) → no type key" "item_id@id:string is_active@active" "$(fieldsOf)"

echo "C. POST + Bearer with a {column} input"
F1=$(agent feed '{"name":"feed agent","fields":["sub_title"]}'); contract feed $F1
check "Authorization: Bearer {token}; body template with {category} + context + literal" 'Authorization Bearer {token} {"items":[{"sku":"{item_id}","cat":"{category}"}],"context":{"locale":"{_meta.openai/locale}"},"currency":"USD"}' "$(doc service_header) $(doc service_value_format) $(doc request.body)"
check "  sample_request: one object per id, REAL categories, context object dropped, literal kept" '{"items":[{"sku":"SKU-1001","cat":"shoes"},{"sku":"SKU-1002","cat":"shoes"}],"currency":"USD"}' "$(doc sample_request)"
check "  fields: id at sku, sub_title at title; max 10" "item_id@sku:string sub_title@title:string 10" "$(fieldsOf) $(doc call_rules.max_ids_per_call)"

echo "D. With Jivox's facts (fake MCP server)"
json $T/p.json "{\"mcpUrl\":\"http://127.0.0.1:$FAKE_PORT/bound/sub_title,currency,current_price\",\"accessKey\":\"$KEY\"}"; req a PATCH "$S/apis/prices/agents/$A1" $T/p.json
req a POST "$S/apis/prices/agents/$A1/read-jivox"; contract prices $A1
check "Read from Jivox → the agent's bound group becomes its contract fields; no notes" "item_id@id:string current_price@amount:float sub_title@subkey:string currency@cur:string ||" "$(fieldsOf) |$(notes)|"
json $T/p.json "{\"mcpUrl\":\"http://127.0.0.1:$FAKE_PORT/review\"}"; req a PATCH "$S/apis/prices/agents/$A1" $T/p.json
req a POST "$S/apis/prices/agents/$A1/read-jivox"; contract prices $A1
check "Jivox says the agent is a review agent → blocker FEED_TYPE_DIFFERS" "blocker:FEED_TYPE_DIFFERS" "$(ex 'o.notes.filter(n=>n.level==="blocker").map(n=>n.level+":"+n.code).join()' < $T/c)"

echo "E. Download, design changes, who can"
curl -s -D $T/h -o $T/dl -b $T/a "$API/organizations/$S/apis/prices/agents/$A2/contract/download"
contract prices $A2
check "download: attachment contract-prices-mswfeed18-agent-1.json, JSON, no-store" "yes yes yes" "$(grep -qi 'content-disposition: attachment; filename="contract-prices-mswfeed18-agent-1.json"' $T/h && echo yes || echo no) $(grep -qi '^content-type: application/json' $T/h && echo yes || echo no) $(grep -qi '^cache-control: no-store' $T/h && echo yes || echo no)"
check "  the file = the document (apart from the answer's own time)" "same" "$(node -e 'const f=require("fs");const a=JSON.parse(f.readFileSync(process.argv[1]));const b=JSON.parse(f.readFileSync(process.argv[2])).document;a.response.generated_at=b.response.generated_at="x";console.log(JSON.stringify(a)===JSON.stringify(b)?"same":"different")' $T/dl $T/c)"
sed 's/"responseKey":"subkey"/"responseKey":"subtitle"/' $T/d1.json > $T/d1b.json; save prices $T/d1b.json
json $T/p.json '{"sampleIds":[]}'; req a PATCH "$S/apis/prices/agents/$A2" $T/p.json; contract prices $A2
check "design saved (subkey → subtitle) → the next contract maps sub_title to the new key" "sub_title@subtitle:string" "$(ex 'o.document.fields.filter(f=>f.column_name==="sub_title").map(f=>f.column_name+"@"+f.at.replace("$.data[*].","")+":"+f.type).join()' < $T/c)"
F0=$(agent empty-api '{"name":"x","fields":["sub_title"]}'); req a GET "$S/apis/empty-api/agents/$F0/contract"
check "API without a design → 409 NO_DESIGN" "409 NO_DESIGN" "$(code) $(body | ex 'o.error.code')"
check "another account → 404; an agent of another API → 404; logged out → 401" "404 404 401" "$(req b GET "$S/apis/prices/agents/$A2/contract"; code) $(req a GET "$S/apis/feed/agents/$A2/contract"; code) $(curl -s -o /dev/null -w '%{http_code}' "$API/organizations/$S/apis/prices/agents/$A2/contract")"

echo "F. The contract works on the live URL, the way Jivox's verification uses it"
req a POST "$S/apis/prices/publish"; req a POST "$S/apis/feed/publish"
contract prices $A2
URL="$(doc base_url)$(doc request.path)?$(node -e 'console.log(new URLSearchParams(JSON.parse(process.argv[1])).toString())' "$(doc sample_request)")"
curl -s -D $T/vh -o $T/v -H "$(doc service_header): $(doc service_value_format | sed "s/{token}/$TP/")" "$URL"
check "GET: sample_request sent as is, token in the contract's header → 2xx, no-store, success" "yes yes success" "$(head -1 $T/vh | grep -q ' 2[0-9][0-9]' && echo yes || echo no) $(grep -qi '^cache-control: no-store' $T/vh && echo yes || echo no) $(ex 'o.status' < $T/v)"
check "  every sample id exactly once at the id field's path" "yes" "$(node -e 'const f=require("fs");const d=JSON.parse(f.readFileSync(process.argv[1])).document;const v=JSON.parse(f.readFileSync(process.argv[2]));const k=d.fields[0].at.replace("$.data[*].","");const ids=d.sample_request.ids.split(",");console.log(ids.every(i=>v.data.filter(x=>x[k]===i).length===1)?"yes":"no")' $T/c $T/v)"
check "  every field's \"at\" resolves to a value in each item" "yes" "$(node -e 'const f=require("fs");const d=JSON.parse(f.readFileSync(process.argv[1])).document;const v=JSON.parse(f.readFileSync(process.argv[2]));console.log(v.data.every(x=>d.fields.every(fl=>fl.at.replace("$.data[*].","") in x))?"yes":"no")' $T/c $T/v)"
contract feed $F1
curl -s -o $T/v -X POST -H 'Content-Type: application/json' -H "$(doc service_header): $(doc service_value_format | sed "s/{token}/$TF/")" -d "$(doc sample_request)" "$(doc base_url)$(doc request.path)"
check "POST + Bearer: sample_request as is → success, both ids, title at its path" "success SKU-1001,SKU-1002 Red Runner" "$(ex 'o.status' < $T/v) $(ex 'o.data.map(d=>d.sku).join()' < $T/v) $(ex 'o.data[0].title' < $T/v)"

psql "$DB" -qtAc "DELETE FROM users WHERE email IN ('$EMAIL','other-$EMAIL')" >/dev/null
kill $FAKE 2>/dev/null; wait $FAKE 2>/dev/null; trap - EXIT # waits for the fake server only
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
