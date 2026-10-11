# Phase 4: Tokens, Live Endpoint and Testing

**Status:** ✅ Done (2026-10-12). Tasks 4.1–4.9, plus 4.8b/4.8c (Recent calls) and R11 (empty values sent as `""`), all verified. End-to-end in §20.
**Roadmap:** [../ROADMAP.md](../ROADMAP.md) · **Big picture:** [../PLAN-v2-api-first.md](../PLAN-v2-api-first.md)
**Depends on:** Phase 3 (an API has a saved design)

---

## 0. Progress tracker

| # | Task | Side | Status |
|---|---|---|---|
| 4.1 | Database: `api_tokens` (hash + encrypted copy, expiry, revoke) + `auth_header` / `published_at` on `apis`; `TOKEN_ENCRYPTION_KEY`, `PUBLIC_BASE_URL` | Backend | ✅ |
| 4.2 | Tokens: create, list, show, rename, **Extend**, **Renew**, revoke; up to 20 per API; header style | Backend | ✅ |
| 4.3 | Public runtime: `GET` / `POST /v1/:brand/:api`: token check (incl. expiry), ids, lookup, conversion, envelope, `no-store` | Backend | ✅ |
| 4.4 | Publish / unpublish (rules: valid design + data + at least one active token) | Backend | ✅ |
| 4.5 | "Try it" (from the app, also for drafts) + **self-check** of every Jivox verification rule | Backend | ✅ |
| 4.6 | Frontend: **Tokens** card + dialogs (new, created, Extend, Renew, row menu) | Frontend | ✅ |
| 4.7 | Frontend: **Test tab** (curl, Try it, self-check) + Publish button | Frontend | ✅ |
| 4.8 | Load + race tests (many parallel calls, token revoked / expiring mid-flight, data replaced mid-call) | Both | ✅ |
| 4.8b | **Recent calls** backend: the last 5 calls to each API's live URL (also failures), list + Clear (asked by the user after 4.8) | Backend | ✅ |
| 4.8c | Frontend: **Recent calls** card on the Test tab | Frontend | ✅ |
| 4.9 | End-to-end check + docs | Both | ✅ |

---

## 1. Goal (simple words)

The API becomes **real**: anyone with one of its tokens can call
`https://<host>/v1/<brand-slug>/<api-slug>` and gets live data in the exact Jivox format. In the
app, the user gets a ready-to-copy **curl**, a **Try it** panel and a **self-check** that runs
the same checks Jivox will run.

## 2. How a call works

```
GET /v1/acme-shoes-k3x9q2/live-prices?ids=SKU-1001,SKU-9999&market=US
X-Api-Key: rtk_8Hf2k…                (or Authorization: Bearer rtk_…, per the API's setting)

 1. find brand + API by slugs                         not found / draft  → 404 envelope
 2. read the token from the API's header style        missing            → 401 envelope
 3. sha256(token) → api_tokens (this API, not revoked) unknown / revoked / other API's token → 401 envelope
 4. read ids (GET param or POST items[*].<idKey>), trim, de-duplicate
                                                      none               → 400 envelope
                                                      > maxIdsPerCall    → 400 envelope
 5. ONE query: records WHERE data_source_id = … AND external_id IN (…)
 6. build items from the design: keys, type conversion, defaults
 7. unknown ids → errors[] { error_id, error_code: "NOT_FOUND", error_message: "unknown <id key>" }
 8. Cache-Control: no-store on EVERY answer (also errors)

200 { "status": "success", "generated_at": "…", "data": [ … ], "errors": [ … ] }
4xx { "status": "failure", "generated_at": "…", "data": [], "errors": [ { "error_id": "", "error_code": "UNAUTHORIZED", "error_message": "…" } ] }
```

Literals, context (`locale`, `location`) and POST per-row extras are accepted and ignored (Q5).

## 3. Decisions (proposed)

| # | Decision | Why |
|---|---|---|
| P4-1 | Token format `rtk_` + 32 random bytes (base64url). Stored **twice**: a **SHA-256 hash** (used to check every `/v1` call, fast) and an **AES-256-GCM encrypted copy** (key `TOKEN_ENCRYPTION_KEY` in `.env`, never in the DB) so the owner can **view and copy it any time**. Hidden by default (`rtk_8Hf2••••`), "Show" fetches it | User decision 2026-10-11: re-pasting into Jivox on qa3 is common. A stolen DB alone is still useless |
| P4-12 | **Expiry chosen per token** at creation: **Never** (default) · 30 days · 90 days · 1 year · custom date. List shows "Expires in N days" (amber, ≤ 7 days) and **Expired** (red). An expired token → `401 TOKEN_EXPIRED` "This token expired on <date>" | User decision 2026-10-11 (option B) |
| P4-13 | An expired (or about-to-expire) token can be handled from the API page: **Renew** = new token with a new expiry, old one revoked at once (paste the new one into Jivox) · **Extend** = same token, new expiry date (nothing to change in Jivox). **Both approved** | User asked 2026-10-11: "token expires → come to the API → get a new token with expiry" |
| P4-2 | **Several tokens per API**, each with a name ("Jivox qa3"), revocable one by one; `last_used_at` | Rotate without downtime (Q6) |
| P4-3 | A token works only for **its own API**; another API's token → 401 | Least privilege |
| P4-4 | Header style per API: `x-api-key` → `X-Api-Key: {token}` · `bearer` → `Authorization: Bearer {token}` | D3 |
| P4-5 | Only **published** APIs answer on `/v1`; publishing needs a valid design + an active token | D9 |
| P4-6 | **Every** `/v1` answer (also 401/404/400) uses the contract envelope + `no-store` | Jivox reads failures the same way |
| P4-7 | The `/v1` router is separate from the app's `/api`: no cookies, no sessions, no CORS | Server-to-server only |
| P4-8 | `last_used_at` is updated at most once per minute per token, without delaying the answer | No extra write per call under load |
| P4-9 | "Try it" runs **inside our server** (logged-in user, any status, no token needed) using the same runtime code | Test drafts before publishing |
| P4-11 | The API's slug can change (task 2.5): `/v1` always answers on the **current** slug; the old URL stops at once (simple design, 2026-10-11). The UI warns on published APIs | Decided before 2.5 |
| P4-14 | A **revoked** token is final: its encrypted copy is deleted (DB rule), it moves to a collapsed "Revoked" list and can't be shown, extended or renewed | Revoke = gone for good. Approved 2026-10-11 |
| P4-15 | Extend / Renew work on any **active or expired** token (not only expired) | Act before it expires |
| P4-16 | Expiry presets count from now (30 days = now + 30 × 24 h); "Pick a date" = end of that day in the user's time zone | Natural to read |
| P4-17 | At most **20 active** tokens per API | Keeps the list sane |
| P4-18 | A published API whose tokens all expire **stays published**: calls get `TOKEN_EXPIRED`, Overview shows a warning | One Extend fixes it, no re-publish |
| P4-19 | Missing / malformed `TOKEN_ENCRYPTION_KEY` → server doesn't start. Changed key → calls keep working (hash), "Show" says "can't be shown, renew it" | Losing the key never breaks Jivox |
| P4-20 | Phone: token rows become cards; the ⋯ menu opens as a bottom sheet | Same pattern as the Design tab |
| P4-21 | curl host = `PUBLIC_BASE_URL` (default `http://localhost:<PORT>`). Jivox on qa3 can't reach `localhost`: real calls need a tunnel (ngrok) or the Phase 8 deploy | Open item, not blocking |
| P4-22 | **Recent calls**: the last **5** calls to each API's live URL, by anyone, **failures included** (no / unknown / expired / revoked / another API's token, wrong header, not published, wrong method, bad body, too large). Shows time, status + error, token **name** (never the token), header used, ids + found, duration, the start of the body (2 KB, token-shaped text scrubbed), user agent, IP. **Clear** empties it | User request 2026-10-11 (option B): "status of last 5 calls, others removed" |
| P4-23 | **Self-check calls aren't recorded** (they'd push Jivox's calls out; the Self-check card shows them already). Calls to unknown addresses aren't recorded either | Approved with the plan |
| P4-24 | Calls without a usable token are matched to the API **by its address** (one indexed lookup, cached 10 s), so "Jivox sent no token" shows up | Most common setup mistake |
| P4-25 | Kept in memory and saved **at most once a second per API** (one upsert keeping the newest 5; also on shutdown), so `/v1` isn't slowed; owner-only, like tokens | 2 298 calls/s after the change (was 2 169) |
| P4-10 | Self-check = the Jivox verification algorithm: 2xx · `no-store` · `status: success` · every sent id exactly once at the id key · every field present with its type or default · < 3 s | Know before submitting |

## 4. API endpoints

**App (logged in):** `/api/organizations/:slug/apis/:apiSlug/…`

| Method | Path | Purpose |
|---|---|---|
| GET / POST | `/tokens` | list · create `{ name, expiresAt? }` (null = never) → `201 { token, tokenInfo }` |
| GET | `/tokens/:tokenId/reveal` | the full token (owner only, `no-store`, never logged) |
| POST | `/tokens/:tokenId/renew` | `{ expiresAt? }` → new token; the old one revoked in the same transaction |
| PATCH / DELETE | `/tokens/:tokenId` | rename / change expiry (Extend) · revoke |
| PUT | `/auth-header` | `{ style: "x-api-key" \| "bearer" }` |
| POST | `/publish` · `/unpublish` | change status (409 if rules not met, with reasons) |
| POST | `/try` | `{ ids }` → `{ request, status, headers, body, durationMs }` |
| POST | `/self-check` | `{ ids? }` → `{ checks: [{ name, passed, detail }] }` |
| GET · DELETE | `/recent-calls` | the last 5 `/v1` calls `{ calls, kept: 5, clearedAt }` · Clear (task 4.8b) |

**Public:** `GET` and `POST /v1/:brandSlug/:apiSlug` (section 2).

## 5. Frontend

- **Tokens** (inside the Test tab or its own card): list (name, `rtk_8Hf2••••` + Show / Copy, created, expires, last used, Renew / Extend / Revoke), "New token" → dialog with name + expiry (Never default) → shows the token with Copy (it stays viewable later).
- **Header style**: radio X-Api-Key / Bearer, with the exact header shown.
- **Test tab**:
  - curl (GET or POST, with `<your token>` placeholder, or the real token right after creating one)
  - Try it: ids box (prefilled with 2 real ids) → status, time, headers, pretty JSON
  - Self-check: list of green ✓ / red ✗ with the reason
- **Publish** button in the API header (disabled with the reasons listed until the rules are met).

## 6. Concurrency and load

| Situation | Result |
|---|---|
| 200 parallel calls | All answer; each is 2 indexed queries (token, records) |
| Token revoked during calls | Calls already past the check finish; later calls 401 |
| Data replaced during calls | Each call sees old or new data, never mixed (one query per call) |
| Design saved during calls | Each call uses the design it read at its start |
| Unpublished during calls | Later calls 404 |

## 7. Security

Tokens never logged (`authorization`, `x-api-key` redacted, already in place), hashed + encrypted in the DB (key only in `.env`),
viewable only by the owner; `/v1` errors never reveal whether a brand/API exists beyond 404; body limit 1 MB;
ids limited by `maxIdsPerCall`. (Rate limiting stays out of scope; noted for Phase 8.)

## 8. How to verify (all checked by 4.9)

- [x] curl with a good token → envelope with data + `no-store` *(4.3)*
- [x] no token / wrong token / revoked token / another API's token → 401 envelope *(4.3)*
- [x] expired token → 401 `TOKEN_EXPIRED` with the date; Extend makes it work again; Renew gives a new one and the old one 401s *(4.9 §8)*
- [x] Show / Copy returns the same token that was created; another account can't reveal it (404) *(4.9 §3; Copy in the browser 4.6)*
- [x] draft API → 404; published → 200 *(4.3 + 4.4)*
- [x] unknown ids in `errors[]`; > max ids → 400 *(4.3)*
- [x] Bearer and X-Api-Key styles both work (only the chosen one is accepted) *(4.3)*
- [x] Self-check all green for a good API; red with reasons for a broken one *(4.5, backend)*
- [x] 200 parallel calls, revocation and data replacement during calls behave as in section 6 *(4.8: 500 at once, 2 169 calls/s sustained, every race)*
- [x] Recent calls: the last 5 live calls with the reason for each failure; self-checks not listed; Clear *(4.8b/4.8c, 4.9 §10)*
- [x] Empty values sent as `""` by default (or left out per field), live and in the self-check *(R11, 4.9 §2, §4, §7)*
- [x] Revoking every token keeps the API published; calls 401; a new token works without re-publishing *(P4-18, 4.9 §11)*

---

## 9. Task 4.1: Database for tokens ✅ (2026-10-11)

**What was built**

| Piece | Details |
|---|---|
| `api_tokens` table | `name`, `token_hash` (SHA-256, unique: the `/v1` lookup), `token_encrypted` (AES-256-GCM, null once revoked), `hint` (`rtk_8Hf2`), `expires_at` (null = never), `revoked_at`, `last_used_at`, timestamps. Deleting an API deletes its tokens |
| `apis` | `auth_header` (`x_api_key` default / `bearer`), `published_at` |
| DB rules (CHECK) | name 1–60 chars (trimmed); hint `rtk_` + 4; hash = 64 hex (a raw token can't be stored by mistake); **revoked ⇔ no readable copy**; published ⇒ has `published_at` |
| `lib/api-token.ts` | `newApiToken()` → token + hash + hint + encrypted copy; `decryptToken()` returns null (never throws) for another key / changed text / a copy moved to another row (the hash is bound in as GCM "additional data", and the result is re-hashed); `tokenState()` active / expired / revoked |
| `.env` | `TOKEN_ENCRYPTION_KEY` **required** (`openssl rand -base64 32`; bad or missing → server refuses to start). `PUBLIC_BASE_URL` optional (empty = default `http://localhost:<PORT>`, trailing `/` removed) |

Migrations: `api_tokens`, `api_tokens_checks`.

**Tests:** `docs/test-scripts/phase-04-task-4.1-tokens-db.test.mts` (39 checks; runs in one transaction that is rolled back):
`cd backend && npx tsx ../docs/test-scripts/phase-04-task-4.1-tokens-db.test.mts`.
2000 tokens unique and well-formed · encrypt/decrypt round trip · tampered / moved / other-key copies → null ·
expiry edge (expires exactly now = expired) · every DB rule refuses bad rows · cascade on API delete ·
hash lookup uses the unique index · bad `.env` values stop the server.

**Found along the way**

| Issue | Fix |
|---|---|
| Old scripts 2.5 / 3.2 faked "published" with `UPDATE … status='published'`: the new rule refuses it (correct) | Scripts also set `published_at` |
| Script 3.6 failed ~1 run in 2: an import is marked *failed* first, then its 200 000 half-written rows are deleted (~1 s); the check counted them mid-delete | Test waits up to 10 s for the clean-up (app behaviour was right: old data stayed live, leftovers always removed). 6/6 green |
| `docs/` isn't an ES-module package: a `.ts` test with top-level `await` fails | Backend tests in `docs/` use `.mts`; `pg` loaded via `createRequire` from `backend/` |

---

## 10. Task 4.2: Token backend ✅ (2026-10-11)

**Endpoints** (`/api/organizations/:slug/apis/:apiSlug/…`, logged-in owner only; every answer `no-store`)

| Method + path | Body | Answer |
|---|---|---|
| `GET /tokens` | | `200 { tokens: [tokenInfo], authHeader, limits: { maxTokens: 20 } }`: not-revoked oldest first, then revoked newest first |
| `POST /tokens` | `{ name, expiresAt? }` (ISO with zone, or null / left out = never) | `201 { token, tokenInfo }` · 409 `TOKEN_NAME_TAKEN` / `TOO_MANY_TOKENS` |
| `GET /tokens/:id/reveal` | | `200 { token, tokenInfo }` · 409 `TOKEN_REVOKED` / `TOKEN_UNREADABLE` |
| `PATCH /tokens/:id` | `{ name?, expiresAt? }` (rename / **Extend**) | `200 { tokenInfo }` · 409 `TOKEN_REVOKED` / `TOKEN_NAME_TAKEN` |
| `POST /tokens/:id/renew` | `{ expiresAt? }` | `201 { token, tokenInfo, replaced }` (new token, same name; old revoked in the same transaction) · 409 `TOKEN_REVOKED` |
| `DELETE /tokens/:id` | | `200 { tokenInfo }` revoked; again → same answer (same time) |
| `PUT /auth-header` | `{ style: "x-api-key" \| "bearer" }` | `200 { authHeader }` (also shown on every API answer, with `publishedAt`) |

`tokenInfo` = `{ id, name, hint, state (active|expired|revoked), canShow, expiresAt, revokedAt, lastUsedAt, createdAt }`.
Never the token (except create / renew / reveal), its hash or its encrypted copy.

**Rules**

| Rule | Detail |
|---|---|
| Name | trimmed, 1–60 chars, unique among the API's **not-revoked** tokens ignoring case (a revoked token's name can be reused; another API may use the same name) |
| Expiry | `null` = never; a date must have a time zone, be in the future and ≤ 10 years away ("choose Never instead") |
| Limit | 20 not-revoked tokens per API; **expired ones count** (Extend could make them active again). Renew at the limit is fine (replaces) |
| Revoked = final | rename / Extend / renew / reveal → 409 `TOKEN_REVOKED`; copy deleted |
| Expired | can still be shown, extended, renewed, revoked |
| Unreadable copy (other `TOKEN_ENCRYPTION_KEY` / changed) | `canShow: false`; reveal → 409 `TOKEN_UNREADABLE` "still works … Renew it"; renew gives a viewable one |
| Isolation | a token id under another API → 404 `TOKEN_NOT_FOUND`; another account → 404; logged out → 401 |

**Two people at once:** every change locks the API row first (`SELECT … FOR UPDATE`, same order as the
design save), so token changes of one API run one after the other and every check sees the latest state.
An API deleted meanwhile → 404 (its tokens go with it).

**Tests:** `docs/test-scripts/phase-04-task-4.2-tokens.sh`: **65 checks**, 4 runs in a row green
(`LOG_FILE=<backend log>` adds the log check). Races proven:

| Race | Result |
|---|---|
| 10 creates, same name | exactly 1 made, 9 `TOKEN_NAME_TAKEN` |
| 18 tokens + 10 creates at once | exactly 2 made, 8 `TOO_MANY_TOKENS`, DB = 20 |
| 10 renews of one token | exactly 1 new token, 9 `TOKEN_REVOKED` |
| 10 revokes at once | all 200, one revoked time |
| renew + revoke + Extend of one token (×5 each) | no 500s; old token revoked; at most one new token |
| API deleted while 8 tokens are being made | only 201 / 404, no token rows left |

Also checked: tokens never appear in the backend log; the DB holds only the hash + an encrypted copy that doesn't contain the token.

**Found along the way (test-side only)**

| Issue | Fix |
|---|---|
| Parallel helper wrote bodies next to result files; `cat r1-*` glued JSON (no final newline) to result lines | Bodies in `$T/pb/` |
| bash 3.2: `\"` inside `"$( … )"` stays literal → invalid JSON → 400 for the wrong reason (2 checks passed wrongly) | Bodies built in variables first; checks also assert `.error.code` / message |
| `node -e … -1`: node read `-1` as an option | `node -e … -- -1` |
| 4.1 "hash lookup uses the index" flaky on a near-empty table (seq scan is cheaper there) | `SET LOCAL enable_seqscan = off` in that check: proves the index serves it |

---

## 11. Task 4.3: The live endpoint `/v1` ✅ (2026-10-11)

**Where:** `backend/src/modules/v1/` (`envelope.ts`, `v1.service.ts`, `v1.routes.ts`), mounted in `app.ts` at `/v1`
**before** cookies / sessions, with its own JSON parser (any content type, 1 MB) and its own error handler.

**One call, step by step**

| Step | Detail | Failure |
|---|---|---|
| 1. Token | from `X-Api-Key`, else `Authorization: Bearer` (scheme any case). Not `rtk_…`-shaped → refused without a DB query. Else SHA-256 → **one query**: token + API + brand + data source | 401 `UNAUTHORIZED` (missing / invalid / revoked / "belongs to a different API, or this API's address has changed" / "expects X-Api-Key: <token>") · 401 `TOKEN_EXPIRED` "expired on 2026-01-15 10:30 UTC. Extend or renew it…" |
| — | The token is checked **before** anything about the API: without a valid token, a real path and a made-up one both get 401 (nothing to probe). Tokens in the URL or other headers are ignored | |
| 2. API | must be published | 404 `NOT_FOUND` "isn't published yet" |
| | must be called with its designed method | 405 `METHOD_NOT_ALLOWED` + `Allow:` |
| 3. Ids | GET: the id parameter, comma-separated (also `%2C`, also repeated `?ids=`). POST: `<rowsPath>[*].<idKey>` (text; a number becomes text). Trimmed, empty dropped, duplicates once, first-seen order | 400 `BAD_REQUEST` (names the parameter / place / row) · 400 `TOO_MANY_IDS` (counted after removing duplicates) |
| 4. Rows | **one statement**: `generation = (SELECT active_generation …)` inside it, so a data replace never gives a mix or an empty answer | |
| 5. Answer | `buildResponse` (same code as the Design preview: tested equal) → 200 `success`, unknown ids in `errors[]` | |
| Always | `Cache-Control: no-store`, JSON, contract envelope (also 404 for other `/v1` paths, invalid JSON, 413 > 1 MB, 500); no cookies, no CORS headers | |

`last_used_at`: written only after a successful token check, at most once a minute per token
(in-memory throttle + the same rule in the SQL `WHERE`), fire-and-forget (never delays the answer).
The request design's summary is cached per `apiId:designVersion:feedType`.

**Tests**

- `phase-04-task-4.3-v1-endpoint.sh`: **59 checks** (GET + POST answers equal the preview; ids; body problems;
  every token case incl. expiry → Extend → works, Renew → old 401 / new 200; header switch takes effect at once;
  draft 404; 405s; capitals in slugs; renamed address; unpublish; lastUsedAt; design + data changes reach the
  next call; 50 parallel calls; logs). Publishing is done with SQL until 4.4.
- `phase-04-task-4.3-v1-big.sh`: 500 000 rows, 100 ids per call: **avg 96 ms, slowest 136 ms**; 100 such calls
  at once: all 200 in **1.4 s**.

**Found and fixed**

| Issue | Fix |
|---|---|
| A caller putting the token in the URL (`?api_key=rtk_…`) or another header: refused, but the URL / header was written to the log **with the token** | `scrubTokens()` in `lib/logger.ts`: anything shaped `rtk_…` is logged as `rtk_[Redacted]` in URLs (request serializer + log messages) and every header value. Test checks it |
| "Different API" message confusing after an address rename | "…belongs to a different API, or this API's address has changed. Check the URL…" |
| Row error read `"items"[1] has no …` | `items[1] has no "sku"` |
| Test-side: `new_token` passed JSON text where the helper wants a file; a wrong Jivox field name (`image_url` → `product_image`) left the POST design unsaved | Setup now fails fast if tokens / designs aren't created |
| 4.2 failed **once** (1 check) in a full-suite run, then passed 15 runs in a row; the log shows no 500 or unexpected token answer | Not reproduced. Log checks now only use real token-shaped lines (an `undefined` / `JSON-ERROR` line could match ordinary log text) and print how many tokens they checked |

---

## 12. Task 4.4: Publish / unpublish ✅ (2026-10-11)

**Endpoints** (`/api/organizations/:slug/apis/:apiSlug/…`, owner only)

| Method + path | Answer |
|---|---|
| `GET /publish-check` | `200 { status, publishedAt, canPublish, reasons: [{ code, message }] }` (no-store): what the Publish button shows |
| `POST /publish` | `200 { api }` (already published → same, `publishedAt` unchanged) · `409 PUBLISH_BLOCKED`, `details` = **every** reason `{ field: <code>, message }` |
| `POST /unpublish` | `200 { api }` (already a draft → same). `publishedAt` is kept = last published |

**Reasons** (all listed at once; each message says what to do)

| Code | When |
|---|---|
| `NO_DESIGN` | no design saved yet |
| `DESIGN_INVALID` | the saved design fails the design / request rules against the CURRENT data + feed type (e.g. feed type changed on a draft). "has N problems (first: field: message). Fix them on the Design tab" |
| `NO_DATA` | no finished data version (import running / failed) or 0 rows |
| `NO_ACTIVE_TOKEN` | no token that is neither revoked nor expired ("Create a token first" / "Every token has expired. Extend or renew one") |

After publishing, the API **stays published** when tokens expire or the last one is revoked (P4-18): `/v1`
answers 401, `publish-check` still lists `NO_ACTIVE_TOKEN` so the UI can warn; Extend fixes it with no re-publish.
A published API's feed type still can't change (409 `API_PUBLISHED`, task 2.5); unpublish first.

**Two people at once:** publish / unpublish lock the API row then the data-source row (same order as design
saves, data switches and token changes), and the reasons are checked inside that lock.

**Tests:** `docs/test-scripts/phase-04-task-4.4-publish.sh`: **37 checks**, 4 runs green. Races:

| Race | Result |
|---|---|
| 10 publishes at once | all 200, one `publishedAt` |
| publish + unpublish ×5 at once | only 200s; ends published or draft |
| publish vs revoking the only token, 8 rounds | each round 200/200 (publish first) or 409/200 (revoke first): both happened (5 / 3); never a 500 |
| publishing while the API is deleted | only 200 / 404 |

The 4.3 scripts now use the real Publish / Unpublish (no SQL). The 2.5 / 3.2 scripts still set
`status = 'published'` with SQL on purpose: they test PATCH rules on published APIs without designs / tokens.

---

## 13. Task 4.5: Try it + self-check ✅ (2026-10-11)

**Where:** `backend/src/modules/apis/testing/` (`curl.ts`, `testing.schemas.ts`, `testing.service.ts`,
`testing.controller.ts`). `/v1`'s service was split into reusable parts (`requestOf`, `extractIds`, `answerIds`)
so both features run **the same code** as live calls.

| Endpoint | Body | Answer |
|---|---|---|
| `POST /try` | `{ ids? }` (left out = first 2 rows; 1–100) | `{ mode: "in-app", status, designVersion, request: { method, url, headers, query \| body }, curl, response: { status, headers, body }, durationMs }` |
| `POST /self-check` | `{ ids? }` | `{ mode: "live" \| "in-app", url, ids, passed, checks: [{ id, label, status: pass\|fail\|warn\|skip, detail }], request, response, durationMs }` |
| both | | 409 `NO_DESIGN` / `NO_DATA` / `DESIGN_INVALID` (request no longer fits the feed type) |

**Try it**: saved design, no token, any status. Builds the request Jivox would send (public URL from
`PUBLIC_BASE_URL`; POST `{column}` values filled from our data), reads the ids back OUT of it the way `/v1`
does (a comma in a GET id splits it, as live), answers in-process. Shows failure envelopes too (e.g. 400
`TOO_MANY_IDS`). `curl` = ready to copy with `<your token>` (header per style; POST adds `-X POST`,
Content-Type, `-d` with shell-safe quoting).

**Self-check**

| Check id | ✓ when |
|---|---|
| `published` | status published |
| `token` | an active token we can read (⚠ active but unreadable → "renew it"; ✗ none) |
| `reachable` | live: answered at `PUBLIC_BASE_URL/v1/…` (⚠ if that's localhost: "Jivox on qa3 can't reach localhost"); in-app: skip with the reason |
| `needs_token` | live: the same call WITHOUT a token gets 401 + failure envelope; in-app: skip |
| `status_2xx` · `no_store` · `envelope` · `success` | as named (reasons quote the /v1 error, e.g. "HTTP 400: TOO_MANY_IDS, …") |
| `ids_once` | each sent id exactly once under the id key ("SKU-9999 isn't in your data", "comes back 2 times", items not asked for) |
| `fields_typed` | every design field present with its type (int / float / boolean / image = http(s) URL / string); fields with `typeInContract: false` only need to be present. Up to 5 reasons listed, "and N more" |
| `fast` | under 3 s |

`passed` = **live** call made and no ✗ (⚠ allowed): what Jivox's verification would see. Live mode needs
published + a readable active token; the server decrypts it, calls itself over HTTP with a per-process
secret header (`x-platform-self-check`) so the check **doesn't count as token use** (`lastUsedAt`).
The token never appears in the answer (only its name).

**Tests:** `docs/test-scripts/phase-04-task-4.5-try-and-self-check.sh`: **40 checks**, 3 runs green. Highlights:
Try it = Design preview = live `/v1`; the curl from Try it, with a real token put in, run by bash → same data
(GET and POST/Bearer); every check seen passing and failing with its reason (sent-as-written values, a missing
key, unknown id, too many ids, expired / unreadable token, unpublished).

---

## 14. Task 4.6: Tokens screen ✅ (2026-10-11)

**Where:** the API page's **Test** tab is now enabled (`/brands/:slug/apis/:apiSlug/test`); 4.7 adds calling,
Try it, self-check and Publish below the card.
`frontend/src/components/apis/test/` (`TestTab`, `TokensCard`, `TokenDialogs`, `ExpiryPicker`),
`frontend/src/lib/tokens.ts` (pure helpers), `tokensApi` in `lib/api.ts`.

| Part | Behaviour |
|---|---|
| List | wide (container ≥ 42rem): rows Name · Token · Expires · Last used · actions (fixed-width last column so every row lines up); phones: cards, ⋯ opens a **bottom sheet** (44 px actions) |
| Expiry | "Never" · date · amber **Expires in N days / hours / minutes** (≤ 7 days; days rounded) · red **Expired 1 Oct** with inline **Extend** / **Renew** buttons |
| Token cell | `rtk_8Hf2••••••••` + Show (eye) / Copy. Shown tokens live **only in memory**: hidden again on Hide, after **60 s**, when the token changes, and when leaving the tab; never stored |
| Copy | starts the clipboard write inside the click with `ClipboardItem` + a promise (Safari refuses writes that start after a network wait); if the browser refuses, the token is shown to copy by hand |
| New token | name (1–60) + expiry (Never default · 30 / 90 days · 1 year · pick a date = end of that day, local; today … 10 years) → "Token created" with the token, Copy, the header Jivox must send, the expiry; "Done" focused |
| Rename · Extend · Renew · Revoke | dialogs as in mockup 2; Renew shows the new token + "the old one stopped working"; Revoke confirms (final) and warns when it's the **last active token of a published API** |
| Limit | "N of 20" (expired count); at 20, New token explains instead of opening |
| Revoked | collapsed "Revoked (N)", newest first, struck-through names |
| Header style | X-Api-Key / Bearer radios + the exact header; on a **published** API a confirmation first ("Jivox's calls fail until its contract is updated") |
| Stale | token revoked / removed elsewhere → the dialog closes with "… was revoked meanwhile (another tab?)", Show / Copy explain, the list reloads |
| Focus | back to the button that opened a dialog; if that button is gone (inline Extend on a no-longer-expired row, a revoked row) → the row's ⋯, else New token. Checked after React draws the new list |
| Keyboard | expiry chips = radio group (one tab stop, arrows move + wrap; arrows keep focus on the chips, a click on "Pick a date" jumps to the date box) |

**Tests**
- `docs/test-scripts/phase-04-task-4.6-tokens-lib.test.ts`: **25 checks** (presets, end-of-day, bounds, impossible dates,
  every expiry wording), green in 4 time zones (local, Los Angeles, Kolkata, Auckland):
  `cd frontend && npx tsx ../docs/test-scripts/phase-04-task-4.6-tokens-lib.test.ts`.
- Browser (my copy, fresh test account, deleted after): empty state; create (30 days, pick a date); Show / Hide;
  Copy with a **real click** (toast + tick, token stays hidden); Extend expired → Never; Renew (sheet) → new token,
  old one revoked; Rename (taken name in other case → error; trimmed); Revoke (+ last-active warning on a
  published API); header switch on a published API (cancel / confirm, saved as bearer); stale Show + stale Extend;
  20-token limit; auto-hide at 60 s; leaving the tab hides; desktop 1280 px, phone 362 px (no sideways scroll,
  bottom sheet), light + dark.

**Found and fixed while testing**

| Issue | Fix |
|---|---|
| Rows with Extend / Renew buttons pushed their columns out of line | fixed-width actions column |
| "Header Jivox sends" wrapped; the header example broke inside the token | nowrap on wide screens |
| Card description squeezed into 4 lines next to the button on phones | title block `min-w-60`: count + button wrap below |
| "Pick a date" wrapped to a second row | dialogs `sm:max-w-lg` |
| Copy after waiting for the server fails in Safari | ClipboardItem with a promise |
| Arrow keys onto "Pick a date" jumped into the date box | focus jump only on click |
| Focus dropped to the page when the opening button disappeared | fallback chain, checked after the new list renders |
| "Expires in 1 day" with 1 day 23 h left | days rounded → "in 2 days" |

---

## 15. Task 4.7: Test tab + Publish button ✅ (2026-10-11)

**Where:** `frontend/src/components/apis/test/` (`CallCard`, `SelfCheckCard`, `result-bits`, `TestTab` now shares the
token list + ids box), `components/apis/api-page/` (`PublishButton`, `UnpublishDialog`, `ApiActions`, `OverviewTab`,
`context.ts` with `readinessChanged` / `readinessTick`), `lib/testing.ts` (ids box + self-check headline),
`lib/clipboard.ts` (Safari-safe copy, now shared with the Tokens card), `lib/use-tokens.ts`, `testingApi` in `lib/api.ts`.
Backend: `POST /try` also returns `ids` (the ones it used).

| Part | Behaviour |
|---|---|
| **Call it** | curl from `/try` (public URL, ids, literals; POST: `-X POST`, Content-Type, body). "Token in curl": `<your token>` or one of the API's active, readable tokens: shown **masked** in the box, the **real** token goes into the copy (fetched in the click, ClipboardItem) |
| Ids box | empty = the first rows (placeholder shows them); commas or new lines; trimmed, each once; > 100 / > 500 chars caught in the box. Shared with the self-check |
| Try it | runs on opening and when the design / header / status changes; keeps the last answer dimmed while a new one loads; shows HTTP status pill, ms, Cache-Control, the POST request body (folded), the answer JSON (scrolls inside its box); draft note "answered inside the app… 404 until you publish"; failure envelopes too (e.g. 400 TOO_MANY_IDS) |
| Not ready | no design / design no longer fits / no data → message + link to the Design / Data tab |
| **Self-check** | run on demand; headline: **Passed** (green) · **Passed, with a warning** (⚠ named, e.g. localhost) · **The answer looks right** (amber: draft / no token, content ✓) · **N checks failed** (red, names them); each check ✓ ✗ ⚠ or skipped with its reason; footer: live / in-app, URL, ids, ms, when; the checked answer (folded) |
| **Publish** (header, drafts) | always clickable; the server decides. A mark (⚠ icon, "not ready: N to fix" for screen readers, tooltip) when the check says something is missing; refreshed when design / data / tokens change (`readinessTick`) and on window focus. Blocked → popover listing **every** reason with "Open the Design / Data / Test tab"; Escape / close → focus back on the button |
| Published | green badge (tooltip: when); **Unpublish** in ⋯ with a confirmation ("404 from the next call; tokens, design and data stay") |
| Overview | step 3 = ✓ **Published** when live, else "Tokens and testing: create a token, try the API and run the self-check (Test tab), then publish" |

**Tests**
- `docs/test-scripts/phase-04-task-4.7-testing-lib.test.ts`: **13 checks** (ids box parsing, self-check headline in every case).
- `phase-04-task-4.5-try-and-self-check.sh`: + 1 check (`ids` in the Try answer) → **41**.
- Browser (my copy, fresh test account, deleted after; 1280 px + 375 px phone, light + dark): draft Test tab
  (curl, answer, ids hint); Publish blocked → popover (1 reason; no-design API: 2 reasons, links work); draft
  self-check (amber); token created in the card → Publish mark clears at once; Publish → green badge, toast, button gone;
  live self-check (✓ all, ⚠ localhost; token still "never used"); token chosen in curl → masked on screen, the copied
  command **run in a shell → 200 with the right data**; Try it with unknown + duplicate ids, 11 ids (400 envelope),
  101 ids (caught in the box); POST API: curl with body, request body panel, self-check ✗ naming "amount is text
  n/a", "image is text not-a-url", "amount is missing"; Overview ✓ Published; Unpublish → Draft, live URL 404;
  phone: no sideways scroll, header buttons fit, every card inside the screen.

**Found and fixed while testing**

| Issue | Fix |
|---|---|
| The ids-box hint guessed the ids from the request | `/try` returns the `ids` it used |
| Publish popover (opened by the server's answer, no Radix trigger): Escape sometimes needed twice, focus fell to the page | explicit `onCloseAutoFocus` → the Publish button; 4 open / Escape cycles (keyboard and click) clean |

---

## 16. Task 4.8: Load + race tests ✅ (2026-10-11)

**Script:** `docs/test-scripts/phase-04-task-4.8-load-and-races.mts` (Node: real parallel calls, each timed;
`cd backend && npx tsx ../docs/test-scripts/phase-04-task-4.8-load-and-races.mts`), **41 checks**, on 500 000 rows.
Rule everywhere: never a 500; every answer the contract envelope + `no-store`; a call **started after** a change
finished always sees it (calls in flight may see either side).

### The finding: stale statistics after a FIRST upload (fixed)

First run: 300 calls at once → 20 × **500**, 500 at once → 220 × 500; one 100-id call took ~90 ms (735 ms cold).
Cause: right after a big import Postgres' statistics say the new data has ~1 row, so it read **all 500 000 rows**
through the wrong index for every call; connections stayed busy, others waited > 3 s for one → pool error → 500.
The import already ran `ANALYZE` for replace / merge (task 2.3), but **not for a first upload**, and a merge's
carried-over rows came after it.

| Fix | Where |
|---|---|
| `ANALYZE records` **before the switch** when the new data has ≥ 10 000 rows: first uploads, and again after a merge's carry-over (replace keeps its single ANALYZE before the compare). No live call ever sees the slow plan | `import-engine.ts` |
| A call that can't get a DB connection within 3 s (overload, DB briefly down) → **503 `SERVICE_BUSY`** envelope + `Retry-After: 1`, logged as a warning, never a 500 | `v1/v1.routes.ts`, `envelope.ts` |
| Pool size is a setting: `DB_POOL_MAX` (default 10, 2–50) | `config/env.ts`, `lib/prisma.ts`, `.env.example` |

Query after the fix: **1 ms** (was 735 ms) for 100 ids on 500 000 rows (unique index `(data_source_id, generation, external_id)`).

### Results after the fix

| Load | Result |
|---|---|
| 100 / 300 / 500 calls at once (100 ids each) | all 200 with 100 items; whole burst done in **88 / 186 / 312 ms** (was 1.3 s / 3.5 s with 500s) |
| 50 callers for 10 s | **21 723 calls, 2 169 calls/s** (≈ 217 000 items/s), p50 21 ms, p95 34 ms (was 72 calls/s, p95 862 ms) |
| `last_used_at` during that | **1** token-row write for 21 723 calls (≤ 1 a minute) |
| 200 bad-token calls mixed with 100 good | bad 401, good 200 |
| `phase-04-task-4.3-v1-big.sh` | one 100-id call **4 ms** (was 96), 100 at once 218 ms (was 1.4 s) |

| Race (20 callers non-stop) | Result |
|---|---|
| token **revoked** | before → 200; started after → 401; in flight: either; no 500 |
| token **expiry** passing (moved to now + 1.2 s) | answered before → 200; started after → 401 `TOKEN_EXPIRED` |
| **renew** | old token: after → 401; the new one works at once |
| header style switched to Bearer | after → 401 naming `Authorization: Bearer` |
| **data replaced** (500 000 rows USD → EUR, 22 494 calls during the import) | no answer mixes USD and EUR, none misses a row, all calls started after the switch are EUR |
| **design saved** | every answer wholly old shape or wholly new; after → new; before → old |
| 10 × unpublish + publish | only 200 / 404; calls fully inside a published window 200, inside an unpublished one 404 |
| API **deleted** | after → 401 (its tokens went with it); the data source stays |

**503 check:** `docs/test-scripts/phase-04-task-4.8-busy-503.sh` (**5 checks**) starts its own extra backend
(port 4100, `DB_POOL_MAX=2`), holds a lock on `api_tokens` for 6 s, fires 10 calls: 2 wait and succeed, 8 get
503 `SERVICE_BUSY` with `Retry-After: 1` + `no-store` after 3 s, logged as "busy" (no "unexpected error"),
the next call is 200, and it stops only the backend it started.

All earlier suites green after the import change (2.3 import 56, 2.4 98, 3.6 24, …).

## 17. Task 4.8b: Recent calls backend ✅ (2026-10-11)

Asked by the user after 4.8 ("a button … status of the last 5 calls, others removed"); option B chosen: the
real calls to the live URL (Jivox's), not self-check history. Decisions P4-22 … P4-25.

| Part | What | Where |
|---|---|---|
| Table | `api_recent_calls`: one row per API, `calls` jsonb (newest first; DB rule: an array of ≤ 5), `cleared_at`; deleted with the API | migration `20261011175711_api_recent_calls` |
| Note per call | `recordCalls` (first `/v1` middleware) starts a note for `/v1/<brand>/<api>` (not self-checks); the JSON parser's `verify` keeps the body's start (also invalid JSON); `answerCall` adds API, token name, ids, found; `sendFailure` the error | `v1/recent-calls.ts`, `v1.routes.ts`, `v1.service.ts`, `envelope.ts` |
| Token kinds | `this_api` (named; may be revoked / expired, see the error) · `other_api` (no name) · `unknown` · `not_checked` (sent, but the body failed first) · `none` | |
| Saving | after the answer: into memory, then ONE upsert merges new + saved, drops calls from before the last Clear, keeps the newest 5 (safe with several server processes). At most one save a second per API, counted from the **end** of the previous save; retried if the DB is busy; dropped if the API was deleted; flushed on shutdown | `recent-calls.ts`, `index.ts` |
| Scrubbing | token headers never stored; the path and body are scrubbed **before** being cut at 2 KB (a token across the cut is still removed whole) | |
| Endpoints | `GET` / `DELETE …/apis/:apiSlug/recent-calls` (owner only, `no-store`); the list also shows calls not saved yet | `testing.controller.ts`, `apis.routes.ts` |

**Tests:** `docs/test-scripts/phase-04-task-4.8b-recent-calls.sh`: **51 checks**, 3 runs in a row green. Every
kind of call above recorded on the right API with the right reason; another API's token recorded on the URL's
API, not its own; self-check and unknown addresses not recorded; tokens in query / body / at the 2 KB cut scrubbed,
none in the DB; 6th call refused by the DB; **200 calls at once → 2 saves, ≥ 1 s apart** (counted with a temporary
trigger, removed after); Clear, also **during 100 calls** (nothing from before comes back); API deleted with calls
waiting → no error, nothing left; another account 404, logged out 401.
Also: 4.8 load + races **41/41**: **2 298 calls/s, p95 24 ms** (before: 2 169, p95 34); 503 busy 5/5; 4.2 65,
4.3 59, 4.4 37, 4.5 41 (with `LOG_FILE`: no token in the logs). Restart check (own backend on port 4101): 4 calls
then stop within 0.5 s → saved on shutdown, listed after the restart.

| Found while testing | Fix |
|---|---|
| Two saves only 759 ms apart under load (the timer counted from the save's start; the first one waited for a busy DB) | Count from the save's end |
| Invalid JSON with a token showed as "no token" (the parser fails before the token is read) | The header is noted first; kind `not_checked` |
| Test scripts: `grep -c "$token_part"` breaks when a token starts with `-` (read as an option); 1 flaky run | `grep -cF -e` in 4.2, 4.5, 4.8b |

## 18. Fix: empty values sent as `""` (2026-10-11, between 4.8b and 4.8c)

The user saw on the Design preview that id 5 (empty price, no Default) had **no `currentPrice` key** and asked for
`""` instead. Decision **R11** (phase 3 doc): per field `onEmpty` = `empty_string` (default, also older designs) or
`omit` (old behaviour), set in the field's Type menu. Same code for preview, Try it, self-check and `/v1`
(`buildItem`), so it applies to live calls at once.

| Where | Change |
|---|---|
| `design.schemas.ts`, `design.service.ts`, `build-response.ts` | `onEmpty`; no value + no default → `""` or left out; note "sent as \"\" (no default)" |
| `preview.ts` | warning when `""` goes out in a number / boolean / image field |
| `api-types.ts`, `ResponseFields.tsx`, `field-controls.tsx` | Type menu "When a value is empty (and no default)": Send `""` / Leave the key out; notes "1 row is empty: \"\" is sent."; Default hint follows the choice |

**Tests:** 3.5 preview **41** (V-9 → `""` + warning; `onEmpty: omit` → left out; bad value → 400), 3.8 **33**, 4.5
**41** (self-check: `"amount" is text "", the contract says float`), 3.2 69, 3.3 34, 3.6 24, 3.7 26, 4.3 56 all green.
Browser: phone sheet + desktop, dark + light: note, Default hint, Type menu choice, Save, preview with / without the key.

## 19. Task 4.8c: Recent calls card ✅ (2026-10-12)

The card from the mockup, last on the Test tab (`RecentCallsCard.tsx`; pure helpers `lib/recent-calls.ts`).

| Part | What |
|---|---|
| Header | "Recent calls" + green **live** dot; Refresh; Clear (disabled when empty; focus then goes to Refresh, toast) |
| Rows (desktop) | When (hh:mm:ss) · Status pill (green 2xx all found / amber some not found / red failure) · Token (name, or "no token" / "unknown token" / "another API's token" in red) · Ids (first 3 + "+n more") · Result ("2 found", "1 found · 1 not found", or the error code) · duration |
| Phone (`@container`) | each call a card: time · just now, status, token · ids, result · duration |
| Details (click / Enter / Space, `aria-expanded`) | method + path, answer, message, token + header used, all kept ids, IP + user agent, time with seconds, **body as sent** (pretty when JSON; as is when invalid; "first 2 KB of 4.9 KB" when cut; "not kept" when too large) |
| Live | every 5 s while the tab is visible (`usePolling`); new rows highlighted 4 s and announced ("1 new call") |
| Empty | "No calls yet…" / "No calls since you cleared the list at …", the URL; drafts: "get no data until you publish" |
| Self-check card | after a live run: "Jivox's own calls aren't checked here: see Recent calls" (scrolls + focuses the card heading) |

**Tests:** `phase-04-task-4.8c-recent-calls-lib.test.ts` **21 checks** (result / token / header / ids / body / duration / time;
also `TZ=America/Los_Angeles`). Browser on real calls: desktop dark + phone light; 5 kinds of calls listed right; new
call shown in 3.4 s, highlighted, announced, fade after 4 s; 12 ids and 5 KB body details; keyboard open / close
with focus ring; a live self-check adds nothing to the list; the link focuses the heading; Clear; 3 polls in 12 s;
no sideways scroll at 375 px.

| Found while testing | Fix |
|---|---|
| Ids cut off ("SKU-1001, SK…") while Result had spare room | narrower fixed columns, Token · ids takes the rest |
| "ids not read" on failed calls was noise | failed-before-ids rows show only the token |
| Clear left keyboard focus on the page (the button disables itself) | focus moves to Refresh |
| After Clear the card said "No calls yet" | "No calls since you cleared the list at …" |
| Details time had no seconds | `fullTimeLabel` (12 Oct 2026, 14:02:31) |
| Draft text said "answered 404" (a call without a valid token gets 401) | "get no data until you publish" |
| User: "there should be some space between token and id" (they shared one cell, "Jivox qa3 · SKU-1…") | Token and Ids are **separate columns** (16 px gap; widths share the space 0.9 : 1.2 : 1.1 with Result); phone: one line, 12 px gap, token name at most 60 % wide. Checked at 1024 / 1440 / 375 px |

## 20. Task 4.9: End to end ✅ (2026-10-12)

**Script:** `docs/test-scripts/phase-04-task-4.9-end-to-end.sh`: **53 checks** with `LOG_FILE` (52 without), **3 runs
in a row green**. One story, as a brand owner and Jivox live it, on the real endpoints:

| # | Step | What it proves |
|---|---|---|
| 1 | New API: publish-check + Publish | 409 `PUBLISH_BLOCKED` with NO_DESIGN + NO_ACTIVE_TOKEN |
| 2 | Two designs on one data source | GET + X-Api-Key with literal `market=US`; POST + Bearer with its own keys; `onEmpty` kept per field |
| 3 | Tokens | 30-day expiry; list shows only the hint; Show = the token made; another account 404 |
| 4 | Before publishing | Try it answers (empty price → `""`); the live URL is 404 even with a good token |
| 5–6 | Publish, Jivox calls | live = Try it; envelope + `no-store`; `"n/a"` as written; unknown id in `errors[]`; TOO_MANY_IDS; wrong header / other API's token 401; POST Bearer; 405 + `Allow`; the Test tab's curl runs as written; `lastUsedAt` set |
| 7 | Self-check (live) | passes; `""` in a float field flagged with its reason |
| 8 | Expiry | TOKEN_EXPIRED with the date; still published; Extend → same token works; Renew → old 401, new 200, self-check passes |
| 9 | New data, new design | replace upload and design save are live on the next call |
| 10 | Recent calls | last 5, newest first, reasons, no self-checks, no token text, per API, owner only, Clear |
| 11 | Revoke every token | 401, stays published, NO_ACTIVE_TOKEN; revoked token can't be shown / extended / renewed; a new one works at once |
| 12 | Unpublish, delete | 404 (recorded), Try it still works; delete → 401, tokens + recent calls gone; the other API still answers |
| Logs | | no token anywhere in the backend log |

**Browser journey** (a fresh account, light mode, 1024 px): Test tab on a draft explains each missing step → **New
token** dialog (name, expiry chips, "Token created" with the full token + Copy) → **Publish** button → toast "Jivox
can call /v1/…" → a real call from the terminal → **Recent calls** (Refresh) shows it with token name, ids, result
and details. Console: only the two expected 401s of `/api/auth/me` before login. Note: polling pauses while the page
is hidden (by design); Refresh or coming back to the tab fetches at once.

**Full regression (2026-10-12), all green:** 2.2 53 · 2.3 56 · 2.4 98 · 2.5 87 · 3.1 45 · 3.2 69 · 3.3 34 · 3.4 51 ·
3.5 41 · 3.6 24 · 3.7 26 · 3.8 33 · 4.1 39 · 4.2 64 (65 with LOG_FILE) · 4.3 56 (59) · 4.3-big 4 · 4.4 37 · 4.5 41 ·
4.6 25 · 4.7 13 · 4.8 load + races 41 (**2 313 calls/s, p95 25 ms**) · 4.8 busy 5 · 4.8b 51 · 4.8c 21 · 4.9 52 (53).
(1.4 / 1.5 not run: they stop Postgres / delete all users.)

### Phase 4 summary

- **Tokens** (`rtk_…`): hash for checks + AES-GCM copy so the owner can Show / Copy any time; expiry per token
  (Never default); Extend (same token) and Renew (new token, old revoked); revoke is final; 20 per API.
- **Live API** `/v1/<brand>/<api>`: token first (nothing to probe), published check, method, ids, one query in the
  data's current version, the same `buildResponse` as the preview; every answer the envelope + `no-store`; 503 when
  busy; 2 300 calls/s on 500 000 rows.
- **Test tab**: Tokens card, Call it (curl + Try it), Self-check (Jivox's rules, live once published), Recent calls.
- **Found by the user during the phase:** their copy missed the `/v1` mount (merge list now explicit); empty values
  should be `""` (R11); token and ids needed their own columns in Recent calls.
- **Open items:** Jivox on qa3 can't reach `localhost` → a tunnel or the Phase 8 deploy (`PUBLIC_BASE_URL`);
  confirm with Jivox the id placeholder of non-product feeds.

