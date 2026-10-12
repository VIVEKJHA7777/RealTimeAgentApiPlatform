#!/bin/bash
# Task 6.4: Submit / Versions / Activate / History endpoints, against the FAKE Jivox (nothing touches qa3).
# On a laptop the checklist always has one ✗ (base_url: localhost), which tests the 409 and "anyway".
#   0 setup (published API, two agents read from the fake) · 1 refusals before sending (not connected,
#   checklist ✗) · 2 submit anyway: failed (no Studio token) → verified v1 · 3 versions + activate,
#   retire · 4 refused activations · 5 busy (one at a time per agent; two agents fine) · 6 history +
#   details · 7 Jivox unreachable / errors / wrong key (recorded, 200) · 8 out of date vs the submitted
#   contract · 9 nothing secret stored · 10 who may · 11 removing an agent removes its history.
# SLOW=1 adds the 60 s timeout case.
#
# Usage (backend running with `npm run dev`), from the project folder:
#   DB_URL="$(grep -o 'postgresql://[^"]*' backend/.env)" API=localhost:4001/api bash docs/test-scripts/phase-06-task-6.4-endpoints.sh
API="${API:-localhost:4000/api}"
DB="${DB_URL:-postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV="$SCRIPT_DIR/../test-data/csv"
FAKE_PORT="${FAKE_PORT:-4802}"
H='content-type: application/json'
curl -s -o /dev/null --max-time 3 "$API/health" || { echo "Backend not reachable at $API"; exit 1; }
lsof -nP -iTCP:$FAKE_PORT -sTCP:LISTEN >/dev/null && { echo "Port $FAKE_PORT is busy: set FAKE_PORT"; exit 1; }

T=$(mktemp -d); PASS=0; FAIL=0
check() { if [ "$2" == "$3" ]; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1  (expected: $2, got: $3)"; fi; }
ex() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);const v=eval(process.argv[1]);console.log(typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('JSON-ERROR')}})" "$1"; }
code() { cat $T/code; }
body() { cat $T/body; }
b() { ex "$1" < $T/body; }
req() { if [ -n "$4" ]; then curl -s -o $T/body -w '%{http_code}' -b $T/$1 -X $2 "$API/organizations/$S/$3" -H "$H" -d @"$4" > $T/code; else curl -s -o $T/body -w '%{http_code}' -b $T/$1 -X $2 "$API/organizations/$S/$3" > $T/code; fi; cat $T/body >> $T/all; }
json() { printf '%s' "$2" > "$1"; }
json $T/anyway.json '{"anyway":true}'; json $T/plain.json '{}'
submit() { req a POST "apis/$P/agents/$1/jivox/submit" ${2:-$T/anyway.json}; }
activate() { req a POST "apis/$P/agents/$1/jivox/versions/$2/activate"; }
agent() { curl -s -b $T/a "$API/organizations/$S/apis/$P/agents" | ex "o.agents.find(a=>a.id==='$1').$2"; }

export MCP_KEY="bWNwLWF1dGgvZmFrZS0$(openssl rand -hex 12)"
node "$SCRIPT_DIR/phase-05-fake-jivox-mcp.mjs" $FAKE_PORT $T/fake.log "$MCP_KEY" > $T/fake.out 2>&1 & FAKE=$!
trap 'kill $FAKE 2>/dev/null' EXIT
for i in $(seq 1 50); do grep -q "fake MCP" $T/fake.out && break; sleep 0.1; done
F="http://127.0.0.1:$FAKE_PORT"; A1P=/bound/sub_title; A2P=/bound/current_price,sub_title
control() { curl -s -o /dev/null -X POST "$F/__control" -H "Authorization: Bearer $MCP_KEY" -H "$H" --data-binary "$(node -e "const o=JSON.parse(process.argv[1]);o.path=process.argv[2];console.log(JSON.stringify(o))" "$2" "$1")"; }
fakeCalls() { grep -c "\"tool\":\"$1\"" $T/fake.log; }

echo "0. Setup: published API, two agents read from the fake"
EMAIL="ep-$RANDOM$RANDOM@test.com"; EMAIL2="ep2-$RANDOM$RANDOM@test.com"
curl -s -o /dev/null -c $T/a -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
curl -s -o /dev/null -c $T/b -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL2\",\"password\":\"password123\"}"
S=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"Endpoints","slug":"endpoints-64"}' | ex 'o.organization.slug')
B=$(curl -s -b $T/a -X POST "$API/organizations/$S/data-sources" -F "file=@$CSV/e2e-products-v1.csv" -F "idColumn=sku" -F "name=Products")
DS=$(echo "$B" | ex 'o.dataSource.id')
for i in $(seq 1 100); do s=$(curl -s -b $T/a "$API/organizations/$S/data-sources/$DS/imports/$(echo "$B" | ex 'o.import.id')" | ex 'o.import.status'); [ "$s" == succeeded ] && break; sleep 0.1; done
P=prices
json $T/api.json "{\"name\":\"Prices\",\"slug\":\"$P\",\"dataSourceId\":\"$DS\"}"; req a POST "apis" $T/api.json
json $T/d.json '{"version":0,"idField":{"responseKey":"id"},"fields":[{"jivoxColumn":"current_price","sourceColumn":"priceUSD","responseKey":"price","type":"float","onEmpty":"omit"},{"jivoxColumn":"sub_title","sourceColumn":"Product Name","responseKey":"sub","type":"string"}],"request":{"method":"GET","query":{"ids":"{item_id}"},"maxIdsPerCall":50}}'
req a PUT "apis/$P/design" $T/d.json; DV=$(b 'o.design.version')
json $T/t.json '{"name":"Jivox axas"}'; req a POST "apis/$P/tokens" $T/t.json; TA=$(b 'o.token'); TAID=$(b 'o.tokenInfo.id')
json $T/t.json '{"name":"Jivox msw"}'; req a POST "apis/$P/tokens" $T/t.json; TM=$(b 'o.token'); TMID=$(b 'o.tokenInfo.id')
: > $T/all # token answers are not part of the "nothing secret" check below
req a POST "apis/$P/publish"
json $T/ag.json "{\"name\":\"axas · Agent 1\",\"tokenId\":\"$TAID\",\"mcpUrl\":\"$F$A1P\",\"accessKey\":\"$MCP_KEY\"}"; req a POST "apis/$P/agents" $T/ag.json; A1=$(b 'o.agent.id')
json $T/ag.json "{\"name\":\"msw · Agent 1\",\"tokenId\":\"$TMID\",\"mcpUrl\":\"$F$A2P\",\"accessKey\":\"$MCP_KEY\"}"; req a POST "apis/$P/agents" $T/ag.json; A2=$(b 'o.agent.id')
json $T/ag.json '{"name":"hand · not connected","fields":["sub_title"]}'; req a POST "apis/$P/agents" $T/ag.json; A3=$(b 'o.agent.id')
for a in $A1 $A2; do req a POST "apis/$P/agents/$a/read-jivox"; done
check "setup: 3 agents, 2 read from the fake" "200 3" "$(code) $(curl -s -b $T/a "$API/organizations/$S/apis/$P/agents" | ex 'o.agents.length')"

echo "1. Refused before anything is sent (and nothing recorded)"
submit $A3
check "agent without MCP destination / key → 409 AGENT_NOT_CONNECTED" "409 AGENT_NOT_CONNECTED" "$(code) $(b 'o.error.code')"
submit $A1 $T/plain.json
check "checklist has a ✗ (base_url: localhost) → 409 CHECKLIST_FAILED naming it" "409 CHECKLIST_FAILED base_url" "$(code) $(b 'o.error.code') $(b 'o.error.extra.failed.map(f=>f.id).join()')"
check "  nothing sent to Jivox, nothing recorded" "0 0" "$(fakeCalls submit_contract) $(req a GET "apis/$P/agents/$A1/jivox/actions"; b 'o.actions.length')"
json $T/badbody.json '{"anyway":"yes","extra":1}'; submit $A1 $T/badbody.json
check "bad body (anyway not a boolean, unknown key) → 400" "400 VALIDATION_ERROR" "$(code) $(b 'o.error.code')"

echo "2. Submit anyway"
submit $A1
check "no token in Studio yet → 200, action done / failed, with the ✗ it was sent with" "200 done failed base_url" "$(code) $(b 'o.action.state') $(b 'o.action.outcome') $(b 'o.action.failedChecks.join()')"
check "  the record: Jivox host, design version, who; Jivox's problems + OUR hint (Studio)" "127.0.0.1:$FAKE_PORT $DV $EMAIL yes studio" "$(b 'o.action.mcpHost') $(b 'o.action.designVersion') $(b 'o.action.startedBy') $(b 'o.action.problems.some(p=>p.message.startsWith("HTTP 401"))?"yes":"no"') $(b 'o.action.hints.map(h=>h.place).join()')"
control $A1P "{\"studioToken\":\"$TA\"}"
submit $A1
check "token pasted in Studio → verified, version 1" "200 done verified 1" "$(code) $(b 'o.action.state') $(b 'o.action.outcome') $(b 'o.action.version')"
check "  the agent: last contract = the submitted one (up to date); table summary: last submit verified v1, none active" "submit false verified 1 null" "$(agent $A1 'contract.last.how') $(agent $A1 'contract.outOfDate') $(agent $A1 'jivoxActions.lastSubmit.outcome') $(agent $A1 'jivoxActions.lastSubmit.version') $(agent $A1 'jivoxActions.activeVersion')"

echo "3. Versions (live from Jivox) and Activate"
req a GET "apis/$P/agents/$A1/jivox/versions"
check "versions: v1 verified, not active; we know it was submitted here (design version, who)" "200 [[1,\"verified\",false]] null $DV $EMAIL" "$(code) $(b 'o.versions.map(v=>[v.version,v.status,v.active])') $(b 'JSON.stringify(o.activeVersion)') $(b 'o.versions[0].submittedHere.designVersion') $(b 'o.versions[0].submittedHere.by')"
activate $A1 1
check "activate 1 → activated, nothing retired; the table summary says v1 active" "200 activated 1 null 1" "$(code) $(b 'o.action.outcome') $(b 'o.action.version') $(b 'JSON.stringify(o.action.retired)') $(agent $A1 'jivoxActions.activeVersion')"
submit $A1; V2=$(b 'o.action.version'); activate $A1 $V2
check "submit again → v2; activate 2 → v1 retired" "2 activated 1" "$V2 $(b 'o.action.outcome') $(b 'o.action.retired')"
req a GET "apis/$P/agents/$A1/jivox/versions"
check "versions now: only v2, active (retired versions are never listed)" '[[2,"active",true]] 2' "$(b 'o.versions.map(v=>[v.version,v.status,v.active])') $(b 'o.activeVersion')"

echo "4. Refused activations (recorded, explained)"
activate $A1 1
check "activate the retired v1 → refused (not_verified), recorded" "200 done refused not_verified" "$(code) $(b 'o.action.state') $(b 'o.action.outcome') $(b 'o.action.problems[0].code')"
activate $A1 99; check "activate an unknown v99 → refused (unknown_version)" "refused unknown_version" "$(b 'o.action.outcome') $(b 'o.action.problems[0].code')"
activate $A1 0; C0=$(code); activate $A1 abc
check "version 0 / abc → 400 (nothing sent)" "400 400" "$C0 $(code)"
submit $A1; V3=$(b 'o.action.version')
req a POST "apis/$P/unpublish"; activate $A1 $V3
check "activate while our API is unpublished → refused with Jivox's evidence (404) + hint: publish" "refused yes publish" "$(b 'o.action.outcome') $(b 'JSON.stringify(o.action.evidence).includes("404")?"yes":"no"') $(b 'o.action.hints.map(h=>h.place).join()')"
req a POST "apis/$P/publish"

echo "5. One at a time per agent"
control $A1P '{"submit":"slow"}'
(curl -s -o $T/p1 -w '%{http_code}' -b $T/a -X POST "$API/organizations/$S/apis/$P/agents/$A1/jivox/submit" -H "$H" -d @$T/anyway.json > $T/p1c) & W1=$!
sleep 1.2
submit $A1
check "a second submit while the first waits for Jivox → 409 JIVOX_BUSY saying what runs" "409 JIVOX_BUSY submit yes" "$(code) $(b 'o.error.code') $(b 'o.error.extra.running.kind') $(b '/still running \(started \d+ s ago\)/.test(o.error.message)?"yes":"no"')"
activate $A1 $V2; check "  …activate too (one action per agent, any kind)" "409 JIVOX_BUSY" "$(code) $(b 'o.error.code')"
check "  the agents list shows it running" "submit" "$(agent $A1 'jivoxActions.running.kind')"
control $A2P "{\"studioToken\":\"$TM\"}"
submit $A2; check "another agent submits meanwhile → fine (verified, its own v1)" "200 verified 1" "$(code) $(b 'o.action.outcome') $(b 'o.action.version')"
wait $W1
check "the slow first one finishes normally" "200 verified" "$(cat $T/p1c) $(ex 'o.action.outcome' < $T/p1)"
control $A1P '{"submit":""}'
PIDS=""; for i in 1 2 3 4 5 6; do (curl -s -o /dev/null -w '%{http_code}\n' -b $T/a -X POST "$API/organizations/$S/apis/$P/agents/$A2/jivox/submit" -H "$H" -d @$T/anyway.json >> $T/burst) & PIDS="$PIDS $!"; done; wait $PIDS
check "6 submits at once on one agent → 1 sent, 5 × 409 (Jivox got exactly one more)" "1 5" "$(grep -c 200 $T/burst) $(grep -c 409 $T/burst)"

echo "6. History"
req a GET "apis/$P/agents/$A1/jivox/actions"
check "newest first, light rows (no document / answer), every kind" "yes no submit,activate" "$(b 'o.actions[0].startedAt>=o.actions[1].startedAt?"yes":"no"') $(b '"document" in o.actions[0]||"answer" in o.actions[0]?"yes":"no"') $(b '[...new Set(o.actions.map(a=>a.kind))].sort().reverse().join()')"
FIRST=$(b 'o.actions.at(-1).id'); N=$(b 'o.actions.length')
req a GET "apis/$P/agents/$A1/jivox/actions?limit=2"; NEXT=$(b 'o.next')
req a GET "apis/$P/agents/$A1/jivox/actions?limit=2&before=$NEXT"
check "pages of 2 follow on (no repeats)" "2 yes" "$(b 'o.actions.length') $([ "$NEXT" != null ] && echo yes || echo no)"
req a GET "apis/$P/agents/$A1/jivox/actions/$FIRST"
check "one action in full: the document sent + Jivox's answer, explained again" "contract/1 failed studio" "$(b 'o.action.document.contract_format') $(b 'o.action.answer.status') $(b 'o.action.hints.map(h=>h.place).join()')"
req a GET "apis/$P/agents/$A2/jivox/actions/$FIRST"
check "that action through ANOTHER agent's path → 404" "404 ACTION_NOT_FOUND" "$(code) $(b 'o.error.code')"
check "history count = every submit / activate sent for axas ($N)" "$N" "$(psql "$DB" -tAc "SELECT count(*) FROM jivox_contract_actions WHERE agent_id='$A1'")"

echo "7. When Jivox doesn't answer properly (recorded as errors, still 200)"
control $A2P '{"submit":"tool-error"}'; submit $A2
check "the tool answers isError with text → error / bad_answer, Jivox's text kept" "200 error bad_answer yes" "$(code) $(b 'o.action.state') $(b 'o.action.outcome') $(b '/internal error while handling/.test(o.action.errorMessage)?"yes":"no"')"
control $A2P '{"submit":"http500"}'; submit $A2
check "HTTP 500 → error / bad_answer" "error bad_answer" "$(b 'o.action.state') $(b 'o.action.outcome')"
control $A2P '{"submit":""}'
json $T/p.json '{"accessKey":"wrong-key-1234567890"}'; req a PATCH "apis/$P/agents/$A2" $T/p.json; submit $A2
check "a wrong access key → error / auth_failed (with what to do)" "error auth_failed yes" "$(b 'o.action.state') $(b 'o.action.outcome') $(b '/Copy it again from Studio/.test(o.action.errorMessage)?"yes":"no"')"
json $T/p.json "{\"mcpUrl\":\"http://127.0.0.1:4899/mcp\",\"accessKey\":\"$MCP_KEY\"}"; req a PATCH "apis/$P/agents/$A2" $T/p.json; submit $A2
check "Jivox unreachable → error / unreachable (the reason named)" "error unreachable yes" "$(b 'o.action.state') $(b 'o.action.outcome') $(b '/ECONNREFUSED/.test(o.action.errorMessage)?"yes":"no"')"
req a GET "apis/$P/agents/$A2/jivox/versions"
check "versions when unreachable → 502 JIVOX_UNREACHABLE (nothing recorded for a read)" "502 JIVOX_UNREACHABLE" "$(code) $(b 'o.error.code')"
json $T/p.json "{\"mcpUrl\":\"$F$A2P\",\"accessKey\":\"$MCP_KEY\"}"; req a PATCH "apis/$P/agents/$A2" $T/p.json; req a POST "apis/$P/agents/$A2/read-jivox"
if [ -n "$SLOW" ]; then
  control $A2P '{"submit":"hang"}'; t0=$(date +%s); submit $A2; t1=$(date +%s)
  check "Jivox silent for 60 s → error / timeout after ~60 s, saying Jivox may still finish it" "error timeout yes yes" "$(b 'o.action.state') $(b 'o.action.outcome') $([ $((t1-t0)) -ge 59 ] && [ $((t1-t0)) -le 70 ] && echo yes || echo no) $(b '/may still finish it/.test(o.action.errorMessage)?"yes":"no"')"
  control $A2P '{"submit":""}'
fi

echo "8. Out of date compares with what Jivox has"
json $T/d2.json "$(node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1]));d.version=+process.argv[2];d.fields[1].responseKey='subtitle';console.log(JSON.stringify(d))" $T/d.json "$(curl -s -b $T/a "$API/organizations/$S/apis/$P/design" | ex 'o.design.version')")"
req a PUT "apis/$P/design" $T/d2.json; DS2=$(code)
check "design key renamed → axas out of date vs its SUBMITTED contract, with the reason" "200 true submit sub_title: key sub → subtitle" "$DS2 $(agent $A1 'contract.outOfDate') $(agent $A1 'contract.last.how') $(agent $A1 'contract.changes.join()')"
submit $A1
check "submit the new one → verified, up to date again" "verified false" "$(b 'o.action.outcome') $(agent $A1 'contract.outOfDate')"

echo "9. Nothing secret stored or answered"
check "no API token / access key in any answer of this run" "0 0 0" "$(grep -cF -e "${TA:4}" $T/all) $(grep -cF -e "${TM:4}" $T/all) $(grep -cF -e "${MCP_KEY:6}" $T/all)"
check "  nor in the stored actions (documents, answers, messages)" "0" "$(psql "$DB" -tAc "SELECT count(*) FROM jivox_contract_actions WHERE agent_id IN ('$A1','$A2') AND (coalesce(answer::text,'') || coalesce(document::text,'') || coalesce(error_message,'')) ~ '(${TA:4:20}|${TM:4:20}|${MCP_KEY:6:20})'")"

echo "10. Who may"
check "another account → 404 for submit / versions / activate / history" "404 404 404 404" "$(for x in "POST jivox/submit" "GET jivox/versions" "POST jivox/versions/1/activate" "GET jivox/actions"; do set -- $x; req b $1 "apis/$P/agents/$A1/$2"; printf '%s ' $(code); done | sed 's/ $//')"
check "logged out → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/organizations/$S/apis/$P/agents/$A1/jivox/submit" -H "$H" -d '{}')"

echo "11. Removing an agent removes its history (nothing changes in Jivox)"
req a DELETE "apis/$P/agents/$A1"
check "agent removed → its actions gone; msw's stay" "204 0 yes" "$(code) $(psql "$DB" -tAc "SELECT count(*) FROM jivox_contract_actions WHERE agent_id='$A1'") $([ "$(psql "$DB" -tAc "SELECT count(*) FROM jivox_contract_actions WHERE agent_id='$A2'")" -gt 0 ] && echo yes || echo no)"

psql "$DB" -qtAc "DELETE FROM users WHERE email IN ('$EMAIL','$EMAIL2')" >/dev/null
kill $FAKE 2>/dev/null; wait $FAKE 2>/dev/null; trap - EXIT
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
