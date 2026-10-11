#!/bin/bash
# Task 5.6: design changes vs Jivox agents.
#   A. The save guard: a design save that takes fields away from agents answers 409
#      AGENT_FIELDS_DROPPED (who loses what, how many fields each keeps) until EXACTLY those pairs are
#      confirmed; then it saves and reports which agents' contracts changed and how.
#   B. "Out of date": copy / download remembers the contract's shape; every later change that alters
#      it (design, header style, API URL, the agent's fields) marks the agent with the reasons; new
#      data or other sample ids don't; going back makes it up to date again.
#   C. Validation + database checks, D. races, E. load (20 agents, 5 lakh rows).
# Uses the FAKE Jivox MCP server (Read from Jivox), started and stopped here.
#
# Usage (backend running with `npm run dev`), from the project folder (DB_URL = that backend's database):
#   DB_URL="$(grep -o 'postgresql://[^"]*' backend/.env)" API=localhost:4001/api \
#   bash docs/test-scripts/phase-05-task-5.6-design-vs-agents.sh
# SKIP_BIG=1 skips the 5-lakh-row part (it uploads ~25 MB). Deletes ONLY its own test users.
API="${API:-localhost:4000/api}"
DB="${DB_URL:-postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV="$SCRIPT_DIR/../test-data/csv"
FAKE_PORT="${FAKE_PORT:-4796}"
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
now() { perl -MTime::HiRes=time -e 'printf "%d", time*1000'; }
version() { curl -s -b $T/a "$API/organizations/$S/apis/${1:-$P}/design" | ex 'o.design.version'; }
# put FILE [CONFIRM-JSON] [API]: the design in FILE with the current version (+ confirmDroppedFields)
put() { node -e "const f=require('fs');const d=JSON.parse(f.readFileSync(process.argv[1]));d.version=+process.argv[2];if(process.argv[3])d.confirmDroppedFields=JSON.parse(process.argv[3]);f.writeFileSync(process.argv[1]+'.v',JSON.stringify(d))" "$1" "$(version ${3:-$P})" "$2"; req a PUT "$S/apis/${3:-$P}/design" "$1.v"; }
# the confirmation for everything the last 409 listed
all_dropped() { body | ex 'JSON.stringify(o.error.extra.agents.flatMap(a=>a.fields.map(field=>({agentId:a.id,field}))))'; }
F_PRICE='{"jivoxColumn":"current_price","sourceColumn":"priceUSD","responseKey":"amount","type":"float","onEmpty":"omit"}'
F_SUB='{"jivoxColumn":"sub_title","sourceColumn":"Product Name","responseKey":"subkey","type":"string"}'
F_CAT='{"jivoxColumn":"category","sourceColumn":"category","responseKey":"category","type":"string"}'
GETREQ='{"method":"GET","query":{"ids":"{item_id}"},"maxIdsPerCall":25}'
d() { json $T/$1.json "{\"idField\":{\"responseKey\":\"id\"},\"fields\":[$2],\"request\":${3:-$GETREQ}}"; } # d NAME FIELDS [REQUEST]
agents() { curl -s -b $T/a "$API/organizations/$S/apis/$P/agents" > $T/list; }
st() { ex "(a=>a?[a.contract.outOfDate,a.contract.last&&a.contract.last.how].join(' '):'none')(o.agents.find(a=>a.id==='$1'))" < $T/list; } # "false copy"
why() { ex "o.agents.find(a=>a.id==='$1').contract.changes.join('; ')" < $T/list; }
take() { req a POST "$S/apis/$P/agents/$1/contract/check"; local v; v=$(body | ex 'o.designVersion'); node -e "const f=require('fs');const c=JSON.parse(f.readFileSync(process.argv[1]));f.writeFileSync(process.argv[1]+'.t',JSON.stringify({how:process.argv[2],designVersion:+process.argv[3],document:c.document}))" $T/body "${2:-copy}" "$v"; req a POST "$S/apis/$P/agents/$1/contract/taken" $T/body.t; }

KEY="bWNwLWF1dGgvZmFrZS0$(openssl rand -hex 12)"
node "$SCRIPT_DIR/phase-05-fake-jivox-mcp.mjs" $FAKE_PORT $T/fake.log "$KEY" > $T/fake.out 2>&1 &
FAKE=$!
trap 'kill $FAKE 2>/dev/null' EXIT
for i in $(seq 1 50); do grep -q "fake MCP" $T/fake.out && break; sleep 0.1; done

EMAIL="dva-$RANDOM$RANDOM@test.com"; EMAIL2="dvb-$RANDOM$RANDOM@test.com"
curl -s -o /dev/null -c $T/a -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
curl -s -o /dev/null -c $T/b -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL2\",\"password\":\"password123\"}"
S=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"Design vs agents","slug":"design-vs-agents"}' | ex 'o.organization.slug')
curl -s -o /dev/null -b $T/b -X POST $API/organizations -H "$H" -d '{"name":"Other","slug":"dva-other"}'
B=$(curl -s -b $T/a -X POST "$API/organizations/$S/data-sources" -F "file=@$CSV/e2e-products-v1.csv" -F "idColumn=sku" -F "name=Products")
DS=$(echo "$B" | ex 'o.dataSource.id')
for i in $(seq 1 100); do s=$(curl -s -b $T/a "$API/organizations/$S/data-sources/$DS/imports/$(echo "$B" | ex 'o.import.id')" | ex 'o.import.status'); [ "$s" == succeeded ] && break; sleep 0.1; done
P=price-api
json $T/api.json "{\"name\":\"Price API\",\"slug\":\"$P\",\"dataSourceId\":\"$DS\"}"; req a POST "$S/apis" $T/api.json
json $T/api.json "{\"name\":\"Second API\",\"slug\":\"second-api\",\"dataSourceId\":\"$DS\"}"; req a POST "$S/apis" $T/api.json
d full "$F_PRICE,$F_SUB,$F_CAT"; put $T/full.json
json $T/t.json '{"name":"Jivox axas"}'; req a POST "$S/apis/$P/tokens" $T/t.json; TA=$(body | ex 'o.tokenInfo.id')
json $T/ag.json "{\"name\":\"axas · Agent 1\",\"tokenId\":\"$TA\",\"mcpUrl\":\"http://127.0.0.1:$FAKE_PORT/bound/sub_title\",\"accessKey\":\"$KEY\"}"; req a POST "$S/apis/$P/agents" $T/ag.json; A1=$(body | ex 'o.agent.id')
json $T/ag.json "{\"name\":\"msw · Agent 1\",\"mcpUrl\":\"http://127.0.0.1:$FAKE_PORT/bound/current_price,sub_title\",\"accessKey\":\"$KEY\"}"; req a POST "$S/apis/$P/agents" $T/ag.json; A2=$(body | ex 'o.agent.id')
for a in $A1 $A2; do req a POST "$S/apis/$P/agents/$a/read-jivox"; done
[ -n "$A2" ] && [ "$(code)" == 200 ] || { echo "Setup failed: $(body)"; exit 1; }

echo "A. Save guard"
curl -s -b $T/a "$API/organizations/$S/apis/$P/design" > $T/g
check "GET design lists the agents and their fields (for the Design tab's marks)" '[["axas · Agent 1","sub_title"],["msw · Agent 1","current_price,sub_title"]]' "$(ex 'o.agents.map(a=>[a.name,a.fields.join()])' < $T/g)"
V=$(version)
d nosub "$F_PRICE,$F_CAT"; put $T/nosub.json
check "remove sub_title → 409 AGENT_FIELDS_DROPPED naming BOTH agents" "409 AGENT_FIELDS_DROPPED" "$(code) $(body | ex 'o.error.code')"
check "  who loses what, how many fields each keeps (axas: 0 left, msw: 1)" '[["axas · Agent 1","sub_title",0],["msw · Agent 1","sub_title",1]]' "$(body | ex 'o.error.extra.agents.map(a=>[a.name,a.fields.join(),a.left])')"
check "  message says how many agents; nothing saved (version unchanged)" "2 Jivox agents|$V" "$(body | ex 'o.error.message.match(/\d+ Jivox agents?/)[0]')|$(version)"
ALL=$(all_dropped)
put $T/nosub.json "[{\"agentId\":\"$A1\",\"field\":\"sub_title\"}]"
check "confirm only agent 1 → asked again, still both listed" "409 2" "$(code) $(body | ex 'o.error.extra.agents.length')"
put $T/nosub.json "[{\"agentId\":\"$A1\",\"field\":\"current_price\"},{\"agentId\":\"$A2\",\"field\":\"category\"}]"
check "confirm the wrong pairs → asked again" "409" "$(code)"
put $T/nosub.json "[{\"agentId\":\"$A1\",\"field\":\"sub_title\"},{\"agentId\":\"$A1\",\"field\":\"sub_title\"},{\"agentId\":\"bogus\",\"field\":\"x\"}]"
check "duplicates / unknown agent ids in the confirmation don't count for agent 2" "409" "$(code)"
put $T/nosub.json "$ALL"
check "confirm exactly what was listed → saved (version +1)" "200 $((V+1))" "$(code) $(body | ex 'o.design.version')"
check "  answer: agentImpact.dropped = both, changed = both with 'sub_title removed'" '2|[["axas · Agent 1","sub_title removed"],["msw · Agent 1","sub_title removed"]]' "$(body | ex 'o.agentImpact.dropped.length')|$(body | ex 'o.agentImpact.changed.map(a=>[a.name,a.changes.join("; ")])')"
check "  warning: 'This save changed the contract of 2 Jivox agents (…). Copy the new one…'" "yes" "$(body | ex 'o.warnings.some(w=>w.startsWith("This save changed the contract of 2 Jivox agents (axas · Agent 1, msw · Agent 1)"))?"yes":"no"')"
d nosub2 '{"jivoxColumn":"current_price","sourceColumn":"priceUSD","responseKey":"price","type":"float","onEmpty":"omit"},'"$F_CAT"; put $T/nosub2.json
check "next save while sub_title is STILL missing: not asked again; only msw's contract changed (key amount → price)" '200 0 [["msw · Agent 1","current_price: key amount → price"]]' "$(code) $(body | ex 'o.agentImpact.dropped.length') $(body | ex 'o.agentImpact.changed.map(a=>[a.name,a.changes.join("; ")])')"
put $T/full.json
check "sub_title back → no question; both contracts changed ('sub_title added')" '200 [["axas · Agent 1","sub_title added"],["msw · Agent 1","current_price: key price → amount; sub_title added"]]' "$(code) $(body | ex 'o.agentImpact.changed.map(a=>[a.name,a.changes.join("; ")])')"
d swap "$F_PRICE,"'{"jivoxColumn":"description","sourceColumn":"Product Name","responseKey":"subkey","type":"string"}'",$F_CAT"; put $T/swap.json
check "a row's Jivox field changed (sub_title → description) = sub_title dropped → asked" "409 axas · Agent 1,msw · Agent 1" "$(code) $(body | ex 'o.error.extra.agents.map(a=>a.name).join()')"
d keys '{"jivoxColumn":"current_price","sourceColumn":"priceUSD","responseKey":"amount","type":"string","onEmpty":"omit"},{"jivoxColumn":"sub_title","sourceColumn":"category","responseKey":"st","type":"string","default":"n/a"},'"$F_CAT"; put $T/keys.json
check "key / type / column / default changes take nothing away → saved without a question" "200 0" "$(code) $(body | ex 'o.agentImpact.dropped.length')"
check "  …and the changes are listed per agent (type alone doesn't change msw's contract: Jivox's type stays)" '[["axas · Agent 1","sub_title: key subkey → st; sub_title: default \"\" → n/a"],["msw · Agent 1","sub_title: key subkey → st; sub_title: default \"\" → n/a"]]' "$(body | ex 'o.agentImpact.changed.map(a=>[a.name,a.changes.join("; ")])')"
put $T/full.json
json $T/stale.json "$(node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1]));d.version=1;d.confirmDroppedFields=[];console.log(JSON.stringify(d))" $T/nosub.json)"
req a PUT "$S/apis/$P/design" $T/stale.json
check "stale version AND a drop → 409 DESIGN_CHANGED first (reload before anything else)" "409 DESIGN_CHANGED" "$(code) $(body | ex 'o.error.code')"
d bad '{"jivoxColumn":"current_price","sourceColumn":"nope","responseKey":"amount","type":"float"},'"$F_CAT"; put $T/bad.json
check "invalid design AND a drop → 400 DESIGN_INVALID first (fix it, then confirm)" "400 DESIGN_INVALID" "$(code) $(body | ex 'o.error.code')"
put $T/nosub.json '[{"agentId":5}]'
check "confirmDroppedFields of the wrong shape → 400 DESIGN_INVALID naming it" "400 confirmDroppedFields.0.agentId" "$(code) $(body | ex 'o.error.details[0].field')"
put $T/full.json '[]'
check "nothing dropped + empty confirmation → plain save" "200" "$(code)"
d noprice "$F_SUB,$F_CAT"; put $T/noprice.json
L1=$(body | ex 'o.error.extra.agents.map(a=>a.name).join()')
json $T/ag.json '{"name":"hand · Agent 3","fields":["current_price"]}'; req a POST "$S/apis/$P/agents" $T/ag.json; A3=$(body | ex 'o.agent.id')
put $T/noprice.json "[{\"agentId\":\"$A2\",\"field\":\"current_price\"}]"
check "asked about msw; an agent using current_price is ADDED before 'Save anyway' → asked again with it" "msw · Agent 1|409 msw · Agent 1,hand · Agent 3" "$L1|$(code) $(body | ex 'o.error.extra.agents.map(a=>a.name).join()')"
put $T/noprice.json "$(all_dropped)"
check "  confirm the new list → saved; hand · Agent 3 keeps 0 fields (its contract: no fields ✗)" "200 0 fail" "$(code) $(body | ex 'o.agentImpact.dropped.find(a=>a.name==="hand · Agent 3").left') $(req a POST "$S/apis/$P/agents/$A3/contract/check"; body | ex 'o.checks.find(c=>c.id==="fields").status')"
put $T/full.json
req a DELETE "$S/apis/$P/agents/$A3"
d other "$F_CAT"; put $T/other.json "" second-api
check "another API of the same brand (no agents) → never asked" "200 []" "$(code) $(body | ex 'o.agents')"

echo "B. Out of date"
agents
check "never copied → last null, outOfDate null, no chip" "null|null" "$(ex "JSON.stringify(o.agents[0].contract.last)" < $T/list)|$(ex "JSON.stringify(o.agents[0].contract.outOfDate)" < $T/list)"
take $A1 copy; take $A2 download
check "copy (agent 1) / download (agent 2) → remembered, up to date" "200|false copy|false download" "$(code)|$(agents; st $A1)|$(st $A2)"
check "  remembered with the design version the screen showed" "$(version)" "$(ex "o.agents[0].contract.last.designVersion" < $T/list)"
check "  only the shape is stored: no sample answer / request, no token or key text" "false false 0" "$(psql "$DB" -tAc "SELECT last_contract_shape ? 'response', last_contract_shape ? 'sample_request', (SELECT count(*) FROM jivox_agents WHERE api_id=(SELECT api_id FROM jivox_agents WHERE id='$A1') AND (last_contract_shape::text ~ 'rtk_' OR last_contract_shape::text LIKE '%$KEY%')) FROM jivox_agents WHERE id='$A1'" | tr '|' ' ' | sed 's/f/false/g; s/t/true/g')"
curl -s -o $T/body -b $T/a -X POST "$API/organizations/$S/data-sources/$DS/imports" -F "file=@$CSV/e2e-products-v3.csv" -F "mode=replace"
IMP=$(body | ex 'o.import.id'); for i in $(seq 1 100); do s=$(curl -s -b $T/a "$API/organizations/$S/data-sources/$DS/imports/$IMP" | ex 'o.import.status'); [ "$s" == succeeded ] && break; sleep 0.1; done
json $T/p.json '{"sampleIds":["SKU-1002"]}'; req a PATCH "$S/apis/$P/agents/$A1" $T/p.json
agents
check "new data + other sample ids (samples change) → still up to date" "succeeded|false copy|false download" "$s|$(st $A1)|$(st $A2)"
d ren "$F_PRICE,"'{"jivoxColumn":"sub_title","sourceColumn":"Product Name","responseKey":"sub","type":"string"}'",$F_CAT"; put $T/ren.json; agents
check "design: sub_title key renamed → BOTH out of date, with the reason" "true copy|sub_title: key subkey → sub|true download" "$(st $A1)|$(why $A1)|$(st $A2)"
req a GET "$S/apis/$P/agents/$A1/contract"
check "  same state in GET …/contract and in the checklist answer" "true|true" "$(body | ex 'o.contract.outOfDate')|$(req a POST "$S/apis/$P/agents/$A1/contract/check"; body | ex 'o.contract.outOfDate')"
take $A1 copy; agents
check "copy agent 1 again → it's up to date; agent 2 still out of date" "false copy|true download" "$(st $A1)|$(st $A2)"
put $T/full.json; agents
check "design back as it was → agent 2 (downloaded then) is up to date again; agent 1 now out of date" "false download|true copy" "$(st $A2)|$(st $A1)"
take $A1; json $T/st.json '{"style":"bearer"}'; req a PUT "$S/apis/$P/auth-header" $T/st.json; agents
check "header style → Bearer: out of date 'Token header: X-Api-Key: {token} → Authorization: Bearer {token}'" "true copy|Token header: X-Api-Key: {token} → Authorization: Bearer {token}" "$(st $A1)|$(why $A1)"
json $T/st.json '{"style":"x-api-key"}'; req a PUT "$S/apis/$P/auth-header" $T/st.json; agents
check "  back to X-Api-Key → up to date again" "false copy" "$(st $A1)"
json $T/r.json '{"slug":"price-api-2"}'; req a PATCH "$S/apis/$P" $T/r.json; P=price-api-2; agents
check "API renamed (URL) → out of date with the new address" "true copy|yes" "$(st $A1)|$(why $A1 | grep -q '/price-api → .*/price-api-2' && echo yes || echo no)"
json $T/r.json '{"slug":"price-api"}'; req a PATCH "$S/apis/$P" $T/r.json; P=price-api; agents
check "  renamed back → up to date" "false copy" "$(st $A1)"
json $T/p.json '{"fields":["sub_title","current_price"]}'; req a PATCH "$S/apis/$P/agents/$A1" $T/p.json; agents
check "the agent's own fields edited (current_price added) → out of date 'current_price added'" "true copy|current_price added" "$(st $A1)|$(why $A1)"
req a POST "$S/apis/$P/agents/$A1/read-jivox"; agents
check "Read from Jivox puts the bound fields back → up to date again" "false copy" "$(st $A1)"
d post "$F_PRICE,$F_SUB,$F_CAT" '{"method":"POST","body":{"items":[{"id":"{item_id}"}]},"maxIdsPerCall":25}'; put $T/post.json; agents
check "GET → POST → out of date 'Request: GET → POST'" "true|Request: GET → POST" "$(st $A1 | cut -d' ' -f1)|$(why $A1)"
take $A1 download; agents
check "download now → 'download' remembered, up to date" "false download" "$(st $A1)"
put $T/full.json

echo "C. Validation + database"
req a POST "$S/apis/$P/agents/$A1/contract/check"; cp $T/body $T/doc
# mk 'JS changing t' → POST it; the JS goes through a file (no shell quoting / brace games)
mk() { printf '%s' "$1" > $T/mk.js; node -e "const f=require('fs');const c=JSON.parse(f.readFileSync(process.argv[1]));const t={how:'copy',designVersion:3,document:c.document};eval(f.readFileSync(process.argv[3],'utf8'));f.writeFileSync(process.argv[2],JSON.stringify(t))" $T/doc $T/x.json $T/mk.js; req a POST "$S/apis/$P/agents/$A1/contract/taken" $T/x.json; echo "$(code) $(body | ex 'o.error?(o.error.details||[]).map(d=>d.field).join():"ok"')"; }
check "how 'email' → 400 how" "400 how" "$(mk "t.how='email'")"
check "no document → 400 document" "400 document" "$(mk "delete t.document")"
check "contract_format other than contract/1 → 400" "400 document.contract_format" "$(mk "t.document.contract_format='contract/2'")"
check "no fields → 400" "400 document.fields" "$(mk "t.document.fields=[]")"
check "designVersion -1 / 1.5 → 400" "400 designVersion|400 designVersion" "$(mk "t.designVersion=-1")|$(mk "t.designVersion=1.5")"
check "shape bigger than 64 KB (huge unknown key) → 400 'too big'" "400 document" "$(mk "t.document.extra='x'.repeat(70000)")"
check "a big sample answer is fine (it isn't kept)" "200 ok" "$(mk 't.document.response={data:Array.from({length:3000},(_,i)=>({id:"SKU-"+i,x:"y".repeat(50)}))}')"
take $A1
req a POST "$S/apis/$P/agents/nope/contract/taken" $T/body.t
check "unknown agent → 404; another API's path → 404" "404|404" "$(code)|$(req a POST "$S/apis/second-api/agents/$A1/contract/taken" $T/body.t; code)"
check "not logged in → 401; another account → 404" "401|404" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/organizations/$S/apis/$P/agents/$A1/contract/taken" -H "$H" -d @$T/body.t)|$(req b POST "$S/apis/$P/agents/$A1/contract/taken" $T/body.t; code)"
check "DB refuses a half-filled record and an unknown 'how'" "refused refused" "$(psql "$DB" -qtAc "UPDATE jivox_agents SET last_contract_shape=NULL WHERE id='$A1'" >/dev/null 2>&1 && echo allowed || echo refused) $(psql "$DB" -qtAc "UPDATE jivox_agents SET last_contract_how='email' WHERE id='$A1'" >/dev/null 2>&1 && echo allowed || echo refused)"
check "after the refused writes the agent is unchanged: still up to date" "false copy" "$(agents; st $A1)"

echo "D. Races"
d r1 "$F_SUB,$F_CAT"; d r2 "$F_PRICE,$F_CAT"
for i in $(seq 1 10); do node -e "const f=require('fs');const d=JSON.parse(f.readFileSync(process.argv[1]));d.version=+process.argv[2];d.confirmDroppedFields=JSON.parse(process.argv[3]);f.writeFileSync(process.argv[1]+'.r$i',JSON.stringify(d))" $T/r$((i%2+1)).json "$(version)" "[{\"agentId\":\"$A1\",\"field\":\"sub_title\"},{\"agentId\":\"$A2\",\"field\":\"sub_title\"},{\"agentId\":\"$A2\",\"field\":\"current_price\"}]"; done
PIDS=""; for i in $(seq 1 10); do (curl -s -o $T/race$i -w '%{http_code}' -b $T/a -X PUT "$API/organizations/$S/apis/$P/design" -H "$H" -d @$T/r$((i%2+1)).json.r$i > $T/rc$i) & PIDS="$PIDS $!"; done; wait $PIDS # not the fake server
check "10 confirmed saves at once, same version → exactly 1 saved, 9 DESIGN_CHANGED" "1 9" "$(cat $T/rc* | grep -o 200 | wc -l | tr -d ' ') $(cat $T/race* | grep -o DESIGN_CHANGED | wc -l | tr -d ' ')"
put $T/full.json
OK200=0; OK409=0; BAD=0
for i in $(seq 1 12); do
  put $T/full.json
  node -e "const f=require('fs');const d=JSON.parse(f.readFileSync(process.argv[1]));d.version=+process.argv[2];d.confirmDroppedFields=[{agentId:process.argv[3],field:'current_price'}];f.writeFileSync(process.argv[1]+'.v',JSON.stringify(d))" $T/noprice.json "$(version)" "$A2"
  json $T/ag.json "{\"name\":\"race $i\",\"fields\":[\"current_price\"]}"
  (curl -s -o $T/rs -w '%{http_code}' -b $T/a -X PUT "$API/organizations/$S/apis/$P/design" -H "$H" -d @$T/noprice.json.v > $T/rsc) & W1=$!
  (curl -s -o $T/ra -b $T/a -X POST "$API/organizations/$S/apis/$P/agents" -H "$H" -d @$T/ag.json) & W2=$!
  wait $W1 $W2
  NEW=$(ex 'o.agent.id' < $T/ra)
  if [ "$(cat $T/rsc)" == 200 ] && [ "$(ex "o.agentImpact.dropped.some(a=>a.id==='$NEW')" < $T/rs)" == false ]; then OK200=$((OK200+1))
  elif [ "$(cat $T/rsc)" == 409 ] && [ "$(ex "o.error.extra.agents.some(a=>a.id==='$NEW')" < $T/rs)" == true ]; then OK409=$((OK409+1))
  else BAD=$((BAD+1)); fi
  req a DELETE "$S/apis/$P/agents/$NEW"
done
check "12 × (save dropping current_price ∥ new agent with current_price): saved before it, or asked about it; never saved past it unasked" "0 12" "$BAD $((OK200+OK409))"
echo "     (saved first: $OK200, asked: $OK409)"
put $T/full.json; take $A1
PIDS=""; for i in $(seq 1 8); do (curl -s -o /dev/null -w '%{http_code}\n' -b $T/a -X POST "$API/organizations/$S/apis/$P/agents/$A1/contract/taken" -H "$H" -d @$T/body.t >> $T/tk) & PIDS="$PIDS $!"; done
put $T/ren.json; wait $PIDS
agents
check "8 copies at once while the design changes → all 200; the end state matches the last copy vs today's design" "8 true" "$(grep -c 200 $T/tk) $(st $A1 | cut -d' ' -f1)"
put $T/full.json

echo "E. Load: 20 agents, every optional field"
curl -s -b $T/a "$API/jivox/feed-schemas/product" > $T/schema
ALLF=$(ex 'o.feedSchema.fields.filter(f=>!f.isId&&f.tier!=="mandatory").map(f=>f.name).slice(0,40)' < $T/schema)
[ "$(ex 'o.includes("sub_title")' <<< "$ALLF")" == true ] || echo "  (sub_title isn't in the first 40 fields: the load part needs it)"
node -e "const fs=require('fs');const names=JSON.parse(process.argv[1]);const fields=names.map((n,i)=>({jivoxColumn:n,sourceColumn:'Product Name',responseKey:'k'+i,type:'string'}));fs.writeFileSync(process.argv[2],JSON.stringify({idField:{responseKey:'id'},fields,request:{method:'GET',query:{ids:'{item_id}'},maxIdsPerCall:25}}));const less=fields.filter(f=>f.jivoxColumn!=='sub_title');fs.writeFileSync(process.argv[3],JSON.stringify({idField:{responseKey:'id'},fields:less,request:{method:'GET',query:{ids:'{item_id}'},maxIdsPerCall:25}}))" "$ALLF" $T/wide.json $T/wide-less.json
put $T/wide.json "$(node -e "console.log(JSON.stringify([]))")"; [ "$(code)" == 409 ] && put $T/wide.json "$(all_dropped)"
check "a design with $(ex 'o.length' <<< "$ALLF") fields saves" "200" "$(code)"
for i in $(seq 3 20); do json $T/ag.json "{\"name\":\"load $i\",\"fields\":$ALLF}"; req a POST "$S/apis/$P/agents" $T/ag.json; done
for a in $(curl -s -b $T/a "$API/organizations/$S/apis/$P/agents" | ex 'o.agents.map(a=>a.id).join(" ")'); do take $a >/dev/null; done
agents
check "20 agents, all copied → all up to date" "20 20" "$(ex 'o.agents.length' < $T/list) $(ex 'o.agents.filter(a=>a.contract.outOfDate===false).length' < $T/list)"
t0=$(now); for i in 1 2 3 4 5; do agents; done; LIST=$(( ($(now)-t0)/5 ))
check "agents list (20 contract shapes compared) < 300 ms (took ${LIST} ms)" "yes" "$([ $LIST -lt 300 ] && echo yes || echo no)"
t0=$(now); put $T/wide-less.json; ASK=$(( $(now)-t0 ))
check "drop sub_title (all 20 use it) → 409 naming all 20 (< 500 ms, took ${ASK} ms incl. reading the version)" "409 20 yes" "$(code) $(body | ex 'o.error.extra.agents.length') $([ $ASK -lt 500 ] && echo yes || echo no)"
t0=$(now); put $T/wide-less.json "$(all_dropped)"; SAVE=$(( $(now)-t0 ))
check "confirm → saved, 20 changed contracts reported (< 800 ms, took ${SAVE} ms)" "200 20 yes" "$(code) $(body | ex 'o.agentImpact.changed.length') $([ $SAVE -lt 800 ] && echo yes || echo no)"
agents
check "all 20 out of date, each says what was removed" "20 yes" "$(ex 'o.agents.filter(a=>a.contract.outOfDate===true).length' < $T/list) $(ex 'o.agents.every(a=>a.contract.changes.some(c=>c.endsWith(" removed")))?"yes":"no"' < $T/list)"

if [ -z "$SKIP_BIG" ]; then
  echo "E2. 5 lakh rows under the same 20 agents"
  python3 "$SCRIPT_DIR/../test-data/generate-big-csv.py" 500000 $T/big.csv >/dev/null
  BB=$(curl -s -b $T/a -X POST "$API/organizations/$S/data-sources" -F "file=@$T/big.csv" -F "idColumn=sku" -F "name=Big")
  BDS=$(echo "$BB" | ex 'o.dataSource.id')
  for i in $(seq 1 600); do s=$(curl -s -b $T/a "$API/organizations/$S/data-sources/$BDS/imports/$(echo "$BB" | ex 'o.import.id')" | ex 'o.import.status'); [ "$s" == succeeded ] || [ "$s" == failed ] && break; sleep 0.5; done
  # Both files have "category": map every field to it, switch the data (the 3.6 data guard needs every
  # design column in the new data), then map them to the big file's "name".
  for c in category name; do node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[1]));d.fields.forEach(f=>f.sourceColumn=process.argv[3]);fs.writeFileSync(process.argv[2],JSON.stringify(d))" $T/wide-less.json $T/wide-$c.json $c; done
  put $T/wide-category.json; json $T/r.json "{\"dataSourceId\":\"$BDS\"}"; req a PATCH "$S/apis/$P" $T/r.json; SW=$(code)
  put $T/wide-name.json
  check "500 000 rows imported, API switched to them, design maps the big file's column" "succeeded 200 200 500000" "$s $SW $(code) $(curl -s -b $T/a "$API/organizations/$S/data-sources/$BDS" | ex 'o.dataSource.rowCount')"
  t0=$(now); for i in 1 2 3; do agents; done; LIST2=$(( ($(now)-t0)/3 ))
  check "agents list with 5 lakh rows: no data is read for 'out of date' (< 300 ms, took ${LIST2} ms)" "yes 20" "$([ $LIST2 -lt 300 ] && echo yes || echo no) $(ex 'o.agents.length' < $T/list)"
  t0=$(now); req a POST "$S/apis/$P/agents/$A1/contract/check"; CHK=$(( $(now)-t0 ))
  check "one agent's full check (real sample from 5 lakh rows) < 2 s (took ${CHK} ms)" "200 yes" "$(code) $([ $CHK -lt 2000 ] && echo yes || echo no)"
fi

psql "$DB" -qtAc "DELETE FROM users WHERE email IN ('$EMAIL','$EMAIL2')" >/dev/null
kill $FAKE 2>/dev/null; wait $FAKE 2>/dev/null; trap - EXIT
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
