#!/bin/bash
# Task 1.4 scenario tests: login, logout, me, session middleware, concurrency.
#
# Usage (backend must be running with `npm run dev`):
#   DB_URL="postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_mine" \
#   LOG_FILE=/path/to/backend.log  bash docs/test-scripts/phase-01-task-1.4-auth.sh
#
# WARNING: deletes ALL rows from the users table (and with them all sessions/brands).
# It also stops and restarts PostgreSQL for a few seconds (section J).
# LOG_FILE is optional: without it, section K (secrets in logs) is skipped.
# To capture logs: npm run dev 2>&1 | tee /tmp/backend.log
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

sql "DELETE FROM users" >/dev/null
for i in $(seq 1 40); do curl -s $API/health >/dev/null 2>&1 && break; perl -e 'select(undef,undef,undef,0.3)'; done

echo "A. Sign-up gives a working session"
check "signup → 201" 201 "$(code -c $T/a -X POST $API/auth/signup -H "$H" -d '{"email":"alice@acme.com","password":"password123","name":"Alice"}')"
check "me with signup cookie → 200" 200 "$(code -b $T/a $API/auth/me)"
check "me returns alice" '"alice@acme.com"' "$(curl -s -b $T/a $API/auth/me | grep -o '"alice@acme.com"')"
check "me has Cache-Control: no-store" "no-store" "$(curl -s -D - -o /dev/null -b $T/a $API/auth/me | tr -d '\r' | sed -n 's/^Cache-Control: //Ip')"

echo "B. Requests without a valid session"
check "me without cookie → 401" 401 "$(code $API/auth/me)"
check "401 code is UNAUTHENTICATED" UNAUTHENTICATED "$(curl -s $API/auth/me | grep -o UNAUTHENTICATED)"
check "me with garbage cookie → 401" 401 "$(code -H 'Cookie: sid=garbage' $API/auth/me)"
check "garbage cookie gets cleared (Set-Cookie sid=;)" "sid=;" "$(curl -s -D - -o /dev/null -H 'Cookie: sid=garbage' $API/auth/me | grep -io 'sid=;' | head -1)"
check "logout without cookie → 401" 401 "$(code -X POST $API/auth/logout)"

echo "C. Login"
check "login correct → 200" 200 "$(code -c $T/b -X POST $API/auth/login -H "$H" -d '{"email":"alice@acme.com","password":"password123"}')"
check "login response has no passwordHash" "" "$(curl -s -X POST $API/auth/login -H "$H" -d '{"email":"alice@acme.com","password":"password123"}' | grep -o passwordHash)"
check "login cookie is HttpOnly + SameSite=Lax" "HttpOnly; SameSite=Lax" "$(curl -s -D - -o /dev/null -X POST $API/auth/login -H "$H" -d '{"email":"alice@acme.com","password":"password123"}' | grep -o 'HttpOnly; SameSite=Lax')"
check "login with '  ALICE@Acme.com ' (case/space) → 200" 200 "$(code -X POST $API/auth/login -H "$H" -d '{"email":"  ALICE@Acme.com ","password":"password123"}')"
check "me with login cookie → 200" 200 "$(code -b $T/b $API/auth/me)"
WRONG=$(curl -s -X POST $API/auth/login -H "$H" -d '{"email":"alice@acme.com","password":"wrong-password"}' | sed 's/,"requestId":"[^"]*"//')
NOUSER=$(curl -s -X POST $API/auth/login -H "$H" -d '{"email":"nobody@acme.com","password":"wrong-password"}' | sed 's/,"requestId":"[^"]*"//')
check "wrong password → 401" 401 "$(code -X POST $API/auth/login -H "$H" -d '{"email":"alice@acme.com","password":"wrong-password"}')"
check "unknown email → 401" 401 "$(code -X POST $API/auth/login -H "$H" -d '{"email":"nobody@acme.com","password":"wrong-password"}')"
check "wrong password and unknown email give IDENTICAL bodies" "$WRONG" "$NOUSER"
check "login bad input → 400" 400 "$(code -X POST $API/auth/login -H "$H" -d '{"email":"nope","password":""}')"
check "login broken JSON → 400" 400 "$(code -X POST $API/auth/login -H "$H" -d '{bad')"
check "login password over 128 chars → 400" 400 "$(code -X POST $API/auth/login -H "$H" -d "{\"email\":\"alice@acme.com\",\"password\":\"$(printf 'x%.0s' $(seq 1 129))\"}")"

echo "D. Timing: unknown email vs wrong password (should be similar)"
t() { curl -s -o /dev/null -w '%{time_total}' -X POST $API/auth/login -H "$H" -d "$1"; }
TW=0; TU=0
for i in 1 2 3 4 5; do
  TW=$(echo "$TW + $(t '{"email":"alice@acme.com","password":"wrong-password"}')" | bc)
  TU=$(echo "$TU + $(t '{"email":"nobody@acme.com","password":"wrong-password"}')" | bc)
done
echo "  avg wrong password: $(echo "scale=1; $TW*1000/5" | bc) ms · avg unknown email: $(echo "scale=1; $TU*1000/5" | bc) ms"

echo "E. Logout"
SESS_BEFORE=$(sql "SELECT count(*) FROM sessions")
TOKEN_A=$(awk '$6=="sid"{print $7}' $T/a)
check "logout (browser A) → 204" 204 "$(code -b $T/a -c $T/a -X POST $API/auth/logout)"
code -c $T/x -X POST $API/auth/login -H "$H" -d '{"email":"alice@acme.com","password":"password123"}' >/dev/null
check "logout clears cookie (Set-Cookie sid=;)" "sid=;" "$(curl -s -D - -o /dev/null -b $T/x -X POST $API/auth/logout | grep -io 'sid=;' | head -1)"
SESS_BEFORE=$((SESS_BEFORE-1))  # browser x: one login + one logout = net 0; adjust for A's logout below
check "session rows deleted (A's and x's logouts)" $SESS_BEFORE "$(sql "SELECT count(*) FROM sessions")"
check "old token replayed after logout → 401" 401 "$(code -H "Cookie: sid=$TOKEN_A" $API/auth/me)"
check "browser B still logged in (other device unaffected)" 200 "$(code -b $T/b $API/auth/me)"

echo "F. Login again in the same browser replaces the old session"
code -c $T/c -X POST $API/auth/login -H "$H" -d '{"email":"alice@acme.com","password":"password123"}' >/dev/null
OLD_C=$(awk '$6=="sid"{print $7}' $T/c)
N1=$(sql "SELECT count(*) FROM sessions")
code -b $T/c -c $T/c -X POST $API/auth/login -H "$H" -d '{"email":"alice@acme.com","password":"password123"}' >/dev/null
check "session count unchanged after re-login" "$N1" "$(sql "SELECT count(*) FROM sessions")"
check "previous cookie of that browser now invalid" 401 "$(code -H "Cookie: sid=$OLD_C" $API/auth/me)"
check "new cookie works" 200 "$(code -b $T/c $API/auth/me)"

echo "G. Expired session"
code -c $T/d -X POST $API/auth/login -H "$H" -d '{"email":"alice@acme.com","password":"password123"}' >/dev/null
TOKEN_D=$(awk '$6=="sid"{print $7}' $T/d)
HASH_D=$(printf %s "$TOKEN_D" | shasum -a 256 | cut -d' ' -f1)
sql "UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE token_hash='$HASH_D'" >/dev/null
check "expired session → 401" 401 "$(code -b $T/d $API/auth/me)"
check "expired session row deleted" 0 "$(sql "SELECT count(*) FROM sessions WHERE token_hash='$HASH_D'")"

echo "H. User deleted while logged in"
code -c $T/e -X POST $API/auth/signup -H "$H" -d '{"email":"temp@acme.com","password":"password123"}' >/dev/null
check "temp user logged in" 200 "$(code -b $T/e $API/auth/me)"
sql "DELETE FROM users WHERE email='temp@acme.com'" >/dev/null
check "after user deleted → 401 (sessions cascaded)" 401 "$(code -b $T/e $API/auth/me)"

echo "I. Concurrency"
sql "DELETE FROM sessions" >/dev/null
R=$(for i in $(seq 1 20); do curl -s -o /dev/null -w '%{http_code}\n' -c $T/p$i -X POST $API/auth/login -H "$H" -d '{"email":"alice@acme.com","password":"password123"}' & done; wait)
check "20 parallel logins → 20 × 200" "20" "$(echo "$R" | grep -c 200)"
check "20 distinct sessions created" 20 "$(sql "SELECT count(DISTINCT token_hash) FROM sessions")"
R=$(for i in $(seq 1 20); do curl -s -o /dev/null -w '%{http_code}\n' -b $T/p$i $API/auth/me & done; wait)
check "20 parallel /me (different sessions) → 20 × 200" "20" "$(echo "$R" | grep -c 200)"
R=$(for i in $(seq 1 5); do curl -s -o /dev/null -w '%{http_code}\n' -b $T/p1 -X POST $API/auth/logout & done; wait)
check "5 parallel logouts, SAME session → no 500" "0" "$(echo "$R" | grep -c 500)"
echo "     (statuses: $(echo $R | tr '\n' ' '))"
check "that session is gone, the other 19 remain" 19 "$(sql "SELECT count(*) FROM sessions")"
R=$(for i in $(seq 1 10); do curl -s -o /dev/null -w '%{http_code}\n' -X POST $API/auth/login -H "$H" -d '{"email":"alice@acme.com","password":"wrong-password"}' & done; wait)
check "10 parallel wrong-password logins → 10 × 401" "10" "$(echo "$R" | grep -c 401)"

echo "J. Health still answers 503 (not 500) with a cookie while DB is down"
code -c $T/j -X POST $API/auth/login -H "$H" -d '{"email":"alice@acme.com","password":"password123"}' >/dev/null
brew services stop postgresql@18 >/dev/null 2>&1; perl -e 'select(undef,undef,undef,1)'
check "health with cookie, DB down → 503" 503 "$(code -b $T/j $API/health)"
check "me with cookie, DB down → 500 (can't check session)" 500 "$(code -b $T/j $API/auth/me)"
brew services start postgresql@18 >/dev/null 2>&1; for i in $(seq 1 20); do pg_isready -q && break; perl -e 'select(undef,undef,undef,0.5)'; done
perl -e 'select(undef,undef,undef,1)'
check "DB back → me works again with same cookie" 200 "$(code -b $T/j $API/auth/me)"

echo "K. Secrets never in logs"
L="${LOG_FILE:-}"
if [ -z "$L" ] || [ ! -f "$L" ]; then echo "  (skipped: set LOG_FILE to check logs)"; else
TOKEN_J=$(awk '$6=="sid"{print $7}' $T/j)
check "session token absent from logs" 0 "$(grep -c -- "$TOKEN_J" $L)"
check "passwords absent from logs" 0 "$(grep -c -E 'password123|wrong-password' $L)"
check "cookie header shown as [Redacted]" 1 "$(grep -c -m1 '"cookie":"\[Redacted\]"' $L)"
fi

sql "DELETE FROM users" >/dev/null
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
