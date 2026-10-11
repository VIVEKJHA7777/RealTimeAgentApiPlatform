#!/bin/bash
# Task 2.5 scenario tests: APIs (create, list, open, change name / slug / feed type / data
# source, delete), brand isolation, and races (same slug, rename vs rename, create vs delete).
#
# Usage (backend running with `npm run dev`), from any folder:
#   DB_URL="postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_mine" \
#   API=localhost:4001/api bash docs/test-scripts/phase-02-task-2.5-apis.sh
#
# Creates its own test users and deletes ONLY them at the end. Small files only.
API="${API:-localhost:4000/api}"
DB="${DB_URL:-postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV="${CSV_DIR:-$SCRIPT_DIR/../test-data/csv}"
H='content-type: application/json'
[ -f "$CSV/products-v1.csv" ] || { echo "Can't find the test CSVs in $CSV (set CSV_DIR)"; exit 1; }
curl -s -o /dev/null --max-time 3 "$API/health" || { echo "Backend not reachable at $API"; exit 1; }

T=$(mktemp -d); PASS=0; FAIL=0
check() { if [ "$2" == "$3" ]; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1  (expected: $2, got: $3)"; fi; }
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);const v=eval('o'+process.argv[1]);console.log(typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('JSON-ERROR')}})" "$1"; }
sql() { psql "$DB" -tAc "$1"; }
code() { cat $T/code; }
tally() { sort | uniq -c | awk '{printf "%s×%s ", $1, $2}'; }
# call JAR METHOD PATH [JSON] → body; code in $T/code; headers in $T/headers. PATH is under /organizations/
call() { local jar=$1 m=$2 p=$3 d=$4; if [ -n "$d" ]; then curl -s -D $T/headers -o $T/body -w '%{http_code}' -b $T/$jar -X $m "$API/organizations/$p" -H "$H" -d "$d" > $T/code; else curl -s -D $T/headers -o $T/body -w '%{http_code}' -b $T/$jar -X $m "$API/organizations/$p" > $T/code; fi; cat $T/body; }
# new_ds JAR BRAND FILE NAME → id of a data source whose first import has finished
new_ds() {
  local B ds imp; B=$(curl -s -b $T/$1 -X POST "$API/organizations/$2/data-sources" -F "file=@$3" -F idColumn=sku -F "name=$4")
  ds=$(echo "$B" | json .dataSource.id); imp=$(echo "$B" | json .import.id)
  for i in $(seq 1 100); do st=$(curl -s -b $T/$1 "$API/organizations/$2/data-sources/$ds/imports/$imp" | json .import.status); [ "$st" == succeeded ] || [ "$st" == failed ] && break; sleep 0.1; done
  echo "$ds"
}
api_body() { echo "{\"name\":\"$1\",\"slug\":\"$2\",\"dataSourceId\":\"$3\"${4:+,$4}}"; }

EMAIL="apis-$RANDOM$RANDOM@test.com"
curl -s -o /dev/null -c $T/a -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
curl -s -o /dev/null -c $T/b -X POST $API/auth/signup -H "$H" -d "{\"email\":\"other-$EMAIL\",\"password\":\"password123\"}"
S=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"APIs Test","slug":"apis-test"}' | json .organization.slug)
S2=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"My Second Brand","slug":"second"}' | json .organization.slug)
SB=$(curl -s -b $T/b -X POST $API/organizations -H "$H" -d '{"name":"Other Brand","slug":"other"}' | json .organization.slug)
DS1=$(new_ds a $S $CSV/products-v1.csv Products)
DS2=$(new_ds a $S $CSV/good.csv Catalog)
DS_MY2=$(new_ds a $S2 $CSV/products-v1.csv Products)   # same account, OTHER brand
DS_B=$(new_ds b $SB $CSV/products-v1.csv Products)      # other account
echo "test brand: $S"

echo "A. Create"
R=$(call a POST "$S/apis" "$(api_body 'Live prices' '  Live-Prices  ' $DS1)")
check "201 Created" 201 "$(code)"
check "slug cleaned (trim + lower-case), feed type product, draft" "live-prices product draft" "$(echo "$R" | json '.api.slug+" "+o.api.feedType+" "+o.api.status')"
check "path = /v1/<brand>/<api>" "/v1/$S/live-prices" "$(echo "$R" | json .api.path)"
check "data source summary (name, id column, rows, has data)" "Products sku 5 true" "$(echo "$R" | json '.api.dataSource.name+" "+o.api.dataSource.idColumn+" "+o.api.dataSource.rowCount+" "+o.api.dataSource.hasData')"
check "no internal fields (organizationId, dataSourceId at top)" "undefined undefined" "$(echo "$R" | json '.api.organizationId+" "+o.api.dataSourceId')"
API1=$(echo "$R" | json .api.id)
R=$(call a POST "$S/apis" "$(api_body 'Product details' product-details $DS1 '"feedType":"content"')")
check "second API on the SAME data source, feed type content → 201" "201 content" "$(code) $(echo "$R" | json .api.feedType)"
check "same name, different slug → 201 (names don't have to be unique)" 201 "$(call a POST "$S/apis" "$(api_body 'Live prices' live-prices-2 $DS2)" > /dev/null; code)"
R=$(call a POST "$S/apis" "$(api_body X live-prices $DS2)")
check "same slug in the brand → 409 API_SLUG_TAKEN" "409 API_SLUG_TAKEN slug" "$(code) $(echo "$R" | json .error.code) $(echo "$R" | json .error.details[0].field)"
check "same slug in ANOTHER brand → 201 (unique per brand only)" 201 "$(call a POST "$S2/apis" "$(api_body 'Live prices' live-prices $DS_MY2)" > /dev/null; code)"
for bad in '"ab"' '"a-very-long-slug-that-is-more-than-fifty-characters-x"' '"live_prices"' '"1prices"' '"live--prices"' '"prices-"' '"-prices"' '"live prices"' '"préis"' '""' '123' '"new"' '"NEW"'; do
  # (JSON built in a variable first: macOS bash 3.2 brace-expands {…,…} written with \" inside "$( )")
  BODY="{\"name\":\"X\",\"slug\":$bad,\"dataSourceId\":\"$DS1\"}"
  check "  slug $bad → 400 VALIDATION_ERROR" "400 VALIDATION_ERROR" "$(call a POST "$S/apis" "$BODY" > /dev/null; code) $(cat $T/body | json .error.code)"
done
BODY="{\"slug\":\"okay-slug\",\"dataSourceId\":\"$DS1\"}"
check "name missing → 400 (field name)" "400 name" "$(call a POST "$S/apis" "$BODY" > /dev/null; code) $(cat $T/body | json .error.details[0].field)"
check "name of spaces only → 400" 400 "$(call a POST "$S/apis" "$(api_body '   ' okay-slug $DS1)" > /dev/null; code)"
check "name over 100 characters → 400" 400 "$(call a POST "$S/apis" "$(api_body "$(printf 'n%.0s' $(seq 1 101))" okay-slug $DS1)" > /dev/null; code)"
check "unknown feed type → 400" 400 "$(call a POST "$S/apis" "$(api_body X okay-slug $DS1 '"feedType":"news"')" > /dev/null; code)"
check "dataSourceId missing → 400 (field dataSourceId)" "400 dataSourceId" "$(call a POST "$S/apis" '{"name":"X","slug":"okay-slug"}' > /dev/null; code) $(cat $T/body | json .error.details[0].field)"
check "unknown data source → 404 DATA_SOURCE_NOT_FOUND" "404 DATA_SOURCE_NOT_FOUND" "$(call a POST "$S/apis" "$(api_body X okay-slug nope)" > /dev/null; code) $(cat $T/body | json .error.code)"
check "data source of my OTHER brand → 404" 404 "$(call a POST "$S/apis" "$(api_body X okay-slug $DS_MY2)" > /dev/null; code)"
check "data source of another account → 404" 404 "$(call a POST "$S/apis" "$(api_body X okay-slug $DS_B)" > /dev/null; code)"
check "status in the body is ignored (always draft)" draft "$(call a POST "$S/apis" "$(api_body X status-test $DS1 '"status":"published"')" | json .api.status)"
check "invalid JSON → 400 INVALID_JSON" "400 INVALID_JSON" "$(call a POST "$S/apis" '{"name":' > /dev/null; code) $(cat $T/body | json .error.code)"
B=$(curl -s -b $T/a -X POST "$API/organizations/$S/data-sources" -F "file=@$CSV/products-duplicate-ids.csv" -F idColumn=sku -F name=NoData); DSF=$(echo "$B" | json .dataSource.id); sleep 0.5
check "API on data without a finished import → 201, hasData false" "201 false" "$(call a POST "$S/apis" "$(api_body 'Waiting' waiting $DSF)" > /dev/null; code) $(cat $T/body | json .api.dataSource.hasData)"
check "DB: nothing created by the refused requests (5 APIs in the brand)" 5 "$(sql "SELECT count(*) FROM apis a JOIN organizations o ON o.id=a.organization_id WHERE o.slug='$S'")"

echo "B. List and open"
L=$(call a GET "$S/apis")
check "list → 200, newest first" "200 waiting,status-test,live-prices-2,product-details,live-prices" "$(code) $(echo "$L" | json '.apis.map(a=>a.slug).join(",")')"
check "  Cache-Control: no-store" yes "$(grep -qi '^cache-control: no-store' $T/headers && echo yes || echo no)"
check "  only this brand's APIs (my other brand's not listed)" 5 "$(echo "$L" | json .apis.length)"
R=$(call a GET "$S/apis/live-prices"); check "open by slug → 200" "200 Live prices $API1" "$(code) $(echo "$R" | json '.api.name+" "+o.api.id')"
check "unknown slug → 404 API_NOT_FOUND" "404 API_NOT_FOUND" "$(call a GET "$S/apis/nope" > /dev/null; code) $(cat $T/body | json .error.code)"
check "slug in another case (LIVE-PRICES) → 404 (URLs are exact)" 404 "$(call a GET "$S/apis/LIVE-PRICES" > /dev/null; code)"
check "data source shows the APIs that use it" '["Live prices","Product details","X"]' "$(curl -s -b $T/a "$API/organizations/$S/data-sources/$DS1" | json '.dataSource.usedBy.map(a=>a.name).sort()')"

echo "C. Change (PATCH)"
R=$(call a PATCH "$S/apis/live-prices" '{"name":"  Live prices (US)  "}')
check "rename → 200, name trimmed, slug unchanged, no warnings" "200 Live prices (US) live-prices []" "$(code) $(echo "$R" | json '.api.name+" "+o.api.slug') $(echo "$R" | json .warnings)"
R=$(call a PATCH "$S/apis/live-prices" '{"slug":"Prices-US"}')
check "change slug → 200, new path" "200 prices-us /v1/$S/prices-us" "$(code) $(echo "$R" | json '.api.slug+" "+o.api.path')"
OLD=$(call a GET "$S/apis/live-prices" > /dev/null; code); R=$(call a GET "$S/apis/prices-us")
check "  old slug → 404, new slug → 200, same API" "404 200 $API1" "$OLD $(code) $(echo "$R" | json .api.id)"
check "  slug set to its own current value → 200" 200 "$(call a PATCH "$S/apis/prices-us" '{"slug":"prices-us"}' > /dev/null; code)"
R=$(call a PATCH "$S/apis/prices-us" '{"slug":"product-details"}')
check "slug of another API → 409 API_SLUG_TAKEN, nothing changed" "409 API_SLUG_TAKEN prices-us" "$(code) $(echo "$R" | json .error.code) $(sql "SELECT slug FROM apis WHERE id='$API1'")"
R=$(call a PATCH "$S/apis/prices-us" '{"name":"Changed","slug":"product-details"}')
check "  name + taken slug → 409, the name is NOT changed either (all or nothing)" "409 Live prices (US)" "$(code) $(sql "SELECT name FROM apis WHERE id='$API1'")"
check "feed type change on a draft → 200" "200 review" "$(call a PATCH "$S/apis/prices-us" '{"feedType":"review"}' > /dev/null; code) $(cat $T/body | json .api.feedType)"
R=$(call a PATCH "$S/apis/prices-us" "{\"dataSourceId\":\"$DS2\"}")
check "switch to other data of the brand → 200, summary = Catalog" "200 Catalog 12" "$(code) $(echo "$R" | json '.api.dataSource.name+" "+o.api.dataSource.rowCount')"
check "  old data no longer lists it, new data does" "no yes" "$(curl -s -b $T/a "$API/organizations/$S/data-sources/$DS1" | json '.dataSource.usedBy.some(a=>a.slug==="prices-us")?"yes":"no"') $(curl -s -b $T/a "$API/organizations/$S/data-sources/$DS2" | json '.dataSource.usedBy.some(a=>a.slug==="prices-us")?"yes":"no"')"
check "switch to my OTHER brand's data → 404, unchanged" "404 DATA_SOURCE_NOT_FOUND $DS2" "$(call a PATCH "$S/apis/prices-us" "{\"dataSourceId\":\"$DS_MY2\"}" > /dev/null; code) $(cat $T/body | json .error.code) $(sql "SELECT data_source_id FROM apis WHERE id='$API1'")"
check "switch to another account's data → 404" 404 "$(call a PATCH "$S/apis/prices-us" "{\"dataSourceId\":\"$DS_B\"}" > /dev/null; code)"
check "switch to unknown data → 404" 404 "$(call a PATCH "$S/apis/prices-us" '{"dataSourceId":"nope"}' > /dev/null; code)"
check "empty body → 400" "400 Send at least one of: name, slug, feedType, dataSourceId" "$(call a PATCH "$S/apis/prices-us" '{}' > /dev/null; code) $(cat $T/body | json .error.details[0].message)"
check "only unknown fields ({status}) → 400, status unchanged" "400 draft" "$(call a PATCH "$S/apis/prices-us" '{"status":"published"}' > /dev/null; code) $(sql "SELECT status FROM apis WHERE id='$API1'")"
check "bad slug → 400" 400 "$(call a PATCH "$S/apis/prices-us" '{"slug":"Bad Slug!"}' > /dev/null; code)"
check "bad feed type → 400" 400 "$(call a PATCH "$S/apis/prices-us" '{"feedType":"news"}' > /dev/null; code)"
check "empty name → 400" 400 "$(call a PATCH "$S/apis/prices-us" '{"name":""}' > /dev/null; code)"
check "unknown API → 404 API_NOT_FOUND" "404 API_NOT_FOUND" "$(call a PATCH "$S/apis/nope" '{"name":"X"}' > /dev/null; code) $(cat $T/body | json .error.code)"
# Published APIs (publishing comes in Phase 4: set by SQL here)
sql "UPDATE apis SET status='published', published_at=now() WHERE id='$API1'" > /dev/null
R=$(call a PATCH "$S/apis/prices-us" '{"feedType":"product"}')
check "published: feed type change → 409 API_PUBLISHED, unchanged" "409 API_PUBLISHED review" "$(code) $(echo "$R" | json .error.code) $(sql "SELECT feed_type FROM apis WHERE id='$API1'")"
check "published: same feed type sent again → 200 (not a change)" 200 "$(call a PATCH "$S/apis/prices-us" '{"feedType":"review"}' > /dev/null; code)"
R=$(call a PATCH "$S/apis/prices-us" '{"slug":"prices-live"}')
check "published: slug change → 200 with a warning (new URL, redo the contract)" "200 1 yes" "$(code) $(echo "$R" | json .warnings.length) $(echo "$R" | json '.warnings[0].includes("/v1/'$S'/prices-live") && o.warnings[0].includes("new contract") ? "yes" : "no"')"
R=$(call a PATCH "$S/apis/prices-live" "{\"dataSourceId\":\"$DS1\"}")
check "published: data source switch → 200 with a warning" "200 1" "$(code) $(echo "$R" | json .warnings.length)"
check "published: rename only → no warning" "200 []" "$(call a PATCH "$S/apis/prices-live" '{"name":"Live prices"}' > /dev/null; code) $(cat $T/body | json .warnings)"

echo "D. Delete"
check "delete an API → 204" 204 "$(call a DELETE "$S/apis/product-details" > /dev/null; code)"
check "  open it → 404, delete again → 404" "404 404" "$(call a GET "$S/apis/product-details" > /dev/null; code) $(call a DELETE "$S/apis/product-details" > /dev/null; code)"
check "  its data is kept (Products: 5 rows)" "1 5" "$(sql "SELECT count(*) FROM data_sources WHERE id='$DS1'") $(sql "SELECT row_count FROM data_sources WHERE id='$DS1'")"
check "  its slug is free again → 201" 201 "$(call a POST "$S/apis" "$(api_body 'Product details' product-details $DS2)" > /dev/null; code)"
check "data used by APIs can't be deleted (409 DATA_SOURCE_IN_USE)" 409 "$(curl -s -o /dev/null -w '%{http_code}' -b $T/a -X DELETE "$API/organizations/$S/data-sources/$DS1")"
call a DELETE "$S/apis/prices-live" > /dev/null; call a DELETE "$S/apis/status-test" > /dev/null
check "after deleting its last APIs → the data can be deleted (204)" 204 "$(curl -s -o /dev/null -w '%{http_code}' -b $T/a -X DELETE "$API/organizations/$S/data-sources/$DS1")"

echo "E. Other accounts / brands → 404"
for req in "GET apis" "POST apis" "GET apis/live-prices-2" "PATCH apis/live-prices-2" "DELETE apis/live-prices-2"; do
  set -- $req
  check "other account: $1 …/$2 of my brand → 404 ORGANIZATION_NOT_FOUND" "404 ORGANIZATION_NOT_FOUND" "$(call b $1 "$S/$2" '{"name":"Hacked","slug":"hacked","dataSourceId":"x"}' > /dev/null; code) $(cat $T/body | json .error.code)"
done
check "  my API untouched" "Live prices" "$(sql "SELECT a.name FROM apis a JOIN organizations o ON o.id=a.organization_id WHERE o.slug='$S' AND a.slug='live-prices-2'")"
call b POST "$SB/apis" "$(api_body 'Theirs' only-theirs $DS_B)" > /dev/null
check "another brand's API slug under MY brand → 404 API_NOT_FOUND" "404 API_NOT_FOUND" "$(call a GET "$S/apis/only-theirs" > /dev/null; code) $(cat $T/body | json .error.code)"
check "my other brand's API under this brand → 404" 404 "$(call a GET "$S/apis/live-prices" > /dev/null; code)"
check "logged out → 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' "$API/organizations/$S/apis")"
check "DB makes cross-brand links impossible (insert with another brand's data source fails)" "fails" "$(sql "INSERT INTO apis (id, organization_id, data_source_id, name, slug, updated_at) SELECT 'x-$RANDOM', o.id, '$DS_B', 'Bad', 'bad-link', now() FROM organizations o WHERE o.slug='$S'" > /dev/null 2>&1 && echo inserted || echo fails)"

echo "F. Races"
R=$( (for n in $(seq 1 10); do curl -s -o /dev/null -w '%{http_code}\n' -b $T/a -X POST "$API/organizations/$S/apis" -H "$H" -d "$(api_body "Race $n" race-slug $DS2)" & done; wait) | tally)
check "10 parallel creates with the same slug → 1 × 201 + 9 × 409" "1×201 9×409 " "$R"
for n in 1 2 3 4 5; do call a POST "$S/apis" "$(api_body "Renamer $n" renamer-$n $DS2)" > /dev/null; done
R=$( (for n in 1 2 3 4 5; do curl -s -o /dev/null -w '%{http_code}\n' -b $T/a -X PATCH "$API/organizations/$S/apis/renamer-$n" -H "$H" -d '{"slug":"the-winner"}' & done; wait) | tally)
check "5 different APIs renamed to the same slug at once → 1 × 200 + 4 × 409" "1×200 4×409 " "$R"
check "  exactly one API has it" 1 "$(sql "SELECT count(*) FROM apis a JOIN organizations o ON o.id=a.organization_id WHERE o.slug='$S' AND a.slug='the-winner'")"
R=$( (for n in $(seq 1 10); do curl -s -o /dev/null -w '%{http_code}\n' -b $T/a -X DELETE "$API/organizations/$S/apis/race-slug" & done; wait) | tally)
check "10 parallel deletes of one API → 1 × 204 + 9 × 404" "1×204 9×404 " "$R"
OK=0
for n in 1 2 3 4 5 6; do
  D=$(new_ds a $S $CSV/products-v1.csv "Contested $n")
  curl -s -o /dev/null -w '%{http_code}' -b $T/a -X POST "$API/organizations/$S/apis" -H "$H" -d "$(api_body "Contested $n" contested-$n $D)" > $T/c1 &
  curl -s -o /dev/null -w '%{http_code}' -b $T/a -X DELETE "$API/organizations/$S/data-sources/$D" > $T/c2 &
  wait
  DS_LEFT=$(sql "SELECT count(*) FROM data_sources WHERE id='$D'"); API_LEFT=$(sql "SELECT count(*) FROM apis WHERE data_source_id='$D'")
  # Valid end states: API created + data kept (delete 409) · data deleted + no API (create 404)
  if { [ "$(cat $T/c1) $(cat $T/c2) $DS_LEFT $API_LEFT" == "201 409 1 1" ] || [ "$(cat $T/c1) $(cat $T/c2) $DS_LEFT $API_LEFT" == "404 204 0 0" ]; }; then OK=$((OK+1)); else echo "     round $n: create $(cat $T/c1), delete $(cat $T/c2), data left $DS_LEFT, APIs left $API_LEFT"; fi
  echo "     round $n: create $(cat $T/c1) · delete data $(cat $T/c2)" >> $T/rounds
done
check "create API + delete its data at the same moment (6 rounds) → always a clean end state" 6 "$OK"
sed 's/^/ /' $T/rounds
D=$(new_ds a $S $CSV/products-v1.csv "Switch target")
curl -s -o /dev/null -w '%{http_code}' -b $T/a -X PATCH "$API/organizations/$S/apis/live-prices-2" -H "$H" -d "{\"dataSourceId\":\"$D\"}" > $T/c1 &
curl -s -o /dev/null -w '%{http_code}' -b $T/a -X DELETE "$API/organizations/$S/data-sources/$D" > $T/c2 &
wait
STATE="$(cat $T/c1) $(cat $T/c2) $(sql "SELECT count(*) FROM data_sources WHERE id='$D'") $(sql "SELECT count(*) FROM apis WHERE data_source_id='$D'")"
check "switch an API to data + delete that data at once → clean end state ($STATE)" yes "$([ "$STATE" == "200 409 1 1" ] || [ "$STATE" == "404 204 0 0" ] && echo yes || echo no)"
check "every API points to existing data of its own brand" 0 "$(sql "SELECT count(*) FROM apis a LEFT JOIN data_sources d ON d.id=a.data_source_id AND d.organization_id=a.organization_id WHERE d.id IS NULL")"

psql "$DB" -qtAc "DELETE FROM users WHERE email IN ('$EMAIL','other-$EMAIL')" >/dev/null
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
