#!/bin/bash
# Task 7.3: the logs API. GET …/apis/:api/logs (filters, pages, "anything new?"), GET …/logs/:id (everything +
# Copy as curl that really reproduces the call), DELETE …/logs (Clear; switch lines stay). Two agents whose tokens
# have the SAME name (Renew = a new token, same name) are told apart (token_id, new column). Another owner sees nothing. 20 000 other rows: still fast.
# Usage (backend running with `npm run dev`), from the project folder:
#   DB_URL="$(grep -o 'postgresql://[^"]*' backend/.env)" API=localhost:4001/api bash docs/test-scripts/phase-07-task-7.3-logs-api.sh
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
code() { cat $T/code; }
req() { if [ -n "$3" ]; then curl -s -o $T/body -w '%{http_code}' -b $T/a -X $1 "$API/organizations/$S/$2" -H "$H" -d @"$3" > $T/code; else curl -s -o $T/body -w '%{http_code}' -b $T/a -X $1 "$API/organizations/$S/$2" > $T/code; fi; }
json() { printf '%s' "$2" > "$1"; }
sql() { psql "$DB" -qtAc "$1"; }
logs() { req GET "apis/$P/logs$1"; }
# all calls written (batches every 0.5 s): wait until the API's log has N call lines
settle() { for i in $(seq 1 40); do [ "$(sql "SELECT count(*) FROM api_call_logs WHERE api_id = '$PID' AND kind = 'call'")" -ge "$1" ] && return; sleep 0.1; done; }
call() { curl -s -o /dev/null "$@"; }

EMAIL="lg-$RANDOM$RANDOM@test.com"
curl -s -o /dev/null -c $T/a -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
S=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d "{\"name\":\"Logs\",\"slug\":\"logs-$RANDOM\"}" | ex 'o.organization.slug')
B=$(curl -s -b $T/a -X POST "$API/organizations/$S/data-sources" -F "file=@$CSV/e2e-products-v1.csv" -F "idColumn=sku" -F "name=Products")
DS=$(echo "$B" | ex 'o.dataSource.id')
for i in $(seq 1 100); do s=$(curl -s -b $T/a "$API/organizations/$S/data-sources/$DS/imports/$(echo "$B" | ex 'o.import.id')" | ex 'o.import.status'); [ "$s" == succeeded ] && break; sleep 0.1; done
FIELDS='[{"jivoxColumn":"sub_title","sourceColumn":"Product Name","responseKey":"sub","type":"string"}]'
api() { # api SLUG REQUEST → designed (published after its first token), $AID
  json $T/api.json "{\"name\":\"$1\",\"slug\":\"$1\",\"dataSourceId\":\"$DS\"}"; req POST apis $T/api.json
  json $T/d.json "{\"version\":0,\"idField\":{\"responseKey\":\"id\"},\"fields\":$FIELDS,\"request\":$2}"; req PUT "apis/$1/design" $T/d.json
  AID=$(sql "SELECT a.id FROM apis a JOIN organizations o ON o.id = a.organization_id WHERE o.slug = '$S' AND a.slug = '$1'")
}
token() { json $T/t.json "{\"name\":\"$2\"}"; req POST "apis/$1/tokens" $T/t.json; TOK=$(b 'o.token'); TID=$(b 'o.tokenInfo.id'); }
P=logs-get; api $P '{"method":"GET","query":{"ids":"{item_id}","market":"US"},"maxIdsPerCall":25}'; PID=$AID
token $P Jivox; TA=$TOK; IA=$TID
token $P "Jivox 2"; TB=$TOK; IB=$TID
req POST "apis/$P/publish"
json $T/ag.json "{\"name\":\"Agent 1\",\"tokenId\":\"$IA\"}"; req POST "apis/$P/agents" $T/ag.json
json $T/ag.json "{\"name\":\"Agent 2\",\"tokenId\":\"$IB\"}"; req POST "apis/$P/agents" $T/ag.json
Q=logs-post; api $Q '{"method":"POST","body":{"items":[{"sku":"{item_id}"}],"currency":"USD"},"maxIdsPerCall":25}'; QID=$AID
token $Q Jivox; TQ=$TOK; req POST "apis/$Q/publish"

echo "Calls: 4 with Agent 1's token, 3 with Agent 2's, 1 without a token"
U="$V/$S/$P"
call -H "X-Api-Key: $TA" "$U?ids=SKU-1001&market=US"; sleep 0.05
call -H "X-Api-Key: $TA" "$U?ids=SKU-1001,SKU-1002&market=US"; sleep 0.05
call -H "X-Api-Key: $TA" "$U?ids=SKU-1003&market=UK"; sleep 0.05          # check ✗
sleep 0.05; MID=$(node -e 'console.log(new Date().toISOString())'); sleep 0.05
call -H "X-Api-Key: $TB" "$U?ids=SKU-1002,NOPE&market=US"; sleep 0.05    # 200, 1 not found
call -H "X-Api-Key: $TB" -X POST -H "$H" -d '{}' "$U"; sleep 0.05         # 405
call "$U?ids=SKU-1001&market=US"; sleep 0.05                             # 401, no token
call -H "X-Api-Key: $TA" "$U?ids=SKU-1004&market=US"; sleep 0.05
call -H "X-Api-Key: $TB" "$U?ids=SKU-1005&market=US"
settle 8

echo "1. The list"
logs
check "8 entries, newest first; matching = total = 8; kept 500" "200 8 8 8 500 yes" "$(code) $(b 'o.entries.length') $(b 'o.matching') $(b 'o.total') $(b 'o.kept') $(b 'o.entries.every((e,i,a)=>i===0||BigInt(a[i-1].id)>BigInt(e.id))?"yes":"no"')"
check "  list lines carry no bodies / headers (those are in the full entry)" "no" "$(b 'o.entries.some(e=>"body" in e||"requestHeaders" in e||"responseBody" in e)?"yes":"no"')"
check "  newest line: Agent 2's token (by id), 200, check ✓" "$IB 200 true" "$(b 'o.entries[0].tokenId') $(b 'o.entries[0].status') $(b 'o.entries[0].checkOk')"
check "  each token with its current name and its agent" "Jivox:Agent 1 Jivox 2:Agent 2" "$(b "[o.tokens['$IA'],o.tokens['$IB']].map(t=>t.name+':'+t.agents.map(a=>a.name).join()).join(' ')")"
check "  token ids stored only for this API's tokens (the no-token call: none)" "1" "$(b 'o.entries.filter(e=>e.tokenId===null).length')"

echo "2. Filters"
f() { logs "?$1"; echo "$(code) $(b 'o.matching') $(b "o.entries.map(e=>$2).join(',')")"; }
check "token = Agent 1's → its 4 calls" "200 4 $IA,$IA,$IA,$IA" "$(f "token=$IA" 'e.tokenId')"
check "token = Agent 2's → its 3 calls" "200 3 $IB,$IB,$IB" "$(f "token=$IB" 'e.tokenId')"
check "token = none → the call without a token (401)" "200 1 401" "$(f 'token=none' 'e.status')"
check "status = ok → 6 (2xx + success envelope)" "200 6" "$(f 'status=ok' 'e.status' | cut -d' ' -f1-2)"
check "status = failed → 401 + 405" "200 2 401,405" "$(f 'status=failed' 'e.status')"
check "status = 405 → that one" "200 1 405" "$(f 'status=405' 'e.status')"
check "check = failed → market=UK + the 405 (wrong method)" "200 2 405,200" "$(f 'check=failed' 'e.status')"
check "check = passed → 5" "200 5" "$(f 'check=passed' 'e.status' | cut -d' ' -f1-2)"
check "id = SKU-1002 → the 2 calls that asked for it" "200 2" "$(f 'id=SKU-1002' 'e.ids' | cut -d' ' -f1-2)"
check "switched = no → all 8 calls · yes → none (switches come in 7.4)" "8 0" "$(logs '?switched=no'; b 'o.matching') $(logs '?switched=yes'; b 'o.matching')"
check "from = halfway → the last 5" "200 5" "$(f "from=$MID" 'e.status' | cut -d' ' -f1-2)"
check "to = halfway → the first 3" "200 3" "$(f "to=$MID" 'e.status' | cut -d' ' -f1-2)"
check "combined: Agent 2 + failed → the 405" "200 1 405" "$(f "token=$IB&status=failed" 'e.status')"
check "  total stays 8 whatever the filter" "8" "$(logs "?token=$IB&status=failed"; b 'o.total')"

echo "3. Pages and \"anything new?\""
ALL=$(logs; b 'o.entries.map(e=>e.id).join()'); GOT=""; CUR=""
for i in 1 2 3 4 5; do logs "?limit=3${CUR:+&before=$CUR}"; GOT="$GOT${GOT:+,}$(b 'o.entries.map(e=>e.id).join()')"; CUR=$(b 'o.next'); [ "$CUR" == null ] && break; done
check "pages of 3 (3 + 3 + 2, then next = null) = the whole list, same order, no repeats" "$ALL null" "$GOT $CUR"
logs; NEW=$(b 'o.newestId')
check "after = newestId → nothing new" "0 false" "$(logs "?after=$NEW"; b 'o.entries.length') $(b 'o.gap')"
call -H "X-Api-Key: $TA" "$U?ids=SKU-1001&market=US"; settle 9
check "  one call later → exactly that one" "1 $IA" "$(logs "?after=$NEW"; b 'o.entries.length') $(b 'o.entries[0].tokenId')"
for i in 1 2 3 4 5; do call -H "X-Api-Key: $TB" "$U?ids=SKU-1001&market=US"; done; settle 14
check "  five more, asked with limit 2 → the newest 2 + gap (reload)" "2 true $(sql "SELECT max(id) FROM api_call_logs WHERE api_id = '$PID'")" "$(logs "?after=$NEW&limit=2"; b 'o.entries.length') $(b 'o.gap') $(b 'o.entries[0].id')"

echo "3b. Renew: a NEW token with the SAME name"
json $T/r.json '{}'; req POST "apis/$P/tokens/$IA/renew" $T/r.json; TA2=$(b 'o.token'); IA2=$(b 'o.tokenInfo.id')
call -H "X-Api-Key: $TA2" "$U?ids=SKU-1001&market=US"; call -H "X-Api-Key: $TA" "$U?ids=SKU-1001&market=US"; settle 16
logs "?limit=2"
check "renewed (new id, same name); its call + the old token's 401 after it" "200 yes 401 $IA 200 $IA2" "$(code) $( [ "$IA2" != "$IA" ] && echo yes || echo no) $(b 'o.entries[0].status') $(b 'o.entries[0].tokenId') $(b 'o.entries[1].status') $(b 'o.entries[1].tokenId')"
check "  both named \"Jivox\" in the log, told apart by id; Agent 1 now on the new one, the old one revoked" "Jivox:true: Jivox:false:Agent 1" "$(b "[o.tokens['$IA'],o.tokens['$IA2']].map(t=>t.name+':'+t.revoked+':'+t.agents.map(a=>a.name).join()).join(' ')")"
check "  filter by the old token → its 6 calls (incl. the 401 after revoke) · by the new → 1" "6 1" "$(logs "?token=$IA"; b 'o.matching') $(logs "?token=$IA2"; b 'o.matching')"

echo "4. Wrong questions → 400"
check "status=abc · before=xyz · before+after · limit=500 · from=yesterday · kind=x → all 400" "400 400 400 400 400 400" "$(for q in 'status=abc' 'before=xyz' 'before=1&after=2' 'limit=500' 'from=yesterday' 'kind=x'; do logs "?$q"; printf '%s ' $(code); done | sed 's/ $//')"

echo "5. One entry in full + Copy as curl"
LID=$(sql "SELECT id FROM api_call_logs WHERE api_id = '$PID' AND status = 200 AND 'NOPE' = ANY(ids)")
req GET "apis/$P/logs/$LID"
check "everything: headers in and out, ids, query, body sent back, check" "200 no-store yes US yes true" "$(code) $(b 'o.entry.responseHeaders["cache-control"]') $(b 'o.entry.requestHeaders.host?"yes":"no"') $(b 'o.entry.query.market') $(b 'o.entry.responseBody.includes("NOPE")?"yes":"no"') $(b 'o.entry.requestCheck.ok')"
check "  the curl: public address + path, X-Api-Key: <your token>, no notes" "yes yes 0" "$(b 'o.curl.includes(o.curl.match(/https?:\/\/[^/]+/)[0]+"/v1/'"$S/$P"'?ids=SKU-1002,NOPE&market=US")?"yes":"no"') $(b 'o.curl.includes("X-Api-Key: <your token>")?"yes":"no"') $(b 'o.curlNotes.length')"
check "  no token anywhere in the answer" "no" "$(grep -c -e "${TA:4:30}" -e "${TB:4:30}" $T/body >/dev/null && echo yes || echo no)"
# Run the curl with the real token, against the server under test (the public address may be another host)
CMD=$(b 'o.curl' | sed -E "s|<your token>|$TB|; s|https?://[^/']*/v1/|$V/|")
eval "$CMD" > $T/again
check "  running that curl (token filled in) gives the same data again" "$(b 'JSON.stringify(JSON.parse(o.entry.responseBody).data)')" "$(ex 'JSON.stringify(o.data)' < $T/again)"
NT=$(sql "SELECT id FROM api_call_logs WHERE api_id = '$PID' AND token_kind = 'none'")
req GET "apis/$P/logs/$NT"
check "the no-token call: curl adds the token header, note says so" "yes yes" "$(b 'o.curl.includes("<your token>")?"yes":"no"') $(b 'o.curlNotes.some(n=>n.includes("sent no token"))?"yes":"no"')"

echo "6. POST bodies"
call -X POST -H "X-Api-Key: $TQ" -H "$H" -d '{"items":[{"sku":"SKU-1001"},{"sku":"SKU-1002"}],"currency":"USD"}' "$V/$S/$Q"
node -e "console.log(JSON.stringify({items:[{sku:'SKU-1001'}],currency:'USD',pad:'x'.repeat(9000)}))" > $T/big.json
call -X POST -H "X-Api-Key: $TQ" -H "$H" --data-binary @$T/big.json "$V/$S/$Q"; sleep 1
req GET "apis/$Q/logs"; SMALL=$(b 'o.entries[1].id'); BIG=$(b 'o.entries[0].id')
req GET "apis/$Q/logs/$SMALL"
CMD=$(b 'o.curl' | sed -E "s|<your token>|$TQ|; s|https?://[^/']*/v1/|$V/|")
check "POST: curl sends the body as sent (--data-binary, its Content-Type); running it → the same 2 items" "yes 2" "$(b 'o.curl.includes("--data-binary")&&o.curl.includes("Content-Type: application/json")?"yes":"no"') $(eval "$CMD" | ex 'o.data.length')"
req GET "apis/$Q/logs/$BIG"
check "a 9 KB body: bodyCut + a note that the curl sends only the first 4 KB" "true yes" "$(b 'o.entry.bodyCut') $(b 'o.curlNotes.some(n=>n.includes("first 4 KB"))?"yes":"no"')"

echo "7. Only the owner, only this API"
check "an entry of ANOTHER API of the same brand → 404 here" "404 LOG_NOT_FOUND" "$(req GET "apis/$P/logs/$BIG"; code) $(b 'o.error.code')"
check "an id that doesn't exist → 404 · not a number → 400" "404 400" "$(req GET "apis/$P/logs/999999999999"; code) $(req GET "apis/$P/logs/abc"; code)"
E2="lg2-$RANDOM$RANDOM@test.com"; curl -s -o /dev/null -c $T/a2 -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$E2\",\"password\":\"password123\"}"
check "another account: list / entry / clear of this brand's log → refused (404), nothing deleted" "404 404 404 $(sql "SELECT count(*) FROM api_call_logs WHERE api_id = '$PID'")" "$(curl -s -o /dev/null -w '%{http_code}' -b $T/a2 "$API/organizations/$S/apis/$P/logs") $(curl -s -o /dev/null -w '%{http_code}' -b $T/a2 "$API/organizations/$S/apis/$P/logs/$LID") $(curl -s -o /dev/null -w '%{http_code}' -b $T/a2 -X DELETE "$API/organizations/$S/apis/$P/logs") $(sql "SELECT count(*) FROM api_call_logs WHERE api_id = '$PID'")"
check "  not logged in → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' "$API/organizations/$S/apis/$P/logs")"

echo "8. Clear"
sql "INSERT INTO api_call_logs (api_id, kind, at, event) VALUES ('$PID', 'switch', now(), '{\"action\":\"on\",\"switch\":\"no_store\"}')" >/dev/null
check "a switch line shows with kind=switch, never with call filters" "1 0" "$(logs '?kind=switch'; b 'o.matching') $(logs '?kind=switch&status=ok'; b 'o.matching')"
req DELETE "apis/$P/logs"
check "Clear → the 17 calls gone (16 + the curl run in 5), the switch line (audit) stays" "200 17 1 switch" "$(code) $(b 'o.cleared') $(logs; b 'o.total') $(b 'o.entries[0].kind')"
# calls arriving during Clear: none made before it may come back
for i in $(seq 1 20); do call -H "X-Api-Key: $TA" "$U?ids=SKU-1001&market=US" & done; sleep 0.02
req DELETE "apis/$P/logs"; CLEARED=$(b 'o.clearedAt'); wait
call -H "X-Api-Key: $TA" "$U?ids=SKU-1001&market=US"; sleep 1.2
check "20 calls racing a Clear: none made before it reappears; the next call is logged" "0 1" "$(sql "SELECT count(*) FROM api_call_logs WHERE api_id = '$PID' AND kind = 'call' AND at <= '$CLEARED'") $( [ "$(sql "SELECT count(*) FROM api_call_logs WHERE api_id = '$PID' AND kind = 'call' AND at > '$CLEARED'")" -ge 1 ] && echo 1 || echo 0)"

echo "9. Speed: 500 entries here + 20 000 in another API's log"
sql "INSERT INTO api_call_logs (api_id, kind, at, method, path, status, envelope_status, ids, id_count, token_kind, token_id, token_name, request_check)
     SELECT '$PID', 'call', now() - (g || ' seconds')::interval, 'GET', '/v1/x?ids=S' || g, CASE WHEN g % 10 = 0 THEN 500 ELSE 200 END, CASE WHEN g % 10 = 0 THEN 'failure' ELSE 'success' END,
            ARRAY['S' || g], 1, 'this_api', CASE WHEN g % 2 = 0 THEN '$IA' ELSE '$IB' END, 'Jivox', jsonb_build_object('ok', g % 3 <> 0)
     FROM generate_series(1, 500) g;
     INSERT INTO api_call_logs (api_id, kind, at, method, path, ids) SELECT '$QID', 'call', now(), 'GET', '/x', ARRAY['S' || g] FROM generate_series(1, 20000) g" >/dev/null
t() { local s=$(node -e 'console.log(Date.now())'); logs "?$1"; local e=$(node -e 'console.log(Date.now())'); echo $((e-s)); }
T1=$(t ''); T2=$(t "token=$IA&status=failed&check=failed"); T3=$(t 'id=S250'); T4=$(t 'limit=200&before=999999999999')
check "list / 3 filters / an id / 200 lines → each under 200 ms ($T1 / $T2 / $T3 / $T4 ms)" "yes" "$( [ $T1 -lt 200 ] && [ $T2 -lt 200 ] && [ $T3 -lt 200 ] && [ $T4 -lt 200 ] && echo yes || echo no)"
check "  the counts are right: Agent 1 + 500 + check ✗ = every 30th of 500 = 16 (+0 real)" "16" "$(logs "?token=$IA&status=failed&check=failed"; b 'o.matching')"
check "  with fresh statistics (autovacuum keeps them) the database reads through the (api_id, id DESC) index" "yes" "$(psql "$DB" -qtAc "ANALYZE api_call_logs" ; psql "$DB" -qtAc "EXPLAIN SELECT * FROM api_call_logs WHERE api_id = '$PID' ORDER BY id DESC LIMIT 51" | grep -q 'api_call_logs_api_id_id_idx' && echo yes || echo no)"

echo "10. The new column's rule"
ins() { psql "$DB" -qtAc "INSERT INTO api_call_logs (api_id, kind, at, method, path, token_kind, token_id) VALUES ('$PID', 'call', now(), 'GET', '/x', $1, $2)" >/dev/null 2>&1 && echo ok || echo refused; }
check "token id with kind this_api ok · with kind none / NULL (the NULL trap) / other_api refused · 65 characters refused" "ok refused refused refused refused" "$(ins "'this_api'" "'t1'") $(ins "'none'" "'t1'") $(ins NULL "'t1'") $(ins "'other_api'" "'t1'") $(ins "'this_api'" "'$(printf 'x%.0s' $(seq 1 65))'")"

sql "DELETE FROM users WHERE email IN ('$EMAIL', '$E2')" >/dev/null
sql "DELETE FROM organizations WHERE slug='$S'" >/dev/null
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
