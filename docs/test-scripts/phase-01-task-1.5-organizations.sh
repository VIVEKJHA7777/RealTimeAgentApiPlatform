#!/bin/bash
# Task 1.5 scenario tests: brands (organizations) API.
#
# Usage (backend must be running with `npm run dev`):
#   DB_URL="postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_mine" \
#   LOG_FILE=/path/to/backend.log  bash docs/test-scripts/phase-01-task-1.5-organizations.sh
#
# WARNING: deletes ALL rows from the users table (and with them all sessions and brands).
# LOG_FILE is optional: without it, section J (logs) is skipped.
API=localhost:4000/api
DB="${DB_URL:-postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev}"
H='content-type: application/json'
T=$(mktemp -d)
PASS=0; FAIL=0
check() { # name expected actual
  if [ "$2" == "$3" ]; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1  (expected: $2, got: $3)"; fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
sql() { psql "$DB" -tAc "$1"; }
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);console.log(eval('o'+process.argv[1]))})" "$1"; }
create() { # jar body → full JSON response
  curl -s -b $T/$1 -X POST $API/organizations -H "$H" -d "$2"
}

sql "DELETE FROM users" >/dev/null
for i in $(seq 1 40); do curl -s $API/health >/dev/null 2>&1 && break; perl -e 'select(undef,undef,undef,0.3)'; done
code -c $T/a -X POST $API/auth/signup -H "$H" -d '{"email":"alice@acme.com","password":"password123"}' >/dev/null
code -c $T/b -X POST $API/auth/signup -H "$H" -d '{"email":"bob@bolt.com","password":"password123"}' >/dev/null
code -c $T/c -X POST $API/auth/signup -H "$H" -d '{"email":"carol@new.com","password":"password123"}' >/dev/null
ALICE_ID=$(sql "SELECT id FROM users WHERE email='alice@acme.com'")

echo "A. Create"
R=$(create a '{"name":"Acme Shoes","slug":"acme-shoes"}')
SLUG_A1=$(echo "$R" | json .organization.slug)
check "create → 201" 201 "$(code -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"Acme Kids","slug":"acme-kids"}')"
check "slug = base + '-' + 6 random chars" "yes" "$(echo "$SLUG_A1" | grep -qE '^acme-shoes-[a-z0-9]{6}$' && echo yes || echo "no ($SLUG_A1)")"
check "response has id, name, slug, createdAt only" "createdAt,id,name,slug" "$(echo "$R" | json '.organization && Object.keys(o.organization).sort().join(",")')"
check "owner in DB is the logged-in user" "$ALICE_ID" "$(sql "SELECT owner_id FROM organizations WHERE slug='$SLUG_A1'")"
R=$(create a '{"name":"  Acme Sport  ","slug":"  Acme-Sport "}')
check "'  Acme-Sport ' cleaned to base 'acme-sport'" "yes" "$(echo "$R" | json .organization.slug | grep -qE '^acme-sport-[a-z0-9]{6}$' && echo yes || echo no)"
check "name trimmed" "Acme Sport" "$(echo "$R" | json .organization.name)"
R=$(create a "{\"name\":\"Hacker\",\"slug\":\"owned-by-me\",\"ownerId\":\"someone-else\"}")
check "ownerId in body ignored (owner = me)" "$ALICE_ID" "$(sql "SELECT owner_id FROM organizations WHERE slug='$(echo "$R" | json .organization.slug)'")"
LONG=$(printf 'a%.0s' $(seq 1 30))
R=$(create a "{\"name\":\"Long\",\"slug\":\"$LONG\"}")
check "30-char base → 201, final slug 37 chars" 37 "$(echo "$R" | json .organization.slug.length)"

echo "B. Same base slug: everyone gets a unique slug (no conflicts)"
S1=$(create a '{"name":"Twin","slug":"twin"}' | json .organization.slug)
S2=$(create a '{"name":"Twin","slug":"twin"}' | json .organization.slug)
S3=$(create b '{"name":"Twin","slug":"twin"}' | json .organization.slug)
check "same account, same base twice → 2 different slugs" "yes" "$([ "$S1" != "$S2" ] && [ -n "$S1" ] && echo yes || echo no)"
check "other account, same base → another different slug" "yes" "$([ "$S3" != "$S1" ] && [ "$S3" != "$S2" ] && [ -n "$S3" ] && echo yes || echo no)"

echo "C. Validation (each → 400 VALIDATION_ERROR on the right field)"
v() { # label body field
  local r; r=$(curl -s -b $T/a -w '|%{http_code}' -X POST $API/organizations -H "$H" -d "$2")
  check "$1" "400 $3" "${r##*|} $(echo "${r%|*}" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).error.details.map(d=>d.field).join(','))}catch{console.log('?')}})")"
}
v "missing name"           '{"slug":"valid-slug"}'            name
v "blank name"             '{"name":"   ","slug":"valid-slug"}' name
v "name over 100 chars"    "{\"name\":\"$(printf 'n%.0s' $(seq 1 101))\",\"slug\":\"valid-slug\"}" name
v "missing slug"           '{"name":"X"}'                      slug
v "slug too short 'ab'"    '{"name":"X","slug":"ab"}'          slug
v "slug starts with digit" '{"name":"X","slug":"2brand"}'      slug
v "slug with underscore"   '{"name":"X","slug":"acme_shoes"}'  slug
v "slug with '--'"         '{"name":"X","slug":"acme--shoes"}' slug
v "slug ending with '-'"   '{"name":"X","slug":"acme-"}'       slug
v "slug with space inside" '{"name":"X","slug":"acme shoes"}'  slug
v "slug 31 chars"          "{\"name\":\"X\",\"slug\":\"$(printf 'a%.0s' $(seq 1 31))\"}" slug
v "reserved slug 'api'"    '{"name":"X","slug":"api"}'         slug
v "reserved slug 'NEW' (case-insensitive)" '{"name":"X","slug":"NEW"}' slug
v "slug not a string"      '{"name":"X","slug":123}'           slug
v "both missing"           '{}'                                "name,slug"
check "broken JSON → 400 INVALID_JSON" "400" "$(code -b $T/a -X POST $API/organizations -H "$H" -d '{bad')"

echo "D. List"
A_COUNT=$(sql "SELECT count(*) FROM organizations WHERE owner_id='$ALICE_ID'")
R=$(curl -s -b $T/a $API/organizations)
check "Alice sees exactly her brands" "$A_COUNT" "$(echo "$R" | json .organizations.length)"
check "Bob sees only his 1 brand" 1 "$(curl -s -b $T/b $API/organizations | json .organizations.length)"
check "Carol (no brands) → []" 0 "$(curl -s -b $T/c $API/organizations | json .organizations.length)"
check "newest first" "$S2" "$(curl -s -b $T/a $API/organizations | json '.organizations.filter(o=>o.slug.startsWith("twin-"))[0].slug')"
check "Alice's list contains none of Bob's" 0 "$(echo "$R" | json ".organizations.filter(o=>o.slug==='$S3').length")"

echo "E. Open one (ownership check)"
check "own brand → 200" 200 "$(code -b $T/a $API/organizations/$SLUG_A1)"
check "own brand returns it" "$SLUG_A1" "$(curl -s -b $T/a $API/organizations/$SLUG_A1 | json .organization.slug)"
check "Bob opens Alice's brand → 404" 404 "$(code -b $T/b $API/organizations/$SLUG_A1)"
check "unknown slug → 404" 404 "$(code -b $T/a $API/organizations/does-not-exist-123456)"
N1=$(curl -s -b $T/b $API/organizations/$SLUG_A1 | sed 's/,"requestId":"[^"]*"//')
N2=$(curl -s -b $T/b $API/organizations/does-not-exist-123456 | sed 's/,"requestId":"[^"]*"//')
check "'not mine' and 'doesn't exist' bodies are IDENTICAL" "$N1" "$N2"
check "404 code is ORGANIZATION_NOT_FOUND" ORGANIZATION_NOT_FOUND "$(echo "$N1" | json .error.code)"
check "slug lookup is exact (uppercase → 404)" 404 "$(code -b $T/a $API/organizations/$(echo $SLUG_A1 | tr a-z A-Z))"

echo "F. Auth required"
check "create without cookie → 401" 401 "$(code -X POST $API/organizations -H "$H" -d '{"name":"X","slug":"valid-slug"}')"
check "list without cookie → 401" 401 "$(code $API/organizations)"
check "open without cookie → 401" 401 "$(code $API/organizations/$SLUG_A1)"
code -c $T/a2 -X POST $API/auth/login -H "$H" -d '{"email":"alice@acme.com","password":"password123"}' >/dev/null
code -b $T/a2 -X POST $API/auth/logout >/dev/null
check "list with logged-out cookie → 401" 401 "$(code -b $T/a2 $API/organizations)"

echo "G. Concurrency"
BEFORE=$(sql "SELECT count(*) FROM organizations")
R=$(for i in $(seq 1 10); do curl -s -o /dev/null -w '%{http_code}\n' -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"Rush","slug":"rush"}' & done; wait)
check "10 parallel creates, same base, same account → 10 × 201" 10 "$(echo "$R" | grep -c 201)"
check "10 new rows, 10 distinct slugs" "10 10" "$(sql "SELECT count(*) || ' ' || count(DISTINCT slug) FROM organizations WHERE slug LIKE 'rush-%'")"
R=$( (for i in $(seq 1 5); do curl -s -o /dev/null -w '%{http_code}\n' -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"Race","slug":"race"}' & done; for i in $(seq 1 5); do curl -s -o /dev/null -w '%{http_code}\n' -b $T/b -X POST $API/organizations -H "$H" -d '{"name":"Race","slug":"race"}' & done; wait) )
check "two accounts × 5 parallel creates, same base → 10 × 201" 10 "$(echo "$R" | grep -c 201)"
check "each account owns its 5" "5 5" "$(sql "SELECT (SELECT count(*) FROM organizations o JOIN users u ON u.id=o.owner_id WHERE u.email='alice@acme.com' AND slug LIKE 'race-%') || ' ' || (SELECT count(*) FROM organizations o JOIN users u ON u.id=o.owner_id WHERE u.email='bob@bolt.com' AND slug LIKE 'race-%')")"
R=$( (for i in $(seq 1 10); do curl -s -o /dev/null -w '%{http_code}\n' -b $T/a $API/organizations & done; for i in $(seq 1 10); do curl -s -o /dev/null -w '%{http_code}\n' -b $T/b $API/organizations/$S3 & done; wait) )
check "20 parallel list/open requests → 20 × 200" 20 "$(echo "$R" | grep -c 200)"
R=$(for i in $(seq 1 10); do curl -s -o /dev/null -w '%{http_code}\n' -b $T/b $API/organizations/$SLUG_A1 & done; wait)
check "10 parallel 'open someone else's brand' → 10 × 404" 10 "$(echo "$R" | grep -c 404)"

echo "H. Cascade"
create c '{"name":"Carol Co","slug":"carol-co"}' >/dev/null
check "Carol has 1 brand" 1 "$(sql "SELECT count(*) FROM organizations o JOIN users u ON u.id=o.owner_id WHERE u.email='carol@new.com'")"
sql "DELETE FROM users WHERE email='carol@new.com'" >/dev/null
check "Carol deleted → her brand is gone" 0 "$(sql "SELECT count(*) FROM organizations WHERE slug LIKE 'carol-co-%'")"

echo "I. Database"
check "no slug longer than 40" 0 "$(sql "SELECT count(*) FROM organizations WHERE length(slug) > 40")"
check "all slugs unique" "$(sql "SELECT count(*) FROM organizations")" "$(sql "SELECT count(DISTINCT slug) FROM organizations")"

echo "J. Logs"
L="${LOG_FILE:-}"
if [ -z "$L" ] || [ ! -f "$L" ]; then echo "  (skipped: set LOG_FILE to check logs)"; else
check "no 500 errors logged during the run" 0 "$(sed 's/\x1b\[[0-9;]*m//g' "$L" | grep -c '/api/organizations.*→ 5[0-9][0-9]')"
fi

sql "DELETE FROM users" >/dev/null
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
