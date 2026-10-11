#!/bin/bash
# Task 6.0: is a PRODUCTION server ready for the internet? Run it against a production build on your
# Mac (see docs/DEPLOY-render-neon.md §5) or against the real Render address after deploying.
#   one address: pages (deep links too), hashed assets cached, /api + /v1 stay JSON, /api/ping
#   sign-up only for allowed emails; login cookie Secure + HttpOnly + SameSite=Lax
#   login / sign-up attempts limited per caller (behind one proxy: per X-Forwarded-For address)
#   PUBLIC_BASE_URL = the server's own address (contracts + Try it use it)
#
# Usage:
#   BASE=http://localhost:4300 ALLOWED=someone@test.com bash docs/test-scripts/phase-06-task-6.0-deploy.sh
#   BASE=https://api-platform.onrender.com ALLOWED=you@jivox.com SKIP_LIMIT=1 bash …   (on Render: see below)
# ALLOWED: an email the server's SIGNUP_ALLOWED_EMAILS lets in that has NO account yet (an account is
#   made with it; on your own server, delete it afterwards or use it as your account).
# DB_URL (optional): that server's database, to delete the test accounts at the end.
# SKIP_LIMIT=1 skips the attempt-limit part (it uses up ~LIMIT attempts from made-up addresses;
#   harmless, but on Render the proxy decides the address, so it can't be tested from outside).
BASE="${BASE:-http://localhost:4300}"; API="$BASE/api"
ALLOWED="${ALLOWED:-deploy-$RANDOM$RANDOM@test.com}"
LIMIT="${LIMIT:-40}"   # the server's AUTH_ATTEMPTS_PER_15_MIN
H='content-type: application/json'
curl -s -o /dev/null --max-time 60 "$API/ping" || { echo "Server not reachable at $BASE"; exit 1; }

T=$(mktemp -d); PASS=0; FAIL=0
check() { if [ "$2" == "$3" ]; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1  (expected: $2, got: $3)"; fi; }
ex() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);const v=eval(process.argv[1]);console.log(typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('JSON-ERROR')}})" "$1"; }
hdr() { grep -i "^$1:" $T/h | head -1 | cut -d' ' -f2- | tr -d '\r'; }
get() { curl -s -D $T/h -o $T/b -w '%{http_code}' "$@"; }
# JSON bodies go through files: a {"a":1,"b":2} written inside "$( … )" can be brace-expanded by bash
body() { printf '%s' "$2" > $T/$1.json; }

echo "1. One address: pages, assets, API"
check "/api/ping → 200 {ok:true}, no-store" '200 true no-store' "$(get "$API/ping") $(ex 'o.ok' < $T/b) $(hdr cache-control)"
check "/ → the app's page (HTML), never cached, framing refused, nosniff" "200 yes no-cache DENY nosniff" "$(get -H 'Accept: text/html' "$BASE/") $(grep -qi '<div id="root">' $T/b && echo yes || echo no) $(hdr cache-control) $(hdr x-frame-options) $(hdr x-content-type-options)"
check "a deep link (/brands/x/apis/y/jivox) → the same page (React Router shows it)" "200 yes" "$(get -H 'Accept: text/html' "$BASE/brands/x/apis/y/jivox") $(grep -qi '<div id="root">' $T/b && echo yes || echo no)"
ASSET=$(curl -s "$BASE/" | grep -o '/assets/[^"]*\.js' | head -1)
check "a hashed asset ($ASSET) → JavaScript, cached a year (immutable)" "200 yes yes" "$(get "$BASE$ASSET") $(hdr content-type | grep -q javascript && echo yes || echo no) $(hdr cache-control | grep -q 'max-age=31536000.*immutable\|immutable.*max-age=31536000' && echo yes || echo no)"
check "a missing asset → 404 (not the page: a stale browser must not run HTML as JS)" "404" "$(get "$BASE/assets/nope-123.js")"
check "an unknown /api path → JSON 404 (not the page)" "404 NOT_FOUND" "$(get -H 'Accept: text/html' "$API/nope") $(ex 'o.error.code' < $T/b)"
check "/v1 stays the live API (JSON envelope, not the page)" "401 failure" "$(get -H 'Accept: text/html' "$BASE/v1/x/y?ids=1") $(ex 'o.status' < $T/b)"
check "/api/health answers (backend + DB)" "200" "$(get "$API/health")"

echo "2. Sign-up only for allowed emails; the login cookie"
OUT="nobody-$RANDOM@not-allowed.example"; body out "{\"email\":\"$OUT\",\"password\":\"password123\"}"
check "an email NOT allowed → 403 SIGNUP_CLOSED (before any password hashing)" "403 SIGNUP_CLOSED" "$(curl -s -o $T/b -w '%{http_code}' -X POST "$API/auth/signup" -H "$H" -d @$T/out.json) $(ex 'o.error.code' < $T/b)"
check "  …and it can't log in either (no account was made)" "401" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/auth/login" -H "$H" -d @$T/out.json)"
PW="pw-$(openssl rand -hex 8)"; body me "{\"email\":\"$ALLOWED\",\"password\":\"$PW\"}"
check "an allowed email → 201, logged in" "201" "$(curl -s -o $T/b -D $T/h -c $T/jar -w '%{http_code}' -X POST "$API/auth/signup" -H "$H" -d @$T/me.json)"
COOKIE=$(hdr set-cookie)
check "  the cookie: HttpOnly, Secure, SameSite=Lax" "yes yes yes" "$(echo "$COOKIE" | grep -qi httponly && echo yes || echo no) $(echo "$COOKIE" | grep -qi secure && echo yes || echo no) $(echo "$COOKIE" | grep -qi 'samesite=lax' && echo yes || echo no)"
SID=$(echo "$COOKIE" | grep -o '^[^;]*')
check "  the session works on /api/auth/me" "200 $ALLOWED" "$(curl -s -o $T/b -w '%{http_code}' -H "Cookie: $SID" "$API/auth/me") $(ex 'o.user.email' < $T/b)"

echo "3. The server's own address (PUBLIC_BASE_URL)"
S=$(curl -s -H "Cookie: $SID" -X POST "$API/organizations" -H "$H" -d '{"name":"Deploy check","slug":"deploy-check"}' | ex 'o.organization.slug')
printf 'sku,price\nSKU-1,10\nSKU-2,20\n' > $T/d.csv
B=$(curl -s -H "Cookie: $SID" -X POST "$API/organizations/$S/data-sources" -F "file=@$T/d.csv" -F "idColumn=sku" -F "name=D")
DS=$(echo "$B" | ex 'o.dataSource.id')
for i in $(seq 1 100); do st=$(curl -s -H "Cookie: $SID" "$API/organizations/$S/data-sources/$DS/imports/$(echo "$B" | ex 'o.import.id')" | ex 'o.import.status'); [ "$st" == succeeded ] && break; sleep 0.2; done
body api "{\"name\":\"P\",\"slug\":\"price-api\",\"dataSourceId\":\"$DS\"}"; curl -s -o /dev/null -H "Cookie: $SID" -X POST "$API/organizations/$S/apis" -H "$H" -d @$T/api.json
curl -s -o /dev/null -H "Cookie: $SID" -X PUT "$API/organizations/$S/apis/price-api/design" -H "$H" -d '{"version":0,"idField":{"responseKey":"id"},"fields":[{"jivoxColumn":"current_price","sourceColumn":"price","responseKey":"price","type":"float"}]}'
URL=$(curl -s -H "Cookie: $SID" -X POST "$API/organizations/$S/apis/price-api/try" -H "$H" -d '{}' | ex 'o.request.url')
check "upload + design work; Try it's request goes to THIS server's address" "succeeded $BASE/v1/$S/price-api" "$st $(echo "$URL" | cut -d'?' -f1)"
TOK=$(curl -s -H "Cookie: $SID" -X POST "$API/organizations/$S/apis/price-api/tokens" -H "$H" -d '{"name":"t"}' | ex 'o.token')
curl -s -o /dev/null -H "Cookie: $SID" -X POST "$API/organizations/$S/apis/price-api/publish"
check "published → a real /v1 call through this address answers (200, no-store, the price)" "200 no-store 10" "$(get -H "X-Api-Key: $TOK" "$BASE/v1/$S/price-api?ids=SKU-1") $(hdr cache-control) $(ex 'o.data[0].price' < $T/b)"

if [ -z "$SKIP_LIMIT" ]; then
  echo "4. Login / sign-up attempts per caller ($LIMIT per 15 min; behind one proxy the caller = X-Forwarded-For)"
  A="198.51.100.$((RANDOM % 250 + 1))"; B2="203.0.113.$((RANDOM % 250 + 1))"
  CODES=$(for i in $(seq 1 $((LIMIT + 1))); do curl -s -o /dev/null -w '%{http_code} ' -X POST "$API/auth/login" -H "$H" -H "X-Forwarded-For: $A" -d '{"email":"x@test.com","password":"wrong-password"}'; done)
  check "$LIMIT wrong logins from one caller → 401 each, the next → 429" "$LIMIT 1" "$(echo $CODES | grep -o 401 | wc -l | tr -d ' ') $(echo $CODES | grep -o 429 | wc -l | tr -d ' ')"
  check "  429 says TOO_MANY_ATTEMPTS + Retry-After; sign-up from that caller is refused too (one budget)" "429 TOO_MANY_ATTEMPTS yes 429" "$(curl -s -D $T/h -o $T/b -w '%{http_code}' -X POST "$API/auth/login" -H "$H" -H "X-Forwarded-For: $A" -d '{"email":"x@test.com","password":"x"}') $(ex 'o.error.code' < $T/b) $([ -n "$(hdr retry-after)" ] && echo yes || echo no) $(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/auth/signup" -H "$H" -H "X-Forwarded-For: $A" -d '{"email":"y@test.com","password":"password123"}')"
  check "  another caller is not affected; the right password from it logs in" "200" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/auth/login" -H "$H" -H "X-Forwarded-For: $B2" -d @$T/me.json)"
  check "  the live /v1 API and ping are never limited" "200 200" "$(curl -s -o /dev/null -w '%{http_code}' -H "X-Forwarded-For: $A" -H "X-Api-Key: $TOK" "$BASE/v1/$S/price-api?ids=SKU-1") $(curl -s -o /dev/null -w '%{http_code}' -H "X-Forwarded-For: $A" "$API/ping")"
fi

if [ -n "$DB_URL" ]; then psql "$DB_URL" -qtAc "DELETE FROM users WHERE email='$ALLOWED'" >/dev/null; echo "  (test account deleted)"; else echo "  (DB_URL not set: the account $ALLOWED stays; delete it or keep it as yours)"; fi
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
