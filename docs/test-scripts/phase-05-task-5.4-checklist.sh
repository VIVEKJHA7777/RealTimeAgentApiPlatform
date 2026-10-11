#!/bin/bash
# Task 5.4 scenario tests: the per-agent contract checklist. Starts from a fully correct agent (read
# from a FAKE Jivox MCP server, token linked, published) → everything ✓ except "base URL" (this machine
# runs on localhost, which Jivox can't reach), then breaks ONE thing at a time and checks that exactly the
# right check turns ✗ / ⚠ with its reason and where to fix it: draft, no / revoked / expired token, token
# not registered in Studio, fields picked by hand, a field the design lacks, an unbound field, a type
# Jivox doesn't expect, another feed type, empty values in a float field, "n/a", unknown sample ids,
# POST {column} inputs; the live call uses the AGENT's token and isn't counted in Recent calls.
#
# Usage (backend running with `npm run dev`), from any folder:
#   DB_URL="postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_mine" \
#   API=localhost:4001/api bash docs/test-scripts/phase-05-task-5.4-checklist.sh
# Creates its own test users and deletes ONLY them at the end.
API="${API:-localhost:4000/api}"; BASE="${API%/api}"
DB="${DB_URL:-postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV="$SCRIPT_DIR/../test-data/csv"
FAKE_PORT="${FAKE_PORT:-4793}" # not 4190 (fetch refuses it)
H='content-type: application/json'
[ -f "$CSV/e2e-products-v1.csv" ] || { echo "Can't find the test CSVs in $CSV"; exit 1; }
curl -s -o /dev/null --max-time 3 "$API/health" || { echo "Backend not reachable at $API"; exit 1; }
lsof -nP -iTCP:$FAKE_PORT -sTCP:LISTEN >/dev/null && { echo "Port $FAKE_PORT is busy: set FAKE_PORT"; exit 1; }

T=$(mktemp -d); PASS=0; FAIL=0
check() { if [ "$2" == "$3" ]; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1  (expected: $2, got: $3)"; fi; }
ex() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);const v=eval(process.argv[1]);console.log(typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('JSON-ERROR')}})" "$1"; }
sql() { psql "$DB" -tAc "$1"; }
code() { cat $T/code; }
body() { cat $T/body; }
req() { if [ -n "$4" ]; then curl -s -o $T/body -w '%{http_code}' -b $T/$1 -X $2 "$API/organizations/$3" -H "$H" -d @"$4" > $T/code; else curl -s -o $T/body -w '%{http_code}' -b $T/$1 -X $2 "$API/organizations/$3" > $T/code; fi; }
json() { printf '%s' "$2" > "$1"; }
save() { local v; v=$(curl -s -b $T/a "$API/organizations/$S/apis/$1/design" | ex 'o.design.version'); node -e "const f=require('fs');const d=JSON.parse(f.readFileSync(process.argv[1]));d.version=+process.argv[2];f.writeFileSync(process.argv[1]+'.v',JSON.stringify(d))" "$2" "$v"; req a PUT "$S/apis/$1/design" "$2.v"; confirm_drops "$2.v" "$S/apis/$1/design"; }
# 5.6: a save that takes fields away from agents answers 409 AGENT_FIELDS_DROPPED; these scripts mean it → confirm and resend.
confirm_drops() { if [ "$(code)" == 409 ] && [ "$(body | ex 'o.error.code')" == AGENT_FIELDS_DROPPED ]; then node -e "const f=require('fs');const d=JSON.parse(f.readFileSync(process.argv[1]));const e=JSON.parse(f.readFileSync(process.argv[2]));d.confirmDroppedFields=e.error.extra.agents.flatMap(a=>a.fields.map(field=>({agentId:a.id,field})));f.writeFileSync(process.argv[1],JSON.stringify(d))" "$1" $T/body; req a PUT "$2" "$1"; fi; }
patch() { json $T/pa.json "$3"; req a PATCH "$S/apis/$1/agents/$2" $T/pa.json; }
run() { req a POST "$S/apis/$1/agents/$2/contract/check"; cp $T/body $T/c; }
st() { ex "(o.checks.find(c=>c.id==='$1')||{status:'absent'}).status" < $T/c; }
detail() { ex "(o.checks.find(c=>c.id==='$1')||{}).detail" < $T/c; }
fix() { ex "((o.checks.find(c=>c.id==='$1')||{}).fix||{place:'-'}).place" < $T/c; }
fails() { ex 'o.checks.filter(c=>c.status==="fail").map(c=>c.id).sort().join(" ")' < $T/c; } # sorted
warns() { ex 'o.checks.filter(c=>c.status==="warn").map(c=>c.id).join(" ")' < $T/c; }
fake() { echo "http://127.0.0.1:$FAKE_PORT/$1"; }

KEY="bWNwLWF1dGgvZmFrZS0$(openssl rand -hex 12)"
node "$SCRIPT_DIR/phase-05-fake-jivox-mcp.mjs" $FAKE_PORT $T/fake.log "$KEY" > $T/fake.out 2>&1 &
FAKE=$!
trap 'kill $FAKE 2>/dev/null' EXIT
for i in $(seq 1 50); do grep -q "fake MCP" $T/fake.out && break; sleep 0.1; done

EMAIL="check-$RANDOM$RANDOM@test.com"
curl -s -o /dev/null -c $T/a -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
curl -s -o /dev/null -c $T/b -X POST $API/auth/signup -H "$H" -d "{\"email\":\"other-$EMAIL\",\"password\":\"password123\"}"
S=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"Check Test","slug":"check-test"}' | ex 'o.organization.slug')
B=$(curl -s -b $T/a -X POST "$API/organizations/$S/data-sources" -F "file=@$CSV/e2e-products-v1.csv" -F "idColumn=sku" -F "name=Products")
DS=$(echo "$B" | ex 'o.dataSource.id')
for i in $(seq 1 100); do st=$(curl -s -b $T/a "$API/organizations/$S/data-sources/$DS/imports/$(echo "$B" | ex 'o.import.id')" | ex 'o.import.status'); [ "$st" == succeeded ] && break; sleep 0.1; done
for a in prices feed; do json $T/api.json "{\"name\":\"$a\",\"slug\":\"$a\",\"dataSourceId\":\"$DS\"}"; req a POST "$S/apis" $T/api.json; done
json $T/d1.json '{"idField":{"responseKey":"id"},"fields":[
 {"jivoxColumn":"current_price","sourceColumn":"priceUSD","responseKey":"amount","type":"float"},
 {"jivoxColumn":"sub_title","sourceColumn":"Product Name","responseKey":"subkey","type":"string"},
 {"jivoxColumn":"currency","sourceColumn":"category","responseKey":"cur","type":"string"},
 {"jivoxColumn":"brand_name","sourceColumn":"category","responseKey":"brand","type":"string"}],
 "request":{"method":"GET","query":{"ids":"{item_id}","market":"US"},"maxIdsPerCall":25}}'
save prices $T/d1.json
json $T/t.json '{"name":"Jivox axas"}'; req a POST "$S/apis/prices/tokens" $T/t.json; TP=$(body | ex 'o.token'); TPID=$(body | ex 'o.tokenInfo.id')
json $T/t.json '{"name":"Spare"}'; req a POST "$S/apis/prices/tokens" $T/t.json; SPARE=$(body | ex 'o.tokenInfo.id')
req a POST "$S/apis/prices/publish"
json $T/ag.json "{\"name\":\"axas · Agent 1\",\"tokenId\":\"$TPID\",\"mcpUrl\":\"$(fake 'bound/sub_title,currency,current_price')\",\"accessKey\":\"$KEY\"}"
req a POST "$S/apis/prices/agents" $T/ag.json; A=$(body | ex 'o.agent.id')
req a POST "$S/apis/prices/agents/$A/read-jivox"
[ "$(code)" == 200 ] && [ ${#TP} == 47 ] || { echo "Setup failed"; exit 1; }

echo "A. A correct agent"
run prices $A
check "200; every check ✓ except base_url (localhost here); so not ready" "200 base_url false" "$(code) $(fails) $(ex 'o.ready' < $T/c)"
check "  no warnings" "" "$(warns)"
check "  the checks, in their 4 groups" "agent:jivox_read,feed_type,fields,bound,types,inputs contract:format,base_url,sample_ids token:token,token_in_studio live:published,status_2xx,no_store,success,ids_once,fields_typed,fast,needs_token" "$(ex '["agent","contract","token","live"].map(g=>g+":"+o.checks.filter(c=>c.group===g).map(c=>c.id).join()).join(" ")' < $T/c)"
check "  base_url ✗ says why (Jivox can't reach this machine) and where to fix it" "yes settings" "$(detail base_url | grep -q "can't reach this machine" && echo yes || echo no) $(fix base_url)"
check "  fields: each Jivox field → our key" "current_price → amount, sub_title → subkey, currency → cur" "$(detail fields)"
check "  the live call ran with the AGENT's token (Jivox axas), refused without one" "pass pass yes" "$(st status_2xx) $(st needs_token) $(detail token | grep -q 'Jivox axas' && echo yes || echo no)"
check "  inputs: skipped for GET" "skip" "$(st inputs)"
check "  the answer holds the document + the live sample" "contract/1 true SKU-1001,SKU-1002" "$(ex 'o.document.contract_format' < $T/c) $(ex 'o.sample.live' < $T/c) $(ex 'o.sample.ids.join()' < $T/c)"
check "  no token text in the answer" "0" "$(grep -cF -e "${TP:4:16}" $T/c)"
check "  the check's own calls are NOT in Recent calls (self-check header)" "0" "$(curl -s -b $T/a "$API/organizations/$S/apis/prices/recent-calls" | ex 'o.calls.length')"

echo "B. Break one thing at a time"
req a POST "$S/apis/prices/unpublish"; run prices $A
check "draft → published ✗ (fix: publish), live call skipped" "base_url published skip publish" "$(fails) $(st live) $(fix published)"
req a POST "$S/apis/prices/publish"
patch prices $A '{"tokenId":null}'; run prices $A
check "no token linked → token ✗ (fix: agent), live call skipped" "base_url token skip agent" "$(fails) $(st live) $(fix token)"
patch prices $A "{\"tokenId\":\"$SPARE\"}"; req a DELETE "$S/apis/prices/tokens/$SPARE"; run prices $A
check "the linked token was revoked → token ✗ (fix: make a new token)" "base_url token tokens" "$(fails) $(fix token)"
patch prices $A "{\"tokenId\":\"$TPID\"}"
sql "UPDATE api_tokens SET expires_at = now() - interval '1 minute' WHERE id='$TPID'" >/dev/null; run prices $A
check "expired token → token ✗ 'Extend it…'; the live call is skipped (not run with a dead token)" "base_url token yes skip" "$(fails) $(detail token | grep -q 'Extend it' && echo yes || echo no) $(st live)"
sql "UPDATE api_tokens SET expires_at = NULL WHERE id='$TPID'" >/dev/null
patch prices $A "{\"mcpUrl\":\"$(fake unregistered)\"}"; req a POST "$S/apis/prices/agents/$A/read-jivox"; run prices $A
check "no token registered in Studio → token_in_studio ✗ with the Studio steps" "base_url token_in_studio studio yes" "$(fails) $(fix token_in_studio) $(detail token_in_studio | grep -q 'Save token' && echo yes || echo no)"
patch prices $A "{\"mcpUrl\":\"$(fake 'bound/sub_title')\"}"; patch prices $A '{"fields":["sub_title"]}'; run prices $A
check "a new MCP URL forgot Jivox's facts → fields 'picked by hand': ⚠ jivox_read, bound / feed / studio skipped" "jivox_read skip skip skip" "$(warns) $(st bound) $(st feed_type) $(st token_in_studio)"
patch prices $A "{\"mcpUrl\":\"$(fake 'bound/sub_title,currency,current_price')\"}"; req a POST "$S/apis/prices/agents/$A/read-jivox"
patch prices $A '{"fields":["sub_title","currency","current_price","brand_name"]}'; run prices $A
check "a field added by hand that Jivox didn't bind (brand_name) → bound ✗ naming it" "base_url bound yes" "$(fails) $(detail bound | grep -q brand_name && echo yes || echo no)"
patch prices $A "{\"mcpUrl\":\"$(fake 'bound/sub_title,currency,current_price,description')\"}"; req a POST "$S/apis/prices/agents/$A/read-jivox"; run prices $A
check "bound field the design lacks (description) → fields ⚠ (Jivox keeps the feed's value), fix: design" "base_url fields design" "$(fails) $(warns) $(fix fields)"
patch prices $A "{\"mcpUrl\":\"$(fake 'bound/sub_title,currency,current_price')\"}"; req a POST "$S/apis/prices/agents/$A/read-jivox"
sed 's/"responseKey":"amount","type":"float"/"responseKey":"amount","type":"string"/' $T/d1.json > $T/d1t.json; save prices $T/d1t.json; run prices $A
check "design sends current_price as string, Jivox says float → types ✗ (fix: design), and the live answer fails too" "base_url fields_typed types design" "$(fails) $(fix types)"
save prices $T/d1.json
patch prices $A "{\"mcpUrl\":\"$(fake review)\"}"; req a POST "$S/apis/prices/agents/$A/read-jivox"; run prices $A
check "Jivox says it's a review agent → feed_type ✗" "yes" "$(fails | grep -q feed_type && echo yes || echo no)"
patch prices $A "{\"mcpUrl\":\"$(fake 'bound/sub_title,currency,current_price')\"}"; req a POST "$S/apis/prices/agents/$A/read-jivox"

echo "C. Sample values, the way verification reads them"
patch prices $A '{"sampleIds":["SKU-1001","SKU-1004"]}'; run prices $A
check "SKU-1004 has no price → our API sends \"\" (R11) → fields_typed ✗ naming it, with the fix" "base_url fields_typed yes design" "$(fails) $(detail fields_typed | grep -qF 'SKU-1004: "amount" is text ""' && echo yes || echo no) $(fix fields_typed)"
sed 's/"responseKey":"amount","type":"float"}/"responseKey":"amount","type":"float","onEmpty":"omit"}/' $T/d1.json > $T/d1o.json; save prices $T/d1o.json; run prices $A
check "  same with \"leave the key out\" → fields ✓, but a ⚠ 'no value' for SKU-1004" "base_url no_value yes" "$(fails) $(warns) $(detail no_value | grep -q SKU-1004 && echo yes || echo no)"
save prices $T/d1.json
patch prices $A '{"sampleIds":["SKU-1003","SKU-1002"]}'; run prices $A
check "SKU-1003 price \"n/a\" (sent as written, R10) → fields_typed ✗" "base_url fields_typed" "$(fails)"
patch prices $A '{"sampleIds":["SKU-1001","NOPE-9"]}'; run prices $A
check "unknown sample id → sample_ids ✗ AND the live ids check ✗ (fix: agent)" "base_url ids_once sample_ids agent" "$(fails) $(fix sample_ids)"
patch prices $A '{"sampleIds":[]}'

echo "D. POST with {column} inputs"
json $T/d2.json '{"idField":{"responseKey":"sku"},"fields":[{"jivoxColumn":"current_price","sourceColumn":"priceUSD","responseKey":"price","type":"float"},{"jivoxColumn":"category","sourceColumn":"category","responseKey":"cat","type":"string"}],
 "request":{"method":"POST","body":{"items":[{"sku":"{item_id}","c":"{category}"}]},"maxIdsPerCall":10}}'
save feed $T/d2.json
json $T/t.json '{"name":"Feed"}'; req a POST "$S/apis/feed/tokens" $T/t.json; TF=$(body | ex 'o.tokenInfo.id'); req a POST "$S/apis/feed/publish"
json $T/ag.json "{\"name\":\"feed agent\",\"tokenId\":\"$TF\",\"fields\":[\"current_price\"]}"; req a POST "$S/apis/feed/agents" $T/ag.json; F=$(body | ex 'o.agent.id')
run feed $F
check "{category} mapped in the design → inputs ✓ (the sample sends real categories)" "pass {category}" "$(st inputs) $(detail inputs)"
json $T/d2b.json "$(sed 's/,{"jivoxColumn":"category","sourceColumn":"category","responseKey":"cat","type":"string"}//' $T/d2.json)"; save feed $T/d2b.json; run feed $F
check "{category} NOT mapped → inputs ⚠ (the sample sends \"\")" "warn yes" "$(st inputs) $(detail inputs | grep -qF 'sends "" for {category}' && echo yes || echo no)"
save feed $T/d2.json
json $T/ag.json '{"name":"category agent","fields":["category"]}'; req a POST "$S/apis/feed/agents" $T/ag.json; run feed $F
check "another agent of this API answers category → {category} as an input ✗ (Jivox never sends realtime fields)" "fail design" "$(st inputs) $(fix inputs)"

echo "E. Who can"
check "another account → 404; logged out → 401; unknown agent → 404" "404 401 404" "$(req b POST "$S/apis/prices/agents/$A/contract/check"; code) $(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/organizations/$S/apis/prices/agents/$A/contract/check") $(req a POST "$S/apis/prices/agents/nope/contract/check"; code)"
check "  GET instead of POST → 404 (the check makes a live call: POST only)" "404" "$(req a GET "$S/apis/prices/agents/$A/contract/check"; code)"

psql "$DB" -qtAc "DELETE FROM users WHERE email IN ('$EMAIL','other-$EMAIL')" >/dev/null
kill $FAKE 2>/dev/null; wait $FAKE 2>/dev/null; trap - EXIT # waits for the fake server only
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
