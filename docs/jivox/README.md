# Jivox reference material (for Phases 3–6)

| File | What |
|---|---|
| [contract-1.md](contract-1.md) | The contract/1 spec: template, dictated response, samples A/B, rules, verification, live vs ingested |
| [feed-schemas/product-feed-schema.csv](feed-schemas/product-feed-schema.csv) | Jivox **product** feed columns (43) |
| [feed-schemas/review-feed-schema.csv](feed-schemas/review-feed-schema.csv) | **review** feed (38) |
| [feed-schemas/store-feed-schema.csv](feed-schemas/store-feed-schema.csv) | **store** feed (24) |
| [feed-schemas/content-feed-schema.csv](feed-schemas/content-feed-schema.csv) | **content** feed (33) |
| [mcp-snapshot-2026-10-12/](mcp-snapshot-2026-10-12/) | Live answers of the qa3 data MCP (task 5.0, read-only): tools list, `get_contract_spec`, `get_canonical_schema` (real types, tiers, bound fields), `list_contracts`. No key inside |

Shared by the user on 2026-10-11. Schema CSV columns: `column_name, tier, description, example_format`.
Tiers: **mandatory** / **expected** / **optional**.

## How they fit our platform

In a contract, `fields[].column_name` must be one of these canonical column names (for the API's
feed type), and `at` points at the key **our** API uses for that value
(`$.data[*].<our key>`). So the Phase 3 "response design" is exactly: for each Jivox column the
agent serves, which column of our data feeds it, under which response key, with which type and
default.

```
our data column      our response key      Jivox column_name (feed schema)
currentPrice    ──►  "price"          ──►  current_price          (type float)
productImage    ──►  "image"          ──►  product_image          (type image)
Id1             ──►  "id"             ──►  item_id  ← always first (the echo)
```

## Facts from the schemas

| Feed | Columns | Mandatory | Id column (proposed echo) |
|---|---|---|---|
| product | 43 | item_id, product_name, product_image, purchase_link_1_purchase_link, purchase_link_1_retailer_name | `item_id` |
| review | 38 | review_id, item_id, rating_value, review_text, submission_date | `review_id`? or `item_id`? (**open question**) |
| store | 24 | store_id, store_name, retailer_name, latitude, longitude | `store_id` |
| content | 33 | content_id, content_name, primary_image | `content_id` |

Repeated groups: `gallery_image_1..5`, `purchase_link_1..5_*`, `custom_badge_1..3_label/value`,
`featured_product_1..3_*`, `section_1..5_label/content`, `photo_1..3_*`, `secondary_rating_1..3_*`.

## Gaps / open questions (to confirm in the Phase 3 review)

1. **No `type` column in these CSVs.** The contract's types are `string | int | float | boolean |
   image` ("filled from the schema if omitted"), and the MCP server shares each bound field's type.
   Until we have the real types, a proposed inference by name (to confirm):
   - `image`: product_image, primary_image, gallery_image_N, *_image_url, *logo*, photo_N_url
   - `float`: current_price, discount_percentage, rating_value (product/content), latitude,
     longitude, store_rating_value, secondary_rating_N_value
   - `int`: rating_count, store_rating_count, helpful_votes_up, secondary_rating_N_scale_max,
     review `rating_value` (description says integer 1–5)
   - `boolean`: is_* (is_active, is_featured, is_verified_purchase…)
   - `string`: everything else (ids, names, texts, non-image URLs like product_url, dates, currency…)
2. **Review feed id:** the review schema has both `review_id` (unique, upsert key) and `item_id`
   (the product it belongs to). Contract/1 needs one id per row; `review_id` looks right, but
   the template comment says "item_id first". Which does the review agent use?
3. Pipe-separated values (`pros`, `cons`, `review_tags`) stay strings ("a | b | c").
