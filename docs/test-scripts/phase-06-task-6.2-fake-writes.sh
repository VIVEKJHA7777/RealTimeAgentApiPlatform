#!/bin/bash
# Task 6.2: the fake Jivox's WRITE side behaves like Jivox's spec, against OUR real API:
#   submit → invalid / gate_failed (with fixes) / failed (live call evidence) / verified vN (new number each time)
#   list → verified + active only (retired and failed never listed) · activate → re-checks, old active retired
#   per agent (per path) numbering, the "Studio token", forced failures (tool error, HTTP 500, slow)
# The verification call is REAL: the fake calls our /v1 with the contract's sample_request; it shows up in
# our Recent calls with the token's name, like Jivox's will. Nothing here talks to Jivox.
#
# Usage (backend running with `npm run dev`), from the project folder:
#   DB_URL="$(grep -o 'postgresql://[^"]*' backend/.env)" API=localhost:4001/api bash docs/test-scripts/phase-06-task-6.2-fake-writes.sh
API="${API:-localhost:4000/api}"
DB="${DB_URL:-postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV="$SCRIPT_DIR/../test-data/csv"
FAKE_PORT="${FAKE_PORT:-4801}"
H='content-type: application/json'
curl -s -o /dev/null --max-time 3 "$API/health" || { echo "Backend not reachable at $API"; exit 1; }
lsof -nP -iTCP:$FAKE_PORT -sTCP:LISTEN >/dev/null && { echo "Port $FAKE_PORT is busy: set FAKE_PORT"; exit 1; }

T=$(mktemp -d); PASS=0; FAIL=0
check() { if [ "$2" == "$3" ]; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1  (expected: $2, got: $3)"; fi; }
ex() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);const v=eval(process.argv[1]);console.log(typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('JSON-ERROR')}})" "$1"; }
code() { cat $T/code; }
body() { cat $T/body; }
req() { if [ -n "$4" ]; then curl -s -o $T/body -w '%{http_code}' -b $T/$1 -X $2 "$API/organizations/$S/$3" -H "$H" -d @"$4" > $T/code; else curl -s -o $T/body -w '%{http_code}' -b $T/$1 -X $2 "$API/organizations/$S/$3" > $T/code; fi; }  # paths below the brand
json() { printf '%s' "$2" > "$1"; }

export MCP_KEY="bWNwLWF1dGgvZmFrZS0$(openssl rand -hex 12)"
node "$SCRIPT_DIR/phase-05-fake-jivox-mcp.mjs" $FAKE_PORT $T/fake.log "$MCP_KEY" > $T/fake.out 2>&1 & FAKE=$!
trap 'kill $FAKE 2>/dev/null' EXIT
for i in $(seq 1 50); do grep -q "fake MCP" $T/fake.out && break; sleep 0.1; done
F="http://127.0.0.1:$FAKE_PORT"
A1P=/bound/sub_title; A2P=/bound/current_price,sub_title
# mcp PATH TOOL ARGS-FILE → the answer as one JSON line (result / toolError / http)
mcp() { local args='{}'; [ -n "$3" ] && args=$(cat "$3"); node "$SCRIPT_DIR/phase-06-mcp-call.mjs" "$F$1" "$2" "$args"; }
control() { json $T/ctl.json "$2"; curl -s -o /dev/null -X POST "$F/__control" -H "Authorization: Bearer $MCP_KEY" -H "$H" --data-binary "$(node -e "const o=JSON.parse(require('fs').readFileSync(process.argv[1]));o.path=process.argv[2];console.log(JSON.stringify(o))" $T/ctl.json "$1")"; }
# doc NAME AGENT [JS that changes d] → $T/NAME.json = { contract: <the agent's generated document, changed> }
doc() { req a POST "apis/$P/agents/$2/contract/check"; node -e "const f=require('fs');const d=JSON.parse(f.readFileSync(process.argv[1])).document;$3;f.writeFileSync(process.argv[2],JSON.stringify({contract:d}))" $T/body $T/$1.json; }
act() { printf '{"version":%s}' "$2" > $T/act.json; mcp "$1" activate_contract $T/act.json; }
r() { ex "$1" <<< "$2"; }

echo "0. Our API (published, GET) + two agents read from the fake"
EMAIL="fw-$RANDOM$RANDOM@test.com"
curl -s -o /dev/null -c $T/a -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
S=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"Fake writes","slug":"fake-writes"}' | ex 'o.organization.slug')
B=$(curl -s -b $T/a -X POST "$API/organizations/$S/data-sources" -F "file=@$CSV/e2e-products-v1.csv" -F "idColumn=sku" -F "name=Products")
DS=$(echo "$B" | ex 'o.dataSource.id')
for i in $(seq 1 100); do s=$(curl -s -b $T/a "$API/organizations/$S/data-sources/$DS/imports/$(echo "$B" | ex 'o.import.id')" | ex 'o.import.status'); [ "$s" == succeeded ] && break; sleep 0.1; done
P=prices
json $T/api.json "{\"name\":\"Prices\",\"slug\":\"$P\",\"dataSourceId\":\"$DS\"}"; req a POST "apis" $T/api.json
json $T/d.json '{"version":0,"idField":{"responseKey":"id"},"fields":[{"jivoxColumn":"current_price","sourceColumn":"priceUSD","responseKey":"price","type":"float","onEmpty":"omit"},{"jivoxColumn":"sub_title","sourceColumn":"Product Name","responseKey":"sub","type":"string"}],"request":{"method":"GET","query":{"ids":"{item_id}"},"maxIdsPerCall":50}}'
req a PUT "apis/$P/design" $T/d.json
json $T/t.json '{"name":"Jivox axas"}'; req a POST "apis/$P/tokens" $T/t.json; TA=$(body | ex 'o.token')
json $T/t.json '{"name":"Jivox msw"}'; req a POST "apis/$P/tokens" $T/t.json; TM=$(body | ex 'o.token'); TMID=$(body | ex 'o.tokenInfo.id')
req a POST "apis/$P/publish"
json $T/ag.json "{\"name\":\"axas · Agent 1\",\"mcpUrl\":\"$F$A1P\",\"accessKey\":\"$MCP_KEY\"}"; req a POST "apis/$P/agents" $T/ag.json; A1=$(body | ex 'o.agent.id')
json $T/ag.json "{\"name\":\"msw · Agent 1\",\"tokenId\":\"$TMID\",\"mcpUrl\":\"$F$A2P\",\"accessKey\":\"$MCP_KEY\"}"; req a POST "apis/$P/agents" $T/ag.json; A2=$(body | ex 'o.agent.id')
for a in $A1 $A2; do req a POST "apis/$P/agents/$a/read-jivox"; done
check "setup: published API, 2 agents read from the fake" "200 sub_title" "$(code) $(body | ex 'o.agent.fields.join()' | sed 's/current_price,//')"
doc good1 $A1

echo "1. Submit before the token is in Studio → failed, with evidence"
OUT=$(mcp $A1P submit_contract $T/good1.json)
check "failed at the verification step: HTTP 401 from our API" "failed verification yes" "$(r 'o.result.status' "$OUT") $(r 'o.result.step' "$OUT") $(r 'o.result.evidence.problems.some(p=>p.startsWith("HTTP 401"))?"yes":"no"' "$OUT")"
check "  evidence = the request Jivox sent (our /v1 URL with the sample ids) + our answer" "yes 401" "$(r 'o.result.evidence.request.url.includes("/v1/'$S'/'$P'?ids=SKU-1001%2CSKU-1002")?"yes":"no"' "$OUT") $(r 'o.result.evidence.response.status' "$OUT")"

echo "2. Token pasted in Studio → verified; every submit is a NEW version"
control $A1P "{\"studioToken\":\"$TA\"}"
OUT=$(mcp $A1P submit_contract $T/good1.json)
check "verified as version 1 (not active yet)" "verified 1 yes" "$(r 'o.result.status' "$OUT") $(r 'o.result.version' "$OUT") $(r '/activate_contract/.test(o.result.message)?"yes":"no"' "$OUT")"
mcp $A1P submit_contract $T/good1.json > $T/v2
check "the same document again → version 2 (Jivox stores every submit)" "verified 2" "$(r 'o.result.status' "$(cat $T/v2)") $(r 'o.result.version' "$(cat $T/v2)")"
curl -s -b $T/a "$API/organizations/$S/apis/$P/recent-calls" > $T/rc
check "Jivox's verification call is in OUR Recent calls, with the token's name, answered OK" "Jivox axas ok" "$(ex '(c=>c.tokenName+" "+(c.status<300?"ok":"bad"))(o.calls.find(c=>c.tokenName))' < $T/rc 2>/dev/null || echo none)"
OUT=$(mcp $A1P list_contracts)
check "list: v1 + v2 verified, none active yet" '[[1,"verified"],[2,"verified"]] null' "$(r 'o.result.contracts.map(c=>[c.version,c.status])' "$OUT") $(r 'JSON.stringify(o.result.active_version)' "$OUT")"

echo "3. Activate: re-checked, then live; the old active one is retired (and never listed again)"
OUT=$(act $A1P 2)
check "activate 2 → active, nothing retired" "active 2 null" "$(r 'o.result.status' "$OUT") $(r 'o.result.version' "$OUT") $(r 'JSON.stringify(o.result.retired)' "$OUT")"
OUT=$(act $A1P 1)
check "activate 1 → active, v2 retired" "active 1 2" "$(r 'o.result.status' "$OUT") $(r 'o.result.version' "$OUT") $(r 'o.result.retired' "$OUT")"
check "  list: only v1 (active); retired v2 is gone" '[[1,"active"]] 1' "$(r 'o.result.contracts.map(c=>[c.version,c.status])' "$(mcp $A1P list_contracts)") $(r 'o.result.active_version' "$(mcp $A1P list_contracts)")"
check "activate the retired v2 / the active v1 / an unknown v99 → refused, each with its reason" "not_verified already_active unknown_version" "$(r 'o.result.reason' "$(act $A1P 2)") $(r 'o.result.reason' "$(act $A1P 1)") $(r 'o.result.reason' "$(act $A1P 99)")"

echo "4. invalid (the document) and gate_failed (the agent), each error with its fix"
doc bad $A1 'd.contract_format="contract/2";d.request.query.again="{item_id}";d.call_rules.max_ids_per_call=500;d.request.query.x="{_meta.openai/secret}"'
OUT=$(mcp $A1P submit_contract $T/bad.json)
check "invalid: format, {item_id} twice, max ids, unknown _meta — every error has a fix" "invalid BAD_FORMAT,ID_PLACEHOLDER,BAD_META,BAD_MAX_IDS yes" "$(r 'o.result.status' "$OUT") $(r 'o.result.errors.map(e=>e.code).join()' "$OUT") $(r 'o.result.errors.every(e=>e.fix)?"yes":"no"' "$OUT")"
doc gate $A1 'd.credential="user";d.user_header="Authorization";d.user_value_format="Bearer {token}";d.fields.push({column_name:"current_price",at:"$.data[*].price",type:"float",default_value:""},{column_name:"product_name",at:"$.data[*].sub",default_value:""})'
OUT=$(mcp $A1P submit_contract $T/gate.json)
check "gate_failed: credential, a field not bound to this agent, a mandatory field" "gate_failed CREDENTIAL,NOT_BOUND,MANDATORY_FIELD" "$(r 'o.result.status' "$OUT") $(r 'o.result.errors.map(e=>e.code).join()' "$OUT")"
check "  failed / invalid submits used no version number: the next good one is v3" "verified 3" "$(OUT=$(mcp $A1P submit_contract $T/good1.json); echo $(r 'o.result.status' "$OUT") $(r 'o.result.version' "$OUT"))"

echo "5. The verification judges the answer like Jivox"
doc wrongtype $A1 'd.fields[1].type="float"'
check "a string field declared float → failed, naming the field, id and value" "failed yes" "$(OUT=$(mcp $A1P submit_contract $T/wrongtype.json); echo $(r 'o.result.status' "$OUT") $(r 'o.result.evidence.problems.some(p=>/sub_title at .* for id SKU-1001 is "Red Runner": expected float/.test(p))?"yes":"no"' "$OUT"))"
doc wrongid $A1 'd.fields[0].at="$.data[*].sku"'
check "the id at the wrong key → 'id SKU-1001 appears 0 times'" "failed yes" "$(OUT=$(mcp $A1P submit_contract $T/wrongid.json); echo $(r 'o.result.status' "$OUT") $(r 'o.result.evidence.problems.some(p=>p.startsWith("id SKU-1001 appears 0 times"))?"yes":"no"' "$OUT"))"
doc unknownid $A1 'd.sample_request.ids="SKU-1001,SKU-9999"'
check "a sample id our data doesn't have → failed (it's in errors[], not data)" "failed yes" "$(OUT=$(mcp $A1P submit_contract $T/unknownid.json); echo $(r 'o.result.status' "$OUT") $(r 'o.result.evidence.problems.some(p=>p.startsWith("id SKU-9999 appears 0 times"))?"yes":"no"' "$OUT"))"
doc msw $A2 ''
control $A2P "{\"studioToken\":\"$TM\"}"
check "msw (current_price + sub_title, its own token): verified v1 (SKU-1001/1002 have prices)" "verified 1" "$(OUT=$(mcp $A2P submit_contract $T/msw.json); echo $(r 'o.result.status' "$OUT") $(r 'o.result.version' "$OUT"))"
doc gone $A2 'd.fields[1].at="$.data[*].nothere"'
check "a field key missing from every item falls back to its default → still verified (v2)" "verified 2" "$(OUT=$(mcp $A2P submit_contract $T/gone.json); echo $(r 'o.result.status' "$OUT") $(r 'o.result.version' "$OUT"))"

echo "6. Our API changes under a verified version"
req a POST "apis/$P/unpublish"
check "unpublished → submit fails (HTTP 404 from /v1)" "failed yes" "$(OUT=$(mcp $A1P submit_contract $T/good1.json); echo $(r 'o.result.status' "$OUT") $(r 'o.result.evidence.problems.some(p=>p.startsWith("HTTP 404"))?"yes":"no"' "$OUT"))"
check "  activate a verified version now → refused (the live call is re-run), nothing changed" "refused verification_failed 1" "$(OUT=$(act $A1P 3); echo $(r 'o.result.status' "$OUT") $(r 'o.result.reason' "$OUT")) $(r 'o.result.active_version' "$(mcp $A1P list_contracts)")"
req a POST "apis/$P/publish"
check "  published again → activate 3 works; v1 retired" "active 3 1" "$(OUT=$(act $A1P 3); echo $(r 'o.result.status' "$OUT") $(r 'o.result.version' "$OUT") $(r 'o.result.retired' "$OUT"))"
WRONG="rtk_wrong_token_$(openssl rand -hex 16)"
control $A1P "{\"studioToken\":\"$WRONG\"}"
OUT=$(mcp $A1P submit_contract $T/good1.json)
check "the wrong token in Studio → failed 401 (that's how a token mix-up shows)" "failed yes" "$(r 'o.result.status' "$OUT") $(r 'o.result.evidence.problems.some(p=>p.startsWith("HTTP 401"))?"yes":"no"' "$OUT")"
check "  the evidence names the header, the token is masked (never echoed)" "yes 0" "$(r 'o.result.evidence.request.headers.includes("X-Api-Key: [token]")?"yes":"no"' "$OUT") $(echo "$OUT" | grep -cF -e "${WRONG:4}")"
control $A1P "{\"studioToken\":\"$TA\"}"

echo "7. Agents are independent; forced failures; who may call"
check "msw has its own numbering (v1, v2) while axas is at v3 active" '[[1,"verified"],[2,"verified"]]|3' "$(r 'o.result.contracts.map(c=>[c.version,c.status])' "$(mcp $A2P list_contracts)")|$(r 'o.result.active_version' "$(mcp $A1P list_contracts)")"
control $A2P '{"submit":"tool-error"}'; check "forced: the tool answers isError" "yes" "$(r 'o.toolError?"yes":"no"' "$(mcp $A2P submit_contract $T/msw.json)")"
control $A2P '{"submit":"http500"}'; check "forced: HTTP 500" "500" "$(r 'o.http' "$(mcp $A2P submit_contract $T/msw.json)")"
control $A2P '{"submit":"slow"}'; t0=$(date +%s); OUT=$(mcp $A2P submit_contract $T/msw.json); t1=$(date +%s)
check "forced: slow (5 s), then a normal verified answer" "verified 3 yes" "$(r 'o.result.status' "$OUT") $(r 'o.result.version' "$OUT") $([ $((t1-t0)) -ge 5 ] && echo yes || echo no)"
control $A2P '{"submit":""}'
check "a wrong access key → HTTP 401 (writes too)" "401" "$(MCP_KEY=wrong r 'o.http' "$(MCP_KEY=wrong mcp $A1P submit_contract $T/good1.json)")"
curl -s "$F/__state?path=$A1P" -H "Authorization: Bearer $MCP_KEY" > $T/state
check "the fake's record for axas: every submit + activate call, versions 1 retired · 2 retired · 3 active" '1:retired,2:retired,3:active' "$(ex 'o.versions.map(v=>v.version+":"+v.status).join()' < $T/state)"
check "write calls are in the fake's log (a test can prove there were none elsewhere)" "yes" "$([ "$(grep -c '"tool":"submit_contract"' $T/fake.log)" -gt 10 ] && echo yes || echo no)"
check "no API token anywhere in the fake's answers we kept" "0" "$(cat $T/v2 $T/state | grep -cF -e "${TA:4}")"

psql "$DB" -qtAc "DELETE FROM users WHERE email='$EMAIL'" >/dev/null
kill $FAKE 2>/dev/null; wait $FAKE 2>/dev/null; trap - EXIT
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
