#!/bin/bash
# Task 6.7: the Phase 6 journey end to end against the FAKE Jivox (answers shaped like qa3's, 6.6):
# ONE API, TWO agents, each on its own fake MCP server with its own access key and its own token "in Studio".
#   1 submit: the checklist ✗ refuses, "anyway" sends → each agent verified v1 with ONLY its fields
#   2 activate both (previous_active null) → summaries, versions "submitted here"
#   3 a design change touching only agent B → B out of date vs what it SUBMITTED, A not → B v2 → activate → v1 retired
#   4 a deliberate failure on A (unknown sample id) → failed, one line + hint, A's v1 still active
#   5 one action at a time per agent; two agents at once fine · 6 history + details + scoping
#   7 Jivox's verification calls are in OUR Recent calls with each agent's token · 8 nothing secret anywhere
#   9 removing an agent removes only its history
# Usage (backend running with `npm run dev`), from the project folder:
#   DB_URL="$(grep -o 'postgresql://[^"]*' backend/.env)" API=localhost:4001/api \
#   LOG_FILE=/tmp/api-platform-backend.log bash docs/test-scripts/phase-06-task-6.7-end-to-end.sh
API="${API:-localhost:4000/api}"
DB="${DB_URL:-postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV="$SCRIPT_DIR/../test-data/csv"
FAKE_PORT="${FAKE_PORT:-4807}"; FAKE2=$((FAKE_PORT+1))
H='content-type: application/json'
curl -s -o /dev/null --max-time 3 "$API/health" || { echo "Backend not reachable at $API"; exit 1; }
for p in $FAKE_PORT $FAKE2; do lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null && { echo "Port $p is busy: set FAKE_PORT"; exit 1; }; done
LOG_START=0; [ -n "$LOG_FILE" ] && [ -f "$LOG_FILE" ] && LOG_START=$(wc -c < "$LOG_FILE" | tr -d ' ')

T=$(mktemp -d); PASS=0; FAIL=0
check() { if [ "$2" == "$3" ]; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1  (expected: $2, got: $3)"; fi; }
ex() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);const v=eval(process.argv[1]);console.log(typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('JSON-ERROR')}})" "$1"; }
b() { ex "$1" < $T/body; }
code() { cat $T/code; }
# every answer is kept for the "nothing secret" check, except creating a token (it shows it, by design)
req() { if [ -n "$3" ]; then curl -s -o $T/body -w '%{http_code}' -b $T/a -X $1 "$API/organizations/$S/$2" -H "$H" -d @"$3" > $T/code; else curl -s -o $T/body -w '%{http_code}' -b $T/a -X $1 "$API/organizations/$S/$2" > $T/code; fi
  case "$2" in */tokens) ;; *) cat $T/body >> $T/all ;; esac; }
json() { printf '%s' "$2" > "$1"; }
json $T/any.json '{"anyway":true}'; json $T/plain.json '{}'
submit() { req POST "apis/$P/agents/$1/jivox/submit" ${2:-$T/any.json}; }
activate() { req POST "apis/$P/agents/$1/jivox/versions/$2/activate"; }
agent() { curl -s -b $T/a "$API/organizations/$S/apis/$P/agents" | ex "o.agents.find(a=>a.id==='$1').$2"; }
version() { curl -s -b $T/a "$API/organizations/$S/apis/$P/design" | ex 'o.design.version'; }

# Two fake Jivox MCP servers = two Studio agents, each with its OWN access key.
KEY1="bWNwLWF1dGgvZmFrZS0$(openssl rand -hex 12)"; KEY2="bWNwLWF1dGgvZmFrZS0$(openssl rand -hex 12)"
node "$SCRIPT_DIR/phase-05-fake-jivox-mcp.mjs" $FAKE_PORT $T/f1.log "$KEY1" > $T/f1.out 2>&1 & F1=$!
node "$SCRIPT_DIR/phase-05-fake-jivox-mcp.mjs" $FAKE2 $T/f2.log "$KEY2" > $T/f2.out 2>&1 & F2=$!
trap 'kill $F1 $F2 2>/dev/null' EXIT
for i in $(seq 1 50); do grep -q "fake MCP" $T/f1.out && grep -q "fake MCP" $T/f2.out && break; sleep 0.1; done
PA=/bound/sub_title; PB=/bound/current_price,sub_title
studio() { curl -s -o /dev/null -X POST "http://127.0.0.1:$1/__control" -H "Authorization: Bearer $2" -H "$H" -d "{\"path\":\"$3\",\"studioToken\":\"$4\"}"; }

echo "0. One published API, two agents (own key, own token)"
EMAIL="e2e6-$RANDOM$RANDOM@test.com"
curl -s -o /dev/null -c $T/a -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
S=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"Amazon","slug":"amazon-e2e6"}' | ex 'o.organization.slug')
B=$(curl -s -b $T/a -X POST "$API/organizations/$S/data-sources" -F "file=@$CSV/e2e-products-v1.csv" -F "idColumn=sku" -F "name=Products")
DS=$(echo "$B" | ex 'o.dataSource.id')
for i in $(seq 1 100); do s=$(curl -s -b $T/a "$API/organizations/$S/data-sources/$DS/imports/$(echo "$B" | ex 'o.import.id')" | ex 'o.import.status'); [ "$s" == succeeded ] && break; sleep 0.1; done
P=newsubtitle
json $T/api.json "{\"name\":\"NewSubtitle\",\"slug\":\"$P\",\"dataSourceId\":\"$DS\"}"; req POST apis $T/api.json
design() { json $T/d.json "{\"version\":$(version),\"idField\":{\"responseKey\":\"Id1\"},\"fields\":[{\"jivoxColumn\":\"current_price\",\"sourceColumn\":\"priceUSD\",\"responseKey\":\"$1\",\"type\":\"float\",\"onEmpty\":\"omit\"},{\"jivoxColumn\":\"sub_title\",\"sourceColumn\":\"Product Name\",\"responseKey\":\"subTitle\",\"type\":\"string\"}],\"request\":{\"method\":\"GET\",\"query\":{\"ids\":\"{item_id}\"},\"maxIdsPerCall\":50}}"; req PUT "apis/$P/design" $T/d.json; }
design price
json $T/t.json '{"name":"Jivox axas"}'; req POST "apis/$P/tokens" $T/t.json; TA=$(b 'o.token'); TAID=$(b 'o.tokenInfo.id')
json $T/t.json '{"name":"Jivox msw"}'; req POST "apis/$P/tokens" $T/t.json; TM=$(b 'o.token'); TMID=$(b 'o.tokenInfo.id')
req POST "apis/$P/publish"
json $T/ag.json "{\"name\":\"axas · Agent 1\",\"tokenId\":\"$TAID\",\"mcpUrl\":\"http://127.0.0.1:$FAKE_PORT$PA\",\"accessKey\":\"$KEY1\"}"; req POST "apis/$P/agents" $T/ag.json; A=$(b 'o.agent.id')
json $T/ag.json "{\"name\":\"msw · Agent 1\",\"tokenId\":\"$TMID\",\"mcpUrl\":\"http://127.0.0.1:$FAKE2$PB\",\"accessKey\":\"$KEY2\"}"; req POST "apis/$P/agents" $T/ag.json; BB=$(b 'o.agent.id')
for x in $A $BB; do req POST "apis/$P/agents/$x/read-jivox"; done
studio $FAKE_PORT "$KEY1" $PA "$TA"; studio $FAKE2 "$KEY2" $PB "$TM"
check "setup: agents read from their own Jivox (own key): sub_title / current_price + sub_title" "sub_title|current_price,sub_title" "$(agent $A 'fields.join()')|$(agent $BB 'fields.join()')"

echo "1. Submit"
submit $A $T/plain.json
check "with the checklist ✗ (base_url: localhost) → 409 CHECKLIST_FAILED, nothing sent" "409 CHECKLIST_FAILED 0" "$(code) $(b 'o.error.code') $(grep -c submit_contract $T/f1.log)"
submit $A; SA=$(cat $T/body); submit $BB; SB=$(cat $T/body)
check "anyway → both verified v1, each with ONLY its fields, each on its own Jivox" "verified 1 verified 1|item_id,sub_title|item_id,current_price,sub_title" "$(ex 'o.action.outcome+" "+o.action.version' <<< "$SA") $(ex 'o.action.outcome+" "+o.action.version' <<< "$SB")|$(curl -s "http://127.0.0.1:$FAKE_PORT/__state?path=$PA" -H "Authorization: Bearer $KEY1" | ex 'o.versions[0].fields.join()')|$(curl -s "http://127.0.0.1:$FAKE2/__state?path=$PB" -H "Authorization: Bearer $KEY2" | ex 'o.versions[0].fields.join()')"
check "  Jivox's sentence (qa3's 'note') shown; sent anyway with base_url ✗; both contracts call the SAME URL" "yes base_url same" "$(ex '/activate_contract\(version=1\)/.test(o.action.message)?"yes":"no"' <<< "$SA") $(ex 'o.action.failedChecks.join()' <<< "$SA") $([ "$(req GET "apis/$P/agents/$A/jivox/actions/$(ex 'o.action.id' <<< "$SA")"; b 'o.action.document.base_url+o.action.document.request.path')" == "$(req GET "apis/$P/agents/$BB/jivox/actions/$(ex 'o.action.id' <<< "$SB")"; b 'o.action.document.base_url+o.action.document.request.path')" ] && echo same || echo different)"

echo "2. Activate both"
activate $A 1; AA=$(b 'o.action.outcome+" "+JSON.stringify(o.action.retired)'); activate $BB 1
check "both activated v1, nothing retired (previous_active null)" "activated null|activated null" "$AA|$(b 'o.action.outcome+" "+JSON.stringify(o.action.retired)')"
check "  table summaries: v1 active each; agents' contracts up to date vs what they submitted" "1 1 false false submit" "$(agent $A 'jivoxActions.activeVersion') $(agent $BB 'jivoxActions.activeVersion') $(agent $A 'contract.outOfDate') $(agent $BB 'contract.outOfDate') $(agent $A 'contract.last.how')"
req GET "apis/$P/agents/$BB/jivox/versions"
check "  versions (live from Jivox): v1 active, submitted here by us" "[[1,true]] $EMAIL" "$(b 'o.versions.map(v=>[v.version,v.active])') $(b 'o.versions[0].submittedHere.by')"

echo "3. A design change that touches only agent B"
design amount
check "current_price's key renamed → B out of date ('current_price: key price → amount'), A not" "true current_price: key price → amount|false" "$(agent $BB 'contract.outOfDate') $(agent $BB 'contract.changes.join()')|$(agent $A 'contract.outOfDate')"
submit $BB; V2=$(b 'o.action.version'); activate $BB $V2
check "B: submit → v2 verified → activate → v1 retired (qa3's previous_active)" "2 activated 1" "$V2 $(b 'o.action.outcome') $(b 'o.action.retired')"
req GET "apis/$P/agents/$BB/jivox/versions"
check "  B's versions: only v2, active (retired versions aren't listed); A still v1 active" "[[2,true]] 1" "$(b 'o.versions.map(v=>[v.version,v.active])') $(agent $A 'jivoxActions.activeVersion')"

echo "4. A deliberate failure on A"
json $T/p.json '{"sampleIds":["NOPE-1"]}'; req PATCH "apis/$P/agents/$A" $T/p.json; submit $A
check "unknown sample id → failed, no version; ONE line (Jivox-style), hint → Edit the agent" "failed null 1 agent" "$(b 'o.action.outcome') $(b 'JSON.stringify(o.action.version)') $(b 'o.action.problems.length') $(b 'o.action.hints.map(h=>h.place).join()')"
check "  A's v1 is still the active one (a failed submit changes nothing in Jivox)" "1 v1 active" "$(req GET "apis/$P/agents/$A/jivox/versions"; b 'o.activeVersion') $(agent $A 'jivoxActions.activeVersion' | sed 's/^/v/') active"
json $T/p.json '{"sampleIds":[]}'; req PATCH "apis/$P/agents/$A" $T/p.json

echo "5. One action at a time per agent"
curl -s -o /dev/null -X POST "http://127.0.0.1:$FAKE_PORT/__control" -H "Authorization: Bearer $KEY1" -H "$H" -d "{\"path\":\"$PA\",\"submit\":\"slow\"}"
PIDS=""; for i in 1 2 3 4; do (curl -s -o /dev/null -w '%{http_code}\n' -b $T/a -X POST "$API/organizations/$S/apis/$P/agents/$A/jivox/submit" -H "$H" -d @$T/any.json >> $T/burst) & PIDS="$PIDS $!"; done
sleep 1; submit $BB; BOTH=$(b 'o.action.outcome'); wait $PIDS
check "4 submits at once on A → 1 sent, 3 × 409; B meanwhile → its own submit fine" "1 3 verified" "$(grep -c 200 $T/burst) $(grep -c 409 $T/burst) $BOTH"
curl -s -o /dev/null -X POST "http://127.0.0.1:$FAKE_PORT/__control" -H "Authorization: Bearer $KEY1" -H "$H" -d "{\"path\":\"$PA\",\"submit\":\"\"}"

echo "6. History"
req GET "apis/$P/agents/$A/jivox/actions"
check "A's history, newest first: submit (slow) · submit failed · activate · submit verified" "submit:verified,submit:failed,activate:activated,submit:verified" "$(b 'o.actions.map(a=>a.kind+":"+a.outcome).join()')"
FIRST=$(b 'o.actions.at(-1).id')
req GET "apis/$P/agents/$A/jivox/actions/$FIRST"
check "  one in full: the contract sent + Jivox's raw answer (qa3 shape: note, contract, verification)" "contract/1 verified true" "$(b 'o.action.document.contract_format') $(b 'o.action.answer.status') $(b 'o.action.answer.verification.passed')"
check "  that action through agent B's path → 404" "404" "$(req GET "apis/$P/agents/$BB/jivox/actions/$FIRST"; code)"

echo "7. Jivox's verification calls in OUR Recent calls"
curl -s -b $T/a "$API/organizations/$S/apis/$P/recent-calls" > $T/rc
check "the fake's verification calls are there, with each agent's token name" "yes yes" "$(ex 'o.calls.some(c=>c.tokenName==="Jivox axas")?"yes":"no"' < $T/rc) $(ex 'o.calls.some(c=>c.tokenName==="Jivox msw")?"yes":"no"' < $T/rc)"

echo "8. Nothing secret"
check "no token / access key in any answer of this run" "0" "$(n=0; for x in "$TA" "$TM" "$KEY1" "$KEY2"; do n=$((n + $(grep -cF -e "${x:6}" $T/all))); done; echo $n)"
check "  nor in the stored actions" "0" "$(psql "$DB" -tAc "SELECT count(*) FROM jivox_contract_actions WHERE agent_id IN ('$A','$BB') AND (coalesce(answer::text,'')||coalesce(document::text,'')||coalesce(error_message,'')) ~ '(${TA:6:20}|${TM:6:20}|${KEY1:6:20}|${KEY2:6:20})'")"
if [ -n "$LOG_FILE" ] && [ -f "$LOG_FILE" ]; then
  tail -c +$((LOG_START+1)) "$LOG_FILE" > $T/log.part
  check "  nor in the backend log ($(wc -l < $T/log.part | tr -d ' ') lines of this run)" "0" "$(n=0; for x in "$TA" "$TM" "$KEY1" "$KEY2"; do n=$((n + $(grep -cF -e "${x:6}" $T/log.part))); done; echo $n)"
else echo "  (LOG_FILE not set: log check skipped)"; fi

echo "9. Removing an agent"
req DELETE "apis/$P/agents/$BB"
check "B removed → its history gone; A's stays, A still v1 active" "204 0 yes 1" "$(code) $(psql "$DB" -tAc "SELECT count(*) FROM jivox_contract_actions WHERE agent_id='$BB'") $([ "$(psql "$DB" -tAc "SELECT count(*) FROM jivox_contract_actions WHERE agent_id='$A'")" -gt 0 ] && echo yes || echo no) $(agent $A 'jivoxActions.activeVersion')"

psql "$DB" -qtAc "DELETE FROM users WHERE email='$EMAIL'" >/dev/null
kill $F1 $F2 2>/dev/null; wait $F1 $F2 2>/dev/null; trap - EXIT
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
