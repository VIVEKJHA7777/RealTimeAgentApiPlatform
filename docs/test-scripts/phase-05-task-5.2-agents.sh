#!/bin/bash
# Task 5.2 scenario tests: an API's Jivox agents (add / list / edit / remove, write-only access key)
# and "Read from Jivox" against a FAKE Jivox MCP server (phase-05-fake-jivox-mcp.mjs, started here on
# FAKE_PORT and stopped at the end): feed type, id column, bound fields → the agent's fields, live tiers,
# contracts; every failure (wrong key, unreachable, garbage, too large, redirect, other feed type…);
# only read-only tools called; races (same name, 25 creates at once, key changed during a read).
#
# Usage (backend running with `npm run dev`), from any folder:
#   DB_URL="postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_mine" \
#   API=localhost:4001/api bash docs/test-scripts/phase-05-task-5.2-agents.sh
# Optional: LOG_FILE=<backend log file> adds "no access key in the log".
#
# Creates its own test users and deletes ONLY them at the end.
API="${API:-localhost:4000/api}"; BASE="${API%/api}"
DB="${DB_URL:-postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV="$SCRIPT_DIR/../test-data/csv"
FAKE_PORT="${FAKE_PORT:-4791}" # not 4190: fetch refuses that port (on the "bad ports" list)
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
# add NAME_JSON_FIELDS → POST /agents with that JSON body
add() { json $T/ag.json "$1"; req a POST "$S/apis/prices/agents" $T/ag.json; }
patch() { json $T/pa.json "$2"; req a PATCH "$S/apis/prices/agents/$1" $T/pa.json; }
readj() { req a POST "$S/apis/prices/agents/$1/read-jivox"; }
fake() { echo "http://127.0.0.1:$FAKE_PORT/$1"; }

# A fake key shaped like Studio's (base64 text) and a second one.
KEY="bWNwLWF1dGgvZmFrZS0$(openssl rand -hex 12)"; KEY2="bWNwLWF1dGgvb3RoZXIt$(openssl rand -hex 12)"
node "$SCRIPT_DIR/phase-05-fake-jivox-mcp.mjs" $FAKE_PORT $T/fake.log "$KEY" > $T/fake.out 2>&1 &
FAKE=$!
trap 'kill $FAKE 2>/dev/null' EXIT
for i in $(seq 1 50); do grep -q "fake MCP" $T/fake.out && break; sleep 0.1; done

EMAIL="agents-$RANDOM$RANDOM@test.com"
curl -s -o /dev/null -c $T/a -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
curl -s -o /dev/null -c $T/b -X POST $API/auth/signup -H "$H" -d "{\"email\":\"other-$EMAIL\",\"password\":\"password123\"}"
S=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"Agents Test","slug":"agents-test"}' | ex 'o.organization.slug')
B=$(curl -s -b $T/a -X POST "$API/organizations/$S/data-sources" -F "file=@$CSV/e2e-products-v1.csv" -F "idColumn=sku" -F "name=Products")
DS=$(echo "$B" | ex 'o.dataSource.id')
for i in $(seq 1 100); do st=$(curl -s -b $T/a "$API/organizations/$S/data-sources/$DS/imports/$(echo "$B" | ex 'o.import.id')" | ex 'o.import.status'); [ "$st" == succeeded ] && break; sleep 0.1; done
for a in prices other; do json $T/api.json "{\"name\":\"$a\",\"slug\":\"$a\",\"dataSourceId\":\"$DS\"}"; req a POST "$S/apis" $T/api.json; done
json $T/t.json '{"name":"Jivox axas"}'; req a POST "$S/apis/prices/tokens" $T/t.json; TOK=$(body | ex 'o.tokenInfo.id')
json $T/t.json '{"name":"Old"}'; req a POST "$S/apis/prices/tokens" $T/t.json; OLD=$(body | ex 'o.tokenInfo.id'); req a DELETE "$S/apis/prices/tokens/$OLD"
json $T/t.json '{"name":"Other API token"}'; req a POST "$S/apis/other/tokens" $T/t.json; OTHER=$(body | ex 'o.tokenInfo.id')
[ -n "$S" ] && [ ${#TOK} -gt 10 ] || { echo "Setup failed"; exit 1; }

echo "A. Add, list, see"
req a GET "$S/apis/prices/agents"
check "new API → no agents, at most 20, no-store" "[] 20 yes" "$(body | ex 'o.agents') $(body | ex 'o.limits.maxAgents') $(curl -s -D - -o /dev/null -b $T/a "$API/organizations/$S/apis/prices/agents" | grep -qi '^cache-control: no-store' && echo yes || echo no)"
add "{\"name\":\"axas · Agent 1\",\"brandstore\":\"axas-c63e9\",\"fields\":[\"sub_title\",\"sub_title\",\"currency\"],\"tokenId\":\"$TOK\",\"mcpUrl\":\"$(fake ok)\",\"accessKey\":\"$KEY\",\"sampleIds\":[\"SKU-1001\",\"SKU-1002\",\"SKU-1001\"]}"
A1=$(body | ex 'o.agent.id')
check "full agent → 201; fields + sample ids de-duplicated; token by name" '201 ["sub_title","currency"] ["SKU-1001","SKU-1002"] Jivox axas active' "$(code) $(body | ex 'o.agent.fields') $(body | ex 'o.agent.sampleIds') $(body | ex 'o.agent.token.name+" "+o.agent.token.state')"
check "  the access key: only its last 2 characters, readable; never in the answer" "${KEY: -2} true 0" "$(body | ex 'o.agent.accessKey.hint') $(body | ex 'o.agent.accessKey.readable') $(grep -cF -e "${KEY:4:16}" $T/body)"
check "  stored encrypted (v1.…), not as text" "1 0" "$(sql "SELECT count(*) FROM jivox_agents WHERE id='$A1' AND access_key_encrypted LIKE 'v1.%'") $(sql "SELECT count(*) FROM jivox_agents WHERE access_key_encrypted LIKE '%${KEY:4:16}%'")"
check "  no Jivox info yet" "null null" "$(body | ex 'o.agent.jivox') $(body | ex 'o.agent.lastError')"
add '{"name":"bare"}'; BARE=$(body | ex 'o.agent.id')
check "name only → 201: no fields, token, MCP, key" "201 [] null null null" "$(code) $(body | ex 'o.agent.fields') $(body | ex 'o.agent.token') $(body | ex 'o.agent.mcpUrl') $(body | ex 'o.agent.accessKey')"
req a GET "$S/apis/prices/agents/$A1"
check "GET one → the same agent" "200 axas · Agent 1" "$(code) $(body | ex 'o.agent.name')"
check "list → both, oldest first" "axas · Agent 1,bare" "$(req a GET "$S/apis/prices/agents"; body | ex 'o.agents.map(a=>a.name).join()')"

echo "B. What is refused"
add '{"name":"  AXAS · agent 1 "}'; check "same name (other case, spaces) → 409 AGENT_NAME_TAKEN" "409 AGENT_NAME_TAKEN" "$(code) $(body | ex 'o.error.code')"
check "same name on another API → 201" "201" "$(json $T/ag.json '{"name":"axas · Agent 1"}'; req a POST "$S/apis/other/agents" $T/ag.json; code)"
add '{"name":""}'; R1=$(code); add "{\"name\":\"$(printf 'x%.0s' {1..61})\"}"; R2=$(code)
check "blank / 61-char name → 400" "400 400" "$R1 $R2"
add '{"name":"f0","fields":["Sub Title"]}'; check "a field not in snake_case → 400" "400 fields.0" "$(code) $(body | ex 'o.error.details[0].field')"
add '{"name":"f1","fields":["no_such_field","item_id","product_name"]}'
check "fields: unknown / the id / mandatory → 400 with each reason" "400 3 yes yes yes" "$(code) $(body | ex 'o.error.details.length') $(body | ex 'o.error.details.some(d=>d.message.includes("a product field in Jivox"))?"yes":"no"') $(body | ex 'o.error.details.some(d=>d.message.includes("is the id"))?"yes":"no"') $(body | ex 'o.error.details.some(d=>d.message.includes("mandatory"))?"yes":"no"')"
add "{\"name\":\"t1\",\"tokenId\":\"$OTHER\"}"; check "another API's token → 400 'Not a token of this API'" "400 tokenId" "$(code) $(body | ex 'o.error.details[0].field')"
add "{\"name\":\"t2\",\"tokenId\":\"$OLD\"}"; check "a revoked token → 409 TOKEN_REVOKED" "409 TOKEN_REVOKED" "$(code) $(body | ex 'o.error.code')"
for u in "http://example.com/mcp" "ftp://x/mcp" "https://user:pw@example.com/mcp" "not a url"; do add "{\"name\":\"u\",\"mcpUrl\":\"$u\"}"; echo -n "$(code) "; done > $T/urls
check "MCP URL: http (not localhost) / ftp / user:password@ / not a URL → 400" "400 400 400 400 " "$(cat $T/urls)"
add '{"name":"k1","accessKey":"abc"}'; R1=$(code); add '{"name":"k2","accessKey":"has a space in it"}'; R2=$(code)
check "access key: too short / with spaces → 400" "400 400" "$R1 $R2"
add '{"name":"s","sampleIds":["1","2","3","4","5","6","7","8","9","10","11"]}'; check "11 sample ids → 400" "400" "$(code)"
patch $A1 '{}'; check "PATCH with nothing → 400" "400" "$(code)"
check "another account → 404 (list, get, add, read)" "404 404 404 404" "$(req b GET "$S/apis/prices/agents"; code) $(req b GET "$S/apis/prices/agents/$A1"; code) $(json $T/ag.json '{"name":"x"}'; req b POST "$S/apis/prices/agents" $T/ag.json; code) $(req b POST "$S/apis/prices/agents/$A1/read-jivox"; code)"
check "logged out → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' "$API/organizations/$S/apis/prices/agents")"
check "an agent id of another API → 404" "404" "$(req a GET "$S/apis/other/agents/$A1"; code)"

echo "C. Edit"
patch $A1 '{"name":"axas · Real Time Agent 1","brandstore":null}'
check "rename + clear brandstore → 200" "200 axas · Real Time Agent 1 null" "$(code) $(body | ex 'o.agent.name') $(body | ex 'o.agent.brandstore')"
patch $BARE '{"name":"AXAS · REAL TIME AGENT 1"}'; check "rename to a taken name → 409" "409" "$(code)"
patch $BARE "{\"tokenId\":\"$TOK\",\"fields\":[\"current_price\"]}"
check "link a token + set fields" "200 Jivox axas [\"current_price\"]" "$(code) $(body | ex 'o.agent.token.name') $(body | ex 'o.agent.fields')"
patch $BARE '{"tokenId":null}'; check "unlink the token" "200 null" "$(code) $(body | ex 'o.agent.token')"

echo "D. Read from Jivox (fake MCP server)"
readj $BARE; check "no MCP destination / key → 409 AGENT_NOT_CONNECTED" "409 AGENT_NOT_CONNECTED" "$(code) $(body | ex 'o.error.code')"
: > $T/fake.log
readj $A1
check "read → 200: feed product, id item_id, bound [sub_title], credential service, token registered" 'product item_id ["sub_title"] service true' "$(body | ex 'o.agent.jivox.feedType+" "+o.agent.jivox.idColumn') $(body | ex 'o.agent.jivox.boundFields') $(body | ex 'o.agent.jivox.credential+" "+o.agent.jivox.serviceTokenRegistered')"
check "  the agent's fields BECOME Jivox's bound fields (before: sub_title, currency)" '["sub_title"] ["sub_title","currency"] true' "$(body | ex 'o.agent.fields') $(body | ex 'o.fieldsBefore') $(body | ex 'o.feedTypeMatches')"
check "  live schema: 43 fields with types + tiers; current_price float/optional; group current_price" "43 float optional current_price" "$(body | ex 'o.agent.jivox.schema.length') $(body | ex 'o.agent.jivox.schema.find(f=>f.name==="current_price").type+" "+o.agent.jivox.schema.find(f=>f.name==="current_price").tier+" "+o.agent.jivox.schema.find(f=>f.name==="current_price").group')"
check "  contracts: none yet; read time set; no error; key still not in the answer" "null 0 yes null 0" "$(body | ex 'o.agent.jivox.contracts.activeVersion') $(body | ex 'o.agent.jivox.contracts.versions.length') $(body | ex '!isNaN(Date.parse(o.agent.jivox.readAt))?"yes":"no"') $(body | ex 'o.agent.lastError') $(grep -cF -e "${KEY:4:16}" $T/body)"
check "  the fake server saw: initialize, initialized, then the 3 read-only tools, nothing else" "initialize notifications/initialized tools/call:get_canonical_schema tools/call:get_contract_spec tools/call:list_contracts" "$(node -e 'console.log(require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(l=>JSON.parse(l)).map(r=>r.method+(r.tool?":"+r.tool:"")).join(" "))' $T/fake.log)"
check "  every call carried exactly 'Authorization: Bearer <key>'" "yes" "$(node -e 'const k=process.argv[2];console.log(require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").every(l=>JSON.parse(l).auth==="Bearer "+k)?"yes":"no")' $T/fake.log "$KEY")"
patch $A1 "{\"mcpUrl\":\"$(fake json)\"}"
check "a new MCP URL clears what Jivox told us" "200 null" "$(code) $(body | ex 'o.agent.jivox')"
readj $A1; check "plain-JSON answers (not SSE) work too; contracts v1, v2 active" "200 2 2" "$(code) $(body | ex 'o.agent.jivox.contracts.activeVersion') $(body | ex 'o.agent.jivox.contracts.versions.length')"
patch $A1 "{\"mcpUrl\":\"$(fake 'bound/sub_title,currency,current_price')\"}"; readj $A1
check "Jivox bound a group (currency + current_price) + sub_title → all three become the fields" '["sub_title","currency","current_price"]' "$(body | ex 'o.agent.fields')"
patch $A1 "{\"mcpUrl\":\"$(fake mandatory)\"}"; readj $A1
check "bound list with mandatory / unknown / the id → only sub_title kept" '["sub_title"]' "$(body | ex 'o.agent.fields')"
patch $A1 "{\"mcpUrl\":\"$(fake review)\"}"; patch $A1 '{"fields":["currency"]}'; readj $A1
check "other feed type (review) → 200, fields left alone, error says why" '200 false ["currency"] yes' "$(code) $(body | ex 'o.feedTypeMatches') $(body | ex 'o.agent.fields') $(body | ex 'o.agent.lastError.includes("review feed")?"yes":"no"')"
fail_case() { patch $A1 "{\"mcpUrl\":\"$1\"}"; readj $A1; echo "$(code) $(body | ex 'o.error.code')"; }
check "wrong key (401) → 422 JIVOX_AUTH_FAILED (not 401: the user stays logged in)" "422 JIVOX_AUTH_FAILED" "$(fail_case "$(fake auth)")"
check "  …and remembered on the agent" "yes" "$(req a GET "$S/apis/prices/agents/$A1"; body | ex 'o.agent.lastError.includes("refused the access key")?"yes":"no"')"
check "nobody listening → 502 JIVOX_UNREACHABLE" "502 JIVOX_UNREACHABLE" "$(fail_case "http://127.0.0.1:1/mcp")"
check "garbage answer → 502 JIVOX_BAD_ANSWER" "502 JIVOX_BAD_ANSWER" "$(fail_case "$(fake garbage)")"
check "tool error → 502 JIVOX_BAD_ANSWER" "502 JIVOX_BAD_ANSWER" "$(fail_case "$(fake tool-error)")"
check "3 MB answer → 502 JIVOX_BAD_ANSWER (stops reading)" "502 JIVOX_BAD_ANSWER" "$(fail_case "$(fake big)")"
check "redirect → 502 (never follows it with the key)" "502 JIVOX_UNREACHABLE" "$(fail_case "$(fake redirect)")"
check "no error message holds the key" "0" "$(req a GET "$S/apis/prices/agents"; grep -cF -e "${KEY:4:16}" $T/body)"
patch $A1 "{\"mcpUrl\":\"$(fake ok)\",\"accessKey\":\"$KEY2\"}"; readj $A1
check "replace the key (wrong one) → hint changes; read → 422" "${KEY2: -2} 422" "$(req a GET "$S/apis/prices/agents/$A1"; body | ex 'o.agent.accessKey.hint') $(readj $A1; code)"
patch $A1 '{"accessKey":null}'; check "remove the key → accessKey null; read → 409" "null 409" "$(body | ex 'o.agent.accessKey') $(readj $A1; code)"
patch $A1 "{\"accessKey\":\"$KEY\"}"; readj $A1; check "key back → read works again" "200" "$(code)"
node -e 'const ok=["get_canonical_schema","get_contract_spec","list_contracts"];console.log(require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(l=>JSON.parse(l)).filter(r=>r.tool&&!ok.includes(r.tool)).length)' $T/fake.log > $T/writes
check "in all of D, no write tool (submit / activate) was ever called" "0" "$(cat $T/writes)"

echo "E. Races"
patch $A1 "{\"mcpUrl\":\"$(fake slow)\"}"
( readj $A1; echo "$(code) $(body | ex 'o.error.code')" > $T/slowread ) &
SLOW=$!
sleep 1; patch $A1 "{\"accessKey\":\"$KEY2\"}"; PATCHED=$(code)
while kill -0 $SLOW 2>/dev/null; do sleep 0.2; done
check "key replaced DURING a 3 s read → the read is not saved: 409 AGENT_CHANGED (the edit wins)" "200 409 AGENT_CHANGED null" "$PATCHED $(cat $T/slowread) $(req a GET "$S/apis/prices/agents/$A1"; body | ex 'o.agent.jivox')"
for i in 1 2; do ( json $T/same$i.json '{"name":"Same name"}'; curl -s -o /dev/null -w '%{http_code}\n' -b $T/a -X POST "$API/organizations/$S/apis/prices/agents" -H "$H" -d @$T/same$i.json >> $T/same ) & done
for i in 1 2; do sleep 0.5; done; sleep 1
check "two adds with the same name at once → one 201, one 409" "201 409" "$(sort $T/same | tr '\n' ' ' | sed 's/ $//')"
N=$(req a GET "$S/apis/prices/agents"; body | ex 'o.agents.length')
for i in $(seq 1 25); do ( json $T/m$i.json "{\"name\":\"many $i\"}"; curl -s -o /dev/null -w '%{http_code}\n' -b $T/a -X POST "$API/organizations/$S/apis/prices/agents" -H "$H" -d @$T/m$i.json >> $T/many ) & done
for i in $(seq 1 40); do [ "$(wc -l < $T/many 2>/dev/null | tr -d ' ')" == 25 ] && break; sleep 0.25; done
check "25 adds at once (with $N already there) → exactly 20 in all; the rest 409 TOO_MANY_AGENTS" "20 $((20 - N)) $((25 - 20 + N))" "$(req a GET "$S/apis/prices/agents"; body | ex 'o.agents.length') $(grep -c 201 $T/many) $(grep -c 409 $T/many)"

echo "F. Remove"
req a DELETE "$S/apis/prices/agents/$BARE"; check "delete → 204; again → 404" "204 404" "$(code) $(req a DELETE "$S/apis/prices/agents/$BARE"; code)"
PID_API=$(sql "SELECT id FROM apis WHERE slug='prices' AND organization_id=(SELECT id FROM organizations WHERE slug='$S')")
req a DELETE "$S/apis/prices"; check "deleting the API deletes its agents" "204 0" "$(code) $(sql "SELECT count(*) FROM jivox_agents WHERE api_id='$PID_API'")"
json $T/bad.json "{\"name\":\"x\",\"accessKey\":\"$KEY\" oops}"
check "invalid JSON with a key in it → 400 INVALID_JSON" "400 INVALID_JSON" "$(req a POST "$S/apis/other/agents" $T/bad.json; code) $(body | ex 'o.error.code')"
if [ -n "$LOG_FILE" ]; then
  sleep 0.5
  check "no access key (2 checked) anywhere in $LOG_FILE" "0" "$(( $(grep -cF -e "${KEY:4:16}" "$LOG_FILE") + $(grep -cF -e "${KEY2:4:16}" "$LOG_FILE") ))"
fi

psql "$DB" -qtAc "DELETE FROM users WHERE email IN ('$EMAIL','other-$EMAIL')" >/dev/null
kill $FAKE 2>/dev/null; wait $FAKE 2>/dev/null; trap - EXIT # waits for the fake server only
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
