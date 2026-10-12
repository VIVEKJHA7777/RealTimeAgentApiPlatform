#!/bin/bash
# Task 7.4: test switches. Each of the 12 makes /v1 answer wrongly in its one way (and the call log names it);
# options checked; scope (whole API / one token = one agent); several at once in the fixed order; the app's own
# checks (self-check, Try it) untouched unless ticked; the CONTRACT never; expiry (ignored at once, "ended" line,
# the 30 s sweeper); audit lines; Renew carries a scoped switch; races; another account can't touch them.
# Usage (backend running with `npm run dev`), from the project folder:
#   DB_URL="$(grep -o 'postgresql://[^"]*' backend/.env)" API=localhost:4001/api bash docs/test-scripts/phase-07-task-7.4-switches.sh
#   SKIP_SWEEP=1 skips the 30 s wait for the background sweeper.
API="${API:-localhost:4000/api}"
V="${API%/api}/v1"; [[ "$V" == http* ]] || V="http://$V"
DB="${DB_URL:-postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV="$SCRIPT_DIR/../test-data/csv"
H='content-type: application/json'
curl -s -o /dev/null --max-time 3 "$API/health" || { echo "Backend not reachable at $API"; exit 1; }

T=$(mktemp -d); PASS=0; FAIL=0
check() { if [ "$2" == "$3" ]; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1  (expected: $2, got: $3)"; fi; }
ex() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);const v=eval(process.argv[1]);console.log(typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('JSON-ERROR')}})" "$1"; }
b() { ex "$1" < $T/body; }
r() { ex "$1" < $T/v1; }   # the /v1 answer
code() { cat $T/code; }
req() { if [ -n "$3" ]; then curl -s -o $T/body -w '%{http_code}' -b $T/a -X $1 "$API/organizations/$S/$2" -H "$H" -d @"$3" > $T/code; else curl -s -o $T/body -w '%{http_code}' -b $T/a -X $1 "$API/organizations/$S/$2" > $T/code; fi; }
json() { printf '%s' "$2" > "$1"; }
sql() { psql "$DB" -qtAc "$1"; }
# sw KIND '{body}' → PUT the switch (status in $T/code) · off [KIND] → DELETE
sw() { if [ -n "$2" ]; then json $T/sw.json "$2"; else json $T/sw.json '{}'; fi; req PUT "apis/$P/switches/$1" $T/sw.json; }
off() { req DELETE "apis/$P/switches${1:+/$1}"; }
# call N TOKEN QUERY [curl args] → /v1 answer in $T/v1, headers $T/v1h, status $T/v1c, ms $T/ms; tagged N in the log
call() { local n=$1 tok=$2 q=$3; shift 3; local s=$(node -e 'console.log(Date.now())'); curl -s -o $T/v1 -D $T/v1h -w '%{http_code}' -H "x-test-n: $n" ${tok:+-H "X-Api-Key: $tok"} "$@" "$V/$S/$P?$q" > $T/v1c; echo $(( $(node -e 'console.log(Date.now())') - s )) > $T/ms; }
hdr() { grep -i "^$1:" $T/v1h | cut -d' ' -f2- | tr -d '\r'; }
logged() { for i in $(seq 1 30); do x=$(sql "SELECT $2 FROM api_call_logs WHERE request_headers->>'x-test-n' = '$1' LIMIT 1"); [ -n "$x" ] && { echo "$x"; return; }; sleep 0.1; done; echo "(not logged)"; }
lastevent() { sql "SELECT concat_ws(' ', event->>'action', event->>'switch', event->>'by') FROM api_call_logs WHERE api_id = '$PID' AND kind = 'switch' ORDER BY id DESC LIMIT 1"; }
OK="ids=SKU-1001,SKU-1002&market=US"

EMAIL="sw-$RANDOM$RANDOM@test.com"
curl -s -o /dev/null -c $T/a -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
S=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d "{\"name\":\"Switches\",\"slug\":\"switches-$RANDOM\"}" | ex 'o.organization.slug')
B=$(curl -s -b $T/a -X POST "$API/organizations/$S/data-sources" -F "file=@$CSV/e2e-products-v1.csv" -F "idColumn=sku" -F "name=Products")
DS=$(echo "$B" | ex 'o.dataSource.id')
for i in $(seq 1 100); do s=$(curl -s -b $T/a "$API/organizations/$S/data-sources/$DS/imports/$(echo "$B" | ex 'o.import.id')" | ex 'o.import.status'); [ "$s" == succeeded ] && break; sleep 0.1; done
P=broken-on-purpose
json $T/api.json "{\"name\":\"$P\",\"slug\":\"$P\",\"dataSourceId\":\"$DS\"}"; req POST apis $T/api.json
json $T/d.json '{"version":0,"idField":{"responseKey":"id"},"fields":[{"jivoxColumn":"sub_title","sourceColumn":"Product Name","responseKey":"sub","type":"string"},{"jivoxColumn":"current_price","sourceColumn":"priceUSD","responseKey":"price","type":"float"}],"request":{"method":"GET","query":{"ids":"{item_id}","market":"US"},"maxIdsPerCall":25}}'
req PUT "apis/$P/design" $T/d.json
json $T/t.json '{"name":"Agent 1 token"}'; req POST "apis/$P/tokens" $T/t.json; TA=$(b 'o.token'); IA=$(b 'o.tokenInfo.id')
json $T/t.json '{"name":"Agent 2 token"}'; req POST "apis/$P/tokens" $T/t.json; TB=$(b 'o.token'); IB=$(b 'o.tokenInfo.id')
json $T/ag.json "{\"name\":\"Agent 1\",\"tokenId\":\"$IA\",\"fields\":[\"sub_title\",\"current_price\"]}"; req POST "apis/$P/agents" $T/ag.json; A1=$(b 'o.agent.id')
json $T/ag.json "{\"name\":\"Agent 2\",\"tokenId\":\"$IB\"}"; req POST "apis/$P/agents" $T/ag.json
req POST "apis/$P/publish"
PID=$(sql "SELECT a.id FROM apis a JOIN organizations o ON o.id = a.organization_id WHERE o.slug = '$S' AND a.slug = '$P'")

echo "0. Nothing on"
req GET "apis/$P/switches"
check "12 switches in the catalogue, each saying what Jivox should report; none on" "200 12 yes 0" "$(code) $(b 'o.catalogue.length') $(b 'o.catalogue.every(c=>c.label&&c.does&&c.jivoxShould)?"yes":"no"') $(b 'o.switches.length')"
call 0 "$TA" "$OK"
check "a normal answer: 200, 2 items, no-store, JSON; nothing recorded" "200 2 no-store {}" "$(cat $T/v1c) $(r 'o.data.length') $(hdr cache-control) $(logged 0 switches)"

echo "1. Each switch (whole API)"
sw no_store; call 1 "$TA" "$OK"
check "no_store → no Cache-Control (data unchanged); log: {no_store}, our headers without it" "200 2  {no_store} f" "$(cat $T/v1c) $(r 'o.data.length') $(hdr cache-control) $(logged 1 switches) $(logged 1 "response_headers ? 'cache-control'")"
check "  audit line: on no_store by the owner" "on no_store $EMAIL" "$(lastevent)"
off no_store
check "  off → audit line; the next call has no-store again" "off no_store $EMAIL no-store" "$(lastevent) $(call 1b "$TA" "$OK"; hdr cache-control)"
sw status_failure; call 2 "$TA" "$OK"
check "status_failure → envelope status failure, data kept, HTTP 200" "200 failure 2 {status_failure}" "$(cat $T/v1c) $(r 'o.status') $(r 'o.data.length') $(logged 2 switches)"; off status_failure
sw duplicate_id; call 3 "$TA" "$OK"
check "duplicate_id → the first item twice (3 items: 1001, 1002, 1001)" "SKU-1001,SKU-1002,SKU-1001 {duplicate_id}" "$(r 'o.data.map(d=>d.id).join()') $(logged 3 switches)"; off duplicate_id
sw drop_id; call 4 "$TA" "$OK"
check "drop_id → the LAST asked id left out (data 1001 only, no error for 1002)" "SKU-1001 0 {drop_id}" "$(r 'o.data.map(d=>d.id).join()') $(r 'o.errors.length') $(logged 4 switches)"
call 4b "$TA" "ids=SKU-1001,NOPE&market=US"
check "  last id unknown → its NOT_FOUND error left out too" "SKU-1001 0" "$(r 'o.data.map(d=>d.id).join()') $(r 'o.errors.length')"; off drop_id
sw extra_id; call 5 "$TA" "$OK"
check "extra_id → an item for NOT-REQUESTED-1 added" "SKU-1001,SKU-1002,NOT-REQUESTED-1 {extra_id}" "$(r 'o.data.map(d=>d.id).join()') $(logged 5 switches)"; off extra_id
sw item_without_id; call 6 "$TA" "$OK"
check "item_without_id → the first item has no id key" "false true {item_without_id}" "$(r '"id" in o.data[0]') $(r '"id" in o.data[1]') $(logged 6 switches)"; off item_without_id
sw wrong_type '{"options":{"field":"sub"}}'; call 7 "$TA" "$OK"
check "wrong_type sub (text) → 12345 (a number) in every item" "number,number {wrong_type}" "$(r 'o.data.map(d=>typeof d.sub).join()') $(logged 7 switches)"
sw wrong_type '{"options":{"field":"price"}}'; call 7b "$TA" "$OK"
check "  changed to price (a number) → \"abc\"; audit: changed" "abc,abc changed wrong_type" "$(r 'o.data.map(d=>d.price).join()') $(lastevent | cut -d' ' -f1-2)"; off wrong_type
sw slow '{"options":{"ms":1200}}'; call 8 "$TA" "$OK"
check "slow 1 200 ms → answered after ≥ 1.2 s, data fine; the log's duration says so" "yes 200 2 {slow} yes" "$( [ $(cat $T/ms) -ge 1200 ] && echo yes || echo no) $(cat $T/v1c) $(r 'o.data.length') $(logged 8 switches) $( [ "$(logged 8 'duration_ms::int')" -ge 1200 ] && echo yes || echo no)"
sw slow; check "  slow without options → 3 500 ms (Jivox allows 3 s)" "3500" "$(b 'o.switches.find(s=>s.kind==="slow").options.ms')"; off slow
sw http_status '{"options":{"status":503}}'; call 9 "$TA" "$OK"
check "http_status 503 → 503 + Retry-After + failure envelope (SERVICE_BUSY, says it's a test switch), still no-store" "503 1 failure SERVICE_BUSY yes no-store {http_status}" "$(cat $T/v1c) $(hdr retry-after) $(r 'o.status') $(r 'o.errors[0].error_code') $(r 'o.errors[0].error_message.includes("Test switch")?"yes":"no"') $(hdr cache-control) $(logged 9 switches)"
sw http_status; call 9b "$TA" "$OK"
check "  no options → 500 INTERNAL_ERROR" "500 INTERNAL_ERROR" "$(cat $T/v1c) $(r 'o.errors[0].error_code')"
check "  every allowed status answers as itself" "400 401 403 404 429 500 502 503" "$(for s in 400 401 403 404 429 500 502 503; do sw http_status "{\"options\":{\"status\":$s}}"; call 9c "$TA" "$OK"; printf '%s ' $(cat $T/v1c); done | sed 's/ $//')"; off http_status
sw empty_data; call 10 "$TA" "ids=SKU-1001,NOPE&market=US"
check "empty_data → data [] AND errors [], status success" "200 success 0 0 {empty_data}" "$(cat $T/v1c) $(r 'o.status') $(r 'o.data.length') $(r 'o.errors.length') $(logged 10 switches)"; off empty_data
sw not_json; call 11 "$TA" "$OK"
check "not_json → plain text (not parseable), text/plain, still no-store; log: no envelope status" "200 JSON-ERROR text/plain; charset=utf-8 no-store {not_json} none" "$(cat $T/v1c) $(r 'o.status') $(hdr content-type) $(hdr cache-control) $(logged 11 switches) $(logged 11 "coalesce(envelope_status,'none')")"; off not_json
sw strict; call 12 "$TA" "$OK"
check "strict, a matching call → normal 200 (strict not recorded: it changed nothing)" "200 2 {}" "$(cat $T/v1c) $(r 'o.data.length') $(logged 12 switches)"
call 12b "$TA" "ids=SKU-1001&market=UK"
check "  market=UK → 400 BAD_REQUEST naming it; recorded" "400 BAD_REQUEST yes {strict}" "$(cat $T/v1c) $(r 'o.errors[0].error_code') $(r 'o.errors[0].error_message.includes("market: expected \"US\", got \"UK\"")?"yes":"no"') $(logged 12b switches)"
call 12c "$TA" "ids=SKU-1001"
check "  market missing → 400 \"market: missing\"" "400 yes" "$(cat $T/v1c) $(r 'o.errors[0].error_message.includes("market: missing")?"yes":"no"')"; off strict

echo "2. Options and scope checked"
for c in 'wrong_type|{}|options.field' 'wrong_type|{"options":{"field":"nope"}}|options.field' 'slow|{"options":{"ms":0}}|options.ms' 'slow|{"options":{"ms":40000}}|options.ms' 'http_status|{"options":{"status":418}}|options.status' 'no_store|{"options":{"x":1}}|options' "no_store|{\"tokenId\":\"nope\"}|tokenId" 'no_store|{"minutes":0}|minutes' 'no_store|{"minutes":1441}|minutes'; do
  IFS='|' read K BODY FIELD <<< "$c"; sw "$K" "$BODY"; R="$R$(code):$(b 'o.error.details[0].field') "
done
check "9 wrong settings → 400 on the right field" "400:options.field 400:options.field 400:options.ms 400:options.ms 400:options.status 400:options 400:tokenId 400:minutes 400:minutes " "$R"
sw wrong_type '{"options":{"field":"nope"}}'
check "  a field not in the answer → the message lists the API's fields" "yes" "$(b 'o.error.message.includes("sub, price")?"yes":"no"')"
check "  an unknown switch → 400 · nothing was turned on by the refused ones" "400 0" "$(sw make_it_rain; code) $(req GET "apis/$P/switches"; b 'o.switches.length')"

echo "3. Scope: one agent's token"
sw drop_id "{\"tokenId\":\"$IB\"}"
check "drop_id for Agent 2's token only: listed with its token and agent" "Agent 2 token:Agent 2" "$(b 'o.switches[0].scope.tokenName+":"+o.switches[0].scope.agents.map(a=>a.name).join()')"
call 13 "$TA" "$OK"; A=$(r 'o.data.length'); call 13b "$TB" "$OK"
check "  Agent 1's call: untouched (2 items) · Agent 2's: dropped (1)" "2 1 {} {drop_id}" "$A $(r 'o.data.length') $(logged 13 switches) $(logged 13b switches)"
check "  the log's filter switched=yes finds Agent 2's call" "yes" "$(req GET "apis/$P/logs?switched=yes&token=$IB"; b 'o.entries.some(e=>e.switches.includes("drop_id"))?"yes":"no"')"
check "  calls without a working token are never switched (401 as usual)" "401 no-store" "$(call 13c "" "$OK"; cat $T/v1c) $(hdr cache-control)"
off drop_id

echo "4. Several at once, in the fixed order"
sw empty_data; sw extra_id; call 14 "$TA" "$OK"
check "empty_data + extra_id → only the extra item (empty first, then the extra)" "NOT-REQUESTED-1 {empty_data,extra_id}" "$(r 'o.data.map(d=>d.id).join()') $(logged 14 switches)"
sw status_failure; sw http_status '{"options":{"status":500}}'; call 15 "$TA" "$OK"
check "  + http_status 500 → 500 first: the answer is never built, only http_status recorded" "500 {http_status}" "$(cat $T/v1c) $(logged 15 switches)"
off; sw no_store; sw not_json; call 16 "$TA" "$OK"
check "  no_store + not_json → text without Cache-Control" "text/plain; charset=utf-8  {no_store,not_json}" "$(hdr content-type) $(hdr cache-control) $(logged 16 switches)"
off
check "turn all off → both off (no_store, not_json); none left" "0 2" "$(b 'o.switches.length') $(b 'o.turnedOff')"
check "  turning off what isn't on → 200, nothing written" "200 0 off not_json $EMAIL" "$(off drop_id; code) $(b 'o.turnedOff') $(lastevent)"

echo "5. The app's own checks (P7-3) and the contract"
req GET "apis/$P/agents/$A1/contract"; CONTRACT=$(b 'JSON.stringify(o.document).replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g,"")')
sw drop_id
req POST "apis/$P/agents/$A1/contract/check"; CL=$(b 'o.checks.find(c=>c.id==="ids_once").status')
req POST "apis/$P/self-check"; SC=$(b 'o.passed'); req POST "apis/$P/try"
check "drop_id NOT ticked: checklist ids ✓, self-check passes, Try it untouched (no switch applied)" "pass true 2 []" "$CL $SC $(b 'o.response.body.data.length') $(b 'o.response.switches')"
sw drop_id '{"applyToOwnChecks":true}'
req POST "apis/$P/self-check"; SC=$(b 'o.passed'); req POST "apis/$P/try"
check "ticked: the self-check now fails, Try it shows 1 item and names drop_id" "false 1 [\"drop_id\"]" "$SC $(b 'o.response.body.data.length') $(b 'o.response.switches')"
req POST "apis/$P/agents/$A1/contract/check"
check "  ticked: the checklist's live call (Agent 1's token) sees it, like Jivox would" "fail SKU-1002 is missing" "$(b 'o.checks.find(c=>c.id==="ids_once").status+" "+o.checks.find(c=>c.id==="ids_once").detail')"
req GET "apis/$P/agents/$A1/contract"
check "  the CONTRACT (what is submitted to Jivox) is never changed by a switch" "same" "$( [ "$(b 'JSON.stringify(o.document).replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g,"")')" == "$CONTRACT" ] && echo same || echo changed)"
sw drop_id "{\"applyToOwnChecks\":true,\"tokenId\":\"$IB\"}"; req POST "apis/$P/try"
check "  a one-token switch never reaches Try it (it has no token)" "2 []" "$(b 'o.response.body.data.length') $(b 'o.response.switches')"
off

echo "6. Ending by itself"
sw no_store '{"minutes":15}'
check "15 minutes → ends 15 min from now" "yes" "$(b '(new Date(o.switches[0].endsAt)-new Date(o.now))/60000>14.9&&(new Date(o.switches[0].endsAt)-new Date(o.now))/60000<=15?"yes":"no"')"
sql "UPDATE api_test_switches SET ends_at = created_at + interval '1 millisecond' WHERE api_id = '$PID'" >/dev/null
call 17 "$TA" "$OK"
check "ended (time passed) → /v1 ignores it at once, before any sweep" "no-store {}" "$(hdr cache-control) $(logged 17 switches)"
req GET "apis/$P/switches"
check "  the list ends it and writes an \"ended\" line (by nobody, at its end time)" "0 ended no_store" "$(b 'o.switches.length') $(lastevent)"
if [ -z "$SKIP_SWEEP" ]; then
  sw status_failure; sql "UPDATE api_test_switches SET ends_at = created_at + interval '1 millisecond' WHERE api_id = '$PID'" >/dev/null
  for i in $(seq 1 35); do [ "$(lastevent)" == "ended status_failure" ] && break; sleep 1; done
  check "  nobody looking: the background sweeper (every 30 s) ends it too" "ended status_failure 0" "$(lastevent) $(sql "SELECT count(*) FROM api_test_switches WHERE api_id = '$PID'")"
fi

echo "7. Renew and revoke"
sw extra_id "{\"tokenId\":\"$IB\"}"
json $T/r.json '{}'; req POST "apis/$P/tokens/$IB/renew" $T/r.json; TB2=$(b 'o.token'); IB2=$(b 'o.tokenInfo.id')
req GET "apis/$P/switches"
check "Renew Agent 2's token → the switch follows the new token (and Agent 2)" "$IB2 Agent 2" "$(b 'o.switches[0].scope.tokenId') $(b 'o.switches[0].scope.agents.map(a=>a.name).join()')"
call 18 "$TB2" "$OK"
check "  the new token's calls are switched; the old one gets 401" "3 401" "$(r 'o.data.length') $(call 18b "$TB" "$OK"; cat $T/v1c)"
req DELETE "apis/$P/tokens/$IB2"
check "revoke that token → allowed; the switch stays, shown as revoked; aiming a NEW switch at it is refused" "true 400" "$(req GET "apis/$P/switches"; b 'o.switches[0].scope.revoked') $(sw drop_id "{\"tokenId\":\"$IB2\"}"; code)"
off

echo "8. Races"
N0=$(sql "SELECT count(*) FROM api_call_logs WHERE api_id = '$PID' AND kind = 'switch'")
for k in no_store no_store no_store status_failure status_failure duplicate_id extra_id empty_data not_json strict; do curl -s -o /dev/null -b $T/a -X PUT "$API/organizations/$S/apis/$P/switches/$k" -H "$H" -d '{}' & done; wait
check "10 changes at once (3 × no_store, 2 × status_failure, 5 others) → 7 switches, 10 audit lines: 7 on + 3 changed" "7 10 7 3" "$(sql "SELECT count(*) FROM api_test_switches WHERE api_id = '$PID'") $(sql "SELECT count(*), count(*) FILTER (WHERE event->>'action' = 'on'), count(*) FILTER (WHERE event->>'action' = 'changed') FROM api_call_logs WHERE api_id = '$PID' AND kind = 'switch' AND id > (SELECT coalesce(max(id),0) FROM api_call_logs WHERE api_id = '$PID' AND kind = 'switch' AND event->>'action' = 'off')" | tr '|' ' ')"
off
cat > $T/flip.mjs <<'EOF'
const [v, tok, n] = process.argv.slice(2);
const res = await Promise.all(Array.from({ length: Number(n) }, async () => {
  const r = await fetch(v, { headers: { 'X-Api-Key': tok } }); const t = await r.text();
  return `${r.status}:${r.headers.get('cache-control') ?? 'none'}:${JSON.parse(t).data.length}`;
}));
const kinds = [...new Set(res)].sort();
console.log(kinds.join(' '));
EOF
( for i in $(seq 1 6); do curl -s -o /dev/null -b $T/a -X PUT "$API/organizations/$S/apis/$P/switches/no_store" -H "$H" -d '{}'; curl -s -o /dev/null -b $T/a -X DELETE "$API/organizations/$S/apis/$P/switches/no_store"; done ) &
FLIP=$(node $T/flip.mjs "$V/$S/$P?$OK" "$TA" 200); wait
check "200 calls while no_store flips on/off 6 times → every answer 200 with 2 items, each with or without no-store" "yes" "$(echo "$FLIP" | tr ' ' '\n' | grep -v -E '^200:(no-store|none):2$' | grep -q . && echo "no: $FLIP" || echo yes)"

echo "9. Only the owner"
E2="sw2-$RANDOM$RANDOM@test.com"; curl -s -o /dev/null -c $T/a2 -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$E2\",\"password\":\"password123\"}"
check "another account: list / turn on / turn off → 404; nothing on" "404 404 404 0" "$(curl -s -o /dev/null -w '%{http_code}' -b $T/a2 "$API/organizations/$S/apis/$P/switches") $(curl -s -o /dev/null -w '%{http_code}' -b $T/a2 -X PUT "$API/organizations/$S/apis/$P/switches/no_store" -H "$H" -d '{}') $(curl -s -o /dev/null -w '%{http_code}' -b $T/a2 -X DELETE "$API/organizations/$S/apis/$P/switches") $(sql "SELECT count(*) FROM api_test_switches WHERE api_id = '$PID'")"

sql "DELETE FROM users WHERE email IN ('$EMAIL', '$E2')" >/dev/null
sql "DELETE FROM organizations WHERE slug='$S'" >/dev/null
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
