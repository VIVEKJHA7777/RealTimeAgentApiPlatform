#!/bin/bash
# Task 3.1 scenario tests: Jivox feed schemas endpoint + the new apis.design / design_version columns.
#
# Usage (backend running with `npm run dev`), from any folder:
#   DB_URL="postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_mine" \
#   API=localhost:4001/api bash docs/test-scripts/phase-03-task-3.1-feed-schemas.sh
#
# Creates its own test user and deletes ONLY it at the end.
API="${API:-localhost:4000/api}"
DB="${DB_URL:-postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCHEMAS="$SCRIPT_DIR/../jivox/feed-schemas"
CSV="$SCRIPT_DIR/../test-data/csv"
H='content-type: application/json'
[ -f "$SCHEMAS/product-feed-schema.csv" ] || { echo "Can't find the feed schemas in $SCHEMAS"; exit 1; }
curl -s -o /dev/null --max-time 3 "$API/health" || { echo "Backend not reachable at $API"; exit 1; }

T=$(mktemp -d); PASS=0; FAIL=0
check() { if [ "$2" == "$3" ]; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1  (expected: $2, got: $3)"; fi; }
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);const v=eval('o'+process.argv[1]);console.log(typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('JSON-ERROR')}})" "$1"; }
sql() { psql "$DB" -tAc "$1"; }
code() { cat $T/code; }
get() { curl -s -D $T/headers -o $T/body -w '%{http_code}' -b $T/a "$API$1" > $T/code; cat $T/body; }
# rows in a schema CSV with a given tier (header excluded); counts ALL rows when no tier given
csv_count() { node -e "const t=require('fs').readFileSync(process.argv[1],'utf8').trim().split('\n').slice(1);console.log(process.argv[2]?t.filter(l=>l.split(',')[1]===process.argv[2]).length:t.length)" "$1" "$2"; }

EMAIL="schemas-$RANDOM$RANDOM@test.com"
check "logged out → 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' "$API/jivox/feed-schemas")"
curl -s -o /dev/null -c $T/a -X POST $API/auth/signup -H "$H" -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"

echo "A. All four schemas"
L=$(get /jivox/feed-schemas)
check "200, four feed types in order" "200 product,review,store,content" "$(code) $(echo "$L" | json '.feedSchemas.map(s=>s.feedType).join(",")')"
check "  Cache-Control: private, max-age=300" yes "$(grep -qi '^cache-control: private, max-age=300' $T/headers && echo yes || echo no)"
for feed in product review store content; do
  S=$(echo "$L" | json ".feedSchemas.find(s=>s.feedType==='$feed')")
  check "$feed: as many fields as the CSV ($(csv_count $SCHEMAS/$feed-feed-schema.csv))" "$(csv_count $SCHEMAS/$feed-feed-schema.csv)" "$(echo "$S" | json .fields.length)"
  check "  mandatory count = CSV" "$(csv_count $SCHEMAS/$feed-feed-schema.csv mandatory)" "$(echo "$S" | json '.fields.filter(f=>f.tier==="mandatory").length')"
  check "  every field: snake_case name, known tier, known typeHint, description" "true" "$(echo "$S" | json '.fields.every(f=>/^[a-z][a-z0-9_]*$/.test(f.name)&&["mandatory","expected","optional"].includes(f.tier)&&["string","int","float","boolean","image"].includes(f.typeHint)&&f.description.length>0)')"
  check "  names unique" "true" "$(echo "$S" | json '.fields.length===new Set(o.fields.map(f=>f.name)).size')"
done
check "id columns: product item_id · review review_id · store store_id · content content_id" "item_id review_id store_id content_id" "$(echo "$L" | json '.feedSchemas.map(s=>s.idColumn).join(" ")')"
check "  the id column is the FIRST field of each schema" "true" "$(echo "$L" | json '.feedSchemas.every(s=>s.fields[0].name===s.idColumn)')"

echo "B. Type hints (approved name rules)"
hint() { echo "$L" | json ".feedSchemas.find(s=>s.feedType==='$1').fields.find(f=>f.name==='$2').typeHint"; }
check "product current_price → float" float "$(hint product current_price)"
check "product discount_percentage → float" float "$(hint product discount_percentage)"
check "product product_image → image" image "$(hint product product_image)"
check "product gallery_image_3 → image" image "$(hint product gallery_image_3)"
check "product purchase_link_2_retailer_logo_url → image" image "$(hint product purchase_link_2_retailer_logo_url)"
check "product product_url → string (a page, not an image)" string "$(hint product product_url)"
check "product is_featured → boolean" boolean "$(hint product is_featured)"
check "product rating_count → int" int "$(hint product rating_count)"
check "product rating_value → float" float "$(hint product rating_value)"
check "review rating_value → int (1–5 per its description)" int "$(hint review rating_value)"
check "review photo_1_url → image · photo_1_caption → string" "image string" "$(hint review photo_1_url) $(hint review photo_1_caption)"
check "review secondary_rating_2_value → float · _scale_max → int" "float int" "$(hint review secondary_rating_2_value) $(hint review secondary_rating_2_scale_max)"
check "review submission_date → string" string "$(hint review submission_date)"
check "store latitude / longitude → float" "float float" "$(hint store latitude) $(hint store longitude)"
check "store retailer_logo / store_logo_url → image" "image image" "$(hint store retailer_logo) $(hint store store_logo_url)"
check "store store_rating_count → int · phone_number → string" "int string" "$(hint store store_rating_count) $(hint store phone_number)"
check "content primary_image / featured_product_1_image_url → image" "image image" "$(hint content primary_image) $(hint content featured_product_1_image_url)"
check "content featured_product_1_product_id → string" string "$(hint content featured_product_1_product_id)"

echo "C. One schema"
check "GET /feed-schemas/review → 200, id review_id, 38 fields" "200 review_id $(csv_count $SCHEMAS/review-feed-schema.csv)" "$(get /jivox/feed-schemas/review > /dev/null; code) $(cat $T/body | json .feedSchema.idColumn) $(cat $T/body | json .feedSchema.fields.length)"
check "unknown feed type → 404 FEED_TYPE_NOT_FOUND" "404 FEED_TYPE_NOT_FOUND" "$(get /jivox/feed-schemas/news > /dev/null; code) $(cat $T/body | json .error.code)"
check "upper case PRODUCT → 404 (exact names)" 404 "$(get /jivox/feed-schemas/PRODUCT > /dev/null; code)"

echo "D. New API columns"
check "apis.design is JSON (keeps key order), nullable · design_version integer, default 0" "json YES integer NO 0" "$(sql "SELECT string_agg(data_type||' '||is_nullable||coalesce(' '||column_default,''), ' ' ORDER BY column_name) FROM information_schema.columns WHERE table_name='apis' AND column_name IN ('design','design_version')")"
SLUG=$(curl -s -b $T/a -X POST $API/organizations -H "$H" -d '{"name":"Schema Test","slug":"schema-test"}' | json .organization.slug)
DS=$(curl -s -b $T/a -X POST "$API/organizations/$SLUG/data-sources" -F "file=@$CSV/products-v1.csv" -F idColumn=sku | json .dataSource.id); sleep 0.5
R=$(curl -s -b $T/a -X POST "$API/organizations/$SLUG/apis" -H "$H" -d "{\"name\":\"X\",\"slug\":\"x-api\",\"dataSourceId\":\"$DS\"}")
check "a new API: designVersion 0 in the answer, design NULL in the DB" "0 t" "$(echo "$R" | json .api.designVersion) $(sql "SELECT design IS NULL FROM apis WHERE id='$(echo "$R" | json .api.id)'")"
check "  the design itself isn't in the API answer (it has its own endpoint, 3.2)" undefined "$(echo "$R" | json .api.design)"

psql "$DB" -qtAc "DELETE FROM users WHERE email='$EMAIL'" >/dev/null
rm -rf $T
echo
echo "RESULT: $PASS passed, $FAIL failed"
