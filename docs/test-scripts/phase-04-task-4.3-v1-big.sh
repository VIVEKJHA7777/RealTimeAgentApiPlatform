#!/bin/bash
# Task 4.3 timing on big data: /v1 against a 500 000-row data source.
#   python3 docs/test-data/generate-big-csv.py 500000 /tmp/products-500k.csv   (once)
#   DB_URL=… API=… bash docs/test-scripts/phase-04-task-4.3-v1-big.sh
# Creates its own test user and deletes ONLY it at the end.
API="${API:-localhost:4000/api}"; BASE="${API%/api}"
DB="${DB_URL:-postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev}"
BIG=/tmp/products-500k.csv; H='content-type: application/json'
[ -f $BIG ] || { echo "Make $BIG first (see the top of this script)"; exit 1; }
T=$(mktemp -d); PASS=0; FAIL=0
check() { if [ "$2" == "$3" ]; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1  (expected: $2, got: $3)"; fi; }
ex() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);const v=eval(process.argv[1]);console.log(typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('JSON-ERROR')}})" "$1"; }
EMAIL="v1big-$RANDOM$RANDOM@test.com"
curl -s -o /dev/null -c $T/a -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
S=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"Big","slug":"big-brand"}' | ex 'o.organization.slug')
B=$(curl -s -b $T/a -X POST "$API/organizations/$S/data-sources" -F "file=@$BIG" -F "idColumn=sku" -F "name=Big")
DS=$(echo "$B" | ex 'o.dataSource.id'); IMP=$(echo "$B" | ex 'o.import.id')
for i in $(seq 1 600); do st=$(curl -s -b $T/a "$API/organizations/$S/data-sources/$DS/imports/$IMP" | ex 'o.import.status'); [ "$st" == succeeded ] && break; sleep 0.5; done
echo "import: $st"
curl -s -o /dev/null -b $T/a -X POST "$API/organizations/$S/apis" -H "$H" -d "{\"name\":\"Big\",\"slug\":\"big-api\",\"dataSourceId\":\"$DS\"}"
printf '%s' '{"version":0,"idField":{"responseKey":"sku"},"fields":[{"jivoxColumn":"product_name","sourceColumn":"name","responseKey":"name","type":"string"},{"jivoxColumn":"current_price","sourceColumn":"price","responseKey":"price","type":"float"},{"jivoxColumn":"is_active","sourceColumn":"in_stock","responseKey":"inStock","type":"boolean"}],"request":{"method":"GET","query":{"ids":"{item_id}"},"maxIdsPerCall":100}}' > $T/d.json
curl -s -o /dev/null -b $T/a -X PUT "$API/organizations/$S/apis/big-api/design" -H "$H" -d @$T/d.json
TK=$(curl -s -b $T/a -X POST "$API/organizations/$S/apis/big-api/tokens" -H "$H" -d '{"name":"t"}' | ex 'o.token')
check "published (real Publish, task 4.4)" "published" "$(curl -s -b $T/a -X POST "$API/organizations/$S/apis/big-api/publish" | ex 'o.api.status')"
# 100 ids spread over the whole file (+ 1 unknown would make 101: keep 100)
IDS=$(node -e 'const a=[];for(let i=0;i<99;i++)a.push("SKU-"+String(1+i*5050).padStart(7,"0"));a.push("SKU-9999999");console.log(a.join(","))')
URL="$BASE/v1/$S/big-api?ids=$IDS"
curl -s -o $T/r -H "X-Api-Key: $TK" "$URL" > /dev/null   # warm-up
check "100 ids on 500 000 rows → 99 found, 1 NOT_FOUND" "200 99 1" "$(curl -s -o $T/r -w '%{http_code}' -H "X-Api-Key: $TK" "$URL") $(ex 'o.data.length+" "+o.errors.length' < $T/r)"
for i in $(seq 1 20); do curl -s -o /dev/null -w '%{time_total}\n' -H "X-Api-Key: $TK" "$URL" >> $T/times; done
AVG=$(awk '{s+=$1} END {printf "%.0f", s/NR*1000}' $T/times); MAX=$(sort -n $T/times | tail -1 | awk '{printf "%.0f", $1*1000}')
echo "    20 calls one after another: average ${AVG} ms, slowest ${MAX} ms"
check "  every call well under Jivox's 3 s (slowest < 500 ms)" yes "$([ $MAX -lt 500 ] && echo yes || echo no)"
START=$(node -e 'console.log(Date.now())')
for i in $(seq 1 100); do curl -s -o /dev/null -w '%{http_code}\n' -H "X-Api-Key: $TK" "$URL" >> $T/par & done; wait
MS=$(( $(node -e 'console.log(Date.now())') - START ))
echo "    100 calls at once (100 ids each): all done in ${MS} ms"
check "  100 parallel calls → all 200, all within 3 s" "100 yes" "$(grep -c '^200$' $T/par) $([ $MS -lt 3000 ] && echo yes || echo no)"
psql "$DB" -qtAc "DELETE FROM users WHERE email='$EMAIL'" >/dev/null
rm -rf $T
echo; echo "RESULT: $PASS passed, $FAIL failed"
