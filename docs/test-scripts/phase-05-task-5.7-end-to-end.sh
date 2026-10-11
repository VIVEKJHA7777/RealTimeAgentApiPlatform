#!/bin/bash
# Task 5.7: the Phase 5 journey end to end, ticking every item of the phase doc's §9 "How to verify".
#   1. A GET API built like Jivox's Sample A and a POST API built like Sample B, TWO agents each
#      (own access key on its own fake Jivox MCP server, own token): Read from Jivox → one contract
#      per agent with only its fields, all pointing at their API's one URL; structure = Jivox's samples.
#   2. An agent field the design doesn't serve → ⚠ (some served) / ✗ (none) with a link to the Design tab.
#   3. The checklist with the live verification-like call, per agent, with the AGENT's token
#      (renew one agent's token → only it moves to the new token and still passes).
#   4. Every §4 rule broken on purpose: the design-level ones are refused when saving (they can never
#      reach a contract), the others turn ✗ in the checklist (one by one in the 5.4 script).
#   5. A design change that drops an agent's field → asked first, contract "out of date" (5.6).
#   6. No token or access key in any contract, any answer, the downloaded files, or the backend log.
# Two fake Jivox MCP servers are started and stopped here (FAKE_PORT and FAKE_PORT+1).
#
# Usage (backend running with `npm run dev`), from the project folder (DB_URL = that backend's database):
#   DB_URL="$(grep -o 'postgresql://[^"]*' backend/.env)" API=localhost:4001/api \
#   LOG_FILE=/tmp/api-platform-backend.log bash docs/test-scripts/phase-05-task-5.7-end-to-end.sh
# LOG_FILE (optional) adds the "nothing secret in the log" check, over the lines written by this run.
# KEEP=1 keeps the test account (to look at it in the browser; password in this file); delete it after.
API="${API:-localhost:4000/api}"
DB="${DB_URL:-postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV="$SCRIPT_DIR/../test-data/csv"
SPEC="$SCRIPT_DIR/../jivox/mcp-snapshot-2026-10-12/get_contract_spec.json"
FAKE_PORT="${FAKE_PORT:-4798}"; FAKE2=$((FAKE_PORT+1))
H='content-type: application/json'
[ -f "$CSV/e2e-products-v1.csv" ] && [ -f "$SPEC" ] || { echo "Can't find the test CSVs / Jivox snapshot next to this script"; exit 1; }
curl -s -o /dev/null --max-time 3 "$API/health" || { echo "Backend not reachable at $API"; exit 1; }
for p in $FAKE_PORT $FAKE2; do lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null && { echo "Port $p is busy: set FAKE_PORT"; exit 1; }; done
LOG_START=0; [ -n "$LOG_FILE" ] && [ -f "$LOG_FILE" ] && LOG_START=$(wc -c < "$LOG_FILE" | tr -d ' ')

T=$(mktemp -d); PASS=0; FAIL=0
check() { if [ "$2" == "$3" ]; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1  (expected: $2, got: $3)"; fi; }
ex() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);const v=eval(process.argv[1]);console.log(typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('JSON-ERROR')}})" "$1"; }
code() { cat $T/code; }
body() { cat $T/body; }
req() { if [ -n "$4" ]; then curl -s -o $T/body -w '%{http_code}' -b $T/a -X $2 "$API/organizations/$S/$3" -H "$H" -d @"$4" > $T/code; else curl -s -o $T/body -w '%{http_code}' -b $T/a -X $2 "$API/organizations/$S/$3" > $T/code; fi
  # every answer is kept for the "no secret anywhere" check, except creating / renewing a token (they show it, by design)
  case "$3" in */tokens|*/renew) ;; *) cp $T/body "$(mktemp $T/ans.XXXXXX)" ;; esac; }  # unique names: req also runs in subshells
json() { printf '%s' "$2" > "$1"; }
version() { curl -s -b $T/a "$API/organizations/$S/apis/$1/design" | ex 'o.design.version'; }
# save API FILE [CONFIRM-JSON]
save() { node -e "const f=require('fs');const d=JSON.parse(f.readFileSync(process.argv[1]));d.version=+process.argv[2];if(process.argv[3])d.confirmDroppedFields=JSON.parse(process.argv[3]);f.writeFileSync(process.argv[1]+'.v',JSON.stringify(d))" "$2" "$(version $1)" "$3"; req a PUT "apis/$1/design" "$2.v"; }
chk() { req a POST "apis/$1/agents/$2/contract/check"; cp $T/body $T/c_$2; }  # chk API AGENT
c() { ex "$2" < $T/c_$1; }
fails() { c $1 'o.checks.filter(c=>c.status==="fail").map(c=>c.id).sort().join(" ")'; }
st() { c $1 "(o.checks.find(c=>c.id==='$2')||{status:'none'}).status"; }
sampleA() { node -e "const s=require(process.argv[1]);const v=eval(process.argv[2]);console.log(typeof v==='string'?v:JSON.stringify(v))" "$SPEC" "(c=>$1)(s.examples[0].contract)"; }
sampleB() { node -e "const s=require(process.argv[1]);const v=eval(process.argv[2]);console.log(typeof v==='string'?v:JSON.stringify(v))" "$SPEC" "(c=>$1)(s.examples[1].contract)"; }

# Two fake Jivox MCP servers = two Studio agents, each with its OWN access key.
KEY1="bWNwLWF1dGgvZmFrZS0$(openssl rand -hex 12)"; KEY2="bWNwLWF1dGgvZmFrZS0$(openssl rand -hex 12)"
node "$SCRIPT_DIR/phase-05-fake-jivox-mcp.mjs" $FAKE_PORT $T/fake1.log "$KEY1" > $T/fake1.out 2>&1 & F1=$!
node "$SCRIPT_DIR/phase-05-fake-jivox-mcp.mjs" $FAKE2 $T/fake2.log "$KEY2" > $T/fake2.out 2>&1 & F2=$!
trap 'kill $F1 $F2 2>/dev/null' EXIT
for i in $(seq 1 50); do grep -q "fake MCP" $T/fake1.out && grep -q "fake MCP" $T/fake2.out && break; sleep 0.1; done
mcp1() { echo "http://127.0.0.1:$FAKE_PORT/bound/$1"; }
mcp2() { echo "http://127.0.0.1:$FAKE2/bound/$1"; }

echo "0. Brand, data, two APIs, tokens"
EMAIL="e2e5-$RANDOM$RANDOM@test.com"
curl -s -o /dev/null -c $T/a -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
S=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"Acme Shoes","slug":"acme-shoes"}' | ex 'o.organization.slug')
B=$(curl -s -b $T/a -X POST "$API/organizations/$S/data-sources" -F "file=@$CSV/e2e-products-v1.csv" -F "idColumn=sku" -F "name=Products")
DS=$(echo "$B" | ex 'o.dataSource.id')
for i in $(seq 1 100); do s=$(curl -s -b $T/a "$API/organizations/$S/data-sources/$DS/imports/$(echo "$B" | ex 'o.import.id')" | ex 'o.import.status'); [ "$s" == succeeded ] && break; sleep 0.1; done
json $T/api.json "{\"name\":\"Live prices\",\"slug\":\"live-prices\",\"dataSourceId\":\"$DS\"}"; req a POST "apis" $T/api.json
json $T/api.json "{\"name\":\"Pricing batch\",\"slug\":\"pricing-batch\",\"dataSourceId\":\"$DS\"}"; req a POST "apis" $T/api.json
# GET like Sample A: ids comma-separated, the chat locale, a literal; Bearer; id key "id", price at "price"
json $T/get.json '{"idField":{"responseKey":"id"},"fields":[
 {"jivoxColumn":"current_price","sourceColumn":"priceUSD","responseKey":"price","type":"float"},
 {"jivoxColumn":"sub_title","sourceColumn":"Product Name","responseKey":"subkey","type":"string"},
 {"jivoxColumn":"category","sourceColumn":"category","responseKey":"category","type":"string"}],
 "request":{"method":"GET","query":{"ids":"{item_id}","locale":"{_meta.openai/locale}","market":"US"},"maxIdsPerCall":100}}'
save live-prices $T/get.json; G1=$(code)
json $T/st.json '{"style":"bearer"}'; req a PUT "apis/live-prices/auth-header" $T/st.json
# POST like Sample B: one object per id with a {category} input, chat context, literals; X-Api-Key; max 50
json $T/post.json '{"idField":{"responseKey":"sku"},"fields":[
 {"jivoxColumn":"current_price","sourceColumn":"priceUSD","responseKey":"amount","type":"float"},
 {"jivoxColumn":"custom_badge_2_value","sourceColumn":"priceUSD","responseKey":"list_price","type":"string","default":"n/a"},
 {"jivoxColumn":"category","sourceColumn":"category","responseKey":"category","type":"string"}],
 "request":{"method":"POST","body":{"items":[{"sku":"{item_id}","cat":"{category}"}],"context":{"locale":"{_meta.openai/locale}","location":"{_meta.openai/userLocation}"},"currency":"USD","include_promotions":true},"maxIdsPerCall":50}}'
save pricing-batch $T/post.json; G2=$(code)
tok() { json $T/t.json "{\"name\":\"$2\"}"; req a POST "apis/$1/tokens" $T/t.json; }
tok live-prices "Jivox axas"; TA=$(body | ex 'o.tokenInfo.id'); SA=$(body | ex 'o.token')
tok live-prices "Jivox msw"; TM=$(body | ex 'o.tokenInfo.id'); SM=$(body | ex 'o.token')
tok pricing-batch "Jivox shoes"; TS=$(body | ex 'o.tokenInfo.id'); SS=$(body | ex 'o.token')
tok pricing-batch "Jivox badges"; TB=$(body | ex 'o.tokenInfo.id'); SB=$(body | ex 'o.token')
req a POST "apis/live-prices/publish"; P1=$(code); req a POST "apis/pricing-batch/publish"; P2=$(code)
check "designs saved, both APIs published, 4 tokens" "200 200 200 200 4" "$G1 $G2 $P1 $P2 $(echo "$SA $SM $SS $SB" | grep -o 'rtk_' | wc -l | tr -d ' ')"

echo "1. Two agents per API, read from Jivox"
agent() { json $T/ag.json "{\"name\":\"$2\",\"tokenId\":\"$3\",\"mcpUrl\":\"$4\",\"accessKey\":\"$5\"}"; req a POST "apis/$1/agents" $T/ag.json; local id; id=$(body | ex 'o.agent.id'); req a POST "apis/$1/agents/$id/read-jivox"; echo $id; }
A1=$(agent live-prices "axas · Agent 1" $TA "$(mcp1 sub_title,description)" "$KEY1")
A2=$(agent live-prices "msw · Agent 1" $TM "$(mcp2 current_price)" "$KEY2")
B1=$(agent pricing-batch "shoes · Agent 1" $TS "$(mcp1 current_price,custom_badge_2_value)" "$KEY1")
B2=$(agent pricing-batch "badges · Agent 1" $TB "$(mcp2 current_price)" "$KEY2")
curl -s -b $T/a "$API/organizations/$S/apis/live-prices/agents" > $T/l1; curl -s -b $T/a "$API/organizations/$S/apis/pricing-batch/agents" > $T/l2
check "Read from Jivox: each agent's fields = what Studio bound to it (with its own key)" '["sub_title,description","current_price"]|["current_price,custom_badge_2_value","current_price"]' "$(ex 'o.agents.map(a=>a.fields.join())' < $T/l1)|$(ex 'o.agents.map(a=>a.fields.join())' < $T/l2)"
check "  each fake MCP server was called with ITS key only (2 agents each)" "yes" "$([ "$(grep -c . $T/fake1.log)" -gt 0 ] && [ "$(grep -c . $T/fake2.log)" -gt 0 ] && echo yes || echo no)"
for a in $A1 $A2; do chk live-prices $a; done; for a in $B1 $B2; do chk pricing-batch $a; done
F() { c $1 'o.document.fields.map(f=>f.column_name+"@"+f.at.replace("$.data[*].","")).join(" ")'; }
URL() { c $1 'o.document.base_url+o.document.request.path'; }
check "§9.1 GET API: two contracts, each ONLY its fields" "item_id@id sub_title@subkey|item_id@id current_price@price" "$(F $A1)|$(F $A2)"
check "§9.1 POST API: two contracts, each ONLY its fields" "item_id@sku current_price@amount custom_badge_2_value@list_price|item_id@sku current_price@amount" "$(F $B1)|$(F $B2)"
check "§9.1 both agents of an API point at the SAME URL (= the API's /v1 address)" "same /v1/$S/live-prices|same /v1/$S/pricing-batch" "$([ "$(URL $A1)" == "$(URL $A2)" ] && echo same) $(URL $A1 | grep -o '/v1/.*')|$([ "$(URL $B1)" == "$(URL $B2)" ] && echo same) $(URL $B1 | grep -o '/v1/.*')"

echo "2. Structure = Jivox's own samples"
same() { [ "$1" == "$2" ] && echo same || echo "differs: $1 vs $2"; }
check "§9.3 GET = Sample A: same keys in the same order" "same" "$(same "$(c $A2 'Object.keys(o.document).join()')" "$(sampleA 'Object.keys(c).join()')")"
check "  credential, header, value format, request method + query template = Sample A's" "same" "$(same "$(c $A2 'JSON.stringify([o.document.credential,o.document.service_header,o.document.service_value_format,o.document.request.method,o.document.request.query])')" "$(sampleA 'JSON.stringify([c.credential,c.service_header,c.service_value_format,c.request.method,c.request.query])')")"
check "  msw's fields array = Sample A's fields EXACTLY; call_rules exactly" "same|same" "$(same "$(c $A2 'JSON.stringify(o.document.fields)')" "$(sampleA 'JSON.stringify(c.fields)')")|$(same "$(c $A2 'JSON.stringify(o.document.call_rules)')" "$(sampleA 'JSON.stringify(c.call_rules)')")"
check "  sample_request like Sample A's: real ids comma-separated, literal kept, chat locale dropped" '{"ids":"SKU-1001,SKU-1002","market":"US"}' "$(c $A2 'JSON.stringify(o.document.sample_request)')"
check "  response: the envelope with our real items (price as a number)" "success 2 79.99" "$(c $A2 'o.document.response.status') $(c $A2 'o.document.response.data.length') $(c $A2 'o.document.response.data[0].price')"
check "§9.3 POST = Sample B: same keys in the same order" "same" "$(same "$(c $B1 'Object.keys(o.document).join()')" "$(sampleB 'Object.keys(c).join()')")"
check "  credential, header, value format, request method + body template = Sample B's" "same" "$(same "$(c $B1 'JSON.stringify([o.document.credential,o.document.service_header,o.document.service_value_format,o.document.request.method,o.document.request.body])')" "$(sampleB 'JSON.stringify([c.credential,c.service_header,c.service_value_format,c.request.method,c.request.body])')")"
check "  shoes' fields array = Sample B's fields EXACTLY (incl. default \"n/a\"); call_rules exactly (max 50)" "same|same" "$(same "$(c $B1 'JSON.stringify(o.document.fields)')" "$(sampleB 'JSON.stringify(c.fields)')")|$(same "$(c $B1 'JSON.stringify(o.document.call_rules)')" "$(sampleB 'JSON.stringify(c.call_rules)')")"
check "  sample_request like Sample B's: one object per id with its REAL category, context dropped, literals kept" '{"items":[{"sku":"SKU-1001","cat":"shoes"},{"sku":"SKU-1002","cat":"shoes"}],"currency":"USD","include_promotions":true}' "$(c $B1 'JSON.stringify(o.document.sample_request)')"
check "  same top-level shape of sample_request as Sample B (keys)" "same" "$(same "$(c $B1 'Object.keys(o.document.sample_request).join()')" "$(sampleB 'Object.keys(c.sample_request).join()')")"

echo "3. The checklist + the verification-like live call, per agent"
check "all 4 agents: the only ✗ is base_url (localhost: Jivox on qa3 can't reach it)" "base_url|base_url|base_url|base_url" "$(fails $A1)|$(fails $A2)|$(fails $B1)|$(fails $B2)"
check "  live call ✓ for each (2xx, no-store, success, ids once, typed fields, < 3 s, refuses without token)" "pass pass pass pass pass pass pass|pass pass pass pass pass pass pass" "$(for k in status_2xx no_store success ids_once fields_typed fast needs_token; do printf '%s ' $(st $A2 $k); done | sed 's/ $//')|$(for k in status_2xx no_store success ids_once fields_typed fast needs_token; do printf '%s ' $(st $B1 $k); done | sed 's/ $//')"
check "  POST: the {category} input is filled from the data (inputs ✓); GET: skipped" "pass skip" "$(st $B1 inputs) $(st $A1 inputs)"
check "  each live call used ITS agent's token (named in the token check)" "Jivox axas|Jivox msw|Jivox shoes|Jivox badges" "$(for a in $A1 $A2 $B1 $B2; do c $a 'o.checks.find(c=>c.id==="token").detail.match(/"([^"]+)"/)[1]'; done | paste -sd'|' -)"
json $T/x.json '{"expiresAt":null}'; req a POST "apis/live-prices/tokens/$TM/renew" $T/x.json; NEWM=$(body | ex 'o.tokenInfo.id'); SM2=$(body | ex 'o.token'); MOVED=$(body | ex 'o.agentsMoved')
chk live-prices $A1; chk live-prices $A2
check "renew msw's token → msw moves to the new one and its live call passes with it; axas untouched" "1 $NEWM pass $TA pass" "$MOVED $(curl -s -b $T/a "$API/organizations/$S/apis/live-prices/agents" | ex "o.agents.find(a=>a.id==='$A2').token.id") $(st $A2 status_2xx) $(curl -s -b $T/a "$API/organizations/$S/apis/live-prices/agents" | ex "o.agents.find(a=>a.id==='$A1').token.id") $(st $A1 status_2xx)"
check "  the old msw token now gets 401 on /v1 (so the check really used the new one)" "401" "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $SM" "${API%/api}/v1/$S/live-prices?ids=SKU-1001")"
req a GET "apis/pricing-batch/agents/$B1/contract/download"; cp $T/body $T/dl_b1
check "download = the checked document; one file per agent" "same contract-pricing-batch-shoes-agent-1.json" "$(node -e 'const f=require("fs");const a=JSON.parse(f.readFileSync(process.argv[1]));const b=JSON.parse(f.readFileSync(process.argv[2])).document;delete a.response.generated_at;delete b.response.generated_at;console.log(JSON.stringify(a)===JSON.stringify(b)?"same":"different")' $T/dl_b1 $T/c_$B1) $(curl -s -D - -o /dev/null -b $T/a "$API/organizations/$S/apis/pricing-batch/agents/$B1/contract/download" | grep -io 'filename="[^"]*"' | cut -d'"' -f2)"

echo "4. §9.2 An agent field the design doesn't serve"
check "axas is bound to description, the design doesn't answer it → left out, fields ⚠, fix on the Design tab" "item_id@id sub_title@subkey|warn design|yes" "$(F $A1)|$(st $A1 fields) $(c $A1 'o.checks.find(c=>c.id==="fields").fix.place')|$(c $A1 'o.checks.find(c=>c.id==="fields").detail' | grep -q description && echo yes || echo no)"
A3=$(agent live-prices "only-unserved · Agent 1" $TA "$(mcp1 description)" "$KEY1"); chk live-prices $A3
check "an agent whose ONLY field isn't served → fields ✗ (no contract fields), fix on the Design tab" "fail design item_id@id" "$(st $A3 fields) $(c $A3 'o.checks.find(c=>c.id==="fields").fix.place') $(F $A3)"
req a DELETE "apis/live-prices/agents/$A3"

echo "5. §9.4 Every §4 rule broken on purpose"
bad() { json $T/bad.json "{\"idField\":{\"responseKey\":\"id\"},\"fields\":[{\"jivoxColumn\":\"current_price\",\"sourceColumn\":\"priceUSD\",\"responseKey\":\"price\",\"type\":\"float\"}],\"request\":$1}"; save live-prices $T/bad.json; echo "$(code) $(body | ex 'o.error.code')"; }
check "{item_id} twice → refused when saving (never reaches a contract)" "400 DESIGN_INVALID" "$(bad '{"method":"GET","query":{"ids":"{item_id}","x":"{item_id}"},"maxIdsPerCall":100}')"
check "no {item_id} at all → refused" "400 DESIGN_INVALID" "$(bad '{"method":"GET","query":{"market":"US"},"maxIdsPerCall":100}')"
check "max ids 0 / 101 → refused" "400 DESIGN_INVALID|400 DESIGN_INVALID" "$(bad '{"method":"GET","query":{"ids":"{item_id}"},"maxIdsPerCall":0}')|$(bad '{"method":"GET","query":{"ids":"{item_id}"},"maxIdsPerCall":101}')"
check "POST: {column} outside the per-id object / not a one-object list → refused" "400 DESIGN_INVALID|400 DESIGN_INVALID" "$(bad '{"method":"POST","body":{"items":[{"sku":"{item_id}"}],"cat":"{category}"},"maxIdsPerCall":50}')|$(bad '{"method":"POST","body":{"items":[{"sku":"{item_id}"},{"sku":"x"}]},"maxIdsPerCall":50}')"
check "an unknown _meta key → refused" "400 DESIGN_INVALID" "$(bad '{"method":"GET","query":{"ids":"{item_id}","x":"{_meta.openai/secret}"},"maxIdsPerCall":100}')"
check "  …and nothing changed: the GET contract is still msw's Sample-A one" "same" "$(chk live-prices $A2; same "$(c $A2 'JSON.stringify(o.document.fields)')" "$(sampleA 'JSON.stringify(c.fields)')")"
check "format ✓ on every contract: id first, {token} once, valid placeholders, max ids 1–100" "pass pass pass pass" "$(for a in $A1 $A2 $B1 $B2; do printf '%s ' $(st $a format); done | sed 's/ $//')"
req a POST "apis/pricing-batch/unpublish"; chk pricing-batch $B1; chk live-prices $A2
check "API unpublished → published ✗ (fix: publish), live call skipped; the OTHER API's agents unaffected" "base_url published|skip publish|base_url" "$(fails $B1)|$(st $B1 live) $(c $B1 'o.checks.find(c=>c.id==="published").fix.place')|$(fails $A2)"
req a POST "apis/pricing-batch/publish"
json $T/p.json '{"tokenId":null}'; req a PATCH "apis/pricing-batch/agents/$B2" $T/p.json; chk pricing-batch $B2
check "no token linked → token ✗, live skipped" "base_url token skip" "$(fails $B2) $(st $B2 live)"
json $T/p.json "{\"tokenId\":\"$TB\",\"sampleIds\":[\"SKU-1001\",\"SKU-9999\"]}"; req a PATCH "apis/pricing-batch/agents/$B2" $T/p.json; chk pricing-batch $B2
check "a sample id not in the data → sample_ids ✗ AND the live 'every id once' ✗" "base_url ids_once sample_ids" "$(fails $B2)"
json $T/p.json '{"sampleIds":["SKU-1004"]}'; req a PATCH "apis/pricing-batch/agents/$B2" $T/p.json; chk pricing-batch $B2
check "SKU-1004 has no price → \"\" in a float field → fields_typed ✗ (Jivox needs its type or default)" "base_url fields_typed" "$(fails $B2)"
json $T/p.json '{"sampleIds":[]}'; req a PATCH "apis/pricing-batch/agents/$B2" $T/p.json
json $T/p.json '{"fields":["current_price","custom_badge_2_value"]}'; req a PATCH "apis/pricing-batch/agents/$B2" $T/p.json; chk pricing-batch $B2
check "a field the design serves but Jivox didn't bind to this agent (custom_badge_2_value, picked by hand) → bound ✗" "base_url bound" "$(fails $B2)"
req a POST "apis/pricing-batch/agents/$B2/read-jivox"; chk pricing-batch $B2
check "  Read from Jivox again → back to only base_url ✗" "base_url" "$(fails $B2)"
echo "  (the rest, one by one: expired / revoked token, Studio token, feed type, types, groups, {column} answered live → phase-05-task-5.4-checklist.sh)"

echo "6. §9.5 Design change vs agents (5.6)"
req a POST "apis/live-prices/agents/$A1/contract/check"; node -e "const f=require('fs');const c=JSON.parse(f.readFileSync(process.argv[1]));f.writeFileSync(process.argv[2],JSON.stringify({how:'copy',designVersion:c.designVersion,document:c.document}))" $T/body $T/take.json
req a POST "apis/live-prices/agents/$A1/contract/taken" $T/take.json
json $T/nosub.json '{"idField":{"responseKey":"id"},"fields":[{"jivoxColumn":"current_price","sourceColumn":"priceUSD","responseKey":"price","type":"float"},{"jivoxColumn":"category","sourceColumn":"category","responseKey":"category","type":"string"}],"request":{"method":"GET","query":{"ids":"{item_id}","locale":"{_meta.openai/locale}","market":"US"},"maxIdsPerCall":100}}'
save live-prices $T/nosub.json
check "remove sub_title → asked first, naming only axas (msw doesn't use it)" "409 axas · Agent 1:sub_title:0" "$(code) $(body | ex 'o.error.extra.agents.map(a=>a.name+":"+a.fields+":"+a.left).join()')"
save live-prices $T/nosub.json "[{\"agentId\":\"$A1\",\"field\":\"sub_title\"}]"
check "  confirmed → saved; axas (copied before) is out of date: 'sub_title removed'" "200 true sub_title removed" "$(code) $(curl -s -b $T/a "$API/organizations/$S/apis/live-prices/agents" | ex "(a=>a.contract.outOfDate+' '+a.contract.changes.join('; '))(o.agents.find(a=>a.id==='$A1'))")"
save live-prices $T/get.json

echo "7. §9.6 No token or access key anywhere"
SECRETS="$SA $SM $SM2 $SS $SB $KEY1 $KEY2"
hits() { local n=0; for s in $SECRETS; do n=$((n + $(cat "$@" | grep -cF -e "${s:4}"))); done; echo $n; }
check "no token / access key in any of the $(ls $T/ans.* | wc -l | tr -d ' ') other answers of this run (contracts, checks, lists, downloads, errors)" "0" "$(hits $T/ans.*)"
check "  nor in the stored contract shapes / agent rows (only the hint + the encrypted key)" "0 2" "$(psql "$DB" -tAc "SELECT count(*) FROM jivox_agents a JOIN apis p ON p.id=a.api_id JOIN organizations o ON o.id=p.organization_id WHERE o.slug='$S' AND (a.last_contract_shape::text LIKE '%rtk_%' OR a.access_key_encrypted LIKE '%${KEY1:4}%' OR a.access_key_encrypted LIKE '%${KEY2:4}%')") $(psql "$DB" -tAc "SELECT min(length(access_key_hint)) FROM jivox_agents a JOIN apis p ON p.id=a.api_id JOIN organizations o ON o.id=p.organization_id WHERE o.slug='$S'")"
if [ -n "$LOG_FILE" ] && [ -f "$LOG_FILE" ]; then
  tail -c +$((LOG_START+1)) "$LOG_FILE" > $T/log.part
  check "  nor in the backend log ($(wc -l < $T/log.part | tr -d ' ') lines written during this run)" "0 yes" "$(hits $T/log.part) $([ -s $T/log.part ] && echo yes || echo no)"
else
  echo "  (LOG_FILE not set: log check skipped)"
fi

if [ -n "$KEEP" ]; then echo; echo "KEEP=1: account $EMAIL (password123), brand $S kept. Delete: psql \"\$DB_URL\" -c \"DELETE FROM users WHERE email='$EMAIL'\""
else psql "$DB" -qtAc "DELETE FROM users WHERE email='$EMAIL'" >/dev/null; fi
kill $F1 $F2 2>/dev/null; wait $F1 $F2 2>/dev/null; trap - EXIT
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
