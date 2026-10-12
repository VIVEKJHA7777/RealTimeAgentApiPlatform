# Phase 7: Testing Aids (call log + failure switches)

**Status:** 🔄 Plan approved 2026-10-12 with the user's choices (P7-1…P7-4 below); building from 7.1
**Roadmap:** [../ROADMAP.md](../ROADMAP.md) · **Big picture:** [../PLAN-v2-api-first.md](../PLAN-v2-api-first.md)
**Depends on:** Phase 4 (live `/v1`, Recent calls), Phase 6 (real Jivox calls; Jivox's `verification` shape)

---

## 0. Progress tracker

| # | Task | Side | Status |
|---|---|---|---|
| 7.1 | Database: `api_call_logs` (the last 500 calls per API, trimmed by itself) + `api_test_switches` | Backend | ✅ |
| 7.2 | Log every `/v1` call **after** answering (batched, never slower): request (method, path, query, body ≤ 4 KB, headers minus secrets, ids, `_meta`), our answer (status, **headers sent**, body ≤ 4 KB, ms), token name, caller, **which switches changed it**, request check. `/v1` stops sending `ETag` | Backend | ✅ |
| 7.3 | Logs API: list (filters: status, token / agent, switched or not, contains id, time) + one entry in full + "Copy as curl" (`<your token>`) | Backend | ✅ |
| 7.4 | Switches: storage, runtime effects inside `/v1`, scope (whole API or one token = one agent), auto-expiry, audit | Backend | ✅ |
| 7.5 | Frontend: **Logs tab** (live list, filters, detail drawer); the Test tab's Recent calls read from the same log | Frontend | ✅ |
| 7.6 | Frontend: **Test switches** panel (on the Test tab) + a red "switches on" banner on every tab of that API | Frontend | ⬜ |
| 7.7 | Each switch against Jivox on qa3 (the user submits; Jivox's real `verification` per switch) → expected vs actual table + docs | Both | ⬜ |

## 1. Goal (simple words)

As a QA tool: **see exactly what Jivox sent us and what we answered** (every call, including headers), and **make the
API answer wrongly on purpose**, one mistake at a time, to check that Jivox catches each one (verification, activate's
re-check, live chat).

## 2. Call log (grows out of Recent calls)

Recent calls (4.8b) keeps 5 calls in one row per API. The log keeps **500 per API** in its own table, written in batches
after the answer has gone out (Jivox's 3 s budget is never touched). Per call: time, token name (never the token),
method, path, query, body (first 4 KB, token-shaped text scrubbed), request headers **without** authorization /
x-api-key / cookie, ids, `_meta` values, our HTTP status, **our response headers** (proof of `Cache-Control: no-store`
per call: the 6.6 question), envelope status, error codes, body preview, duration, caller IP + user agent
(`python-httpx` = Jivox), switches that changed it, and the **request check** (§4).

## 3. Failure switches (per API, off by default)

Each switch names what **Jivox's real `verification`** (6.6) should say:

| Switch | What `/v1` does | Jivox should report (`verification`) |
|---|---|---|
| No `no-store` | omits `Cache-Control: no-store` | `cache_control_ok: false` |
| `status: "failure"` | envelope status failure | `status_ok: false` |
| Duplicate an id | the first item twice | `id_check.duplicates` |
| Drop an id | the last requested id left out of data AND errors | `id_check.missing` |
| Extra id | an item for an id nobody asked for | `id_check.unexpected` |
| Item without id | one item loses its id key | `id_check.without_id` |
| Wrong type | a chosen field sent as text `"abc"` (or a number for a text field) | `fields[].pass: false` |
| Slow answer | waits N ms (default 3 500) | a timeout failure |
| HTTP status | answers 500 (or 401 / 404 / 429, chosen) | `http_status` |
| Empty data | `data: []`, `status: success` | `id_check.missing` (all) |
| Not JSON | plain text | a parse failure |

| Decision (proposed) | Why |
|---|---|
| **Scope:** the whole API, or **only calls with one token** (= one agent) | several agents share one address: break agent B, keep A working |
| **Auto-expiry** (15 min / 1 h / 4 h; default 1 h; max 24 h) | nobody forgets a broken API |
| Several switches may be on together (each is applied in a fixed order) | combined faults are a real case |
| Red banner on every tab of that API while any is on (what, scope, ends in …, Turn off) | obvious state |
| Every logged call shows the switches that changed it | match Jivox's evidence to its cause |
| Allowed on published APIs (that's the point: activate's re-check, live chat) | QA needs it live |
| Switches never touch the app's own checklist / self-check / Try it (they test OUR rules) **unless** "apply to self-check" is ticked | the checklist stays honest |
| The owner only; every switch change is in the log as an event | audit |

## 3b. The user's choices (2026-10-12)

| # | Decision |
|---|---|
| P7-1 | Scope per switch: the **whole API or one token (= one agent)** |
| P7-2 | Auto-expiry **15 min / 1 h / 4 h, default 1 h** (max 24 h); off any time |
| P7-3 | The app's own checklist / Try it / self-check are **not** affected **unless** "apply to our own checks" is ticked |
| P7-4 | **Request check** in every log entry **+ a strict-mode switch** (refuse a non-matching call with 400) |

## 4. Request check + strict mode (from the 2026-10-11 idea)

Every call is compared with the API's request template; the log shows e.g. *"ids ✓ (3) · market=US ✓ · locale=en-US ✓ ·
`cat` missing for SKU-2049 ✗"*. A **strict mode** switch answers a call that doesn't match with `400` in the envelope (how
does an agent handle a refused request?).

## 5. How to verify (filled in during 7.7)

- [ ] Every Jivox call is in the log with its query / body, our answer and our response headers
- [ ] No secret in any stored entry
- [ ] Each switch causes the matching `verification` failure on qa3 (table with real evidence)
- [ ] A one-token switch breaks only that agent
- [ ] Switches end by themselves; the banner says so
- [ ] 200 parallel calls: all logged, `/v1` not slower than without logging

## 7.1 Database ✅ (2026-10-12)

| Part | What | Where |
|---|---|---|
| `api_call_logs` | one row per `/v1` call (kind `call`) or switch change (kind `switch`, the audit): request (method, path, query, body ≤ 4 KB + its size, headers, token kind / name / header style, ids ≤ 100 + count, `_meta`, request check), answer (status, envelope status, error codes, found, **response headers as sent**, body ≤ 4 KB, ms), switches applied, ip, user agent. `BIGSERIAL` id = order. Index `(api_id, id DESC)` | `schema.prisma`, migration `20261012200000_call_logs_and_test_switches` |
| Rules (log) | kinds; a call has method + path and no event, a switch line has an event and no request; **no `authorization` / `x-api-key` / `cookie` / `set-cookie` request header can ever be stored**; sizes (path 2 KB, bodies 4 KB, UA 300, JSON ≤ 8 KB); ids ≤ 100 without NULL; switch names from the list; status 100–599; token kind / header style lists | same (hand-written) |
| `api_test_switches` | one per API per kind (12 kinds incl. `strict`); options per kind (`wrong_type` → field, `slow` → 1–30 000 ms, `http_status` → 400/401/403/404/429/500/502/503, the rest `{}`); scope `token_id` = a token of THIS API (composite key) or NULL = every caller; `apply_to_own_checks` (P7-3); `ends_at` after it was set and ≤ 24 h after its last change (P7-2); set by (user, SET NULL) | same |
| Storage | `writeCallLogs` (one batch, any APIs) + `trimCallLogs` (one indexed DELETE: older than the API's 500th newest) | `modules/v1/call-log-store.ts` |

**Tests:** `phase-07-task-7.1-db.test.mts` **26**, green 3 runs: every log rule (secret headers ×3, sizes, lists, numbers,
kinds); every switch rule (one per kind, a token of THIS API vs another's, options per kind, ends in the past / 25 h / 24 h);
revoke keeps a scoped switch, deleting its token alone refused; API delete removes log + switches; user delete keeps the
switch; 1 200 rows in batches → the newest 500 (S700…S1199), another API untouched; **50 030 rows trimmed in 13 ms**;
**a batch of 100 + trim on a 20 500-row log ≈ 40 ms**; the index serves the newest-first list. A NEW empty database: all
15 migrations apply (30 constraints on the two tables). Regression: 6.4 40 · 5.2 56.

| Found while doing it | Fix |
|---|---|
| A `wrong_type` switch WITHOUT a field was accepted: a missing key makes `jsonb_typeof` NULL and a NULL CHECK passes (the 5.6 trap again) | `CASE kind … COALESCE(…, false)` per kind |

## 7.2 Every /v1 call in the log ✅ (2026-10-12)

**How it works (simple words):** the answer goes out first. Then the call's "note" (already kept for Recent calls) is
turned into a full log entry **in memory** (≈ 13 µs) and queued; every 0.5 s the queue is written in one batch + one
trim per API. Jivox never waits for the log.

| Part | What | Where |
|---|---|---|
| One sender | every `/v1` answer (success and failure) goes out through `sendV1`: JSON written directly, so **no `ETag`** and never an empty `304` (Express' `res.json` answered `If-None-Match: *` on a 200 with an EMPTY 304; checked with its `fresh` module). The exact text sent is kept for the log | `v1/envelope.ts`, `v1/v1.routes.ts` |
| The entry | request: method, path (2 KB), query, body (4 KB, its real size), headers **minus authorization / x-api-key / cookie / proxy-authorization / our self-check header** (≤ 50, 500 chars each, < 8 KB, "N more left out"), token kind / NAME / header style, ids (≤ 100) + count, `_meta` values, the request check · answer: status, envelope status, error codes, found, **our headers as sent** (Cache-Control, Content-Type, Content-Length, X-Request-Id, Allow, Retry-After), body (4 KB), ms · ip, user agent. Token-shaped text scrubbed everywhere | `v1/call-log.ts` (`buildCallLogRow`) |
| Request check (P7-4) | the call vs the API's request template: ids (count), fixed values (`market = "US"`), chat context (`locale ← openai/locale`), per-row columns (POST: `items[].cat` missing for SKU-1002, SKU-2049), wrong method, extra params / top-level keys (information only). `ok` = everything matched; cut to fit 8 KB (fewer rows named, then fewer items, `cutShort`) | `v1/request-check.ts` |
| Queue | batches of 250 every 0.5 s; database unreachable → kept and retried every 2 s, at most 5 000 waiting (the oldest go first, counted in one warning); a batch refused (API deleted meanwhile, or a row breaking a table rule) → written one by one, only the bad ones dropped (a rule break is an ERROR line: a bug); on shutdown the queue is written (≤ 3 rounds, never hangs) | `v1/call-log.ts`, `index.ts` |
| Recent calls | unchanged for the user (still 2 KB of body); the note now keeps 4 KB for the log | `v1/recent-calls.ts` |
| Not logged | the app's own self-check, addresses with no API (as Recent calls) | |

**Tests:** `phase-07-task-7.2-call-log.sh` **36** (green 3 runs; the first before the shutdown check was added): a good GET (status, ids, found, NOT_FOUND, token name,
caller, no secret header, our headers, body = what the caller got, Content-Length, `_meta`, check ✓, ms, X-Request-Id);
a call differing from the template (check ✗ market UK, locale missing, extra `debug`); `If-None-Match: *` /
`W/"…"` / `If-Modified-Since` → 200 with data, no ETag on 200 or 401; token in the wrong header + in the URL + in a
POST body → scrubbed, no header stored; failures logged (no token by address, invalid JSON body as sent, 405 with
`Allow` + check ✗ method), unknown address not logged; POST per-row check; 12 KB body → 4 096 kept + real size, Recent
calls still 2 KB; 200 extra headers → 50 + note, < 8 KB; > 4 KB answer cut with the real Content-Length; TOO_MANY_IDS;
self-check not logged; **200 parallel → all 200 logged**, 400 more → newest 500 (100 + 400); an API deleted while
its calls wait → others still logged; no token anywhere in the run's log; **its own backend (port 4101) stopped
right after 30 calls (0 written yet) → all 30 written on shutdown**.
`phase-07-task-7.2-queue-lib.test.mts` **14** (fake writer): unreachable twice then back (all, in order); 5 100 while
away → 5 000 wait, shutdown returns, back → S101…S5100; deleted API + refused row dropped, others written; the DB
going away mid one-by-one; a broken entry never throws; request-check edge cases (repeated `?ids`, literals as text,
list body, row without id); a ≈ 40 KB check cut under 7 KB.
Regression: 4.3 **56** · 4.8b **51** · 4.5 **41** · 4.9 **52** · 4.8c **21** · 6.6 **15** · 7.1 **26**.

**Speed:** building one entry **13 µs** (20 000 built). Bursts of 200 measured the same with the log on and off
(≈ 1.5 s per burst both ways). **Correction (found in 7.4):** that 1.5 s was NOT the busy machine but a bloated dev
database (see §7.4 "Found"): after the fix, 200 at once take **≈ 0.1 s, all logged** (7.2 script: 134 ms, p50 90 ms).

| Found while doing it | Fix |
|---|---|
| `/v1` sent an `ETag` (Express default) and would answer a 200 call carrying `If-None-Match: *` (or a matching tag) with an **empty 304**, a broken answer for Jivox | `sendV1` writes the JSON itself |
| The user's copy did not build (`AUTH_ATTEMPTS_PER_15_MIN` possibly undefined): the 6.0 export lines of `env.ts` were never applied, and the 6.4 patch no longer applies (JIVOX_WRITE_HOSTS was added by hand, elsewhere) | new `docs/patches/7.2-your-copy.patch` built from their current files; their copy + it + 7.2 files: `tsc` and build green |

## 7.3 Logs API ✅ (2026-10-12)

| Endpoint | Answer |
|---|---|
| `GET …/apis/:apiSlug/logs` | `{ entries, next, gap, matching, total, kept: 500, newestId, tokens }`. Newest first, `limit` 1–200 (50). **Filters** (all combinable): `status` = `ok` (2xx + success envelope) / `failed` (anything else, also "caller hung up") / one code · `token` = a token id (= an agent) or `none` · `switched` = yes / no · `check` = passed / failed · `id` (calls that asked for it, exact) · `kind` = call / switch · `from` / `to` (ISO time). **Pages:** `before=<id>` (older; `next` = null at the end) · `after=<id>` ("anything new?" for the live list; `gap: true` = more arrived than `limit`, reload). List lines carry no bodies / headers. `tokens` = each token named on the page with its CURRENT name, hint, revoked, and the agents using it now |
| `GET …/logs/:logId` | `{ entry (everything: headers in and out, ids, query, _meta, request check, bodies + bodyCut / responseCut), tokens, curl, curlNotes }`. **Copy as curl:** the public address + path as called, the token header the call used (or the API's) with `<your token>`, the body exactly as sent (`--data-binary` + its Content-Type). Notes when it can't be exact: no token in the original, a token of another API, a header this API doesn't expect, scrubbed text, body cut at 4 KB, address cut at 2 KB. 404 `LOG_NOT_FOUND` (not this API's / trimmed) |
| `DELETE …/logs` | `{ cleared, clearedAt }`: the API's **calls** go, switch lines (the audit) stay. Calls still waiting to be written are dropped, and calls being answered at that moment are dropped when they finish (remembered 10 min, in this process) |

| Also | Why |
|---|---|
| New column `api_call_logs.token_id` (migration `20261013090000_call_log_token_id`, no foreign key: the log is history) + rule: only with token kind `this_api`, ≤ 64 characters (written with `COALESCE(…, false)`: the NULL trap caught again while writing it) | names repeat: **Renew** makes a new token with the SAME name; the filter must tell old and new apart |
| `testing/curl.ts` `buildCurl` takes any method + a raw body | Try it's command unchanged (4.5: 41 green) |
| Every filter reads ≤ 500 rows of one API through `(api_id, id DESC)` | 500 here + 20 000 in another API: each list ≈ 40 ms over HTTP |

**Tests:** `phase-07-task-7.3-logs-api.sh` **45** (green 3 runs): list order / counts / no bodies in lines / tokens with
agents; every filter alone + combined (token A / B / none, ok, failed, 405, check ✓ / ✗, id, switched, from / to);
pages of 3 = whole list; `after` (nothing / one / five with limit 2 → gap); **Renew** (new id, same name, old token's
401 after it, Agent 1 follows, filter old 6 / new 1); 400 for 6 wrong questions; the full entry; **the curl, run with
the token filled in, gives the same data again** (GET, and POST with the body as sent); 9 KB body → bodyCut + note;
another API's entry 404, unknown 404, bad id 400, **another account 404 on list / entry / clear (nothing deleted)**, not
logged in 401; switch line kept by Clear and never matched by call filters; Clear 17; **20 calls racing a Clear: none
from before it reappears**; speed (≈ 40 ms each) + index; the new column's rule (5 cases incl. the NULL one).
Regression: 7.2 36 · 7.2 queue 14 · 7.1 26 (new database: all 16 migrations) · 4.5 41 · 4.3 56 · 4.8b 51.

| Found while doing it | Fix |
|---|---|
| The `token_id` rule as first written (`token_kind = 'this_api' AND …`) passed a row with NO token kind (NULL), the 4th time | `COALESCE(token_kind = 'this_api', false)`; re-applied; tested |
| A call that arrived before Clear but finished just after it came back into the log | Clear remembers its moment; such calls are dropped when they finish |
| The "uses the index" check failed once of 3: Postgres' statistics were stale right after inserting 20 000 rows (real use: autovacuum) | the check runs `ANALYZE` first; the API timings were fine in every run |

## 7.4 Switches ✅ (2026-10-12)

**How it works (simple words):** the owner turns a switch on for an API (or for one agent's token), for 15 min / 1 h /
4 h. `/v1` reads the API's switches **in the same query that checks the token** (no cache, nothing stale) and, for
calls with a working token of this API in that scope, answers wrongly in that one way. The call log names the switches
that really changed each answer; every on / change / off / end is a line in the log.

| Part | What | Where |
|---|---|---|
| The 12 switches | `no_store`, `status_failure`, `duplicate_id` (first item twice), `drop_id` (the LAST asked id out of data AND errors), `extra_id` (`NOT-REQUESTED-1`), `item_without_id` (first item), `wrong_type` (`{field}`: text → 12345, others → "abc"), `slow` (`{ms}` 1–30 000, default 3 500), `http_status` (`{status}` 400/401/403/404/429/500/502/503 + failure envelope, Retry-After on 429/503), `empty_data`, `not_json` (text/plain), `strict` (refuses with 400 a call whose request check fails, naming what differs). Catalogue with "Jivox should report" | `v1/test-switches.ts` |
| Fixed order | http_status → strict → [answer built] → empty_data → drop_id → duplicate_id → extra_id → wrong_type → item_without_id → status_failure → [sending] slow → no_store → not_json. Only those that CHANGED the answer are recorded (strict on a matching call: not recorded) | `v1.service.ts` `answerCall`, `envelope.ts` `sendV1` |
| Who gets them | calls with a WORKING token of this API (401s never), scope = whole API or that token. Own checks: self-check + checklist (live, self-check header) and Try it (in-app, whole-API only) only with **"apply to our own checks"** (P7-3). **The contract's sample answer: never** | `v1.service.ts`, `testing.service.ts` (`answerInApp(…, { withSwitches })`), `agents/contract.ts` |
| Endpoints | `GET …/switches` → `{ switches (on now: options, scope with token name / hint / revoked / agents, ownChecks, since, endsAt, setBy), catalogue, now }` · `PUT …/switches/:kind { options?, tokenId?, minutes? (1–1 440, default 60), applyToOwnChecks? }` (on or changed; time counts from now) · `DELETE …/switches/:kind` · `DELETE …/switches` (all). 400 `SWITCH_INVALID` names the field (wrong_type lists the API's fields) | `apis/switches/` |
| Ending | `/v1` ignores an expired switch at once (`ends_at > now()`); the list / any change of that API ends it, and a sweeper every 30 s (and at start-up) does it for all, each with an "ended" line (`DELETE … RETURNING`: never twice) | `switches.service.ts`, `index.ts` |
| Audit | a log line (kind switch) per on / changed / off / ended: switch, options, scope (token id + name), own checks, ends at, by (email; ended: nobody), in the same transaction as the change | `switches.service.ts` |
| Renew | a switch aimed at a token follows its renewed token (like agents); revoke keeps it (shown revoked, never matches); a new switch can't aim at a revoked token | `tokens.service.ts` |

**Tests:** `phase-07-task-7.4-switches.sh` **50** (green 3 runs, with the 30 s sweeper; `SKIP_SWEEP=1` → 49): every switch's
effect on /v1 + its log entry (incl. drop_id on an unknown last id, wrong_type text and number, slow ≥ 1.2 s with the
log's duration, every allowed HTTP status, not_json still no-store, strict: a match passes unrecorded, wrong / missing
market → 400 naming it); 9 wrong settings → 400 on the right field, unknown kind 400; scope (Agent 1 untouched, Agent 2
dropped; logs filter `switched=yes`; no-token 401 unswitched); combinations in the fixed order; own checks (not ticked:
checklist ids ✓, self-check passes, Try it untouched; ticked: checklist "SKU-1002 is missing", self-check fails, Try it
1 item + names it; a one-token switch never reaches Try it) and **the contract unchanged**; 15 min; expired → ignored at
once, list writes "ended", the background sweeper too; Renew carries the switch, old token 401, revoke keeps it shown
revoked, new switch at it refused; **10 changes at once → 7 switches, 10 audit lines (7 on + 3 changed)**; **200 calls
while no_store flips 6 times → every answer 200 with 2 items**; another account 404.
Regression: 4.2 64 · 4.3 56 · 4.5 41 · 4.8b 51 · 4.9 52 · 5.3 30 + lib 24 · 5.4 29 · 5.5 31 · 6.6 15 · 7.1 26 · 7.2 36 ·
7.2 queue 14 · 7.3 45.

**Speed:** 200 at once, healthy DB: **77–149 ms with the switch read, 86–211 ms without** (noise): the extra subquery
(unique index `(api_id, kind)`) costs nothing measurable.

| Found while doing it | Fix |
|---|---|
| `answerInApp` (Try it) is ALSO what builds the **contract's sample answer**: with a switch ticked "own checks", the contract submitted to Jivox would have carried the broken answer | `answerInApp(ctx, sample, { withSwitches: false })` in `contract.ts`; tested (contract identical with a switch on) |
| The log listed sending switches as `not_json, no_store` (marked in another order than documented) | `sendV1` marks slow → no_store → not_json |
| Strict's message `market: expected US, got UK` | values quoted: `expected "US", got "UK"` |
| **Dev DB bloat, not the machine:** a single /v1 call took 46 ms (Phase 4: 4 ms). `records` held 10 live rows in 243 MB and its unique index was **1 017 MB** (many 500 000-row test imports + deletes); the planner then costed the index at 94 648 vs a seq scan at 31 094 and read the whole table every call (23–34 ms; the index: 0.7 ms). `VACUUM ANALYZE` did not change the plan | `VACUUM (FULL, ANALYZE) records` on the dev DB (2.8 GB → 42 MB): single call **5 ms**, 200 at once **≈ 0.1 s**. Could happen on Neon after big data is replaced by small: proposed as its own task (chip "Guard /v1 against records-table bloat") |

## 7.5 Logs tab ✅ (2026-10-12)

Mockup approved with the user's choices: **Recent calls read the log** (newest 5, rows open the call in the Logs tab,
Clear lives there) · **side drawer** for one call · **new calls slide in + Pause** (also paused while a call is open).

| Part | What | Where |
|---|---|---|
| Logs tab | 6th tab (`…/logs`). Header: live / paused dot, Pause / Resume (`aria-pressed`), Clear (asks first; switch lines stay; focus to the heading after). Filters: result, who (each token by its agents' names: "Agent 2 · Jivox qa3 B", revoked last, "No token of this API"), request check, switched, time (15 min / 1 h / 24 h / any), "asked for id" (waits 0.4 s after typing). **Filters live in the address** (`?status=failed&token=…`; Back / reload / links keep them; changing them doesn't pile up history). "N matching of M in the log", Clear filters | `components/apis/call-log/LogsTab.tsx` |
| The list | newest first; columns on wide screens (when · status · who · ids · result · request ✓/✗ · switches · time), two lines on a phone. Switch on / changed / off / ended lines between the calls ("Drop an id turned on for Agent 2 only, until 23:42, by …"); hidden while filtering calls. A switched answer is never green (amber + badge). Load older (50 at a time, up to the 500 kept) | `LogRow.tsx`, `styles.ts` |
| Live | every 3 s "anything newer than the newest I know?" (`after`); new lines slide in highlighted for 4 s and are announced; more than a page at once (`gap`) or a log that shrank (Clear here / elsewhere) → reload; answers for old filters ignored; paused: nothing moves; at most 500 lines | `lib/use-call-log.ts` |
| Drawer (`?open=<id>`) | title (method · status · who), time + ms, path; switch warning; result + the error message + "Sent N items after the switch"; request check line by line + chat context; what came in (token + header, ids, from, query / headers tables, body pretty or as sent, "first 4 KB of …"); what we sent back (**✓ Cache-Control: no-store was sent** / ✗), headers as sent, body; **Copy as curl** + notes; "Only calls from Agent 2" (sets the filter). Full width on a phone, 576 px otherwise. Escape / Back closes it, focus returns to the row. A call no longer in the log: says so | `LogDetailSheet.tsx` |
| Recent calls (Test tab) | reads `logs?kind=call&limit=5`; rows open `logs?open=<id>`; "All calls →"; "N in the log. See all, with filters"; its own Clear removed (the old 5-call store `api_recent_calls` is no longer read by the app: remove it in a later cleanup) | `test/RecentCallsCard.tsx` |
| Helpers | filters ⇄ address, what the API is asked, who / result / ids, switch names + lines, check lines, bodies, agent options | `lib/logs.ts` |
| API page | the open tab scrolls into view in the tab strip (Logs was off-screen on a phone) | `pages/ApiPage.tsx` |

**Tests:** `phase-07-task-7.5-logs-lib.test.ts` **24** (`cd frontend`). In the browser (seeded local account, 2 agents,
calls incl. 401 / 405 / market=UK / a drop_id switch for Agent 2 + no_store, then cleaned up): desktop 1100 px columns;
1000 px two-line layout; phone 375 px (no sideways scroll, filters two per line, Logs tab in view, drawer full width);
light and dark; filters (switched → 2 of 77, `?switched=yes`; failed → 401 + 405; id box waits, `?id=SKU-1003`, focus
stays; Clear filters empties box + address); drawer (switch warning, check ✓ lines + chat context, no-store ✓, 405:
"Method: expected GET, got POST" + the message); Escape → address without `open`, focus back on the row; **live**: 3
calls → 3 new lines on top, highlighted, announced; **Pause**: 2 calls → nothing moves, Resume → they appear; Load older
→ all 82, then **all 500 in 9 clicks (1.5 s), no repeats, in order; 5 more with 500 shown → still 500, new on top**;
Clear → "500 calls cleared", empty, focus to the heading; next call appears by itself; **a Clear from elsewhere** (rows
deleted in the database) → the list empties itself; Recent calls row → `logs?open=…` with the drawer, Back → Test tab;
`?open=1` → "isn't in the log any more"; Copy as curl (stubbed clipboard: "Copied" → back after 1.5 s, the text starts
`curl -s` with `<your token>`; refused → "Couldn't copy…"; the real clipboard in the browser pane is permission-gated);
keyboard order Pause → Clear → filters → Clear filters → rows. `npm run build` + oxlint clean for the new files;
4.8c lib 21.

| Found while doing it | Fix |
|---|---|
| **`frontend/.gitignore` has a bare `logs` line** (Vite template, meant for log files): the new folder `components/apis/logs/` was ignored by **git** (would never have been pushed → the live build would fail) and by **Tailwind** (no columns) | folder renamed `components/apis/call-log/`; checked: no other source file is ignored (the backend's `apis/logs/` is not: the root ignores only `*.log`) |
| Columns built as `` `@3xl:${…}` `` never exist (Tailwind needs whole class names) | `LIST_COLUMNS` written out in full |
| An empty switches cell shifted Time under Switches | the cell is always rendered |
| A switched answer "2 found" showed green although Jivox got 1 item | amber whenever a switch changed it; the drawer says how many were sent |
| The drawer was 384 px (the sheet's own `data-[side=right]:sm:max-w-sm` wins over `sm:max-w-xl`) | same-kind classes `data-[side=right]:w-full data-[side=right]:sm:max-w-xl` |
| The Logs tab was off-screen in the phone's tab strip | the open tab scrolls into view |
| A button / mark inside a section heading made screen readers read "Repeat it Copy as curl" | the aside sits next to the heading |
| Clear said "all 500 lines go" (switch lines stay) | "Every call in this API's log goes" |
| Lint: style constants exported from a component file; an effect copying the id filter into state | `styles.ts`; adjusted during render |

