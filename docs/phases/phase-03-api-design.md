# Phase 3: Response and Request Design

**Status:** ✅ Done (2026-10-11; plan approved with the changes in §3b; end-to-end check §18)
**Roadmap:** [../ROADMAP.md](../ROADMAP.md) · **Big picture:** [../PLAN-v2-api-first.md](../PLAN-v2-api-first.md)
**Depends on:** Phase 2 (APIs + data sources)

---

## 0. Progress tracker

| # | Task | Side | Status |
|---|---|---|---|
| 3.1 | Database: `apis.design` + `design_version` (migration); the 4 Jivox feed schemas loaded in the backend + `GET /api/jivox/feed-schemas` | Backend | ✅ |
| 3.2 | Response design: id key + chosen fields (key, type, default, Jivox name) + validation; `GET`/`PUT /design` with the version check | Backend | ✅ |
| 3.3 | **Type auto-detection** per column (first 10 000 rows + Jivox name hint) + value conversion engine + "can't convert" counts | Backend | ✅ |
| 3.4 | Request design: GET or POST, parameters, literals, context; all contract rules | Backend | ✅ |
| 3.5 | Design preview endpoint (sample request + response from real rows) | Backend | ✅ |
| 3.6 | Data guard: a new upload must still contain every column an API sends; **switching an API to other data** (PATCH `dataSourceId`, task 2.5) needs those columns too → 409 listing the missing ones | Backend | ✅ |
| 3.7 | Frontend: **Design tab** (response table, request form, live preview, save) | Frontend | ✅ |
| 3.8 | End-to-end check + docs | Both | ✅ |

---

## 1. Goal (simple words)

For each API, the user decides **what it sends** and **how Jivox asks for it**:

- **Response:** the id column, plus a **subset** of the data's columns (e.g. 3 of 7), each with
  the key name in the response, a type, a default value and the Jivox field name.
- **Request:** GET (`?ids=…` plus fixed parameters) or POST (`{ "items": [ { "sku": … } ] }`
  plus fixed values), the max ids per call, and which chat context (locale / location) is sent.

This is exactly the information a contract/1 document needs (Phase 5).

```
Data source products.csv: sku · name · price · currency · stock · color · category   (7 columns)

API "Live prices"      sends: sku → "sku" (id) · price → "price" (float, Jivox current_price)
                              currency → "currency" (string) · stock → "in_stock" (boolean)
API "Product details"  sends: sku → "id" (id)  · name · color · category
```

## 2. Why we need it

Two APIs on the same data must be able to send different fields with different names, and
every value must have the **type Jivox expects** (`79.99` as a number, not `"79.99"`).

---

## 3b. Decisions from the review (2026-10-11), these override §3 where they differ

| # | Decision |
|---|---|
| R1 | **Jivox field** per response field = a dropdown of the API feed type's schema columns (the 4 CSVs in [../jivox/](../jivox/README.md)), searchable, with tier / description / example. Each Jivox field at most once. Missing mandatory fields = a hint only. |
| R2 | **Id field fixed and first**: product `item_id`, **review `review_id`** (user's decision), store `store_id`, content `content_id`; its source is the data's id column; only its response key is chosen. |
| R3 | **"From your column" = a dropdown of the data source's columns** (the uploaded feed). One data column may feed several Jivox fields. |
| R4 | **Response key** is suggested (from the chosen data column, made key-safe) and **editable**; keys unique and flat (`a-z A-Z 0-9 _ -`). |
| R5 | **Type** = `string · int · float · boolean · image`, **pre-filled by auto-detection** from the column's values (first 10 000 rows; empty column → hint from the Jivox field name), changeable. Stored as `type` (how our API converts and sends the value) + `typeInContract` (on/off; the dropdown's extra choice "not in contract" = off → the contract omits `type` and Jivox fills it from its schema). Both paths are tested. |
| R6 | Auto-match: data column names matched to Jivox names (`currentPrice` → `current_price`, `discount-percentage` → `discount_percentage`); "Map them" adds them all, the user confirms. |
| R7 | Request = contract/1 template (P3-14, approved): form for GET / POST + JSON editor; POST per-row placeholders (`{category}`) chosen from the schema columns. |
| R9 | **Column names never need to match Jivox names** (user, 2026-10-11): a feed may use any names (`priceUSD`, `Product Title`, `in stock`); ANY data column can feed ANY Jivox field. "Must exist in the data" only means the chosen column is one of the uploaded file's columns (exact name). Auto-match (R6) only pre-fills obvious name matches; everything else is picked by the user from the dropdown and can be changed any time. |
| R10 | **Values that don't fit the type are sent as written by default** (user, 2026-10-11: test feeds may not match, and testing how Jivox handles it is part of the job). Per field `onMismatch`: `send` (default; as text, e.g. `"abc"` for a float; the preview warns "Jivox's verification may reject them") or `default` (strict: like an empty value, P3-4). Designs saved before the option = `send`. |
| R11 | **Empty values are sent as `""` by default** (user, 2026-10-11, found on the Design preview: id 5 had no `currentPrice` key). Applies when a row has no value (or a mismatch treated as empty) and the field has **no Default**. Per field `onEmpty`: `empty_string` (default, also for designs saved before the option) or `omit` (strict, the old P3-5 behaviour: key left out). Chosen in the field's **Type** menu ("When a value is empty"). For a non-text field the preview warns that Jivox's verification may reject `""`, and the self-check flags it (`is text "", the contract says float`) |
| R8 | Types are a **design-time suggestion only**: the data is still stored exactly as written (Phase 2 decision unchanged). |

## 3. Decisions (proposed)

| # | Decision | Why |
|---|---|---|
| P3-1 | Design is stored on the API as JSON (`fields`, `request`) and validated by one Zod schema | One place for every rule; easy to turn into a contract |
| P3-2 | The **id field is always first** and always sent; its response key is chosen (default = id column name) | contract/1: first field = the id echo |
| P3-3 | Types: `string`, `int`, `float`, `boolean`, `image` (an http/https URL) | The contract's type list |
| P3-4 | Conversion rules: `int` `"12"`→12; `float` `"79.99"`→79.99; `boolean` `true/false/yes/no/1/0` (any case); `image` must be `http(s)://…`; `string` as is. A value that can't be converted → **treated as missing** (default applies) | Never send a wrong type to Jivox |
| P3-5 | Default value per field (text, converted with the field's type); empty = "no default": then `onEmpty` decides (R11: `""` by default, or the key left out) | Matches "default_value" in contract/1 |
| P3-6 | Jivox field name per field (`current_price`, `custom_badge_2_value`…): `snake_case`, typed by the user with suggestions; checked against the agent's real fields once Jivox is connected (Phase 6) | We can't know the agent's fields before connecting |
| P3-7 | Response keys must be unique, flat, `a-z A-Z 0-9 _ -` | Items are flat objects |
| P3-8 | GET: an ids parameter name (default `ids`), literal parameters (`market=US`), context parameters (`locale` ← `_meta.openai/locale`) | Sample A |
| P3-9 | POST: items key (default `items`), id key inside each item (default = id response key), **per-row columns** (`cat` ← data column `category`), literal values (any JSON: text, number, true/false) at a dot path (`context.locale` style), context values | Sample B |
| P3-10 | Only `_meta.openai/locale` and `_meta.openai/userLocation` are allowed as context | contract/1 rule |
| P3-11 | `maxIdsPerCall` 1–100, default 100 | contract/1 rule |
| P3-12 | **Two people editing the same design at once:** saving sends the version they loaded; if someone saved in between → `409 DESIGN_CHANGED` ("reload to see the latest") | Nobody silently overwrites someone else's changes |
| P3-13 | Changing the design of a **published** API is allowed and applies **immediately**, with a warning: "Jivox's active contract may stop matching; regenerate and resubmit" (decided 2026-10-11: simple design; a live/draft split is parked) | Real-world safety, kept simple |
| P3-14 | **The request design is stored as a contract/1 request template** (`method`, `query` for GET / `body` for POST, any nesting; placeholders `{item_id}`, `{column}`, `{_meta.openai/locale}`, `{_meta.openai/userLocation}`; literals of any JSON type). The form (P3-8, P3-9) builds this template; an advanced JSON editor allows any shape. The same validator enforces the contract rules (`{item_id}` exactly once; POST ids only in a one-element list of objects; `{column}` only next to it; allowed context keys). The `/v1` runtime parses incoming calls with the same template, and the contract copies it. (Proposed 2026-10-11; confirm at review) | "Support all kinds" of requests with ONE engine |

---

## 4. What a saved design looks like

```jsonc
{
  "version": 4,                                  // increases on every save (P3-12)
  "idField": { "responseKey": "sku", "jivoxColumn": "item_id" },
  "fields": [
    { "sourceColumn": "price",    "responseKey": "price",    "type": "float",   "default": "",    "jivoxColumn": "current_price" },
    { "sourceColumn": "currency", "responseKey": "currency", "type": "string",  "default": "USD", "jivoxColumn": "currency" },
    { "sourceColumn": "stock",    "responseKey": "in_stock", "type": "boolean", "default": "",    "jivoxColumn": "custom_badge_1_value" }
  ],
  "request": {
    "method": "GET",
    "maxIdsPerCall": 100,
    "get":  { "idsParam": "ids",
              "literals": [{ "key": "market", "value": "US" }],
              "context":  [{ "key": "locale", "source": "_meta.openai/locale" }] },
    "post": null
  }
}
```

---

## 5. API endpoints

| Method | Path | Body | Success | Main errors |
|---|---|---|---|---|
| GET | `/api/organizations/:slug/apis/:apiSlug/design` | – | `200 { design, dataSource columns }` | 404 |
| PUT | `/api/organizations/:slug/apis/:apiSlug/design` | `{ version, idField, fields, request }` | `200 { design (version+1) }` | 400 `DESIGN_INVALID` (list of rule problems) · 409 `DESIGN_CHANGED` |
| POST | `/api/organizations/:slug/apis/:apiSlug/design/preview` | `{ design, ids? }` | `200 { request (example), response (real items), conversionIssues }` | 400 |

`conversionIssues` example: "price: 3 of 1 240 rows aren't numbers (rows 17, 233, 980): they'll use the default".

---

## 6. Frontend: Design tab

```
Response ─────────────────────────────────────────────────────────────────────
 Id   sku  → key [ sku      ]                                   Jivox [ item_id       ]
 ☑ price     key [ price    ]  type [ float ▾ ]  default [      ]  Jivox [ current_price ]
 ☑ currency  key [ currency ]  type [ string ▾]  default [ USD  ]  Jivox [ currency      ]
 ☑ stock     key [ in_stock ]  type [ boolean▾]  default [      ]  Jivox [ custom_badge… ]
 ☐ name · ☐ color · ☐ category                         (unchecked = not sent)
 ⚠ price: 3 rows aren't numbers → default used

Request ──────────────────────────────────────────────────────────────────────
 ( • GET   ○ POST )   ids parameter [ ids ]   max ids per call [ 100 ]
 Fixed parameters   market = US   [+ add]
 Chat context       locale ← openai/locale   [+ add]

Live preview ─────────────────────────────────────────────────────────────────
 GET /v1/acme-shoes-k3x9q2/live-prices?ids=SKU-1001,SKU-2049&market=US&locale=en-US
 { "status": "success", "data": [ { "sku": "SKU-1001", "price": 79.99, "currency": "USD", "in_stock": true } ], … }
                                                                     [ Save design ]
```

---

## 7. Concurrency

| Situation | Result |
|---|---|
| Two tabs edit the same design | The second save gets 409 `DESIGN_CHANGED` (version check) |
| Data replaced while someone designs | Preview always reads current data; save checks columns still exist |
| Data replaced without a column an API sends | Upload refused (Phase 2 import + 3.6 guard) with the API names |

---

## 8. Not in Phase 3

Tokens and the live `/v1` endpoint (Phase 4) · contract JSON (Phase 5) · checking Jivox names
against the real agent (Phase 6) · computed / formula fields, joins between data sources (out of scope).

## 9. How to verify (filled in during 3.8)

- [x] Two APIs on one data source send different fields under different keys (3.8 §2–4: `sku/price/inStock` GET vs `productId/name/image/amount` POST)
- [x] Types convert correctly; bad values fall back to the default (strict) or are **sent as written** (R10 default); the preview shows which rows (3.8 §3–5, 3.5)
- [x] Every contract rule is enforced (id first, unique flat keys, allowed context only, max ids 1–100, POST id inside one item object) (3.8 §6, 3.2, 3.4)
- [x] Two tabs saving → one 409 (3.8 §7: 8 at once → 1 × 200, 7 × 409; UI conflict dialog in 3.7)
- [x] Uploading data missing a used column is refused (3.8 §8; also at the import switch and on a data switch, 3.6)

---

## 11. Task 3.1: what was built and tested

**In one sentence:** the database can now hold each API's design, and the backend knows the
Jivox field lists (with a type hint per field) and serves them to the frontend.

### Commands log

```bash
cd backend
mkdir -p jivox-schemas && cp ../docs/jivox/feed-schemas/*.csv jivox-schemas/
# schema.prisma: Api + design Json? + designVersion Int @default(0) @map("design_version")
npx prisma migrate dev --name api_design
npx prisma generate                       # Prisma 7: migrate dev doesn't generate
npx tsc --noEmit
bash ../docs/test-scripts/phase-03-task-3.1-feed-schemas.sh     # 45/45
bash ../docs/test-scripts/phase-02-task-2.5-apis.sh             # 87/87 (regression)
```

Migration SQL: `ALTER TABLE "apis" ADD COLUMN "design" JSONB, ADD COLUMN "design_version" INTEGER NOT NULL DEFAULT 0;`

### Files touched

| File | Change |
|---|---|
| `backend/jivox-schemas/{product,review,store,content}-feed-schema.csv` | **Created** (copies of `docs/jivox/feed-schemas/`; the backend reads these) |
| `backend/prisma/schema.prisma`, `prisma/migrations/<ts>_api_design/` | + `Api.design` (JSONB, null until the first save), `Api.designVersion` |
| `backend/src/modules/jivox/feed-schemas.ts` | **Created**: loads + checks the 4 CSVs at start (snake_case names, unique, known tier, id column present; otherwise the server doesn't start); `typeHintFor()` (approved name rules); id column per feed (product `item_id`, review **`review_id`**, store `store_id`, content `content_id`), id first |
| `backend/src/modules/jivox/jivox.controller.ts`, `jivox.routes.ts` | **Created**: `GET /api/jivox/feed-schemas` · `GET /api/jivox/feed-schemas/:feedType` (404 `FEED_TYPE_NOT_FOUND`); logged in; `Cache-Control: private, max-age=300` |
| `backend/src/app.ts` | + `app.use('/api/jivox', jivoxRouter)` |
| `backend/src/modules/apis/apis.service.ts` | API answers include `designVersion` |
| `docs/test-scripts/phase-03-task-3.1-feed-schemas.sh` | **Created** (45 checks) |

### Answer shape

```jsonc
GET /api/jivox/feed-schemas/product
{ "feedSchema": {
    "feedType": "product", "idColumn": "item_id",
    "fields": [
      { "name": "item_id", "tier": "mandatory", "description": "Map the unique product identifier…", "example": "PRD-001", "typeHint": "string" },
      { "name": "brand_name", "tier": "optional", … , "typeHint": "string" },
      { "name": "current_price", "tier": "expected", … , "typeHint": "float" }, … ] } }
```

### Test results: 45/45 (+ 2.5 regression 87/87)

| Group | Checked |
|---|---|
| Access | logged out → 401 |
| A. Schemas (22) | four feed types in order; field counts and mandatory counts equal the CSVs (43/38/24/33; 5/5/5/3); every field snake_case, known tier, known type hint, has a description; names unique; id columns item_id / review_id / store_id / content_id, each first; `Cache-Control: private, max-age=300` |
| B. Type hints (18) | prices/percentages/lat-long → float; images, gallery, logos, review photos → image; `product_url`, captions, dates, ids, phone → string; `is_*` → boolean; counts, helpful votes, scale max, **review rating_value** → int; product/content rating_value → float |
| C. One schema (3) | review → 200, review_id, 38 fields; unknown / upper-case feed type → 404 |
| D. Columns (3) | `design` JSONB nullable, `design_version` integer default 0; a new API → `designVersion: 0`, design NULL; the design isn't in the API answer |
| Fail-fast (by hand) | a duplicated column, an unknown tier, a missing id column → the module refuses to load with a clear message (file restored, identical to the docs copy) |

### Notes

- **Two copies of the CSVs** (docs + backend) on purpose: the docs are for people, the backend
  folder ships with the server. When Jivox sends new schemas, replace both and restart.
- Type hints are only our guess (no type in the CSVs); Phase 6 can compare with the agent's real types from the MCP server.

## 12. Task 3.2: what was built and tested

**In one sentence:** an API's response design (which Jivox field each data column fills, under
which key, with which type / default / "type in contract") can be loaded and saved, with every
rule checked and no silent overwrites.

### Files touched

| File | Change |
|---|---|
| `backend/src/modules/apis/design/design.schemas.ts` | **Created**: Zod shape of a save (`version`, `idField.responseKey`, `fields[]`: `jivoxColumn`, `sourceColumn`, `responseKey`, `type`, `typeInContract` (default true), `default` (default "")); keys `A-Z a-z 0-9 _ -`, 1–64; ≤ 200 fields |
| `backend/src/modules/apis/design/design-rules.ts` | **Created**: `checkDesign()` (pure, reused by GET, PUT and later the 3.6 guard) → problems + warnings; `suggestResponseKey()` |
| `backend/src/modules/apis/design/convert.ts` | **Created**: `convertValue(type, text)` (P3-4 rules); used for defaults now, by 3.3 for the data |
| `backend/src/modules/apis/design/design.service.ts` | **Created**: `getDesign`, `saveDesign` (transaction: lock API row → version check → lock data source row FOR SHARE → rules → save, version + 1) |
| `backend/src/modules/apis/design/design.controller.ts` | **Created**: GET / PUT; shape and rule errors both `400 DESIGN_INVALID` |
| `backend/src/modules/apis/apis.routes.ts` | + `GET`/`PUT /:apiSlug/design` |
| `backend/src/modules/jivox/feed-schemas.ts` | lint: `name.startsWith('is_')` |
| `docs/test-data/csv/jivox-random-names.csv`, `reviews-random-names.csv` | **Created**: feeds whose column names have nothing in common with Jivox names |
| `docs/test-scripts/phase-03-task-3.2-response-design.sh` | **Created** (68 checks) |

### The rules (problems → 400 `DESIGN_INVALID`, `details[].field` = `fields.<i>.<name>`)

| Rule | Example refused |
|---|---|
| Jivox field must be in the API feed type's schema (exact name) | `price_now`, `review_text` on a product API, `Current_Price` |
| The id column (item_id / review_id / store_id / content_id) is the id field, never a normal field | `item_id` as a field of a product API |
| Each Jivox field once | `current_price` twice |
| Source = a column of the API's data (exact name, any name) | `price` / `priceusd` when the data has `priceUSD` |
| Response keys unique (ignoring case), not equal to the id key, flat `A-Z a-z 0-9 _ -`, 1–64 | `Price` + `price`, `a.b`, `a b`, 65 chars |
| Default converts to the type | int `abc`, float `1,5`, boolean `maybe`, image `logo.png` |
| Version = the one loaded | old or future version → **409 `DESIGN_CHANGED`** |

Allowed: one column feeding several Jivox fields; the id column feeding a normal field; only the id (no fields).
**Warnings** (saved anyway): mandatory Jivox fields not sent; `typeInContract: false` with a type
different from Jivox's (our hint); a **published** API ("applies now, make a new contract").

### Answer shape (GET and PUT)

```jsonc
{ "design": { "version": 1, "saved": true,
    "idField": { "jivoxColumn": "item_id", "sourceColumn": "Code", "responseKey": "sku" },
    "fields": [ { "jivoxColumn": "current_price", "sourceColumn": "priceUSD", "responseKey": "price",
                  "type": "float", "typeInContract": true, "default": "" } ] },
  "data": { "idColumn": "Code", "columns": ["Code", "Product Title", "priceUSD", …] },
  "feedType": "product",
  "problems": [],          // GET: the saved design checked against the CURRENT data / feed type
  "warnings": ["Jivox marks these product fields as mandatory and they aren't sent: …"] }
```

Before the first save: `version 0`, `saved: false`, the id key suggested from the id column.

### Test results: 68/68 (+ regressions 3.1 45/45, 2.5 87/87, 2.4 98/98)

| Group | Checked |
|---|---|
| A. Access (3) | logged out 401; another user 404; unknown API 404 |
| B. Starting design (5) | version 0, saved false; id field item_id ← Code; columns in file order (spaces, camelCase) |
| C. Save (12) | random-named columns mapped to Jivox fields; defaults of omitted options; stored JSON; GET = PUT answer; `designVersion` in the API answer; mandatory warning shrinks; one column → two fields; id column → normal field; empty list |
| D. Versions (5) | old / future version → 409 with the latest; **10 parallel saves → exactly 1 × 200, 9 × 409** |
| E. Rules (22) | every row of the rules table; all problems listed at once; nothing saved on 400; shape errors (no body, version missing / -1 / "1", fields not a list, missing type, 201 fields); invalid JSON |
| F. Warnings (3) | type left out + different → warning naming Jivox's type; same type → none |
| G. Re-check (7) | API switched to other data → GET lists the missing columns, save refused until fixed; feed type → store → problems, id field store_id; back → none |
| H. Review (3) | id review_id ← rid; item_id / rating_value (int) / text / date → no mandatory warning; review_id as a field refused |
| I. Published (1) | saved + warning first |
| J. Locks (2) | a save waits while the data source row is locked (switch in progress), then succeeds; another API's lock doesn't block |
| K. Delete (1) | API deleted → design gone |
| By hand | 30 × (save + PATCH data switch + upload) at once on one API: 15 × 200 / 15 × 409 saves, all PATCH 200, all uploads 202, **no 500, no deadlock** |

### Notes

- The id field stores only its key: its source (the data's id column) and Jivox column (by feed
  type) are always read live, so switching data or feed type can't leave them stale.
- Lock order everywhere: **API row, then data source row** (PATCH does the same via the FK check).
- 3.4 adds `request` to the same PUT body.

## 13. Task 3.3: what was built and tested

**In one sentence:** the backend says which types fit each column (to pre-fill the type
dropdown) and counts, over every row, the values that can't be sent as the chosen type.

### Endpoints

| Method | Path | Answer |
|---|---|---|
| GET | `/apis/:apiSlug/design/columns` | `{ sampledRows, columns: [{ name, isId, filled, empty, fits: {int,float,boolean,image}, candidates, suggestedType, examples }] }` (first 10 000 rows, file order) |
| POST | `/apis/:apiSlug/design/check-values` `{ fields: [{ sourceColumn, type }] }` (1–200) | `{ rows, fields: [{ sourceColumn, type, empty, cantConvert, examples: [{ row, id, value }] }] }` (EVERY row; ≤ 5 examples in file order) · 400 unknown column · **429 `TOO_MANY_VALUE_CHECKS`** (more than `VALUE_CHECK_CONCURRENCY`, default 4) |

### How a type is suggested

1. Count, in the first 10 000 rows, the non-empty values that fit each type.
2. **Candidates** = types fitting ≥ 95% of them (one typo among 1 000 prices doesn't make the
   column text), best first: `boolean` (if true/false/yes/no words are used) → `int` → `float` →
   `image` → `boolean` (only 1/0) → `string` (always).
3. **Pre-filled type** (Design tab, `suggestType()`): the Jivox field's type hint if it's a candidate
   (or the column is empty), else the first candidate. E.g. a 1/0 column → `int`, but mapped to
   `is_active` → `boolean`. Empty column + `current_price` → `float`.

### One set of rules, two engines

`convert.ts` holds the patterns as strings (`PATTERNS.int / float / image`, `BOOLEAN_WORDS`). The API
converts with them in JavaScript; the counts run them in Postgres (`~`, `~*`). Only syntax both
engines read the same way: `[0-9]` (not `\d`), explicit ASCII spaces (not `\s`). Changes from 3.2:
int ≤ 15 digits (always exact), float exponent ≤ 2 digits (no `1e999` = Infinity), image = regex
(no `URL()` parsing) so SQL can match it exactly.

### Files touched

| File | Change |
|---|---|
| `backend/src/modules/apis/design/convert.ts` | Rules as shared pattern strings |
| `backend/src/modules/apis/design/value-checks.ts` | **Created**: `detectColumnTypes`, `checkFieldValues`, `candidateTypes`, `suggestType`; REPEATABLE READ snapshot (60 s limit); busy limit |
| `backend/src/modules/apis/design/design.schemas.ts` | + `checkValuesSchema` |
| `backend/src/modules/apis/design/design.controller.ts`, `apis.routes.ts` | + the two routes |
| `backend/src/config/env.ts`, `.env.example` | + `VALUE_CHECK_CONCURRENCY` (default 4) |
| `docs/test-data/csv/value-types.csv` | **Created**: 21 rows, one column per case |
| `docs/test-scripts/phase-03-task-3.3-value-types.sh` | **Created** (34 checks) |

### Test results: 34/34 (+ regressions 3.2 68/68, 3.1 45/45, 2.5 87/87)

| Group | Checked |
|---|---|
| A. Access (2) | logged out 401, another user 404 (both endpoints) |
| B. Detection (12) | id → string; price with one "abc" → float; whole numbers → int; 1/0 → int then boolean; yes/No/TRUE → boolean; URLs (incl. upper case) with one "logo.png" → image; text; empty column → no suggestion; mixed → string; examples in file order |
| C. Counts (11) | price/float 1 (row 7, V-7, abc); price/int 11, first 5 in file order; image 1; boolean 0; string never; empty ≠ wrong; the id column; duplicates; unknown / wrong-case columns → 400; bad bodies; 201 fields |
| D. Current data (2) | API switched → other columns, old column → 400 |
| E. JS = SQL (5) | 40 tricky values (`4.50`, `1,234`, `1e999`, Arabic digits, `0x1F`, `NaN`, 16 digits, `on`, `y`, URL with a space / no host / ftp / `//` / a no-break space …): identical verdicts in both engines, and equal to the verdicts worked out by hand |
| F. Burst (1) | 12 at once → only 200 / 429 |
| **500 000 rows (by hand)** | detection **0.10 s**; check of 6 fields over every row **~2.0 s** (exactly 5 000 bad prices, 2 000 bad images, first examples rows 100… / 250…); **8 at once → 4 × 200, 4 × 429** (in 0.03 s); checks during a replace import → always one full version (500 000 / 5 000) |

### Notes

- ~0.3 s per field per 500 000 rows: the Design tab (3.7) checks only the field that changed, and
  all fields on save / preview.
- Values are never changed (R8): "can't convert" only means "treated as missing when answering".

## 14. Task 3.4: what was built and tested

**In one sentence:** the design now also holds HOW Jivox calls the API, a contract/1 request
template (GET query or POST body of any shape), and every contract/1 request rule is checked.

### Stored / sent (in the same `PUT /design`, key `request`)

```jsonc
{ "method": "GET",  "query": { "ids": "{item_id}", "locale": "{_meta.openai/locale}", "market": "US" }, "maxIdsPerCall": 100 }
{ "method": "POST", "body": { "items": [ { "sku": "{item_id}", "cat": "{brand_name}" } ],
                              "context": { "locale": "{_meta.openai/locale}" }, "currency": "USD" }, "maxIdsPerCall": 50 }
```

- Left out of a save → the saved request is kept (designs saved before 3.4: the starting one,
  `GET ?ids={<id>}`, 100 per call).
- GET / PUT answers add `design.request` and **`requestSummary`** (null while it has problems):
  GET `{ idParam, context: [{ param, source }] }` · POST `{ rowsPath, idKey, columns: [{ key, column }],
  context: [{ path, source }] }`, which is what the `/v1` runtime (Phase 4) reads ids from and the contract describes.
- `apis.design` is now **`json`** (migration `api_design_plain_json`), not `jsonb`: jsonb re-sorts
  object keys, and a request template must come back in the order it was written.

### Rules (400 `DESIGN_INVALID`, `details[].field` = `request.query.<param>` / `request.body.<path>`)

| Rule | Refused example |
|---|---|
| The id placeholder = the feed's id column (`{item_id}` · `{review_id}` · `{store_id}` · `{content_id}`), **exactly once** | none / twice; `{store_id}` on a product API (one clear message) |
| A placeholder is a whole string value | `"id-{item_id}"`; placeholders in key names |
| Context: only `{_meta.openai/locale}`, `{_meta.openai/userLocation}` (anywhere) | `{_meta.openai/timezone}` |
| Unknown placeholders | `{foo}` |
| GET: `query` only, flat, values text / number / true-false, ≤ 50 params, no `{column}` | a body, nested / null values, empty names, `{brand_name}` |
| POST: `body` only, an object or list; `{id}` directly in the ONE object of a one-element list | `"{item_id}"` bare, `["{item_id}"]`, 2 objects in the list, `{id}` nested deeper |
| POST `{column}` (a Jivox column of this feed) only directly in that per-row object | outside it / nested deeper inside it |
| Size | > 10 levels, > 500 values |
| `maxIdsPerCall` whole number 1–100 | 0, 101, 1.5, "10" |
| `method` | `PUT`, `get` |

Literals are copied as written (text with braces that isn't a placeholder, `null`, lists of numbers…).

### Files touched

| File | Change |
|---|---|
| `backend/src/modules/apis/design/request-rules.ts` | **Created**: `checkRequest()` (problems + summary), `defaultRequest()`, `CONTEXT_KEYS` |
| `backend/src/modules/apis/design/design.schemas.ts` | + `requestSchema` (shape), `request` optional in the save, in `StoredDesign` |
| `backend/src/modules/apis/design/design.service.ts` | request checked on load and save; kept when not sent; `requestSummary` |
| `backend/prisma/schema.prisma` + migration `api_design_plain_json` | `design Json? @db.Json` |
| `docs/test-scripts/phase-03-task-3.4-request-design.sh` | **Created** (51 checks) |
| `docs/test-scripts/phase-03-task-3.1…sh`, `…3.2…sh` | json instead of jsonb; 3.2 also expects the request problem after a feed type change |

### Test results: 51/51 (+ regressions 3.3 34/34, 3.2 68/68, 3.1 45/45, 2.5 87/87, 2.4 98/98)

| Group | Checked |
|---|---|
| A. Start (2) | GET ?ids={item_id}, 100; summary |
| B. GET ok (5) | Sample A + summary; numbers / booleans, any id param name, 25 per call; **key order kept** (answer and DB) ; brace-y literal text |
| C. GET refused (16) | every GET row of the rules table, each pointing at the parameter; error code checked (not a JSON error) |
| D. POST ok (5) | Sample B + full summary; key order; the body itself as the list; deeper list + context inside the row + null / lists literals |
| E. POST refused (13) | every POST row of the table; too deep gives ONE message; nothing saved |
| F. Keep (2) | a save without `request` keeps it; old version + request → 409 |
| G. Review (3) | starts with `{review_id}`; `{item_id}` is a per-row column there (POST only); POST per-row works |
| H. Feed type change (2) | review → store flags `{review_id}` / `{item_id}`, summary null; back → clean |

### Notes / to confirm with Jivox

- **Assumed:** a review / store / content API uses its own id placeholder (`{review_id}`…). The
  spec's samples only show product (`{item_id}`). Easy to change in `request-rules.ts` if Jivox
  always uses `{item_id}`.
- `{column}` names are checked against the feed schema; whether the agent's composition maps
  them is checked in Phase 6 (needs the connected agent).

## 15. Task 3.5: what was built and tested

**In one sentence:** for any design (the one being edited, or the saved one) and a few real ids,
the backend shows the request Jivox would send and the exact answer our API would give.

### Endpoint

`POST /apis/:apiSlug/design/preview` `{ design?: { idField, fields, request? }, ids?: [..] }` (nothing saved)

```jsonc
{ "request":  { "method": "GET", "path": "/v1/<brand>/<api>", "query": { "ids": "V-1,V-2", "market": "US" },
                "url": "/v1/<brand>/<api>?ids=V-1%2CV-2&market=US" },          // POST: { method, path, body }
  "response": { "status": "success", "generated_at": "2026-10-11T10:00:00Z",
                "data": [ { "sku": "V-1", "price": 1.5, "active": false, "brand": "n/a", … } ],
                "errors": [ { "error_id": "NOPE", "error_code": "NOT_FOUND", "error_message": "unknown id" } ] },
  "responseHeaders": { "Cache-Control": "no-store", "Content-Type": "application/json" },
  "notes":    [ { "id": "V-7", "responseKey": "price", "column": "price", "value": "abc", "used": "default 0" } ],
  "warnings": [ … ] }
```

- `design` left out → the saved one; sent without `request` → the saved request (like a save).
- `ids` left out → the first 2 rows of the file (like Sample A); 1–100 ids, at most `maxIdsPerCall`;
  exact match; each id answered once in the asked order; unknown ids → `errors`.
- **Items:** id first, then the fields in design order. Value fits the type → converted; empty or
  can't convert → the default (converted), or the key is **left out** when there's no default (`notes` say which).
- **Sample request** = the contract's `sample_request`: context values are dropped (never sent at
  verification; a warning says so); GET ids joined by commas and URL-encoded (`%2C`); POST one
  object per id from the per-row template, `{column}` filled from OUR column mapped to that Jivox
  field (else `""`), literals kept.
- **Warnings:** the design's (mandatory fields…), context, and for GET: **ids containing a comma**
  in the data (GET can't ask for them).
- Errors: 400 `DESIGN_INVALID` (same checks as a save) · 400 ids · 409 `NO_DATA`.
- One REPEATABLE READ snapshot: the rows always come from one version of the data.

### Files touched

| File | Change |
|---|---|
| `backend/src/modules/apis/design/build-response.ts` | **Created** (pure, reused by `/v1` in Phase 4): `buildItem`, `buildResponse`, `buildSampleRequest`, `queryString` |
| `backend/src/modules/apis/design/preview.ts` | **Created**: `previewDesign` |
| `backend/src/modules/apis/design/design.schemas.ts` | + `previewSchema` |
| `backend/src/modules/apis/design/design.controller.ts`, `apis.routes.ts` | + `POST /design/preview` |
| `docs/test-data/csv/ids-comma.csv` | **Created**: ids with a comma, `&` `=`, accent, space |
| `docs/test-scripts/phase-03-task-3.5-preview.sh` | **Created** (33 checks) |

### Test results: 33/33 (+ regressions 3.4 51, 3.3 34, 3.2 68, 3.1 45, 2.5 87)

| Group | Checked |
|---|---|
| A. Access (2) | 401 / 404 |
| B. Default (7) | URL with `%2C`; full V-1 item (float, int, boolean "No", image, string, empty column → default "n/a", 1/0 → true); "3.00" → number 3; envelope; no-store; notes |
| C. Chosen ids (5) | asked order, repeats once, unknown → errors; "abc" → default 0 + note; bad image without default → key left out + note; exact ids |
| D. Edited design (5) | used without saving (version unchanged); 3 rule problems listed; shape error; bad ids (empty list, empty id, 101, not a list) |
| E. GET (4) | literals in order, context dropped + warning, URL; ids > maxIdsPerCall → 400 |
| F. POST (4) | per-row objects with `{column}` from our mapped column / `""`, context object sent empty, literals; body = list; edited design keeps the saved POST request |
| G. Hard ids (3) | `&` `=` `é` space encoded; comma id → GET warning; POST handles it |
| H. No data (1) | failed first import → 409 NO_DATA |
| I. Versions (1) | 30 previews during 3 replace imports: always one version (1 found + 1 unknown) |
| **500 000 rows (by hand)** | GET (incl. comma scan) **~0.10 s**, POST **~0.05 s**, 100 ids spread over the file |

## 16. Task 3.6: what was built and tested

**In one sentence:** data an API answers from can no longer lose a column the API's design
sends, whether by uploading a new version or by switching the API to other data.

### Where it's checked

| When | Result if a used column is missing |
|---|---|
| Upload a **replace** version (the header is read at once) | **409 `COLUMNS_IN_USE`**, one detail per API: `API "Live prices" (live-prices) sends "price", which the new data doesn't have`; no import created, temp file removed |
| The import's **switch** (again, inside the switch transaction) | the import **fails** with `COLUMNS_IN_USE` (same messages in `problems`); the switch is rolled back, the old version stays live, new rows removed |
| **PATCH `dataSourceId`** | **409 `DATA_MISSING_COLUMNS`**, `details[0]`: `{ field: "dataSourceId", message: "Missing: \"price\", \"name\"" }`; nothing in the request applied (all or nothing) |

- A **merge** never removes columns (old + new), so it can't trip the guard.
- Column names are exact (`Price` ≠ `price`). The id field isn't checked (every version must have the id column anyway); a field that sends the id column under another key IS checked (moving to data whose id column has another name → missing).
- APIs without a saved design never block anything.

### Why the switch checks again (and why it's race-free)

The upload check can be outdated by the time a 500 000-row file has imported (someone saves a
design using the column meanwhile). Locks: a design save holds the API row (FOR UPDATE) and the data
source row (FOR SHARE) while it checks; the switch UPDATEs the data source row (waits for any such
save) and then reads the designs (sees every committed save). PATCH takes the same locks as a save
(API row → data source row FOR SHARE), so it can't attach an API to data that's being switched
without a column it needs. Same lock order everywhere: API row, then data source row.

### Files touched

| File | Change |
|---|---|
| `backend/src/modules/apis/design/column-guard.ts` | **Created**: `columnsOfDesign`, `missingColumns`, `apisMissingColumns(db, dataSourceId, columns)`, `describeMissing` |
| `backend/src/modules/data-sources/data-sources.service.ts` | `startImport`: replace + header missing used columns → 409 |
| `backend/src/modules/data-sources/import/import-engine.ts` | switch: re-check inside the transaction → `ImportFailure('COLUMNS_IN_USE')` |
| `backend/src/modules/apis/apis.service.ts` | `updateApi` in a transaction: locks + guard when `dataSourceId` changes |
| `frontend/src/components/apis/api-page/EditApiDialog.tsx` | `DATA_MISSING_COLUMNS` shown under the Data field (the upload dialog already lists `COLUMNS_IN_USE` details as file problems) |
| `docs/test-data/csv/products-no-price.csv`, `products-renamed.csv` | **Created** |
| `docs/test-scripts/phase-03-task-3.6-data-guard.sh` | **Created** (24 checks) |
| `docs/test-scripts/phase-03-task-3.2-response-design.sh` | group G: the data switch is now refused; the stale-design case simulated in SQL (69 checks) |

### Test results: 24/24 (+ all of Phase 2–3: 3.5 33, 3.4 51, 3.3 34, 3.2 69, 3.1 45, 2.5 87, 2.4 98, 2.3 56, 2.2 53)

| Group | Checked |
|---|---|
| A. Upload (7) | no price → 409 naming only the affected API; no import, temp file removed; renamed columns → both APIs, sorted; every used column + a new one → ok; merge without price → ok, price kept |
| B. Design first (3) | removing price from the design → replace works; then a design using price is refused (3.2) |
| C. **Race at the switch** (6) | 200 000-row file accepted → a design using price saved mid-import → import fails `COLUMNS_IN_USE` naming the API; old generation, 5 rows, price kept, new rows removed; preview still answers from the old data |
| D. PATCH (7) | missing → 409 listing both; API unchanged; a rename in the same request not applied; to good data → 200; no design → any data; id-column-as-field case; a name change doesn't run the guard |
| E. Races (2) | 10 data switches + 10 design saves at once on one API: no 500; end state consistent (no problems) |
| UI (by hand) | Edit API → choose data without price → Save: "The chosen data doesn't have every column this API sends… Missing: "price"" under the Data field |

## 17. Task 3.7: the Design tab (frontend)

**In one sentence:** `/brands/:slug/apis/:apiSlug/design` lets you map your columns to Jivox fields,
pick types, design the GET / POST request (form or JSON), see a live preview from real rows, and
save with the version check, on desktop and phone (mockups approved 2026-10-11).

### What's on the tab

| Part | Behaviour |
|---|---|
| Header | "What your API sends" · feed · data · version; badge **Unsaved changes / N problems / Saved**; Discard + Save design (phones: a sticky bottom bar); published → amber banner |
| Response fields | Locked id row (Jivox id column ← data id column, key editable). **Add field** = searchable Jivox picker (tiers, type hint, description, example, "match: column", used ones greyed; ↑↓ Enter). Each row: Jivox field (picker) · your column (native select with sample values) · key · **type picker** (fit % per type, "suggested", "leave out of the contract") · default · ⋯ (Move up / Move down / Remove) |
| Suggestions | New field: column by name match only (`currentPrice` ↔ `current_price`, never a guess), key from the column (unique), type = Jivox hint if the data allows it else best fit. Changing the column re-suggests key / type unless edited by hand. **Auto-map N matches** adds every name match |
| Under each row | problems (red, from the live check) · "3 of 1,240 rows can't be sent as float (rows 17, 233…): the key is left out / the default X is sent" (amber, every row counted, cached per data version) · "N rows are empty" (muted) |
| Request | GET / POST switch (switching back restores the previous one; GET drops per-row values with a toast). GET form: ids parameter, fixed parameters (text / number / true-false), chat context checkboxes + names. POST form: rows key, id key, per-row values (Jivox column / context / fixed), fixed values + context with dotted paths, live body template. **Edit as JSON** (any shape; parse errors with line/column; a shape the form can't show stays in JSON with a note); request problems listed by path |
| Preview | Re-runs ~0.6 s after any change (also on feed type / data / data version change); ids box (empty = first 2 rows; placeholder = real ids); "Jivox sends" (URL or body) + "Your API answers" with copy buttons, headers, value notes, warnings; invalid → "Fix N problems"; no data → message |
| Safety | **Leave guard** (in-app links ask "Leave without saving?"; reload / close asks via the browser) · a **rename** keeps the unsaved draft (no prompt) · **409** → "This design changed" (Copy my version / Reload latest) · a draft never carries over to another API · save blocked while the JSON is invalid |
| Layout | Two columns (editor + sticky preview) when the tab is ≥ 68rem wide (page is max-w-7xl on this tab); field rows ≥ 42rem, cards + **bottom sheet** below; request rows stack below 36rem |

### Files touched

| File | Change |
|---|---|
| `frontend/src/main.tsx` | `createBrowserRouter` + `RouterProvider` (needed for `useBlocker`); same `<Routes>` in App.tsx |
| `frontend/src/App.tsx` | + route `design` |
| `frontend/src/pages/ApiPage.tsx` | Design tab enabled; wide page on it; after a rename keeps the page up while reloading (`keepPreviousData` + skeleton only without data) |
| `frontend/src/components/apis/api-page/OverviewTab.tsx` | step "Response designed" when `designVersion > 0` |
| `frontend/src/components/apis/api-page/EditApiDialog.tsx` | rename keeps the Design tab, navigates with `state.apiRenamed` |
| `frontend/src/components/ui/popover.tsx` | **Created** (`npx shadcn add popover`) |
| `frontend/src/lib/api-types.ts`, `lib/api.ts` | design types; `designApi` (get, save, columns, checkValues, preview), `jivoxApi.feedSchema`; `designVersion` on Api |
| `frontend/src/lib/design.ts` | **Created**: draft ⇄ input, suggestions, request form ⇄ JSON, GET ⇄ POST conversion |
| `frontend/src/lib/use-design-checks.ts` | **Created**: `useDebouncedValue`, `useDesignPreview`, `useValueChecks` |
| `frontend/src/components/apis/design/{DesignTab,ResponseFields,field-controls,RequestEditor,PreviewPanel}.tsx` | **Created** |
| `docs/test-data/csv/jivox-like-names.csv` | **Created** (auto-map) |
| `docs/test-scripts/phase-03-task-3.7-design-lib.test.ts` | **Created** (26 checks of lib/design.ts) |

### Tested (in the browser, 1500 px desktop + 375 px phone + dark mode)

| Scenario | Result |
|---|---|
| Empty design → Add field via search + Enter → no name match → "Choose a column" live on the row and in the preview | ✔ |
| Choose column → key + type re-suggested; "1 of 21 rows can't be sent as float (row 7)"; image row 9 | ✔ |
| 6 fields (float, image, boolean, string, empty column + default n/a, int → string + not in contract) → preview types correct, backend warning shown → **Save** → DB identical to the screen, version 1 | ✔ |
| Type picker: fit % (int 100 / boolean 4.8 / image 0), suggested, not-in-contract checkbox | ✔ |
| GET → POST: per-row `{product_name}` (filled from our mapped column in the sample), fixed `currency`, `context.locale` (dropped in the sample); POST → GET → POST restores each | ✔ |
| JSON: broken JSON (line/column, text kept, method switch + save blocked) · list body (form disabled + note, max ids synced) · 3 rule problems listed by path · back to `{review_id}` → form returns by itself | ✔ |
| Discard → saved design, form view, Save disabled | ✔ |
| Unsaved + click Data → "Leave without saving?" → Stay (kept, focus to Save) / Leave (navigates; Overview "Response designed") · reload guard only while unsaved | ✔ |
| Someone else saves version 2 → Save → 409 dialog → Reload latest shows v2 | ✔ |
| Rename (Edit API) with unsaved changes → no prompt, draft kept, preview on the new URL, save → v3 **(bug found + fixed: the page skeleton unmounted the tab)** | ✔ |
| Feed type product → review → id row review_id, 3 problems live **(bug found + fixed: the preview didn't re-run on a feed type change)**; fix in JSON + remove via ⋯ (focus to the next row) → 0 problems; back to product | ✔ |
| Move down (focus follows), Remove by keyboard (focus to the row taking its place) | ✔ |
| Auto-map on `currentPrice / Product Name / RATING-VALUE / in_stock` → exactly 3 (in_stock not guessed), keys + types right | ✔ |
| Phone: cards, bottom sheet (type popover above it, Escape closes only the popover), sticky Save; no horizontal scroll; request rows stack **(fixed: header squeezed, 4-column rows)** | ✔ |
| Dark mode; published banner + save toast; review API (review_id, `{review_id}` preview, 4 mandatory hint); keyboard picker ↑↓ Enter with aria-activedescendant | ✔ |
| Console: no errors except the expected 400 answers of live checks; Data / Overview / not-found pages still fine; `npm run build` ✔; backend 3.2 / 3.5 / 3.6 scripts still pass | ✔ |

### Fixes after the user's review (2026-10-11)

| Reported | Fix |
|---|---|
| "From your column" listed sample values; the open list was very wide, and scrolling made it grow (macOS native `<select>` menus grow to the screen height while scrolling and widen to the longest option) | **`components/SearchSelect.tsx`** (new): a popover listbox with a FIXED box (22rem or the field's width, max 18rem tall), scrolling inside itself, long names wrapping, a search box for lists over 8, keyboard ↑ ↓ Home End Enter Escape, aria combobox / listbox / activedescendant. Column list = **names only** (+ `id` / `empty` / `not in the data` tags) |
| Same in the upload wizard's "Other column" | Same component (rounded-pill trigger) |
| (found while testing) POST per-row Jivox column list (42 options) | Same component |
| (found while testing) Wizard on a phone: long column names in the id chips widened the page to 395 px | `<fieldset className="min-w-0">` (a fieldset is min-content wide by default) + `min-w-0` on the chip label + full name on hover |

| Coming back to the Design tab flashed a red problem on the id key | The live check ran once on the empty placeholder draft before the saved design loaded (the debounced value lags ~0.6 s). The preview now only runs on a debounced key that was built from the LOADED draft (`enabled` is part of the key). Tested: 5 × Overview → Design with a MutationObserver: no red at any moment |
| "description" chosen but missing from the answer | Its type was float, so every text value "couldn't be sent" and, with no default, the key was left out. Now: changing a row's **Jivox field re-suggests its type** (unless set by hand: current_price float → sub_title string); the amber note says "None of its values fit this type" and has a **"Send as <suggested> instead"** button (one click → the key is back in the answer) |

| (user) "Values that don't fit should still be sent, for testing" | **R10**: per-field `onMismatch` (`send` default / `default` strict). Backend: schema, `buildItem`, design answer, preview warning; type picker gets "When a value isn't <type>: Send it as written / Treat it as empty"; row notes say what happens. Tests: 3.5 → 38 (sent as written + note + warning; strict mode default 0 / key left out; invalid value 400); browser: an old saved design sends `"des": "description1"` as float-mismatch with no "unsaved changes"; strict → key dropped, saved `onMismatch: default`; mixed column float → `10` (number) and `"abc"` (text) |

| (user) The screen jumped when switching GET ⇄ POST | Measured: the switch moved 79 px per toggle (forms differ in height → page shorter → the browser moved the scroll); "Edit as JSON" moved 142 px at the bottom of the page. Fix in `RequestEditor`: the card keeps its tallest height (`min-height`), and the clicked control is put back at the same screen position (`useLayoutEffect` + `scrollBy`). Re-measured: **0 px** for GET, POST, JSON and form, at the top / middle / bottom, desktop and phone |

Tested with a 60-column file of 48-character names: the box stays 352 × 325 px at every scroll
position (top, middle, bottom) in the Design tab and the wizard; search + Enter picks and the key
follows; ↑ ↓ Enter in the wizard; phone: no horizontal scroll (375 px), list above the bottom sheet.

### Notes

- `npm run build` warns that the main chunk is > 500 kB (all of the app's UI libraries in one file);
  splitting by route is a later optimisation.
- The browser's own reload prompt can't be clicked by the test tool; it was checked by dispatching
  `beforeunload` (prevented only while unsaved).

## 18. Task 3.8: end-to-end check + Phase 3 summary

### End-to-end script: `docs/test-scripts/phase-03-task-3.8-end-to-end.sh` (33 checks, all pass)

One journey through everything: a feed with its own column names (`Product Name`, `priceUSD`,
`in_stock`…) → Jivox schema → type detection (with the 95% rule visible on a 5-row file) → **two
APIs on the same data**: API 1 GET (`sku`, `price` strict with default 0, `inStock`; market literal,
locale context) and API 2 POST (`productId`, `name`, `image`, `amount` sent as written; per-row
`{category}`, currency literal) → previews (types converted, defaults with notes, unknown id →
NOT_FOUND, context left out of the sample, wrong-type warning) → can't-convert counts → 7 contract
rules refused, nothing saved → **8 parallel saves → 1 × 200 / 7 × 409** → data guard (replace without
a used column → 409 naming both APIs; merge allowed; full replace → previews read the new data;
switch to unsuitable data → 409) → feed type change flags the design → delete API 2 (data stays)
→ another account gets 404 everywhere.

### Browser walk-through (fresh account)

Sign up → create brand → **Create API wizard** (upload, id column `sku` recommended, review, create)
→ Overview "Data uploaded · Design the response" → Design: add `current_price ← priceUSD` and
`product_name ← Product Name` (column dropdowns), switch to POST, save → version 1, id first in the
answer → Overview "Response designed", no leave prompt after saving.

### Fixed in 3.8

| Problem | Fix |
|---|---|
| After a session ended, the NEXT account logging in was sent to the previous account's page ("Brand not found") | `lib/last-user.ts` (sessionStorage): RequireAuth records who was logged in next to the page to return to (`state.forUser`); RedirectIfAuthed returns there only for the same user. Tested: user A's session ended on A's brand → B logs in → `/`; B's session ended on `/brands/new` → B logs in → `/brands/new`; links opened while logged out still work |

### Totals (all green on 2026-10-11)

3.1 45 · 3.2 69 · 3.3 34 · 3.4 51 · 3.5 38 · 3.6 24 · 3.7 26 (frontend helpers) · **3.8 33** ·
Phase 2 regressions 2.2 53 · 2.3 56 · 2.4 98 · 2.5 87 · `npm run build` ✔.

### What Phase 3 delivered (for Phase 4 and 5)

- `apis.design` (json) + `design_version`: id key, fields (Jivox column, source column, key, type,
  typeInContract, default, **onMismatch**), request template (GET query / POST body), max ids per call.
- `GET/PUT /apis/:apiSlug/design` (rules, version check, locks) · `GET …/design/columns` (type
  detection) · `POST …/design/check-values` (counts, 429) · `POST …/design/preview`.
- **For Phase 4 (`/v1`):** `build-response.ts` (`buildItem`, `buildResponse`) and the
  `requestSummary` (where the ids are: GET `idParam` / POST `rowsPath` + `idKey`) are ready to reuse;
  rows are found by `external_id = ANY(ids)` on the active generation.
- **For Phase 5 (contract):** `requestSummary`, `typeInContract`, `sample_request` built by
  `buildSampleRequest`, the Jivox schema (`fields[].column_name` = `jivoxColumn`, `at` = `$.data[*].<responseKey>`).
- **Open with Jivox:** non-product APIs assumed to use their own id placeholder (`{review_id}`…).

## 10. Open questions (for the detailed review)

**Received 2026-10-11:** the four Jivox feed schemas + the contract/1 spec → [../jivox/](../jivox/README.md)
(column names + tiers; no types yet; review-feed id to confirm).


- Suggest common Jivox field names (`item_id`, `current_price`…): do you have the full list of product/review/store/content fields?
- Should a field be allowed to appear twice (same column sent under two keys)?
