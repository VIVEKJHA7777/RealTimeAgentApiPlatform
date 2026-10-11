# Jivox contract/1: the realtime API contract (reference)

> Source: shared by the user (Jivox, 2026-10-11). Kept here so every phase works from the exact
> rules. Our platform's job: serve APIs that pass these rules, and generate/submit the contracts.

## How a contract comes to exist

In Studio (screen 1, Data Source) the user adds a **Real Time Agent**, picks the **fields it
serves**, and pastes the **standing service token**. Studio stores the token in the parameter
store, creates the agent row, and issues the agent's **MCP access key**.

The author agent connects to the data MCP server with that key. The server shares the **id
column** and the agent's **bound fields** (name, type, tier, description, example) along with
other possible user input fields, the authoring rules, and these samples.

Every `submit_contract` call creates a new contract. The platform validates the document, gates
it against the agent, and verifies it with **one live call**. A document that passes is stored as
a new numbered version with status **verified**. A document that flunks the live call is stored
with status **failed** and no version number; the evidence comes back in the response, and the
author fixes the document and submits again. Failed contracts are never listed or activated.

`get_contracts` lists the agent's verified versions, and names the active one when there is one.

`activate_contract(version)` makes one listed version active. Only a verified version can be
activated. Before the switch the platform re-runs the gates and the live verification call for
that version, so a document that no longer matches the agent or the API is refused with the
evidence and nothing changes. Exactly one version per agent is active at a time; the previously
active one becomes **retired**.

Versions count 1, 2, 3 per agent in the order they were verified. Failed documents get no
number; retired versions keep theirs (never reused). **failed** and **retired** are final: to go
back to a retired document, submit it again (verified afresh → new version).

```
submit ──► verified ──activate──► active ──(another version activated)──► retired
   └──► failed
```

## 1. The template

```jsonc
{
  "contract_format": "contract/1",
  "feed_type": "product | review | store | content",   // the agent's feed type
  "base_url": "https://host[/prefix]",                    // no placeholders
  "credential": "service | user",                         // service: standing token from Studio; user: signed-in person's token (later)
  "service_header": "X-Api-Key",                          // with service: header carrying the standing token
  "service_value_format": "{token}",                      // with service: header value, {token} exactly once
  // "user_header": "Authorization",                      // with user (later)
  // "user_value_format": "Bearer {token}",               // with user (later)
  "request": {
    "method": "GET | POST",
    "path": "/some/path",                                 // no placeholders
    "query": {},                                          // GET only
    "body": {}                                            // POST only: JSON body, any nesting
    // Values inside query / body (each optional and repeatable unless stated):
    //   "{item_id}"                                 GET only: the id list as ONE comma-separated value. REQUIRED, exactly once.
    //   [ { "k": "{item_id}", "c": "{category}" } ] POST only: one object per row, always a list of objects. REQUIRED, exactly once. A {column} may sit only here.
    //   "{_meta.openai/locale}"                     chat context, sent whole; key dropped when the host has none.
    //   "USD" / true / 3                            literal, copied as written, never validated.
  },
  "response": {                                           // dictated: every API answers in this envelope
    "status": "success | failure",
    "generated_at": "<ISO-8601 timestamp>",
    "data": [{ "<key>": "<flat value>" }],                // one flat object per answered id, the API's own key names
    "errors": [{ "error_id": "<id>", "error_code": "<code>", "error_message": "<text>" }]
  },
  "fields": [                                             // first entry REQUIRED: the feed type's id column (the echo)
    {
      "column_name": "<canonical column>",                // item_id first, then the fields bound to this agent
      "at": "$.data[*].<key>",                            // where the value sits in each data item
      "type": "string | int | float | boolean | image",   // feed schema type; filled from the schema if omitted
      "default_value": ""                                 // used when an item lacks the key; empty = no value
    }
  ],
  "call_rules": {
    "max_ids_per_call": 100,                              // 1..100, the author may lower it
    "timeout_ms": 3000,                                   // dictated
    "retries": 0,                                         // dictated
    "response_must_be_no_store": true                     // dictated
  },
  "sample_request": {}                                    // concrete query (GET) or body (POST) with real ids; sent as-is, once, to verify
}
```

Allowed context keys: `_meta.openai/locale`, `_meta.openai/userLocation`.

## 2. The dictated response

Every realtime API answers with this envelope and nothing else. Items are **flat** (one level of
keys, scalar values). Extra keys are ignored.

```json
{
  "status": "success",
  "generated_at": "2026-09-11T10:00:00Z",
  "data": [
    { "sku": "SKU-1001", "amount": 79.99, "currency": "USD" },
    { "sku": "SKU-2049", "amount": 129.0, "currency": "USD" }
  ],
  "errors": [{ "error_id": "SKU-9999", "error_code": "NOT_FOUND", "error_message": "unknown sku" }]
}
```

- `status: success`: the items in `data` apply. Ids listed in `errors` got no answer and their rows show no live value.
- `status: failure`: the whole call failed. Nothing is applied. `errors` says why.
- The response must carry `Cache-Control: no-store`.
- Every item carries the id it answers for. There is no "one value for all rows" form.

## 3. Sample A: GET, comma-separated ids, bearer token

```json
{
  "contract_format": "contract/1",
  "feed_type": "product",
  "base_url": "https://api.example-brand.example",
  "credential": "service",
  "service_header": "Authorization",
  "service_value_format": "Bearer {token}",
  "request": {
    "method": "GET",
    "path": "/live/prices",
    "query": { "ids": "{item_id}", "locale": "{_meta.openai/locale}", "market": "US" }
  },
  "response": {
    "status": "success",
    "generated_at": "2026-09-11T10:00:00Z",
    "data": [{ "id": "SKU-1001", "price": 79.99, "currency": "USD" }],
    "errors": []
  },
  "fields": [
    { "column_name": "item_id", "at": "$.data[*].id", "type": "string", "default_value": "" },
    { "column_name": "current_price", "at": "$.data[*].price", "type": "float", "default_value": "" }
  ],
  "call_rules": { "max_ids_per_call": 100, "timeout_ms": 3000, "retries": 0, "response_must_be_no_store": true },
  "sample_request": { "ids": "SKU-1001,SKU-2049", "market": "US" }
}
```

Verification call: `GET /live/prices?ids=SKU-1001%2CSKU-2049&market=US` with
`Authorization: Bearer <standing token>`. Checked: HTTP 2xx, `Cache-Control: no-store`,
`status: success`, `$.data[*].id` yields exactly SKU-1001 and SKU-2049, `$.data[*].price` present
and float-coercible for both.

Serve time for SKU-1001, SKU-2049, SKU-3311 with locale en-US:
`GET /live/prices?ids=SKU-1001%2CSKU-2049%2CSKU-3311&locale=en-US&market=US`. Each item is matched
to its row by id; `price` fills `current_price`; `currency` is ignored.

## 4. Sample B: POST, one object per row, raw API key

```json
{
  "contract_format": "contract/1",
  "feed_type": "product",
  "base_url": "https://api.acme-shoes.example",
  "credential": "service",
  "service_header": "X-Api-Key",
  "service_value_format": "{token}",
  "request": {
    "method": "POST",
    "path": "/v2/pricing/batch",
    "body": {
      "items": [{ "sku": "{item_id}", "cat": "{category}" }],
      "context": { "locale": "{_meta.openai/locale}", "location": "{_meta.openai/userLocation}" },
      "currency": "USD",
      "include_promotions": true
    }
  },
  "response": {
    "status": "success",
    "generated_at": "2026-09-11T10:00:00Z",
    "data": [{ "sku": "SKU-1001", "amount": 79.99, "list_price": 89.99, "currency": "USD", "promo": null }],
    "errors": [{ "error_id": "SKU-9999", "error_code": "NOT_FOUND", "error_message": "unknown sku" }]
  },
  "fields": [
    { "column_name": "item_id", "at": "$.data[*].sku", "type": "string", "default_value": "" },
    { "column_name": "current_price", "at": "$.data[*].amount", "type": "float", "default_value": "" },
    { "column_name": "custom_badge_2_value", "at": "$.data[*].list_price", "type": "string", "default_value": "n/a" }
  ],
  "call_rules": { "max_ids_per_call": 50, "timeout_ms": 3000, "retries": 0, "response_must_be_no_store": true },
  "sample_request": {
    "items": [{ "sku": "SKU-1001", "cat": "shoes" }, { "sku": "SKU-3311", "cat": "apparel" }],
    "currency": "USD",
    "include_promotions": true
  }
}
```

Verification: the `sample_request` as the body, `X-Api-Key: <standing token>`. Checked as in
Sample A with `$.data[*].sku` yielding exactly SKU-1001 and SKU-3311 (read from the per-row
objects), `amount` float-coercible, `list_price` present or the default `n/a` applied.

Serve time: one object per row, each filled from that row; context values inserted whole (the
context object is sent empty when the host sends neither); literals copied. If the answer lists
SKU-3311 in `errors`, that row shows no live value and the other two apply. An API that takes only
ids on POST still uses this shape: `"items": [ { "sku": "{item_id}" } ]`.

## 5. Rules the samples rely on

- **`{item_id}` appears exactly once** in every request; every data item echoes the id. GET: the
  query value `"{item_id}"` becomes the batch's ids joined by commas, each URL-encoded. POST: inside
  the one object of a one-element list, `[{"k": "{item_id}", ...}]`, which becomes one object per
  row. A bare `"{item_id}"` or `["{item_id}"]` on POST is refused.
- **`{column}`** (an ingested, non-realtime column) may sit only inside the per-row object next to
  `{item_id}`. POST only. The column must be mapped in the composition the agent belongs to
  (screen 2, Schema Mapping).
- **`{_meta.*}`** is one value per call, inserted whole wherever it sits (also inside per-row
  objects). The key is dropped when the host sends none. Never sent at verification.
- **Literals** are copied exactly, any JSON type, never validated.
- **One batch is one call.** A batch larger than `max_ids_per_call` is split into consecutive calls.
- **credential**: `user` when any bound field is a login-based (user-specific) field, `service`
  otherwise. The format holds `{token}` exactly once; the platform adds nothing. No token ever
  appears in the document.
- **Verification** sends `sample_request` unchanged and reads the sent ids from it by matching the
  request template. It checks HTTP 2xx, `Cache-Control: no-store`, `status: success`, every sent id
  appearing **exactly once** at the id field's path, and every field path resolving to a value of
  its type or falling back to its default.
- **Serve time** walks `data[*]`, matches each item to its row by the id field, reads each field's
  key. Missing key → `default_value` (empty = no value). Id in errors or absent → no value.
  **Duplicate id → the call fails.** `status: failure` → the call fails, nothing applied.
- Stored: the document as submitted; `type` filled from the feed schema when omitted.
- **Not supported:** no id (one value for all rows), nested values inside data items, composite
  keys, map-shaped responses, single-id endpoints, paginated responses (need an adapter).

## 6. Live value vs ingested (DB) value

Realtime is the priority; the DB row is only filled when live data is missing.

| Live API | DB column (ingested) | Result |
|---|---|---|
| has a value | anything (even a real price) | **replace with live** |
| has a value | null / "" | fill with live |
| missing / null | has a value (10, 0, false) | keep ingested |
| missing / null | null / "" | fill with the contract's `default_value` (skip if default is "") |
| call fails | has a value | keep ingested |
| call fails | empty | fill with default |
