#!/bin/bash
# Task 4.2 scenario tests: an API's tokens. Create, list, show (reveal), rename, Extend, Renew,
# revoke, header style; the rules (names, limit of 20, expiry dates, revoked = final), isolation
# between APIs and accounts, and two-or-more people acting at the same moment.
#
# Usage (backend running with `npm run dev`), from any folder:
#   DB_URL="postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_mine" \
#   API=localhost:4001/api bash docs/test-scripts/phase-04-task-4.2-tokens.sh
# Optional: LOG_FILE=<backend log file> also checks that no token ever reaches the logs.
#
# Creates its own test users and deletes ONLY them at the end.
API="${API:-localhost:4000/api}"
DB="${DB_URL:-postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV="$SCRIPT_DIR/../test-data/csv"
H='content-type: application/json'
[ -f "$CSV/products-v1.csv" ] || { echo "Can't find the test CSVs in $CSV"; exit 1; }
curl -s -o /dev/null --max-time 3 "$API/health" || { echo "Backend not reachable at $API"; exit 1; }

T=$(mktemp -d); mkdir $T/pb; PASS=0; FAIL=0
check() { if [ "$2" == "$3" ]; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1  (expected: $2, got: $3)"; fi; }
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);const v=eval('o'+process.argv[1]);console.log(typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('JSON-ERROR')}})" "$1"; }
sql() { psql "$DB" -tAc "$1"; }
code() { cat $T/code; }
body() { cat $T/body; }
# call JAR METHOD PATH [DATA] → body on stdout, status in $T/code, headers in $T/headers
call() { local jar=$1 m=$2 p=$3 d=$4; if [ -n "$d" ]; then curl -s -D $T/headers -o $T/body -w '%{http_code}' -b $T/$jar -X $m "$API/organizations/$p" -H "$H" -d "$d" > $T/code; else curl -s -D $T/headers -o $T/body -w '%{http_code}' -b $T/$jar -X $m "$API/organizations/$p" > $T/code; fi; cat $T/body; }
# pcall OUT METHOD PATH [DATA]: for parallel runs (own files); writes "<status> <error code or ok>" to OUT
# (bodies go to $T/pb/: a glob like $T/r1-* must match only the result lines)
pcall() { local out=$1 m=$2 p=$3 d=$4 c b; b=$T/pb/$(basename $out); c=$(curl -s -o $b -w '%{http_code}' -b $T/a -X $m "$API/organizations/$p" -H "$H" ${d:+-d "$d"}); echo "$c $(cat $b | json '.error?.code ?? "ok"')" > $out; }
iso() { node -e "console.log(new Date(Date.now() + Number(process.argv[1]) * 864e5).toISOString())" -- "$1"; }
sha() { printf '%s' "$1" | shasum -a 256 | cut -d' ' -f1; }
nocache() { grep -i '^cache-control:' $T/headers | tr -d '\r' | cut -d' ' -f2-; }
TOKENS_SEEN=$T/tokens-seen; : > $TOKENS_SEEN
remember() { echo "$1" >> $TOKENS_SEEN; echo "$1"; }

EMAIL="tokens-$RANDOM$RANDOM@test.com"; EMAIL_B="tokens-b-$RANDOM$RANDOM@test.com"
curl -s -o /dev/null -c $T/a -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
curl -s -o /dev/null -c $T/b -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL_B\",\"password\":\"password123\"}"
S=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"Token Test","slug":"token-test"}' | json .organization.slug)
SB=$(curl -s -b $T/b -X POST $API/organizations -H "$H" -d '{"name":"Other Brand","slug":"other-brand"}' | json .organization.slug)
B=$(curl -s -b $T/a -X POST "$API/organizations/$S/data-sources" -F "file=@$CSV/products-v1.csv" -F "idColumn=sku" -F "name=Products")
DS=$(echo "$B" | json .dataSource.id)
for a in live other limit race gone; do call a POST "$S/apis" "{\"name\":\"API $a\",\"slug\":\"$a-api\",\"dataSourceId\":\"$DS\"}" > /dev/null; done
TK="$S/apis/live-api/tokens"

echo "A. Create"
R=$(call a POST $TK '{"name":"Jivox qa3"}')
T1=$(remember "$(echo "$R" | json .token)"); ID1=$(echo "$R" | json .tokenInfo.id)
check "create → 201, never expires, active, can be shown" "201 null active true" "$(code) $(echo "$R" | json .tokenInfo.expiresAt) $(echo "$R" | json .tokenInfo.state) $(echo "$R" | json .tokenInfo.canShow)"
check "  token = rtk_ + 43 chars; hint = its first 8" "yes $(echo ${T1:0:8})" "$([[ "$T1" =~ ^rtk_[A-Za-z0-9_-]{43}$ ]] && echo yes || echo no) $(echo "$R" | json .tokenInfo.hint)"
check "  answer never includes hash / encrypted copy" "undefined undefined" "$(echo "$R" | json .tokenInfo.tokenHash) $(echo "$R" | json .tokenInfo.tokenEncrypted)"
check "  Cache-Control: no-store" "no-store" "$(nocache)"
check "  DB keeps the SHA-256 (not the token) + an encrypted copy without the token in it" "1 0" "$(sql "SELECT count(*) FROM api_tokens WHERE token_hash='$(sha "$T1")'") $(sql "SELECT count(*) FROM api_tokens WHERE token_encrypted LIKE '%${T1:4}%' OR token_hash='$T1'")"
R=$(call a POST $TK "{\"name\":\"  Demo for Priya  \",\"expiresAt\":\"$(iso 30)\"}"); ID2=$(echo "$R" | json .tokenInfo.id); remember "$(echo "$R" | json .token)" > /dev/null
check "with expiry in 30 days → 201, name trimmed, expiry kept" "201 Demo for Priya yes" "$(code) $(echo "$R" | json .tokenInfo.name) $(echo "$R" | json '.tokenInfo.expiresAt > new Date(Date.now()+29*864e5).toISOString()' | sed 's/true/yes/')"
R=$(call a POST $TK '{"name":"Never one","expiresAt":null}')
check "expiresAt null → never" "201 null" "$(code) $(echo "$R" | json .tokenInfo.expiresAt)"
remember "$(body | json .token)" > /dev/null
check "no name → 400 VALIDATION_ERROR on name" "400 VALIDATION_ERROR name" "$(call a POST $TK '{}' > /dev/null; code) $(body | json .error.code) $(body | json .error.details[0].field)"
LONG="{\"name\":\"$(printf 'x%.0s' {1..61})\"}"
check "blank name / 61 characters → 400 VALIDATION_ERROR" "400 400 VALIDATION_ERROR" "$(call a POST $TK '{"name":"   "}' > /dev/null; code) $(call a POST $TK "$LONG" > /dev/null; code) $(body | json .error.code)"
PAST="{\"name\":\"Past\",\"expiresAt\":\"$(iso -1)\"}"
check "expiry in the past → 400 'must be in the future'" "400 Expiry must be in the future" "$(call a POST $TK "$PAST" > /dev/null; code) $(body | json .error.details[0].message)"
check "expiry not a date ('tomorrow') / no time zone → 400" "400 400" "$(call a POST $TK '{"name":"Bad","expiresAt":"tomorrow"}' > /dev/null; code) $(call a POST $TK '{"name":"Bad","expiresAt":"2030-01-01T00:00:00"}' > /dev/null; code)"
FAR="{\"name\":\"Far\",\"expiresAt\":\"$(iso 4100)\"}"
check "expiry 11 years away → 400 (choose Never)" "400 VALIDATION_ERROR yes" "$(call a POST $TK "$FAR" > /dev/null; code) $(body | json .error.code) $(body | json .error.details[0].message | grep -q 'Never' && echo yes || echo no)"
check "same name, other case ('JIVOX QA3') → 409 TOKEN_NAME_TAKEN" "409 TOKEN_NAME_TAKEN" "$(call a POST $TK '{"name":"JIVOX QA3"}' > /dev/null; code) $(body | json .error.code)"
check "same name on ANOTHER API → 201 (names are per API)" "201" "$(call a POST "$S/apis/other-api/tokens" '{"name":"Jivox qa3"}' > /dev/null; code)"
OTHER_ID=$(body | json .tokenInfo.id); OTHER_T=$(remember "$(body | json .token)")

echo "B. List"
L=$(call a GET $TK)
check "3 tokens oldest first, header X-Api-Key, limit 20" "Jivox qa3|Demo for Priya|Never one x-api-key 20" "$(echo "$L" | json '.tokens.map(t=>t.name).join("|")') $(echo "$L" | json .authHeader) $(echo "$L" | json .limits.maxTokens)"
check "  no full token anywhere in the list, no-store" "0 no-store" "$(grep -cF -e "${T1:8}" $T/body) $(nocache)"
check "another API's token isn't listed here" "0" "$(echo "$L" | json ".tokens.filter(t=>t.id==='$OTHER_ID').length")"

echo "C. Show (reveal)"
check "reveal → the same token, no-store" "200 yes no-store" "$(call a GET "$TK/$ID1/reveal" > /dev/null; code) $([ "$(body | json .token)" == "$T1" ] && echo yes || echo no) $(nocache)"
check "this token's id under ANOTHER API → 404 TOKEN_NOT_FOUND" "404 TOKEN_NOT_FOUND" "$(call a GET "$S/apis/other-api/tokens/$ID1/reveal" > /dev/null; code) $(body | json .error.code)"
check "another account (its own brand path / ours) → 404" "404 404" "$(call b GET "$SB/apis/live-api/tokens/$ID1/reveal" > /dev/null; code) $(call b GET "$TK/$ID1/reveal" > /dev/null; code)"
check "logged out → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' "$API/organizations/$TK/$ID1/reveal")"
check "unknown token id → 404" "404" "$(call a GET "$TK/nope/reveal" > /dev/null; code)"

echo "D. Rename and Extend"
check "rename → 200" "200 Jivox qa3 (main)" "$(call a PATCH "$TK/$ID1" '{"name":"Jivox qa3 (main)"}' > /dev/null; code) $(body | json .tokenInfo.name)"
check "rename to its own name in other case → 200 (not 'taken' by itself)" "200" "$(call a PATCH "$TK/$ID1" '{"name":"JIVOX QA3 (MAIN)"}' > /dev/null; code)"
call a PATCH "$TK/$ID1" '{"name":"Jivox qa3"}' > /dev/null
check "rename to another token's name → 409 TOKEN_NAME_TAKEN" "409 TOKEN_NAME_TAKEN" "$(call a PATCH "$TK/$ID1" '{"name":"demo for priya"}' > /dev/null; code) $(body | json .error.code)"
check "empty change → 400" "400" "$(call a PATCH "$TK/$ID1" '{}' > /dev/null; code)"
sql "UPDATE api_tokens SET expires_at = now() - interval '1 day' WHERE id='$ID2'" > /dev/null
check "a token past its date → listed as expired" "expired" "$(call a GET $TK | json ".tokens.find(t=>t.id==='$ID2').state")"
check "  an expired token can still be shown" "200" "$(call a GET "$TK/$ID2/reveal" > /dev/null; code)"
T2=$(body | json .token)
EXT30="{\"expiresAt\":\"$(iso 30)\"}"
check "Extend (+30 days) → active again, SAME token" "200 active yes" "$(call a PATCH "$TK/$ID2" "$EXT30" > /dev/null; code) $(body | json .tokenInfo.state) $([ "$(call a GET "$TK/$ID2/reveal" | json .token)" == "$T2" ] && echo yes || echo no)"
check "Extend to Never (null) → 200, no expiry" "200 null" "$(call a PATCH "$TK/$ID2" '{"expiresAt":null}' > /dev/null; code) $(body | json .tokenInfo.expiresAt)"
EXTPAST="{\"expiresAt\":\"$(iso -2)\"}"
check "Extend to a past date → 400 'must be in the future'" "400 Expiry must be in the future" "$(call a PATCH "$TK/$ID2" "$EXTPAST" > /dev/null; code) $(body | json .error.details[0].message)"

echo "E. Renew"
sql "UPDATE api_tokens SET expires_at = now() - interval '1 hour' WHERE id='$ID1'" > /dev/null
R=$(call a POST "$TK/$ID1/renew" "{\"expiresAt\":\"$(iso 90)\"}")
NEW1=$(remember "$(echo "$R" | json .token)"); NEWID1=$(echo "$R" | json .tokenInfo.id)
check "renew an expired token → 201, a NEW token, same name, 90-day expiry" "201 yes Jivox qa3 yes" "$(code) $([ "$NEW1" != "$T1" ] && [[ "$NEW1" =~ ^rtk_ ]] && echo yes || echo no) $(echo "$R" | json .tokenInfo.name) $(echo "$R" | json '.tokenInfo.expiresAt > new Date(Date.now()+89*864e5).toISOString()' | sed 's/true/yes/')"
check "  the old one: revoked, can't be shown, copy deleted in the DB" "revoked false 0" "$(echo "$R" | json .replaced.state) $(echo "$R" | json .replaced.canShow) $(sql "SELECT count(*) FROM api_tokens WHERE id='$ID1' AND token_encrypted IS NOT NULL")"
check "  reveal old → 409 TOKEN_REVOKED; reveal new → the new token" "409 TOKEN_REVOKED yes" "$(call a GET "$TK/$ID1/reveal" > /dev/null; code) $(body | json .error.code) $([ "$(call a GET "$TK/$NEWID1/reveal" | json .token)" == "$NEW1" ] && echo yes || echo no)"
check "renew an ACTIVE token (no expiry sent → never) → 201" "201 null" "$(call a POST "$TK/$ID2/renew" '{}' > /dev/null; code) $(body | json .tokenInfo.expiresAt)"
NEWID2=$(body | json .tokenInfo.id); remember "$(body | json .token)" > /dev/null

echo "F. Revoke (final)"
check "revoke → 200 revoked; DB copy gone" "200 revoked 0" "$(call a DELETE "$TK/$NEWID2" > /dev/null; code) $(body | json .tokenInfo.state) $(sql "SELECT count(*) FROM api_tokens WHERE id='$NEWID2' AND token_encrypted IS NOT NULL")"
AT=$(body | json .tokenInfo.revokedAt)
check "revoke again → 200, same revoked time" "200 $AT" "$(call a DELETE "$TK/$NEWID2" > /dev/null; code) $(body | json .tokenInfo.revokedAt)"
check "revoked: rename / Extend / renew / reveal → 409 TOKEN_REVOKED" "409 409 409 409 TOKEN_REVOKED" "$(call a PATCH "$TK/$NEWID2" '{"name":"x"}' > /dev/null; code) $(call a PATCH "$TK/$NEWID2" '{"expiresAt":null}' > /dev/null; code) $(call a POST "$TK/$NEWID2/renew" '{}' > /dev/null; code) $(call a GET "$TK/$NEWID2/reveal" > /dev/null; code) $(body | json .error.code)"
check "a revoked token's name can be used again → 201" "201" "$(call a POST $TK '{"name":"Demo for Priya"}' > /dev/null; code)"
remember "$(body | json .token)" > /dev/null
check "list: not-revoked first, then the 3 revoked (old qa3, renewed Demo, revoked renewal)" "active,active,active|revoked,revoked,revoked" "$(call a GET $TK | json '.tokens.map(t=>t.state).join(",").replace(/,revoked/,"|revoked")')"
check "another account can't revoke / rename / renew ours → 404" "404 404 404" "$(call b DELETE "$TK/$NEWID1" > /dev/null; code) $(call b PATCH "$TK/$NEWID1" '{"name":"x"}' > /dev/null; code) $(call b POST "$TK/$NEWID1/renew" '{}' > /dev/null; code)"
check "  …and ours is untouched" "active" "$(call a GET $TK | json ".tokens.find(t=>t.id==='$NEWID1').state")"

echo "G. Limit: 20 not-revoked tokens per API (expired ones count)"
for i in $(seq 1 19); do call a POST "$S/apis/limit-api/tokens" "{\"name\":\"t$i\"}" > /dev/null; done
sql "UPDATE api_tokens SET expires_at = now() - interval '1 day' WHERE name='t1' AND api_id=(SELECT id FROM apis WHERE slug='limit-api' AND organization_id=(SELECT id FROM organizations WHERE slug='$S'))" > /dev/null
check "20th → 201" "201" "$(call a POST "$S/apis/limit-api/tokens" '{"name":"t20"}' > /dev/null; code)"
check "21st (one of the 20 is expired) → 409 TOO_MANY_TOKENS" "409 TOO_MANY_TOKENS" "$(call a POST "$S/apis/limit-api/tokens" '{"name":"t21"}' > /dev/null; code) $(body | json .error.code)"
check "renew at the limit is allowed (replaces, doesn't add)" "201" "$(call a POST "$S/apis/limit-api/tokens/$(call a GET "$S/apis/limit-api/tokens" | json '.tokens.find(t=>t.name==="t1").id')/renew" '{}' > /dev/null; code)"
call a DELETE "$S/apis/limit-api/tokens/$(call a GET "$S/apis/limit-api/tokens" | json '.tokens.find(t=>t.name==="t2").id')" > /dev/null
check "revoke one → room for one more" "201 409" "$(call a POST "$S/apis/limit-api/tokens" '{"name":"t21"}' > /dev/null; code) $(call a POST "$S/apis/limit-api/tokens" '{"name":"t22"}' > /dev/null; code)"

echo "H. A copy that can't be read (other encryption key / changed in the DB)"
sql "UPDATE api_tokens SET token_encrypted = 'v1.' || md5(random()::text) || '.AAAA.BBBB' WHERE id='$NEWID1'" > /dev/null
check "reveal → 409 TOKEN_UNREADABLE (says: still works, renew it)" "409 TOKEN_UNREADABLE yes" "$(call a GET "$TK/$NEWID1/reveal" > /dev/null; code) $(body | json .error.code) $(body | json .error.message | grep -q 'still works.*Renew' && echo yes || echo no)"
check "  list says canShow false (state still active)" "false active" "$(call a GET $TK | json ".tokens.find(t=>t.id==='$NEWID1').canShow") $(call a GET $TK | json ".tokens.find(t=>t.id==='$NEWID1').state")"
check "  renew → a new token that CAN be shown" "201 true" "$(call a POST "$TK/$NEWID1/renew" '{}' > /dev/null; code) $(body | json .tokenInfo.canShow)"
remember "$(body | json .token)" > /dev/null

echo "I. Header style"
check "PUT bearer → 200; API and token list say bearer" "200 bearer bearer bearer" "$(call a PUT "$S/apis/live-api/auth-header" '{"style":"bearer"}' > /dev/null; code) $(body | json .authHeader) $(call a GET "$S/apis/live-api" | json .api.authHeader) $(call a GET $TK | json .authHeader)"
check "unknown style / missing → 400" "400 400" "$(call a PUT "$S/apis/live-api/auth-header" '{"style":"basic"}' > /dev/null; code) $(call a PUT "$S/apis/live-api/auth-header" '{}' > /dev/null; code)"
check "other APIs keep X-Api-Key; back to x-api-key works" "x-api-key 200 x-api-key" "$(call a GET "$S/apis/other-api" | json .api.authHeader) $(call a PUT "$S/apis/live-api/auth-header" '{"style":"x-api-key"}' > /dev/null; code) $(body | json .authHeader)"
check "another account → 404" "404" "$(call b PUT "$S/apis/live-api/auth-header" '{"style":"bearer"}' > /dev/null; code)"

echo "J. Two (or more) people at the same moment"
RT="$S/apis/race-api/tokens"
for i in $(seq 1 10); do pcall $T/r1-$i POST $RT '{"name":"Same name"}' & done; wait
check "10 creates with the same name → exactly 1 made, 9 TOKEN_NAME_TAKEN" "1 9" "$(cat $T/r1-* | grep -c '^201 ok') $(cat $T/r1-* | grep -c '^409 TOKEN_NAME_TAKEN')"
check "  DB: one token with that name" "1" "$(sql "SELECT count(*) FROM api_tokens t JOIN apis a ON a.id=t.api_id WHERE a.slug='race-api' AND t.name='Same name'")"
for i in $(seq 2 18); do call a POST $RT "{\"name\":\"fill $i\"}" > /dev/null; done
for i in $(seq 1 10); do pcall $T/r2-$i POST $RT "{\"name\":\"rush $i\"}" & done; wait
check "18 tokens + 10 creates at once → exactly 2 made, 8 TOO_MANY_TOKENS; DB 20" "2 8 20" "$(cat $T/r2-* | grep -c '^201 ok') $(cat $T/r2-* | grep -c '^409 TOO_MANY_TOKENS') $(sql "SELECT count(*) FROM api_tokens t JOIN apis a ON a.id=t.api_id WHERE a.slug='race-api' AND t.revoked_at IS NULL AND a.organization_id=(SELECT id FROM organizations WHERE slug='$S')")"
SAME=$(call a GET $RT | json '.tokens.find(t=>t.name==="Same name").id')
for i in $(seq 1 10); do pcall $T/r3-$i POST "$RT/$SAME/renew" '{}' & done; wait
check "10 renews of one token → exactly 1 new token, 9 TOKEN_REVOKED" "1 9" "$(cat $T/r3-* | grep -c '^201 ok') $(cat $T/r3-* | grep -c '^409 TOKEN_REVOKED')"
check "  DB: one active + one revoked 'Same name', still 20 not revoked" "1 1 20" "$(sql "SELECT count(*) FILTER (WHERE revoked_at IS NULL), count(*) FILTER (WHERE revoked_at IS NOT NULL) FROM api_tokens t JOIN apis a ON a.id=t.api_id WHERE a.slug='race-api' AND t.name='Same name' AND a.organization_id=(SELECT id FROM organizations WHERE slug='$S')" | tr '|' ' ') $(sql "SELECT count(*) FROM api_tokens t JOIN apis a ON a.id=t.api_id WHERE a.slug='race-api' AND t.revoked_at IS NULL AND a.organization_id=(SELECT id FROM organizations WHERE slug='$S')")"
SAME=$(call a GET $RT | json '.tokens.find(t=>t.name==="Same name" && t.state==="active").id')
for i in $(seq 1 10); do pcall $T/r4-$i DELETE "$RT/$SAME" & done; wait
check "10 revokes at once → all 200, one revoked time" "10 1" "$(cat $T/r4-* | grep -c '^200 ok') $(for f in $T/pb/r4-*; do json .tokenInfo.revokedAt < $f; done | sort -u | wc -l | tr -d ' ')"
F1=$(call a GET $RT | json '.tokens.find(t=>t.name==="fill 2").id')
for i in 1 2 3 4 5; do pcall $T/r5-r$i POST "$RT/$F1/renew" '{}' & pcall $T/r5-d$i DELETE "$RT/$F1" & pcall $T/r5-e$i PATCH "$RT/$F1" "{\"expiresAt\":\"$(iso 7)\"}" & done; wait
check "renew + revoke + Extend of one token at once → no 500s" "0" "$(cat $T/r5-r? $T/r5-d? $T/r5-e? | grep -Evc '^(201 ok|200 ok|409 TOKEN_REVOKED)$')"
check "  end: old token revoked, at most ONE new 'fill 2'" "revoked yes" "$(sql "SELECT CASE WHEN revoked_at IS NULL THEN 'active' ELSE 'revoked' END FROM api_tokens WHERE id='$F1'") $([ "$(sql "SELECT count(*) FROM api_tokens t JOIN apis a ON a.id=t.api_id WHERE a.slug='race-api' AND t.name='fill 2' AND t.revoked_at IS NULL AND a.organization_id=(SELECT id FROM organizations WHERE slug='$S')")" -le 1 ] && echo yes || echo no)"
GONE_ID=$(sql "SELECT id FROM apis WHERE slug='gone-api' AND organization_id=(SELECT id FROM organizations WHERE slug='$S')")
for i in $(seq 1 8); do pcall $T/r6-$i POST "$S/apis/gone-api/tokens" "{\"name\":\"g$i\"}" & done
pcall $T/r6-del DELETE "$S/apis/gone-api" & wait
check "API deleted while tokens are being made → no 500s (201 or 404)" "0" "$(cat $T/r6-? | grep -Evc '^(201 ok|404 API_NOT_FOUND)$')"
check "  …and none of its tokens survive" "0" "$(sql "SELECT count(*) FROM api_tokens WHERE api_id='$GONE_ID'")"

echo "K. Deleting an API deletes its tokens"
check "delete other-api → its token rows are gone" "204 0" "$(call a DELETE "$S/apis/other-api" > /dev/null; code) $(sql "SELECT count(*) FROM api_tokens WHERE id='$OTHER_ID'")"

if [ -n "$LOG_FILE" ] && [ -f "$LOG_FILE" ]; then
  echo "L. Logs"
  check "no token made in this run appears in the backend log ($(grep -cE '^rtk_[A-Za-z0-9_-]{43}$' $TOKENS_SEEN) tokens checked)" "0" "$(grep -c -F -f <(grep -E '^rtk_[A-Za-z0-9_-]{43}$' $TOKENS_SEEN | sed 's/^rtk_//') "$LOG_FILE")"
fi

psql "$DB" -qtAc "DELETE FROM users WHERE email IN ('$EMAIL','$EMAIL_B')" >/dev/null
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
