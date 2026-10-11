#!/bin/bash
# Task 5.5 edit scenarios: TWO agents on one API, then the API is changed under them in every way we
# support, and after EACH change both contracts are regenerated and checked (document + checklist +
# the verification-like live call): GET → POST → GET, response key renamed, header style switched,
# type changed, max ids, a field removed (and all), data replaced, API renamed (slug), unpublish /
# publish, token renewed (agents follow it) / revoked, agent edits (fields, samples, key, URL, token),
# design version shown. Uses a FAKE Jivox MCP server (Read from Jivox), started and stopped here.
#
# Usage (backend running with `npm run dev`), from any folder:
#   DB_URL="postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_mine" \
#   API=localhost:4001/api bash docs/test-scripts/phase-05-task-5.5-edit-scenarios.sh
# Creates its own test users and deletes ONLY them at the end.
API="${API:-localhost:4000/api}"; BASE="${API%/api}"
DB="${DB_URL:-postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV="$SCRIPT_DIR/../test-data/csv"
FAKE_PORT="${FAKE_PORT:-4794}" # not 4190 (fetch refuses it)
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
save() { local v; v=$(curl -s -b $T/a "$API/organizations/$S/apis/$P/design" | ex 'o.design.version'); node -e "const f=require('fs');const d=JSON.parse(f.readFileSync(process.argv[1]));d.version=+process.argv[2];f.writeFileSync(process.argv[1]+'.v',JSON.stringify(d))" "$1" "$v"; req a PUT "$S/apis/$P/design" "$1.v"; confirm_drops "$1.v" "$S/apis/$P/design"; }
# 5.6: a save that takes fields away from agents answers 409 AGENT_FIELDS_DROPPED; these scripts mean it → confirm and resend.
confirm_drops() { if [ "$(code)" == 409 ] && [ "$(body | ex 'o.error.code')" == AGENT_FIELDS_DROPPED ]; then node -e "const f=require('fs');const d=JSON.parse(f.readFileSync(process.argv[1]));const e=JSON.parse(f.readFileSync(process.argv[2]));d.confirmDroppedFields=e.error.extra.agents.flatMap(a=>a.fields.map(field=>({agentId:a.id,field})));f.writeFileSync(process.argv[1],JSON.stringify(d))" "$1" $T/body; req a PUT "$2" "$1"; fi; }
# design JSON from a template with substitutions: design METHOD KEY TYPE MAX [extra fields JSON]
design() {
  local req
  if [ "$1" == GET ]; then req='{"method":"GET","query":{"ids":"{item_id}","market":"US"},"maxIdsPerCall":'$4'}'; else req='{"method":"POST","body":{"items":[{"id":"{item_id}","cat":"{category}"}],"currency":"USD"},"maxIdsPerCall":'$4'}'; fi
  json $T/d.json '{"idField":{"responseKey":"id"},"fields":[
   {"jivoxColumn":"current_price","sourceColumn":"priceUSD","responseKey":"amount","type":"'$3'","onEmpty":"omit"},
   {"jivoxColumn":"sub_title","sourceColumn":"Product Name","responseKey":"'$2'","type":"string"},
   {"jivoxColumn":"category","sourceColumn":"category","responseKey":"category","type":"string"}'"${5:-}"'],"request":'"$req"'}'
  save $T/d.json
}
both() { for a in $A1 $A2; do req a POST "$S/apis/$P/agents/$a/contract/check"; cp $T/body $T/c_$a; done; }
c1() { ex "$1" < $T/c_$A1; }
c2() { ex "$1" < $T/c_$A2; }
fails1() { c1 'o.checks.filter(c=>c.status==="fail").map(c=>c.id).sort().join(" ")'; }
fails2() { c2 'o.checks.filter(c=>c.status==="fail").map(c=>c.id).sort().join(" ")'; }
f1() { c1 'o.document.fields.map(f=>f.column_name+"@"+f.at.replace("$.data[*].","")).join(" ")'; }
f2() { c2 'o.document.fields.map(f=>f.column_name+"@"+f.at.replace("$.data[*].","")).join(" ")'; }

KEY="bWNwLWF1dGgvZmFrZS0$(openssl rand -hex 12)"
node "$SCRIPT_DIR/phase-05-fake-jivox-mcp.mjs" $FAKE_PORT $T/fake.log "$KEY" > $T/fake.out 2>&1 &
FAKE=$!
trap 'kill $FAKE 2>/dev/null' EXIT
for i in $(seq 1 50); do grep -q "fake MCP" $T/fake.out && break; sleep 0.1; done

EMAIL="edits-$RANDOM$RANDOM@test.com"
curl -s -o /dev/null -c $T/a -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
S=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"Edits Test","slug":"edits-test"}' | ex 'o.organization.slug')
B=$(curl -s -b $T/a -X POST "$API/organizations/$S/data-sources" -F "file=@$CSV/e2e-products-v1.csv" -F "idColumn=sku" -F "name=Products")
DS=$(echo "$B" | ex 'o.dataSource.id')
for i in $(seq 1 100); do st=$(curl -s -b $T/a "$API/organizations/$S/data-sources/$DS/imports/$(echo "$B" | ex 'o.import.id')" | ex 'o.import.status'); [ "$st" == succeeded ] && break; sleep 0.1; done
P=price-api
json $T/api.json "{\"name\":\"Price API\",\"slug\":\"$P\",\"dataSourceId\":\"$DS\"}"; req a POST "$S/apis" $T/api.json
design GET subkey float 25
json $T/t.json '{"name":"Jivox axas"}'; req a POST "$S/apis/$P/tokens" $T/t.json; TA=$(body | ex 'o.tokenInfo.id')
json $T/t.json '{"name":"Jivox msw"}'; req a POST "$S/apis/$P/tokens" $T/t.json; TM=$(body | ex 'o.tokenInfo.id')
req a POST "$S/apis/$P/publish"
json $T/ag.json "{\"name\":\"axas · Agent 1\",\"tokenId\":\"$TA\",\"mcpUrl\":\"http://127.0.0.1:$FAKE_PORT/bound/sub_title\",\"accessKey\":\"$KEY\"}"; req a POST "$S/apis/$P/agents" $T/ag.json; A1=$(body | ex 'o.agent.id')
json $T/ag.json "{\"name\":\"msw · Agent 1\",\"tokenId\":\"$TM\",\"mcpUrl\":\"http://127.0.0.1:$FAKE_PORT/bound/current_price,sub_title\",\"accessKey\":\"$KEY\"}"; req a POST "$S/apis/$P/agents" $T/ag.json; A2=$(body | ex 'o.agent.id')
for a in $A1 $A2; do req a POST "$S/apis/$P/agents/$a/read-jivox"; done
[ -n "$A2" ] && [ "$(code)" == 200 ] || { echo "Setup failed"; exit 1; }
PUB=$(curl -s -b $T/a -X POST "$API/organizations/$S/apis/$P/try" -H "$H" -d '{}' | ex 'o.request.url.split("/v1/")[0]')

echo "0. Start: GET, two agents"
both
check "agent 1 (sub_title) / agent 2 (current_price, sub_title): own fields, same URL" "item_id@id sub_title@subkey|item_id@id current_price@amount sub_title@subkey|same" "$(f1)|$(f2)|$([ "$(c1 'o.document.base_url+o.document.request.path')" == "$(c2 'o.document.base_url+o.document.request.path')" ] && echo same || echo different)"
check "both: only base_url fails (localhost here); live call passes with EACH agent's own token" "base_url|base_url|pass pass" "$(fails1)|$(fails2)|$(c1 '(o.checks.find(c=>c.id==="status_2xx")||{}).status') $(c2 '(o.checks.find(c=>c.id==="status_2xx")||{}).status')"
check "  …each check names its own token" "Jivox axas|Jivox msw" "$(c1 'o.checks.find(c=>c.id==="token").detail.match(/"([^"]+)"/)[1]')|$(c2 'o.checks.find(c=>c.id==="token").detail.match(/"([^"]+)"/)[1]')"
V0=$(curl -s -b $T/a "$API/organizations/$S/apis/$P/agents/$A1/contract" | ex 'o.designVersion')

echo "1. Design: GET → POST"
design POST subkey float 25
both
check "both contracts now POST with the body template ({item_id} per row, {category} input, literal)" 'POST|POST|{"items":[{"id":"{item_id}","cat":"{category}"}],"currency":"USD"}' "$(c1 'o.document.request.method')|$(c2 'o.document.request.method')|$(c1 'o.document.request.body')"
check "  sample_request: one object per id with the REAL category; no query any more" '{"items":[{"id":"SKU-1001","cat":"shoes"},{"id":"SKU-1002","cat":"shoes"}],"currency":"USD"} false' "$(c1 'o.document.sample_request') $(c1 '"query" in o.document.request')"
check "  live call (POST) passes for both; inputs ✓ (category mapped); fields unchanged" "base_url|base_url|pass pass|item_id@id sub_title@subkey" "$(fails1)|$(fails2)|$(c1 'o.checks.find(c=>c.id==="inputs").status') $(c2 'o.checks.find(c=>c.id==="status_2xx").status')|$(f1)"
check "  design version went up" "yes" "$([ "$(curl -s -b $T/a "$API/organizations/$S/apis/$P/agents/$A1/contract" | ex 'o.designVersion')" -gt "$V0" ] && echo yes || echo no)"

echo "2. Design: POST → GET again"
design GET subkey float 25
both
check "back to GET: query template + ids sample, body gone; still passing" 'GET {"ids":"SKU-1001,SKU-1002","market":"US"} false base_url' "$(c1 'o.document.request.method') $(c1 'o.document.sample_request') $(c1 '"body" in o.document.request') $(fails1)"

echo "3. Response key renamed (subkey → subtitle)"
design GET subtitle float 25
both
check "both contracts follow the new key; live still passes" "sub_title@subtitle|sub_title@subtitle|base_url" "$(c1 'o.document.fields[1].at.replace("$.data[*].","").replace(/^/,"sub_title@")')|$(c2 'o.document.fields.find(f=>f.column_name==="sub_title").at.replace("$.data[*].","").replace(/^/,"sub_title@")')|$(fails2)"

echo "4. Header style X-Api-Key → Bearer"
json $T/st.json '{"style":"bearer"}'; req a PUT "$S/apis/$P/auth-header" $T/st.json
both
check "contracts say Authorization: Bearer {token}; live call sends it that way and passes" "Authorization Bearer {token} base_url pass" "$(c1 'o.document.service_header') $(c1 'o.document.service_value_format') $(fails1) $(c1 'o.checks.find(c=>c.id==="needs_token").status')"
json $T/st.json '{"style":"x-api-key"}'; req a PUT "$S/apis/$P/auth-header" $T/st.json

echo "5. Type changed (current_price float → string)"
design GET subtitle string 25
both
check "agent 2 (has current_price): types ✗ + live fields ✗; agent 1 (no current_price) unaffected" "base_url fields_typed types|base_url" "$(fails2)|$(fails1)"
design GET subtitle float 25

echo "6. Max ids per call 25 → 7"
design GET subtitle float 7
both
check "call_rules.max_ids_per_call follows" "7 7" "$(c1 'o.document.call_rules.max_ids_per_call') $(c2 'o.document.call_rules.max_ids_per_call')"

echo "7. A field removed from the design"
json $T/d.json "$(sed 's/,{"jivoxColumn":"current_price","sourceColumn":"priceUSD","responseKey":"amount","type":"float","onEmpty":"omit"}//; s/{"jivoxColumn":"current_price","sourceColumn":"priceUSD","responseKey":"amount","type":"float","onEmpty":"omit"},//' $T/d.json)"; save $T/d.json
both
check "current_price gone: agent 2 keeps sub_title + ⚠ fields (Jivox keeps the feed's value); agent 1 fine" "item_id@id sub_title@subtitle|warn|base_url|base_url" "$(f2)|$(c2 'o.checks.find(c=>c.id==="fields").status')|$(fails2)|$(fails1)"
json $T/d.json '{"idField":{"responseKey":"id"},"fields":[{"jivoxColumn":"category","sourceColumn":"category","responseKey":"category","type":"string"}],"request":{"method":"GET","query":{"ids":"{item_id}"},"maxIdsPerCall":7}}'; save $T/d.json
both
check "no agent field left in the design → fields ✗ for both (contract = the id only)" "1 1 fail fail" "$(c1 'o.document.fields.length') $(c2 'o.document.fields.length') $(c1 'o.checks.find(c=>c.id==="fields").status') $(c2 'o.checks.find(c=>c.id==="fields").status')"
design GET subkey float 25

echo "8. Data replaced (SKU-1001 69.99, SKU-1003 gone, SKU-1006 new)"
curl -s -o $T/body -b $T/a -X POST "$API/organizations/$S/data-sources/$DS/imports" -F "file=@$CSV/e2e-products-v3.csv" -F "mode=replace"
IMP=$(body | ex 'o.import.id'); for i in $(seq 1 100); do st=$(curl -s -b $T/a "$API/organizations/$S/data-sources/$DS/imports/$IMP" | ex 'o.import.status'); [ "$st" == succeeded ] && break; sleep 0.1; done
both
check "the contract's sample answer shows the NEW value; still passing" "69.99 base_url" "$(c2 'o.document.response.data[0].amount') $(fails2)"
json $T/p.json '{"sampleIds":["SKU-1003"]}'; req a PATCH "$S/apis/$P/agents/$A2" $T/p.json; both
check "an agent whose sample id was dropped by the new data → sample_ids ✗ + ids ✗ (fix: pick other ids)" "base_url ids_once sample_ids agent" "$(fails2) $(c2 'o.checks.find(c=>c.id==="sample_ids").fix.place')"
json $T/p.json '{"sampleIds":["SKU-1006","SKU-1002"]}'; req a PATCH "$S/apis/$P/agents/$A2" $T/p.json; both
check "  new sample ids (incl. the new row) → passing, sample shows them" "base_url SKU-1006,SKU-1002" "$(fails2) $(c2 'o.sample.ids.join()')"

echo "9. API renamed (slug price-api → live-price)"
json $T/r.json '{"slug":"live-price"}'; req a PATCH "$S/apis/$P" $T/r.json; RN=$(code); P=live-price
both
check "rename → 200; both contracts use the NEW path; live call on the new path passes" "200 /live-price /live-price base_url base_url" "$RN $(c1 'o.document.request.path') $(c2 'o.document.request.path') $(fails1) $(fails2)"

echo "10. Unpublish / publish"
req a POST "$S/apis/$P/unpublish"; both
check "draft → published ✗, live call skipped (both)" "base_url published skip|base_url published" "$(fails1) $(c1 'o.checks.find(c=>c.id==="live").status')|$(fails2)"
req a POST "$S/apis/$P/publish"; both
check "published again → passing again" "base_url|base_url" "$(fails1)|$(fails2)"

echo "11. Tokens: renew (agents follow), revoke"
json $T/x.json '{"expiresAt":null}'; req a POST "$S/apis/$P/tokens/$TA/renew" $T/x.json
NEWTA=$(body | ex 'o.tokenInfo.id'); MOVED=$(body | ex 'o.agentsMoved')
both
check "renew Jivox axas → 1 agent moved to the NEW token; its live check passes with it" "1 $NEWTA pass" "$MOVED $(curl -s -b $T/a "$API/organizations/$S/apis/$P/agents" | ex "o.agents.find(a=>a.id==='$A1').token.id") $(c1 'o.checks.find(c=>c.id==="status_2xx").status')"
check "  the other agent keeps its own token" "$TM" "$(curl -s -b $T/a "$API/organizations/$S/apis/$P/agents" | ex "o.agents.find(a=>a.id==='$A2').token.id")"
req a DELETE "$S/apis/$P/tokens/$TM"; both
check "revoke agent 2's token → token ✗ (fix: make a new token), live skipped; agent 1 unaffected" "base_url token tokens skip|base_url" "$(fails2) $(c2 'o.checks.find(c=>c.id==="token").fix.place') $(c2 'o.checks.find(c=>c.id==="live").status')|$(fails1)"
json $T/t.json '{"name":"Jivox msw 2"}'; req a POST "$S/apis/$P/tokens" $T/t.json; TM2=$(body | ex 'o.tokenInfo.id')
json $T/p.json "{\"tokenId\":\"$TM2\"}"; req a PATCH "$S/apis/$P/agents/$A2" $T/p.json; both
check "link a new token → passing again" "base_url" "$(fails2)"

echo "12. Agent edits"
json $T/p.json "{\"mcpUrl\":\"http://127.0.0.1:$FAKE_PORT/bound/sub_title,current_price,currency\"}"; req a PATCH "$S/apis/$P/agents/$A1" $T/p.json
both
check "new MCP URL → Jivox facts cleared until read again (jivox_read ⚠, bound skipped)" "warn skip" "$(c1 'o.checks.find(c=>c.id==="jivox_read").status') $(c1 'o.checks.find(c=>c.id==="bound").status')"
req a POST "$S/apis/$P/agents/$A1/read-jivox"; both
check "read again → Studio's new selection: current_price + sub_title; currency not in the design → ⚠" "item_id@id current_price@amount sub_title@subkey warn" "$(f1) $(c1 'o.checks.find(c=>c.id==="fields").status')"
json $T/p.json '{"accessKey":null}'; req a PATCH "$S/apis/$P/agents/$A1" $T/p.json; both
check "remove the key → facts cleared; fields stay; contract still generated" "item_id@id current_price@amount sub_title@subkey warn" "$(f1) $(c1 'o.checks.find(c=>c.id==="jivox_read").status')"
json $T/p.json '{"fields":["sub_title"]}'; req a PATCH "$S/apis/$P/agents/$A1" $T/p.json; both
check "fields edited by hand → the contract follows" "item_id@id sub_title@subkey" "$(f1)"
json $T/p.json '{"sampleIds":["SKU-1002"]}'; req a PATCH "$S/apis/$P/agents/$A1" $T/p.json; both
check "one sample id → sample_request with just it" '{"ids":"SKU-1002","market":"US"}' "$(c1 'JSON.stringify(o.document.sample_request)')"
curl -s -D $T/h -o $T/dl -b $T/a "$API/organizations/$S/apis/$P/agents/$A1/contract/download"
check "download after all the edits = the current document" "same contract-live-price-axas-agent-1.json" "$(node -e 'const f=require("fs");const a=JSON.parse(f.readFileSync(process.argv[1]));const b=JSON.parse(f.readFileSync(process.argv[2])).document;a.response.generated_at=b.response.generated_at="x";console.log(JSON.stringify(a)===JSON.stringify(b)?"same":"different")' $T/dl $T/c_$A1) $(grep -io 'filename="[^"]*"' $T/h | cut -d'"' -f2)"
check "no token text in any answer" "0" "$(cat $T/c_$A1 $T/c_$A2 $T/dl | grep -c 'rtk_[A-Za-z0-9_-]\{20,\}')"

psql "$DB" -qtAc "DELETE FROM users WHERE email='$EMAIL'" >/dev/null
kill $FAKE 2>/dev/null; wait $FAKE 2>/dev/null; trap - EXIT # waits for the fake server only
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
