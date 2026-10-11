#!/bin/bash
# Task 4.4 scenario tests: publish / unpublish. Every reason that blocks publishing (listed all at
# once), the check endpoint the Publish button uses, /v1 following the status at once, repeats
# being harmless, tokens expiring after publishing, isolation, and people acting at the same moment.
#
# Usage (backend running with `npm run dev`), from any folder:
#   DB_URL="postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_mine" \
#   API=localhost:4001/api bash docs/test-scripts/phase-04-task-4.4-publish.sh
#
# Creates its own test users and deletes ONLY them at the end.
API="${API:-localhost:4000/api}"; BASE="${API%/api}"
DB="${DB_URL:-postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV="$SCRIPT_DIR/../test-data/csv"
H='content-type: application/json'
[ -f "$CSV/e2e-products-v1.csv" ] || { echo "Can't find the test CSVs in $CSV"; exit 1; }
curl -s -o /dev/null --max-time 3 "$API/health" || { echo "Backend not reachable at $API"; exit 1; }

T=$(mktemp -d); mkdir $T/pb; PASS=0; FAIL=0
check() { if [ "$2" == "$3" ]; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1  (expected: $2, got: $3)"; fi; }
ex() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);const v=eval(process.argv[1]);console.log(typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('JSON-ERROR')}})" "$1"; }
sql() { psql "$DB" -tAc "$1"; }
code() { cat $T/code; }
body() { cat $T/body; }
req() { if [ -n "$4" ]; then curl -s -o $T/body -w '%{http_code}' -b $T/$1 -X $2 "$API/organizations/$3" -H "$H" -d @"$4" > $T/code; else curl -s -o $T/body -w '%{http_code}' -b $T/$1 -X $2 "$API/organizations/$3" > $T/code; fi; }
json() { printf '%s' "$2" > "$1"; }
save() { local v; v=$(curl -s -b $T/a "$API/organizations/$S/apis/$1/design" | ex 'o.design.version'); node -e "const f=require('fs');const d=JSON.parse(f.readFileSync(process.argv[1]));d.version=+process.argv[2];f.writeFileSync(process.argv[1]+'.v',JSON.stringify(d))" "$2" "$v"; req a PUT "$S/apis/$1/design" "$2.v"; }
new_ds() {
  local B ds imp st; B=$(curl -s -b $T/a -X POST "$API/organizations/$S/data-sources" -F "file=@$1" -F "idColumn=$3" -F "name=$2")
  ds=$(echo "$B" | ex 'o.dataSource.id'); imp=$(echo "$B" | ex 'o.import.id')
  for i in $(seq 1 100); do st=$(curl -s -b $T/a "$API/organizations/$S/data-sources/$ds/imports/$imp" | ex 'o.import.status'); [ "$st" == succeeded ] || [ "$st" == failed ] && break; sleep 0.1; done
  echo "$ds"
}
new_api() { json $T/na.json "{\"name\":\"$1\",\"slug\":\"$1\",\"dataSourceId\":\"$2\"}"; req a POST "$S/apis" $T/na.json; }
new_token() { json $T/nt.json "$2"; req a POST "$S/apis/$1/tokens" $T/nt.json; body | ex 'o.token'; }
pcheck() { req a GET "$S/apis/$1/publish-check"; }
reasons() { pcheck "$1"; body | ex 'o.reasons.map(r=>r.code).join(",")||"none"'; }
publish() { req a POST "$S/apis/$1/publish"; }
unpublish() { req a POST "$S/apis/$1/unpublish"; }
v1code() { curl -s -o /dev/null -w '%{http_code}' "$BASE/v1/$S/$1?ids=SKU-1001" -H "X-Api-Key: $2"; }
pcall() { local out=$1 m=$2 p=$3 c b; b=$T/pb/$(basename $out); c=$(curl -s -o $b -w '%{http_code}' -b $T/a -X $m "$API/organizations/$p" -H "$H"); echo "$c $(cat $b | ex 'o.error?.code ?? "ok"')" > $out; }

EMAIL="pub-$RANDOM$RANDOM@test.com"
curl -s -o /dev/null -c $T/a -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
curl -s -o /dev/null -c $T/b -X POST $API/auth/signup -H "$H" -d "{\"email\":\"other-$EMAIL\",\"password\":\"password123\"}"
S=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"Publish Test","slug":"publish-test"}' | ex 'o.organization.slug')
DS=$(new_ds "$CSV/e2e-products-v1.csv" Products sku)
DSBAD=$(new_ds "$CSV/products-duplicate-ids.csv" Dups sku)
json $T/d.json '{"idField":{"responseKey":"sku"},"fields":[{"jivoxColumn":"current_price","sourceColumn":"priceUSD","responseKey":"price","type":"float"}],"request":{"method":"GET","query":{"ids":"{item_id}"},"maxIdsPerCall":10}}'

echo "A. What blocks publishing"
new_api prices "$DS"
check "new API (no design, no token) → canPublish false, reasons NO_DESIGN + NO_ACTIVE_TOKEN" "200 false NO_DESIGN,NO_ACTIVE_TOKEN draft" "$(pcheck prices; code) $(body | ex 'o.canPublish') $(body | ex 'o.reasons.map(r=>r.code).join()') $(body | ex 'o.status')"
check "  no-store on the check" "no-store" "$(curl -s -D - -o /dev/null -b $T/a "$API/organizations/$S/apis/prices/publish-check" | grep -i '^cache-control' | cut -d' ' -f2 | tr -d '\r')"
publish prices
check "publish → 409 PUBLISH_BLOCKED, every reason in details" "409 PUBLISH_BLOCKED NO_DESIGN,NO_ACTIVE_TOKEN" "$(code) $(body | ex 'o.error.code') $(body | ex 'o.error.details.map(d=>d.field).join()')"
check "  reasons say what to do (Design tab / Test tab)" "yes yes" "$(body | ex 'o.error.details[0].message.includes("Design tab")?"yes":"no"') $(body | ex 'o.error.details[1].message.includes("Create a token")?"yes":"no"')"
check "  still a draft in the DB" "draft" "$(sql "SELECT status FROM apis WHERE slug='prices' AND organization_id=(SELECT id FROM organizations WHERE slug='$S')")"
save prices $T/d.json
check "design saved → only NO_ACTIVE_TOKEN left" "NO_ACTIVE_TOKEN" "$(reasons prices)"
TK=$(new_token prices '{"name":"Jivox qa3"}'); TKID=$(body | ex 'o.tokenInfo.id')
check "token made → canPublish true, no reasons" "true none" "$(pcheck prices; body | ex 'o.canPublish') $(reasons prices)"
sql "UPDATE api_tokens SET expires_at = now() - interval '1 minute' WHERE id='$TKID'" > /dev/null
check "its only token expired → NO_ACTIVE_TOKEN, message says extend or renew" "NO_ACTIVE_TOKEN yes" "$(reasons prices) $(body | ex 'o.reasons[0].message.includes("Extend or renew")?"yes":"no"')"
json $T/x.json '{"expiresAt":null}'; req a PATCH "$S/apis/prices/tokens/$TKID" $T/x.json
check "  Extend → can publish again" "true" "$(pcheck prices; body | ex 'o.canPublish')"
new_api dups "$DSBAD"
check "API on data whose import failed → NO_DATA among the reasons" "yes" "$(reasons dups | grep -q NO_DATA && echo yes || echo no)"
new_api reviews "$DS"; save reviews $T/d.json; new_token reviews '{"name":"t"}' > /dev/null
json $T/ft.json '{"feedType":"review"}'; req a PATCH "$S/apis/reviews" $T/ft.json
check "feed type changed (draft) → design no longer fits → DESIGN_INVALID with a count + the first problem" "DESIGN_INVALID yes" "$(reasons reviews) $(body | ex '/has \d+ problems? \(first: .+\)/.test(o.reasons[0].message)?"yes":"no"')"
publish reviews
check "  publish → 409 PUBLISH_BLOCKED DESIGN_INVALID" "409 DESIGN_INVALID" "$(code) $(body | ex 'o.error.details.map(d=>d.field).join()')"

echo "B. Publish"
check "before: /v1 answers 404 (draft)" "404" "$(v1code prices $TK)"
publish prices
P1=$(body | ex 'o.api.publishedAt')
check "publish → 200, published, publishedAt set" "200 published yes" "$(code) $(body | ex 'o.api.status') $([ "$P1" != null ] && echo yes || echo no)"
check "  /v1 answers 200 at once" "200" "$(v1code prices $TK)"
sleep 0.1; publish prices
check "publish again → 200, publishedAt unchanged" "200 $P1" "$(code) $(body | ex 'o.api.publishedAt')"
check "API page / list show published + publishedAt" "published $P1 published" "$(curl -s -b $T/a "$API/organizations/$S/apis/prices" | ex 'o.api.status+" "+o.api.publishedAt') $(curl -s -b $T/a "$API/organizations/$S/apis" | ex 'o.apis.find(a=>a.slug==="prices").status')"
req a PATCH "$S/apis/prices" $T/ft.json
check "feed type of a published API can't change (409 API_PUBLISHED)" "409 API_PUBLISHED" "$(code) $(body | ex 'o.error.code')"
sql "UPDATE api_tokens SET expires_at = now() - interval '1 minute' WHERE id='$TKID'" > /dev/null
check "every token expires AFTER publishing → stays published; /v1 TOKEN_EXPIRED (401)" "published 401 TOKEN_EXPIRED" "$(pcheck prices; body | ex 'o.status') $(curl -s -o $T/v -w '%{http_code}' "$BASE/v1/$S/prices?ids=SKU-1001" -H "X-Api-Key: $TK") $(ex 'o.errors[0].error_code' < $T/v)"
check "  the check still lists the reason (the UI can warn)" "NO_ACTIVE_TOKEN" "$(reasons prices)"
req a PATCH "$S/apis/prices/tokens/$TKID" $T/x.json
check "  Extend → /v1 200 again, no re-publish needed" "200" "$(v1code prices $TK)"
req a DELETE "$S/apis/prices/tokens/$TKID"
check "revoking the last token of a published API is allowed (it stays published, /v1 401)" "200 published 401" "$(code) $(pcheck prices; body | ex 'o.status') $(v1code prices $TK)"
TK=$(new_token prices '{"name":"Jivox qa3 v2"}')

echo "C. Unpublish"
unpublish prices
check "unpublish → 200 draft, publishedAt kept (= last published)" "200 draft $P1" "$(code) $(body | ex 'o.api.status') $(body | ex 'o.api.publishedAt')"
check "  /v1 → 404 at once" "404" "$(v1code prices $TK)"
unpublish prices
check "unpublish again → 200 draft" "200 draft" "$(code) $(body | ex 'o.api.status')"
publish prices
check "publish again → new publishedAt (later)" "200 yes" "$(code) $(body | ex "o.api.publishedAt > '$P1' ? 'yes' : 'no'")"
check "  /v1 200" "200" "$(v1code prices $TK)"
req a PATCH "$S/apis/prices" $T/ft.json
check "unpublished first → feed type CAN change" "200" "$(unpublish prices; req a PATCH "$S/apis/prices" $T/ft.json; code)"
json $T/ft2.json '{"feedType":"product"}'; req a PATCH "$S/apis/prices" $T/ft2.json; publish prices

echo "D. Who can"
check "another account: check / publish / unpublish → 404" "404 404 404" "$(req b GET "$S/apis/prices/publish-check"; code) $(req b POST "$S/apis/prices/publish"; code) $(req b POST "$S/apis/prices/unpublish"; code)"
check "  and it's still published" "published" "$(pcheck prices; body | ex 'o.status')"
check "logged out → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/organizations/$S/apis/prices/publish")"
check "unknown API → 404" "404" "$(publish nope-api; code)"

echo "E. At the same moment"
unpublish prices
for i in $(seq 1 10); do pcall $T/r1-$i POST "$S/apis/prices/publish" & done; wait
check "10 publishes at once → all 200, one publishedAt" "10 1" "$(cat $T/r1-* | grep -c '^200 ok') $(for f in $T/pb/r1-*; do ex 'o.api.publishedAt' < $f; done | sort -u | wc -l | tr -d ' ')"
for i in $(seq 1 5); do pcall $T/r2-p$i POST "$S/apis/prices/publish" & pcall $T/r2-u$i POST "$S/apis/prices/unpublish" & done; wait
check "publish + unpublish ×5 at once → only 200s; end state is one of the two" "0 yes" "$(cat $T/r2-* | grep -vc '^200 ok') $(pcheck prices; body | ex '["published","draft"].includes(o.status)?"yes":"no"')"
new_api race "$DS"; save race $T/d.json
OK=0; BAD=0; WON=0
for round in $(seq 1 8); do
  unpublish race > /dev/null
  RT=$(new_token race "{\"name\":\"r$round\"}"); RID=$(body | ex 'o.tokenInfo.id')
  pcall $T/r3-p POST "$S/apis/race/publish" & pcall $T/r3-d DELETE "$S/apis/race/tokens/$RID" & wait
  P=$(cat $T/r3-p); D=$(cat $T/r3-d)
  # Allowed: published then revoked (200/200), or revoked first and publish refused (409/200).
  [ "$P" == "200 ok" ] && WON=$((WON+1))
  if { [ "$P" == "200 ok" ] || [ "$P" == "409 PUBLISH_BLOCKED" ]; } && [ "$D" == "200 ok" ]; then OK=$((OK+1)); else BAD=$((BAD+1)); echo "    round $round: publish '$P', revoke '$D'"; fi
done
echo "    (publish got in first in $WON of 8 rounds; the revoke in the others)"
check "publish vs revoking the only token (8 rounds) → always 200/200 or 409/200, never a 500" "8 0" "$OK $BAD"
for i in $(seq 1 5); do pcall $T/r4-p$i POST "$S/apis/race/publish" & done
pcall $T/r4-del DELETE "$S/apis/race" & wait
check "publishing while the API is deleted → only 200 / 404, no 500" "0" "$(cat $T/r4-p? | grep -Evc '^(200 ok|404 API_NOT_FOUND|409 PUBLISH_BLOCKED)$')"

echo "F. Publishing reads the design rules, not a cached answer"
json $T/d2.json '{"idField":{"responseKey":"sku"},"fields":[{"jivoxColumn":"current_price","sourceColumn":"priceUSD","responseKey":"price","type":"float"},{"jivoxColumn":"category","sourceColumn":"category","responseKey":"category","type":"string"}],"request":{"method":"GET","query":{"ids":"{item_id}"},"maxIdsPerCall":10}}'
publish prices > /dev/null   # section E's race may have ended as a draft (both end states are fine)
save prices $T/d2.json
check "a published API's design saved again → still published, /v1 sends the new field" "published shoes" "$(pcheck prices; body | ex 'o.status') $(curl -s "$BASE/v1/$S/prices?ids=SKU-1001" -H "X-Api-Key: $TK" | ex 'o.data[0].category')"

psql "$DB" -qtAc "DELETE FROM users WHERE email IN ('$EMAIL','other-$EMAIL')" >/dev/null
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
