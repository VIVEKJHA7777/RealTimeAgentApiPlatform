# Plan v2: API-first platform (for review)

**Status:** ✅ Approved 2026-10-10 with all suggested answers (Q1 = shared data source). Nothing built yet.
**Replaces (once approved):** the Phase 2–8 list in [ROADMAP.md](ROADMAP.md) and the old Phase 2 plan.
**Why:** your feedback (2026-10-10). The product is centred on **APIs**, not datasets: a brand
creates many APIs; each API has its own data, its own token, its chosen fields, a curl to test
it, and a Jivox **contract** that can be submitted and activated from our platform.

---

## 1. The whole journey (what a user does)

```
 Brand "Acme Shoes"
   │
   ├─① Create API          "Live prices"  (feed type: product)
   │
   ├─② Give it data        upload products.csv (7 columns, 1 240 rows)
   │                        → see it, download it, replace it any time
   │
   ├─③ Design the response choose the id column (sku) + only the fields to send
   │                        (price, currency, stock: 3 of the 7 columns),
   │                        rename keys, set types, defaults, Jivox field names
   │
   ├─④ Design the request  GET ?ids=… or POST {items:[…]}, extra fixed params,
   │                        locale/location context, max ids per call, header style
   │
   ├─⑤ Get a token         X-Api-Key or Authorization: Bearer (shown once)
   │
   ├─⑥ Test it             ready-made curl + "Try it" panel in the app +
   │                        our own check of every Jivox verification rule
   │
   ├─⑦ Contract            generated contract/1 JSON from ①–⑤ (+ real sample ids),
   │                        checked against the Jivox rules, copy / download
   │
   └─⑧ Jivox               connect to the Jivox data MCP server (agent's access key),
                            submit_contract → verified / failed (with evidence),
                            get_contracts → versions, activate_contract(version)
```

The **other 4 columns** of that CSV can power a second API ("Product details") that sends a
different set of fields. Section 3 explains how.

---

## 2. Concepts

| Concept | What it is | Example |
|---|---|---|
| **Brand** | (Phase 1) a workspace owned by one account | Acme Shoes |
| **API** | One realtime endpoint Jivox can call. Has a name, slug, feed type, request design, response design, tokens and contracts | "Live prices" → `/v1/acme-shoes-k3x9q2/live-prices` |
| **Data** | The rows an API answers from: uploaded CSV, matched by an id column | 1 240 products, id `sku` |
| **Field** | One column the API sends, with its response key, type, default and Jivox field name | `price` → key `price`, `float`, Jivox `current_price` |
| **Token** | Secret the caller sends in a header; belongs to **one API** | `rtk_8Hf2k…` |
| **Contract** | The contract/1 JSON describing the API for Jivox; can be submitted to the Jivox MCP server | v1 verified, v2 active |
| **Jivox connection** | Per API: the MCP server address + the agent's MCP access key from Studio | |

---

## 3. Key design question: how do APIs and data relate? (Q1)

You described "**every API takes its own data input**" **and** "a 7-column CSV where this API
sends 3 columns and **other APIs** send the others". Two ways to support both:

| | A. Each API owns its own copy of the data | **B. Data source shared by APIs (suggested)** |
|---|---|---|
| How | Upload the CSV into the API. A second API needs its own upload (or "copy data from another API") | A brand has **data sources**; each API **uses one** data source and picks its own fields |
| 7-column scenario | Upload the same CSV twice; or copy (then two copies drift apart when one is replaced) | Upload once → API 1 sends 3 columns, API 2 sends 4 others; replace the data once and **both** APIs are updated |
| UI | Data tab inside the API | **Still API-first**: "Create API → Data: upload a new CSV **or** use existing data". The API page has a Data tab with view / download / replace. Replacing shows "used by 2 APIs" |
| Risk | Copies out of sync | Replacing data affects every API using it (shown clearly, and the new file must still contain each API's fields, otherwise the upload is refused with a list of what's missing) |

**Suggestion: B.** It looks API-first to the user (upload happens inside "Create API"), but
avoids duplicate data and keeps several APIs consistent. If you prefer A, the rest of the plan
is the same except the data tables hang off the API.

---

## 4. What each API stores (design ② – ⑤)

```jsonc
// apis row (simplified)
{
  "name": "Live prices",
  "slug": "live-prices",                 // unique within the brand; part of the URL
  "feedType": "product",                 // product | review | store | content
  "dataSourceId": "…",
  "status": "draft | published",         // only published APIs answer on /v1

  // ③ response design
  "idField":  { "responseKey": "sku", "jivoxColumn": "item_id" },   // the id column (echo)
  "fields": [
    { "sourceColumn": "price",    "responseKey": "price",    "type": "float",  "default": "",    "jivoxColumn": "current_price" },
    { "sourceColumn": "currency", "responseKey": "currency", "type": "string", "default": "USD", "jivoxColumn": "currency" },
    { "sourceColumn": "stock",    "responseKey": "in_stock", "type": "boolean","default": "",    "jivoxColumn": "custom_badge_1_value" }
  ],

  // ④ request design
  "method": "GET",                       // GET | POST
  "get":  { "idsParam": "ids", "literals": { "market": "US" }, "context": { "locale": "_meta.openai/locale" } },
  "post": { "itemsKey": "items", "idKey": "sku", "rowColumns": { "cat": "category" },
            "literals": { "currency": "USD" }, "context": { "context.locale": "_meta.openai/locale" } },
  "maxIdsPerCall": 100,                  // 1..100

  // ⑤ auth
  "authHeader": "x-api-key"              // x-api-key  → X-Api-Key: {token}
                                         // bearer     → Authorization: Bearer {token}
}
```

Rules enforced by the builder (straight from the contract doc):
- the id field is always first, always echoed in every data item;
- items are **flat** (one level, scalar values);
- GET: the ids parameter appears exactly once; POST: `items` is a one-object list containing the id key exactly once; extra per-row columns (`{category}`) only inside that object;
- only `_meta.openai/locale` and `_meta.openai/userLocation` are allowed as context;
- max ids per call 1–100; timeout 3000 ms, retries 0, `no-store` are fixed.

---

## 5. The public API at runtime (what Jivox calls)

```
GET  https://<public host>/v1/acme-shoes-k3x9q2/live-prices?ids=SKU-1001,SKU-9999&market=US&locale=en-US
X-Api-Key: rtk_8Hf2k…

1. token → hash → api_tokens row → it belongs to THIS api (else 401 / 403), not revoked
2. api is published (else 404)
3. read ids (GET param or POST items[*].<idKey>); > maxIdsPerCall → 400
4. one query: records WHERE data_source_id = … AND external_id IN (…)
5. build each item from the chosen fields: rename keys, convert types, apply defaults
6. unknown ids → errors[] NOT_FOUND
7. respond with Cache-Control: no-store

200 { "status": "success", "generated_at": "…",
      "data":   [ { "sku": "SKU-1001", "price": 79.99, "currency": "USD", "in_stock": true } ],
      "errors": [ { "error_id": "SKU-9999", "error_code": "NOT_FOUND", "error_message": "unknown sku" } ] }
```

Literals and context values are accepted (and logged) but don't change the answer: our data
doesn't depend on locale. POST per-row extra columns (`cat`) are accepted and ignored the same way.

---

## 6. Testing an API (⑥)

On the API page, a **Test** tab:
- **curl**, ready to copy, e.g.
  `curl -s "https://<host>/v1/acme-shoes-k3x9q2/live-prices?ids=SKU-1001,SKU-2049&market=US" -H "X-Api-Key: <your token>"`
  (the real token only appears right after it's created; later it shows `<your token>`)
- **Try it**: pick or type ids → we call the API exactly like Jivox would → show status code,
  headers, body
- **Self-check** (runs the same checks Jivox's verification runs, so you know before submitting):
  ✔ HTTP 2xx · ✔ `Cache-Control: no-store` · ✔ `status: success` · ✔ every sent id appears exactly
  once at the id key · ✔ every field is present and has its type (or its default) · ✔ answered in < 3 s

---

## 7. Contracts (⑦) and Jivox (⑧)

### 7.1 Generate

From the API's design we build the full contract/1 document:
`contract_format`, `feed_type`, `base_url` (our public host), `credential: "service"`,
`service_header` / `service_value_format` (from the auth header style), `request`
(GET query / POST body template with `{item_id}`, `{column}`, `{_meta…}`, literals),
`response` (a real sample answer), `fields` (id first, `at: $.data[*].<key>`, type, default,
`column_name` = Jivox field name), `call_rules`, and `sample_request` with **real ids** from the data.

The user can review it, copy it, download it, and see a checklist of the contract rules
(all green before submitting).

### 7.2 Submit and activate through the Jivox MCP server

What we need from the user (per API, entered once in a **Jivox** tab):

| Input | Where the user gets it | Stored how |
|---|---|---|
| MCP server URL | Jivox (data MCP server address) | plain |
| Agent MCP access key | Studio → Real Time Agent → access key icon | **encrypted at rest** (AES-256-GCM, key from env); never shown again, never logged |
| The token to paste into Studio | our platform (⑤) | they paste it into Studio as the standing service token |

Then from our platform:

```
[Connect]   → our backend connects to the MCP server with the access key,
              reads the agent's id column + bound fields (name, type, description, example)
              → we pre-fill / check the Jivox field names in ③ (no typos)
[Submit]    → submit_contract(document) → verified (version N) or failed (+ evidence shown)
[Versions]  → get_contracts → list of verified versions + which one is active
[Activate]  → activate_contract(N) → active (the previous one becomes retired)
```

We keep our own history table (what we submitted, when, the result and evidence), but **Jivox
stays the source of truth** for versions and the active one (we refresh from `get_contracts`).

**Important dependency:** Jivox's live verification calls our API, so it must be reachable
from the internet. For testing: a free tunnel (cloudflared) to the laptop; later a real deploy.

**Unknowns to discover together (Q3):** the exact MCP server URL for qa3, the transport, the
exact tool names/arguments (`submit_contract`, `get_contracts`, `activate_contract`) and the
tool/resource that shares the bound fields. Plan: once you give me a test agent's URL + key, I
list the server's tools first and adapt; the builder and generator don't depend on it.

---

## 8. Data features (②)

- Upload CSV with preview (columns, first rows, id column candidates, problems
  with row numbers) → create. Same CSV rules as the earlier Phase 2 plan (≤ 5 MB, ≤ 50 000 rows,
  ≤ 100 columns, unique headers, unique non-empty ids, BOM / CRLF / quotes handled).
- **View**: paginated table + search by id.
- **Download**: the current data as CSV (same columns and order as uploaded).
- **Replace**: upload a new version (Replace = file becomes the data; Merge = add/update only),
  with a summary "12 added · 1 228 updated · 3 removed". Refused if the file lacks a column an
  API using this data sends.
- Values stored as text exactly as written; empty cell = no value; types are applied by the API
  (⑤ step 5) using the field's type.

---

## 9. Database (new tables)

```
organizations (Phase 1)
 ├── data_sources      name, id_column, columns[names], row_count, last_import_at
 │     └── records     external_id, data JSONB            UNIQUE(data_source_id, external_id)
 ├── apis              name, slug UNIQUE(org, slug), feed_type, status, data_source_id,
 │                     method, request JSONB, id_field JSONB, fields JSONB,
 │                     max_ids_per_call, auth_header
 │     ├── api_tokens  name, prefix, token_hash UNIQUE, last_used_at, revoked_at
 │     ├── contracts   document JSONB, submitted_at, jivox_status (verified|failed|active|retired),
 │     │               jivox_version, evidence JSONB
 │     └── jivox_connections (1:1)  mcp_url, access_key_encrypted, agent_info JSONB, last_checked_at
 └── (later) request_logs   api_id, time, method, ids count, status, duration (no tokens)
```

Every table carries `organization_id`, and every query is scoped by it (Phase 1 rule).

---

## 10. New roadmap (replaces old phases 2–8)

| Phase | Name | Outcome | Main tasks |
|---|---|---|---|
| **2** | **APIs + their data** | Create an API inside a brand; give it data by uploading a CSV (or reuse a brand data source); view, search, download, replace the data | DB (`data_sources`, `records`, `apis`); CSV preview/import/replace/download; API create/list/open/rename/delete; frontend: APIs list on the brand page, "Create API" wizard (name → data), API page with Data tab |
| **3** | **Response + request design** | Choose id + fields (subset, rename, type, default, Jivox name); GET/POST request design | builder API + validation of all contract rules; frontend Design tab with a live preview of a response item |
| **4** | **Tokens + live endpoint + testing** | `/v1/<brand>/<api>` answers in the contract format; tokens per API; curl + Try it + self-check | `api_tokens`; runtime handler (GET + POST, type conversion, defaults, errors[], no-store, max ids); Test tab; curl generator; self-check |
| **5** | **Contract generator** | Valid contract/1 JSON for each API, copy/download, rule checklist | generator + validator; Contract tab |
| **6** | **Public URL + Jivox integration** | Submit, list, activate contracts from our UI | cloudflared tunnel; `jivox_connections` (encrypted key); MCP client; submit / versions / activate; history |
| **7** | **Testing aids** | See exactly what Jivox sent; make the API fail on purpose to test Jivox's checks | request log; failure switches (no `no-store`, `status: failure`, duplicate id, missing id, wrong type, slow > 3 s, HTTP 500) |
| **8** | **Deploy** | Fixed public HTTPS URL | host + DB + env secrets; contracts use the real base URL |

Each phase gets its own detailed plan for your review (like Phase 1), then small tasks, tests
and docs. Phase 2 is next.

### Roadmap decisions this changes

| Was | Becomes |
|---|---|
| D1 one token per brand first, per API later | **Tokens belong to an API from the start** (several per API allowed, so you can rotate without downtime) |
| D2 URL `/v1/<brand-slug>/<api-path>` | Same: `/v1/<brand-slug>/<api-slug>` |
| D3 `X-Api-Key` first, Bearer later | **Both from the start**, chosen per API |
| Old phases: dataset pages, then fixed API, then builder | API-first: create API → data → design → token/test → contract → Jivox |

---

## 11. Concurrency and safety (whole plan)

- Same API slug created twice at once → one wins (`UNIQUE(org, slug)`), the other 409.
- Two data uploads to the same data source at once → serialized by a row lock; each all-or-nothing.
- Jivox calling the API while data is being replaced → sees the old data or the new data, never a mix (transactions).
- Many Jivox calls at once → read-only queries with one indexed lookup per call; token lookup by unique hash.
- Two contract submits at once for one API → allowed (Jivox numbers them); our history records both.
- Tokens and the MCP access key: tokens stored only as hashes; the access key encrypted; both redacted from logs; the token shown once.

---

## 12. Questions for you

| # | Question | My suggestion |
|---|---|---|
| Q1 | Data: **shared data source** used by APIs (B), or each API owns a copy (A)? | B, with an API-first UI |
| Q2 | Jivox field names (`current_price`…): typed by the user with suggestions now, auto-checked against the agent's bound fields once connected to MCP? | Yes |
| Q3 | Can you get a **qa3 test agent**: data MCP server URL + agent MCP access key, so we can discover the exact MCP tools (needed for Phase 6)? | Yes, before Phase 6 |
| Q4 | Public URL for Jivox verification: free **cloudflared** tunnel during development, real deploy in Phase 8? | Yes |
| Q5 | Locale / location / literals / POST per-row extras: accept and log, but they don't change the answer? | Yes |
| Q6 | Several tokens per API (rotate without downtime), each revocable? | Yes |
| Q7 | API status draft / published (only published answers Jivox)? | Yes |
| Q8 | Keep "failure switches" for testing Jivox (Phase 7)? | Yes |
