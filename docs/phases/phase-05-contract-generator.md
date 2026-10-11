# Phase 5: Jivox agents + contract generator

**Status:** ✅ **Done 2026-10-12** (5.0–5.7). Summary in §18. Next: Phase 6 (public URL + submit / activate per agent)
**Roadmap:** [../ROADMAP.md](../ROADMAP.md) · **Big picture:** [../PLAN-v2-api-first.md](../PLAN-v2-api-first.md)
**Depends on:** Phase 4 (published API, live endpoint, tokens, self-check)
**Spec:** [../jivox/contract-1.md](../jivox/contract-1.md)

---

## 0. Progress tracker

| # | Task | Side | Status |
|---|---|---|---|
| 5.0 | **Discovery (read-only)**: connect to the qa3 data MCP with one agent's access key, list its tools and what it says about the agent (feed type, id column, bound fields, how the token is given); write the findings here | Backend | ✅ |
| 5.1 | Database: `jivox_agents` (many per API; access key encrypted; fields; linked token) | Backend | ✅ |
| 5.2 | Agents backend: add / list / edit / remove; key write-only; **Read from Jivox** (read-only `get_canonical_schema` with the agent's key → feed type, id column, bound fields, types, tiers) | Backend | ✅ |
| 5.3 | Generator: one contract/1 per agent (only its fields), real sample ids, POST per-row values | Backend | ✅ |
| 5.4 | Checker: every contract/1 rule + a verify-like-Jivox call with the agent's token → checklist with reasons | Backend | ✅ |
| 5.5 | Frontend: **Jivox tab** (agents list, add / edit dialog, contract panel: checklist, JSON, copy, download) | Frontend | ✅ |
| 5.6 | Design changes vs agents: warnings on save, "out of date" marks; race + load tests | Both | ✅ |
| 5.7 | End-to-end check (one API, two agents, GET and POST APIs) + docs | Both | ✅ |

---

## 1. Goal (simple words)

In Jivox Studio one brandstore can have **several Real Time Agents**, and the same API can serve
**several agents** (the user does this today: Agent 1 in `mswfeed18` asks for some fields, Agent 1 in
`axas` asks for `sub_title`). Each agent has its own MCP access key, its own selected fields, and
its own contract versions in Jivox.

So on our platform: **one API → many agents → one contract per agent**. The API's design is the
superset (every field the API can answer); each agent's contract lists **only that agent's fields**.
Phase 5 builds the agents and their contracts (copy / download, checked like Jivox would). Phase 6
sends them to Jivox over MCP (submit, versions, activate).

```
                       ┌──► Agent "mswfeed18 · Agent 1"  fields: current_price, is_active  → contract A
API "Price API"  ──────┤
(design: 4 fields,     └──► Agent "axas · Agent 1"       fields: sub_title                 → contract B
 one /v1 URL)               (each: own access key, own token, own versions in Jivox)
```

Both contracts point at the **same URL**; extra keys in our answer are ignored by Jivox (spec §2).

## 2. What an agent holds

| Field | Example | Notes |
|---|---|---|
| name | `axas · Agent 1` | unique within the API (any case), 1–60 chars; free text so it matches Studio |
| brandstore (optional) | `axas-c63e9` | just a label, for the user |
| fields | `["sub_title"]` | Jivox column names; each must be served by the API's design (5.2); at least 1 |
| token | "Jivox agent 2" | one of the API's tokens (optional); the token Jivox will use for this agent (P5-4) |
| MCP URL | `https://brandstore-data-mcp.qa3.jivox.com/mcp` | used in Phase 6; https only (http for localhost) |
| access key | `••••Tc` | AES-256-GCM with `TOKEN_ENCRYPTION_KEY`, **write-only** (never shown again), hint = last 2 chars |
| sample ids | `SKU-1001, SKU-1002` | optional; default = the first 2 rows (P5-8) |

## 3. How each contract is filled (per agent)

| Contract key | Comes from |
|---|---|
| `contract_format` | `"contract/1"` |
| `feed_type` | the API's feed type (must equal the agent's, checked in Phase 6 when Jivox tells us) |
| `base_url` | `PUBLIC_BASE_URL` + `/v1/<brand-slug>` |
| `credential` | `"service"` |
| `service_header` / `service_value_format` | API header style → `X-Api-Key` / `{token}` or `Authorization` / `Bearer {token}` |
| `request` | the API's request template (GET query / POST body), `path` = `/<api-slug>` |
| `response` | a real answer for the sample ids, trimmed to 2 items |
| `fields` | `item_id` first (`at: $.data[*].<id key>`), then **only the agent's fields**, in design order: `{ column_name, at: "$.data[*].<response key>", type, default_value }` (type only when the design puts it in the contract, R5) |
| `call_rules` | `max_ids_per_call` from the design; `timeout_ms: 3000`, `retries: 0`, `response_must_be_no_store: true` |
| `sample_request` | 2 real ids; POST rows carry their real `{column}` values; literals kept; no `_meta` |

No token ever appears in a contract.

## 4. Checklist (per agent, green / red with the reason and a link to fix it)

- the API is **published**; the agent has at least 1 field; **every agent field is served by the design**
- `{item_id}` exactly once; POST: one-object list with the id inside; `{column}` only there; allowed `_meta` keys only
- `max_ids_per_call` 1–100; first field is the id echo; every `at` exists in the real answer
- `service_value_format` holds `{token}` once; `base_url` has no placeholders and is **public https** (red on localhost: Jivox can't reach it)
- the sample ids exist in the data
- the agent has a usable token (active, readable)
- **verify-like-Jivox**: the `sample_request` sent to our live URL with the agent's token → 2xx, `no-store`,
  `success`, every id once at the id key, **every agent field** present with its type or default, < 3 s
- warning (not red): an agent field sends `""` for empty values (R11), see P5-7

## 5. Decisions (proposed, for your review)

| # | Decision | Why |
|---|---|---|
| P5-1 | **Many agents per API** (up to 20), each with its own name, fields, token link, MCP URL, access key | Your setup: one API configured for two agents |
| P5-2 | *(revised after 5.0)* An agent's facts come **from Jivox** (read-only `get_canonical_schema`, moved here from Phase 6): feed type, id column, **bound fields**. The contract's fields = the id + the bound fields the design serves (at least 1, at most all; Jivox refuses others). Without a key yet, the user may pick them by hand from the design | 5.0 showed the read is simple and safe |
| P5-3 | Contracts are **generated, not edited**, per agent, on demand. To change one: change the design or the agent's fields | One source of truth |
| P5-4 | *(revised after 5.0)* Jivox reads the agent's token from **Studio** ("standing token … read from the parameter store"; `service_token_registered: true`); MCP can't set it. So: one token per agent (recommended), the agent panel says "paste this token in Studio for this agent", and the verify-like-Jivox check uses that same token. We can't read which token Studio holds, but **Recent calls** shows the token name Jivox's verification call used | Isolation, clear logs |
| P5-5 | The access key is stored **now** (encrypted, write-only), used in Phase 6 | Same screen as Studio's "access keys" |
| P5-6 | *(built in 5.6)* A design change that takes away a field an agent uses (removed, or its Jivox field changed): the save **asks first** ("Jivox agents lose fields", who loses what, 0 left = no contract) and goes ahead on **Save anyway** (never blocked; changes are live at once, as decided in Phase 2). Every save reports which agents' contracts changed. **Out of date** = the agent's contract today differs from the one last **copied / downloaded** (Phase 6: submitted), with the reasons; new data / other sample ids don't count | Don't block edits; never surprise |
| P5-7 | *(user decision 2026-10-12)* **Both options stay, chosen per field** ("When a value is empty": send `""` / leave the key out). The checklist only shows each agent field's choice as a note. One hard rule from 5.0: Jivox's verification needs every field "of its type or its default", so if a **sample id** would send `""` in a number / boolean / image field, the check is **red** ("pick other sample ids or leave the key out") | User: "give both options, user will select" |
| P5-8 | Sample ids per agent (default: first 2 rows); must exist in the data | Verification sends them for real |
| P5-9 | **Discovery first (5.0)**: before building, connect read-only to the qa3 MCP with one agent key and list its tools / agent info. No submit, no activate | The new Studio screen has no field for our token: we must learn how Jivox gets it |
| P5-10 | Access keys never in logs, responses, docs or memory; the one shared in chat is entered in the app only | Same rules as tokens |
| P5-11 | *(from 5.0)* The generator follows the server's own rules: id placeholder `{<agent's id column>}`; **mandatory-tier fields never in `fields`**; a field bound to **any** realtime agent is never a `{column}` input; `credential` must equal the agent's registered one (`service`); `type` from the design when it equals Jivox's, else red | The server would refuse it otherwise |
| P5-12 | *(revised with the user)* **Tiers depend on the brandstore:** optional fields become *expected* when their UI component is on (e.g. Price, Description toggles in "Configure UI Module"); **mandatory never changes**. So tiers are read **live per agent** from Jivox; the saved CSV is only a fallback (its 3 mandatory product fields corrected in 5.1: item_id, product_image, product_name). The one tier rule for contracts: mandatory fields never in `fields` | User, 2026-10-12 |
| P5-15 | **Groups** (`schema_key`): binding a group binds all its fields. Proposed (A): the contract includes the group's fields the design serves (≥ 1, Jivox allows a subset) with a note "currency keeps the feed's value"; (B) would block until all are served. **Awaiting the user** | Spec: "at least one, at most all" |
| P5-16 | The mapping is the Phase 3 design, unchanged: **Jivox field → our feed column → response key**; per agent: bound field → design field → `{ column_name: <Jivox field>, at: "$.data[*].<response key>", type, default_value }`. Example: feed header `sub` → key `subkey` → `sub_title` gives `"at": "$.data[*].subkey"`. A bound field missing from the design: **no extra button** (user, 2026-10-12: "we already did this in Phase 3"); the check is red with a link to the **Design tab**, the only place where mapping is done | User's explanation 2026-10-12 |
| P5-17 | Contract `type` = Jivox's type for that field; if the design sends another type, the check is red ("set current_price to float on the Design tab"). Proposed, awaiting the user | Verification checks Jivox's type |
| P5-13 | *(from 5.0)* MCP client = plain JSON-RPC over HTTPS (Streamable HTTP, **stateless**, answers as SSE), `Authorization: Bearer <access key>`, 20 s timeout; the official SDK is optional | Simple, tested in 5.0 |
| P5-14 | *(from 5.0)* Only read-only tools in Phase 5 (`get_canonical_schema`, `get_contract_spec`, `list_contracts`); `submit_contract` / `activate_contract` stay in Phase 6 | No state changes in Jivox before Phase 6 |

## 6. Endpoints (app, logged in, owner only)

| Method | Path | Result |
|---|---|---|
| GET / POST | `/apis/:apiSlug/agents` | list · add `{ name, brandstore?, fields[], tokenId?, mcpUrl?, accessKey?, sampleIds? }` |
| PATCH / DELETE | `/apis/:apiSlug/agents/:agentId` | edit (accessKey: send to replace, omit to keep) · remove |
| GET | `/apis/:apiSlug/agents/:agentId/contract` | `{ document, checks[], outOfDate }` (runs the checks, incl. the live call) |
| GET | `/apis/:apiSlug/agents/:agentId/contract/download` | `contract-<api>-<agent>.json` |
| POST | `/apis/:apiSlug/agents/:agentId/contract/check` | the checklist (5.4) + `contract` state (5.6) |
| POST | `/apis/:apiSlug/agents/:agentId/contract/taken` | 5.6: `{ how: copy \| download, designVersion, document }` → remembers its shape → `{ agent }` |
| PUT | `/apis/:apiSlug/design` (Phase 3) | 5.6: + `confirmDroppedFields[]`; 409 `AGENT_FIELDS_DROPPED` (`error.extra.agents`); answer + `agents`, `agentImpact { dropped, changed }` |

Concurrency: like tokens, every agent change locks the API row first (`FOR UPDATE`), so "20 agents",
"name taken" and "field served by the design" are checked against the latest state; a design save
takes the same lock, so a field can't vanish between the check and the write.

## 7. Frontend: Jivox tab (mockup shown in chat 2026-10-12)

Agents table (name + key hint + MCP host · field chips · token · Jivox status) → **Add agent** dialog
(name, brandstore, fields as checkboxes from the design, token picker or "create one", MCP URL,
access key) → click a row: contract panel (checklist left, JSON right, Copy, Download; Submit comes
in Phase 6). Phone: rows → cards, dialog → bottom sheet. Design tab: warning banner listing the
agents a change affects.

## 8. Open questions (for Jivox / you)

1. ~~How does Jivox get our API token?~~ **Answered (5.0 + user, 2026-10-12):** the user pastes our `rtk_…` token in Studio → Real-time data → **ACCESS KEYS** (pink key) → "Agent access token" → Save token. Never over MCP.
2. ~~Feed type and bound fields over MCP?~~ **Yes** (`get_canonical_schema`, `get_contract_spec.your_agent`).
3. What does Studio's **Waiting** status mean: waiting for a verified contract, or for an active one?
4. P5-7: does a live `""` replace an ingested value? (Spec §6 lists `null / ""` only on the DB side.)
5. ~~Review feed's id?~~ Each agent's `id_column` comes from Jivox (5.0), so we use whatever it says.
6. ~~`schema_key` groups?~~ **Answered (user):** Studio's "Select fields" shows a group as ONE checkbox (`current_price (currency, current_price)`), so selecting it binds **both**; their values must come from our real-time answer. Open: when the design serves only part of a group, contract with the part (A) or block (B)? (P5-15)
7. ~~"Add to design" button?~~ **No** (user): the Design tab is the only place to map fields; the agent's check links there. (P5-16)
8. Design type ≠ Jivox type: contract always uses **Jivox's type**, check red until the Design type is fixed? (P5-17)

## 9. How to verify ✅ (5.7, `phase-05-task-5.7-end-to-end.sh`)

- [x] One API with two agents → two contracts, each with only its fields, both pointing at the same URL (GET API and POST API, two agents each, each with its own access key and token)
- [x] An agent field the design doesn't serve → left out of the contract, **⚠** with a link to the Design tab while at least one of its fields is served (Jivox keeps the feed's value, P5-15 A); **✗** when none is
- [x] A GET API like Sample A and a POST API like Sample B match the samples' structure: same keys in the same order, same header / value format / request template; `fields` and `call_rules` **identical** to Jivox's; sample_request shaped like theirs (real ids / categories, chat context dropped)
- [x] Every rule in §4 turns red when broken on purpose: the request-template rules ({item_id} once, one-object list, {column} placement, `_meta` keys, max ids 1–100) are refused at design save, so they never reach a contract; the others turn ✗ in the checklist (here: published, no token, unknown sample id, `""` in a float, field not bound; one by one in 5.4). The verify-like-Jivox call uses the agent's token (renew one agent's token → it moves, passes with the new one, the old one gets 401)
- [x] Design change that drops an agent's field → asked on save, agent "out of date" (5.6)
- [x] No token or access key in any contract, response (other than the token-create / renew answers that show it on purpose), download, stored row or the backend log

## 10. Task 5.0: MCP discovery ✅ (2026-10-12, qa3, read-only, approved by the user)

**What ran:** `docs/test-scripts/phase-05-task-5.0-mcp-discovery.mjs` against
`https://brandstore-data-mcp.qa3.jivox.com/mcp` with the access key of the agent that serves `sub_title` (the
`axas` brandstore). Calls: `initialize`, `tools/list`, `resources/list`, `resources/templates/list`,
`prompts/list`, and the read-only tools `get_contract_spec`, `get_canonical_schema`, `list_contracts`.
**Not called:** `submit_contract`, `activate_contract` (the script refuses them). Nothing changed in Jivox.
Snapshot of the answers (no key inside, checked): `docs/jivox/mcp-snapshot-2026-10-12/`.

| Finding | Detail | Changes |
|---|---|---|
| Server | "Brandstore MCP Server" 1.29.1, protocol `2025-06-18`, Streamable HTTP, **stateless** (no session id), answers as SSE | P5-13 |
| Auth | `Authorization: Bearer <access key>`; without it: 401 "Missing or malformed Authorization header" | P5-13 |
| Tools | `get_contract_spec`, `get_canonical_schema`, `list_contracts` (read) · `submit_contract({contract})`, `activate_contract({version, test_user_token?})` (write). No resources, no prompts | P5-14, Phase 6 |
| This agent | `feed_type: product`, `id_column: item_id`, `bound_fields: ["sub_title"]`, `credential: service`, `service_token_registered: true`; `list_contracts`: none yet | P5-2 |
| Token | "the standing token is read from the parameter store": registered in **Studio**, never over MCP | P5-4 |
| `fields` rule | id first, then **only this agent's bound fields, at least one, at most all**; fields bound to another agent, unbound and **mandatory-tier** fields are refused | P5-2, P5-11 |
| Inputs | a field bound to **any** realtime agent is never a `{column}` input; other columns may be, if the composition maps them | P5-11 |
| Verification | sends `sample_request` as is; 2xx, no-store, success, each id once, every field "of its type or its default"; service contracts verify with the standing token | P5-7 |
| Schema | the same 43 product fields as our CSV; **all 43 types equal our Phase 3 guesses**; **5 tiers differ** (see P5-12); each field also has `is_id`, `is_unique`, `schema_key` (groups) | P5-12, open question 6 |
| `activate_contract` | re-runs gates + verification; on a published composition refuses a version whose `{column}` inputs aren't mapped ("that needs a new realtime agent") | Phase 6 |

## 11. Task 5.1: Agents database ✅ (2026-10-12)

| Part | What | Where |
|---|---|---|
| Table | `jivox_agents`: name, brandstore, `fields` (Jivox column names), `token_id`, `mcp_url`, `access_key_encrypted` + `access_key_hint`, `sample_ids`, `agent_info` + `agent_info_at`, `last_error`; deleted with its API; index `(api_id, created_at)` | `schema.prisma`, migration `20261012030000_jivox_agents` |
| Token link | composite foreign key `(token_id, api_id) → api_tokens(id, api_id)`: **only a token of the same API**; `api_tokens` got `UNIQUE (id, api_id)`. NoAction: tokens are never deleted on their own (revoked ones stay), only with their API, which deletes its agents in the same statement | migration |
| DB rules | unique name per API (any case, trimmed: expression index); name 1–60; brandstore 1–100; `fields` snake_case, ≤ 100, no NULLs; `sample_ids` ≤ 10; MCP URL `http(s)://…` ≤ 500; key and hint always together, key stored as `v1.…` only; agent info and its time together; last error ≤ 1000 | migration (hand-written part) |
| Secrets | `lib/secret-box.ts`: `sealSecret` / `openSecret` (AES-256-GCM, `TOKEN_ENCRYPTION_KEY`, bound to the row). API tokens now use it too (**same stored format**: existing tokens still open). Access keys will be bound to `jivox-agent:<agent id>` | `lib/secret-box.ts`, `lib/api-token.ts` |
| Tiers | product CSV corrected from Jivox's live schema (5.0): mandatory = `item_id`, `product_image`, `product_name`; `purchase_link_1_*` expected; `currency`, `current_price`, `description` optional (they turn *expected* per brandstore when their UI component is on; read live per agent later) | `backend/jivox-schemas/` + `docs/jivox/feed-schemas/` |

**Tests:** `docs/test-scripts/phase-05-task-5.1-agents-db.test.mts`: **37 checks**, 3 runs green: secret box (round
trip, other row → null, tampering → null, other key → null, tokens still open), tiers, every DB rule refusing and
accepting, token of another API refused, unknown token / API refused, moving an agent away from its token's API refused,
revoking keeps the link, deleting a linked token alone refused, deleting the API removes agents + tokens, list index
used, **same-name race** (2 connections: the second waits, then is refused), nothing left behind.
Re-run after the change: 4.1 39 · 4.2 64 · 4.5 41 · 4.9 52 · 3.1 45 · 3.2 69 (one check updated: with the corrected
tiers, `purchase_link_1_purchase_link` is no longer "mandatory", so the design no longer warns about it).
No drift: `prisma migrate diff` (DB → schema) is empty.

| Found while doing it | Fix |
|---|---|
| `prisma migrate dev` stops to ask about the new `UNIQUE (id, api_id)` (non-interactive session) | migration SQL generated with `prisma migrate diff --from-config-datasource --to-schema …`, then `prisma migrate deploy` (same result; safe: `id` is already unique) |

## 12. Task 5.2: Agents backend + Read from Jivox ✅ (2026-10-12)

| Method | Path (`/api/organizations/:slug/apis/:apiSlug/…`) | Result |
|---|---|---|
| GET / POST | `agents` | list `{ agents, limits: { maxAgents: 20 } }` · add `{ name, brandstore?, fields?, tokenId?, mcpUrl?, accessKey?, sampleIds? }` → 201 |
| GET / PATCH / DELETE | `agents/:agentId` | one · edit (only what's sent; `accessKey`: new value replaces, `null` removes) · 204 |
| POST | `agents/:agentId/read-jivox` | `{ agent, fieldsBefore, feedTypeMatches }`: Jivox's feed type, id column, bound fields, credential, token registered, **live schema** (type, tier, group per field), contracts (active version, versions) |

| Rule | How |
|---|---|
| Access key **write-only** | answers only `accessKey: { hint (last 2), readable }`; stored `v1.…` bound to `jivox-agent:<id>`; never logged |
| Fields | Jivox column names of the API's feed type; never the id, never mandatory (Jivox refuses both); de-duplicated |
| Token | a token of THIS API, not revoked (expired allowed); DB composite key as the last word |
| MCP URL | `https://` only (http just for localhost); no `user:password@` |
| Limits | 20 agents per API; name unique (any case / spaces) |
| Locking | every change locks the API row (same lock as tokens / design / publish) |
| Read from Jivox | calls `initialize`, then ONLY `get_canonical_schema`, `get_contract_spec`, `list_contracts` (the client refuses anything else); 20 s timeout per call; ≤ 2 MB answers; never follows redirects; SSE or JSON; key scrubbed from messages. Jivox's bound fields **become** the agent's fields when the feed types match (without mandatory / unknown / id); a new MCP URL or key clears what Jivox told us |
| Read without the lock | the 3 calls run unlocked (~3 s on qa3), then lock + save only if the agent's URL and key are unchanged, else 409 `AGENT_CHANGED` (the user's edit wins) |
| Errors | wrong key → **422** `JIVOX_AUTH_FAILED` (not 401, so the app doesn't think the session ended) · 502 `JIVOX_UNREACHABLE` (with the reason: ECONNREFUSED, bad port, timeout…) · 502 `JIVOX_BAD_ANSWER` · 409 `AGENT_NOT_CONNECTED` / `ACCESS_KEY_UNREADABLE`; failures are also kept in `lastError` |

**Tests:** `docs/test-scripts/phase-05-task-5.2-agents.sh` (+ `phase-05-fake-jivox-mcp.mjs`, a fake Jivox MCP server
built from the 5.0 snapshot): **57 checks** with `LOG_FILE`, 3 runs green. Add / list / get; every refusal; edit;
Read from Jivox (SSE and JSON, group bound, mandatory / unknown filtered, other feed type, wrong key, unreachable,
garbage, tool error, 3 MB answer, redirect); the fake server's log proves only read-only tools were called, each with
exactly `Bearer <key>`; races: key replaced during a 3 s read → 409 `AGENT_CHANGED`; same name twice at once → one
201 + one 409; 25 adds at once → exactly 20; delete; API delete removes agents; no access key in answers, DB text
or log. **Real qa3 read** (one agent, read-only): 200 in 3.3 s, `product` / `item_id` / bound `["sub_title"]` / service /
token registered / 43 fields / mandatory = item_id, product_image, product_name / no contracts; fields auto-filled
`["sub_title"]`; test account deleted. Regression: 5.1 37 · 2.5 87 · 4.2 64 · 4.4 37 · 4.9 52.

| Found while doing it | Fix |
|---|---|
| Every fake-server read failed "fetch failed": port **4190** is on fetch's blocked-ports list | fake server on 4791; our error now says the real reason ("bad port", ECONNREFUSED…) instead of "fetch failed" |
| An invalid-JSON request logged the parser error, whose message / object can quote the body (a password, a pasted key) | `INVALID_JSON` no longer attaches the parser error (same 400 for the caller) |

## 13. Task 5.3: Contract generator ✅ (2026-10-12)

| Endpoint | Result |
|---|---|
| `GET …/agents/:agentId/contract` | `{ agent, document, notes, sample: { ids, request, response }, apiStatus, designVersion }` · 409 NO_DESIGN / NO_DATA / DESIGN_INVALID |
| `GET …/agents/:agentId/contract/download` | the document alone: `contract-<api>-<agent>.json` (attachment, no-store) |

**How a document is made** (`modules/apis/agents/contract.ts`; `buildContract` is pure): the API's design is the
mapping (Jivox field → our feed column → response key). For an agent: id first (`at: $.data[*].<id key>`), then
**only its fields, in the design's order**, each `{ column_name, at: "$.data[*].<our response key>", type, default_value }`.
`type` = Jivox's type (its live schema after "Read from Jivox", else ours; omitted for R5 "not in contract" fields);
`default_value` = the design's default. `base_url` = `PUBLIC_BASE_URL/v1/<brand>`, `path` = `/<api>`, header from the
API's style, `request` = the saved template as is, `call_rules.max_ids_per_call` from the design, the rest dictated.
`sample_request` / `response`: the agent's sample ids (or the first 2 rows), built and answered by the same code as
Try it / the self-check / `/v1`; `response` keeps whole items (≤ 2), like Jivox's samples. No token, ever.

**Notes** (for the checklist in 5.4): blocker `NO_FIELDS`, `FEED_TYPE_DIFFERS`, `SAMPLE_FAILED`; warning
`FIELD_NOT_IN_DESIGN` (left out, Jivox keeps the feed's value: decision A), `TYPE_DIFFERS`, `SAMPLE_IDS_UNKNOWN`;
info `FIELDS_NOT_FROM_JIVOX` (picked by hand).

**Tests:** `phase-05-task-5.3-contract-lib.test.ts` **24 checks**: fed the designs behind **Jivox's own Sample A
(GET + Bearer) and Sample B (POST + X-Api-Key, `{category}` input, context, literals, default `n/a`, max 50)**, the
generator produces **Jivox's documents exactly** (only `base_url` + `path` are ours); the user's `sub` → `subkey` →
`sub_title` example; two agents on one API; every note; live types win; R5; key order; file names.
`phase-05-task-5.3-contract.sh` **30 checks**, 3 runs green: over HTTP with real data and the fake MCP server; and the
contract's own `sample_request`, sent to the live `/v1` with the token in the contract's header, gets 2xx + no-store
+ success, every sample id exactly once at the id path, and every field's `at` present (GET and POST + Bearer).
Regression: 3.5 41 · 3.8 33 · 4.3 56 · 4.5 41 · 4.9 52 · 5.2 56.

| Found while doing it | Fix |
|---|---|
| Our sample request kept `"context": {}` when every value of that object was chat context; Jivox's Sample B drops the object entirely (and verification sends `sample_request` as is) | `dropContext` removes objects / lists emptied by context (one empty in the template stays). Also changes Try it, the self-check and the Design preview's sample; 3.5's check updated |
| Jivox's samples show whole items in `response` (extra keys too); I first trimmed them to the mapped keys | keep whole items (≤ 2) |
| File name of "Ünïcode Agent" came out `u-ni-code` | accents removed before slugging |
| A POST `{column}` input the design doesn't map is sent as `""` in `sample_request` (Phase 3/4 rule: values come from the design's mapped column) | unchanged; 5.4's checklist will flag it |

## 14. Task 5.4: Contract checklist ✅ (2026-10-12)

`POST …/agents/:agentId/contract/check` (POST: it makes a live call) → `{ agent, ready, checks: [{ id, group, label,
status: pass | fail | warn | skip, detail, fix?: { place, text } }], document, sample: { ids, request, response, live } }`.
**Ready = no ✗** (⚠ allowed). `fix.place` ∈ design · agent · studio · publish · tokens · settings · data (the screen links there).

| Group | Checks (id) |
|---|---|
| Jivox agent | `jivox_read` (⚠ when fields were picked by hand) · `feed_type` (+ id column) · `fields` (✗ none; ⚠ bound field the design lacks: Jivox keeps the feed's value) · `bound` (✗ a field Jivox didn't bind to this agent) · `types` (✗ design type ≠ Jivox's, P5-17) · `inputs` (POST `{column}`: ✗ a field ANY agent of this API answers; ⚠ not mapped in the design, so the sample sends `""`) |
| Contract | `format` (id first, `at` paths, `{token}` once, max 1–100, no placeholders) · `base_url` (https and not this machine) · `sample_ids` (answered, our answer not a failure) |
| Token | `token` (linked, active, readable; ✗ none / revoked / expired; ⚠ unreadable) · `token_in_studio` (Jivox's `service_token_registered`) |
| Live (like verification) | `published` · the contract's own sample sent to our live URL with **the agent's token** (self-check header: not counted, not in Recent calls): `status_2xx` · `no_store` · `success` · `ids_once` (at the contract's id path) · `fields_typed` (each contract field of Jivox's type; `""` in a float → ✗) · `no_value` ⚠ (key left out, no default) · `fast` · `needs_token` (401 without it). Skipped when not published or the token isn't active + readable |

**Tests:** `phase-05-task-5.4-checklist.sh` **29 checks**, 3 runs green (own fake MCP on `FAKE_PORT` 4793): a correct
agent → all ✓ except `base_url` (localhost here), no warnings, 4 groups, the live call uses the agent's token and isn't
in Recent calls; then ONE thing broken at a time → exactly the expected ✗ / ⚠ with its fix place: draft, no / revoked /
expired token, token not registered in Studio, fields by hand, unbound field, design lacks a bound field, type, other
feed type, `""` in a float (and ✓ + ⚠ with "leave the key out"), `"n/a"`, unknown sample id, POST inputs mapped /
unmapped / answered by an agent; who can. `phase-05-task-5.4-checklist-lib.test.ts` **4 checks**: the base-URL rule
(public https ✓; localhost, 127.0.0.1, [::1], 0.0.0.0, *.localhost, plain http ✗). Regression: 5.3-lib 24 · 5.3 30 ·
5.2 56 · 4.5 41 · 4.9 52.

| Found while doing it | Fix |
|---|---|
| With an **expired** (but readable) token the live call still ran → a cascade of ✗ that hid the one real cause | the live call runs only with an active, readable token |

## 15. Task 5.5: Jivox tab ✅ (2026-10-12)

Updated mockup shown in chat before building (agents table, open agent panel, add dialog).

| Part | What | Where |
|---|---|---|
| Tab | `/brands/:slug/apis/:apiSlug/jivox` (the "Contract · soon" tab became **Jivox**) | `App.tsx`, `ApiPage.tsx` |
| List | Real Time Agents · N of 20 · Add agent; table ≥ 672 px (@2xl): Agent (name, brandstore · key hint · read time) · Fields (chips, +n) · Token · Contract (Ready / N to fix / Not checked); phone: cards. Empty state says where agents come from in Studio | `jivox/JivoxTab.tsx` |
| Add / Edit dialog | name, brandstore, MCP destination, access key (**write-only**: empty box keeps the saved one, "Remove"), token (this API's, not revoked; "make one on the Test tab"), fields (from Jivox: read-only; otherwise checkboxes of the design's non-mandatory fields), sample ids. Same rules as the server (validated before sending); an edit sends **only what changed**; "Save and read from Jivox" when the URL / key is new | `jivox/AgentDialog.tsx`, `lib/agents.ts` |
| Agent panel | Jivox facts (feed, id, bound fields, token in Studio, contracts, read time) + Read from Jivox / Edit / Remove; Jivox's error kept as a banner; **Token for Studio** (Copy token + the Studio steps); **Checklist** in 4 groups with ✓ ✗ ⚠ and a fix link (Design / Test / Overview tabs, or Edit) + Run again; **Contract** JSON + Copy + Download + "generated from design vN" | `jivox/AgentPanel.tsx` |
| Fresh results | opening an agent runs its checks; when the API changes under them (design version, published, header style, new data) every result is dropped and the open one re-runs; only the latest answer per agent counts | `JivoxTab.tsx` |
| Renew follows | **backend**: renewing a token moves the agents linked to it to the new token (same transaction); the renew dialog says how many must get the new one pasted in Studio | `tokens.service.ts`, `TokenDialogs.tsx` |

**Tests:** `phase-05-task-5.5-agents-lib.test.ts` **20 checks** (form, validation, minimal PATCH, write-only key,
read-after-save, sample ids, groups, summary, fix links, pickable fields). `phase-05-task-5.5-edit-scenarios.sh`
**31 checks**: two agents on one API, after EACH change both contracts + checklists + live calls re-checked: GET →
POST → GET, response key renamed, header style → Bearer, type changed, max ids, a field removed (and all), data
replaced (+ sample id gone → ✗, new ids → ✓), **API renamed** (path follows), unpublish / publish, **token renewed
(agent follows)** / revoked / new one linked, agent edits (new URL clears facts, read again, key removed, fields by
hand, one sample id), download = document, no token text.
**Browser** (1024 px light, 375 px dark, keyboard): empty state; add dialog validation (name, http URL); add with
key → saved + read + fields `sub_title` + checks (only base_url ✗) + JSON; Copy token (toast) / Copy contract /
Download (`contract-price-api-axas-real-time-agent-1.json` = what's shown); second agent by hand (SKU-1004 `""` →
✗); Unpublish from the header → open agent re-checked by itself (published ✗, live skipped), the other "Not checked";
design GET → POST → contract POST with real categories, context dropped, live ✓; wrong key → toast + banner; right
key back; renew → agent on the new token; remove (confirm, focus to Add agent); keyboard Edit → Escape → focus back
on Edit; phone: no side scroll, dialog fits. Regression: 4.2 64 · 5.2 56 · 5.3 30 · 5.4 29 · 4.9 52; lint clean.

| Found while doing it | Fix |
|---|---|
| Renewing a token left its agents on the revoked one (their checks failed) | renew moves them to the new token |
| Card layout: the status chip took column 1 and pushed the name right | explicit grid columns |
| At 1024 px (card ~700 px) the phone cards showed though the table fits | table from 672 px (@2xl) |
| After Edit / Escape, focus fell to the page (dialog opened by state) | focus returns to whatever opened it |
| Phone: the facts line squeezed next to the 3 buttons (one word per line) | facts above, buttons below under 576 px |


## 16. Task 5.6: Design changes vs agents ✅ (2026-10-12)

Plan + mockup shown in chat before building (the "lose fields" dialog, the toast, the Out of date chip / banner).

| Part | What | Where |
|---|---|---|
| Save guard | Under the design save's API lock: agents' fields the OLD design served and the NEW one doesn't → 409 `AGENT_FIELDS_DROPPED`, `error.extra.agents = [{ id, name, fields, left }]`. The save goes ahead when `confirmDroppedFields` covers **exactly** those (agent, field) pairs; an agent added / changed in between is asked about again. Checked after DESIGN_CHANGED and DESIGN_INVALID. A field already missing before isn't asked again | `design/design.service.ts`, `agents/design-impact.ts`, `design.schemas.ts` |
| Save report | Every save answers `agents` (who uses which field) and `agentImpact { dropped, changed: [{ id, name, changes }] }` + a warning "This save changed the contract of N Jivox agents (…)" | same |
| Contract shape | The document without `response` / `sample_request` (those change with every upload). Built WITHOUT data (`shapeFor`), compared as canonical JSON (keys sorted: JSONB reorders), changes listed in words: field removed / added, key, type (incl. "left to Jivox"), default, order, id key, address (API slug / base URL), token header, request method / template, max ids, unknown keys; at most 20 lines | `agents/contract-shape.ts`, `agents/contract.ts` (`shapeContextOf`, `shapeFor`, `contractState`) |
| Out of date | Copy / Download → `POST …/contract/taken` with the exact document (Download now fetches the file and saves it from the page, so the remembered text = the saved file). Stored: `last_contract_at / _how / _design_version / _shape` (all-or-none CHECK, `how` in copy / download / submit, ≤ 64 KB). Every agent answer carries `contract: { last, outOfDate, changes }` | migration `20261012120000_agent_last_contract`, `agents.service.ts`, `agents.controller.ts`, `agents.schemas.ts` |
| Errors | `AppError` takes `extra` (sent as `error.extra`); the frontend `ApiError.extra` | `lib/app-error.ts`, `middleware/error-handler.ts`, `frontend/src/lib/api.ts` |
| Design tab | "Used by axas · Agent 1" under each field an agent uses (phone cards: "N Jivox agents"); the **Jivox agents lose fields** dialog (scrolls for 20 agents; focus back to Save); after a save that changed contracts: a toast with **Open Jivox tab** | `DesignTab.tsx`, `ResponseFields.tsx` |
| Jivox tab | amber **Out of date** chip (table: next to the status; phone: on the fields line) with the reasons on hover; panel banner "The contract changed since it was copied 5 min ago (design v5): • …"; up to date: "Same as the one copied …"; never: "Not copied or downloaded yet …". The list reloads when the API changes | `JivoxTab.tsx`, `AgentPanel.tsx`, `lib/agents.ts` |

**Tests:** `phase-05-task-5.6-shape-lib.test.ts` **33** (shape, canonical JSON / hash, every change wording, contractState,
dropped / confirmations / changed). `phase-05-task-5.6-design-vs-agents.sh` **62**: guard (both agents listed with
fields left, partial / wrong / duplicate confirmations asked again, exact confirmation saves, second save not asked again,
re-adding, a row's Jivox field changed = dropped, key / type / default changes not asked, DESIGN_CHANGED and DESIGN_INVALID
come first, bad confirmation shape, an agent added before "Save anyway" → asked again, another API never asked); out of
date (copy / download remembered with the design version, only the shape stored and no token / key text, new data +
other sample ids → still up to date, key renamed → both out of date with the reason, same state in contract + check,
copy again, design back → up to date again, header style, API renamed and back, agent fields edited, Read from Jivox,
GET → POST, download); validation + DB (how, document, format, fields, version, 64 KB, big sample answer OK, 404s,
401, another account, DB refuses half-filled / unknown how); races (10 confirmed saves at once → 1 saved 9
DESIGN_CHANGED; 12 × save ∥ new agent with the dropped field → always saved-before or asked, never saved past it; 8
copies ∥ a design change → consistent); load (20 agents × 40 fields: list 16 ms, 409 naming 20 in 74 ms, confirmed
save 103 ms; 5 lakh rows: list 23 ms, one full check 26 ms). The 5.3 / 5.4 / 5.5 scripts now confirm drops (`confirm_drops`).
**Browser** (laptop light, phone dark, keyboard): field marks; Copy → "Same as the one copied just now"; remove
sub_title → dialog (axas: no fields left; msw keeps 1) → Save anyway → toast → Open Jivox tab → axas Out of date +
banner "sub_title removed", msw (never copied) no chip; Download → right file, banner gone ("Same as the one downloaded
just now (design v2)"); an agent added from outside while the dialog was open → Save anyway asked again listing it;
Escape → focus back on Save; phone dark: chips on the fields line, banner readable, no side scroll.
Regression: 3.2 69 · 3.4 51 · 3.6 24 · 3.8 33 · 4.2 64 · 4.9 52 · 5.2 56 · 5.3 30 · 5.4 29 · 5.5 31 · libs 20 / 21 / 24 / 4; types + lint clean.

| Found while doing it | Fix |
|---|---|
| The DB CHECK let a half-filled row in (`jsonb_typeof(NULL) = 'object'` is NULL, and a NULL CHECK passes) | every column tested `IS NOT NULL` first |
| A GET download link can be triggered from another site (cookies are SameSite=lax) → can't safely record "downloaded" | Download fetches the file and saves it from the page, then POSTs what it saved |
| With 20 agents the dialog pushed its buttons off the screen; the title was cut on short screens | the list scrolls (max 40 % of the screen), the dialog scrolls too |
| After the dialog closed (Cancel / Escape) focus fell to the page | back to the visible Save button (same for "Leave without saving?") |
| Phone: two chips squeezed the agent name to "mswfeed18 ·…" | Out of date moves to the fields line on phones |
| The 5.3 / 5.4 / 5.5 scripts remove agents' fields on purpose → now 409 | their save helper confirms (they mean it) |

## 17. Task 5.7: End to end ✅ (2026-10-12)

**Script:** `docs/test-scripts/phase-05-task-5.7-end-to-end.sh`: **43 checks** with `LOG_FILE` (42 without), green on
3 runs. Two fake Jivox MCP servers = two Studio agents with their OWN access keys.

| # | Step | What it proves |
|---|---|---|
| 0 | Brand, data, **Live prices** (GET like Sample A: ids, chat locale, `market=US`, Bearer) and **Pricing batch** (POST like Sample B: `items[{sku, cat}]`, chat context, literals, X-Api-Key, max 50), 4 tokens, both published | the setup Jivox's samples describe |
| 1 | Two agents per API, Read from Jivox | fields = what Studio bound (each MCP called with its own key); one contract per agent with ONLY its fields; both agents of an API → the same `/v1` URL |
| 2 | Compare with Jivox's samples | same keys / order / header / template; `fields` + `call_rules` identical (incl. `default_value: "n/a"`); sample_request: real ids, real categories, context dropped |
| 3 | Checklist + live call | only base_url ✗ (localhost); live ✓ for all 4 (2xx, no-store, success, ids once, typed, < 3 s, 401 without token); `{category}` filled from data; each check names its own token; **renew** one agent's token → it moves, passes, old one 401; download = document |
| 4 | Field not served | ⚠ + Design link (some served) / ✗ (none) |
| 5 | §4 rules broken | template rules refused at save (5 cases), nothing changed; unpublished → published ✗, other API unaffected; no token; unknown sample id; `""` in a float; field not bound → bound ✗; Read from Jivox restores |
| 6 | Design change (5.6) | asked first naming only the agent using the field; then out of date "sub_title removed" |
| 7 | Secrets | none in 54 answers, the stored rows / shapes, or the backend log lines of the run |

**Browser:** the POST API's agent opened on the kept account (`KEEP=1`): only base_url ✗, contract = Sample B's shape
(`item_id@sku`, `current_price@amount`, `custom_badge_2_value@list_price`, sample with real categories); account deleted.
Regression (5.6 run): 3.2 69 · 3.4 51 · 3.6 24 · 3.8 33 · 4.2 64 · 4.9 52 · 5.2 56 · 5.3 30 · 5.4 29 · 5.5 31 · 5.6 62 · libs all green.

## 18. Phase 5 summary

**What exists now:** one API serves **many Jivox Real Time Agents** (≤ 20). Each agent: name, brandstore label, MCP
destination + access key (encrypted, write-only), linked token, fields (read from Jivox or picked), sample ids. **Read
from Jivox** (read-only MCP) brings feed type, id column, bound fields, live tiers / types, contracts. Each agent gets
its own **contract/1** (generated, never edited: id + only its fields, mapped through the Phase 3 design; reproduces
Jivox's Sample A / B exactly), a **checklist** in 4 groups with fix links and a verification-like live call with its
own token, **Copy / Download**, and an **Out of date** mark against the contract last taken. Design saves that take
fields away from agents ask first. Renewing a token moves its agents.

**Decisions:** P5-1…P5-17 (§5). **Open with Jivox (§8):** what Studio's "Waiting" means; whether a live `""` replaces an
ingested value. **Before Phase 6:** a public https base URL (tunnel or deploy) — the only ✗ left on every agent here.

**Tests:** 5.0 discovery · 5.1 37 · 5.2 57 · 5.3 24 + 30 · 5.4 4 + 29 · 5.5 20 + 31 · 5.6 33 + 62 · 5.7 43.
