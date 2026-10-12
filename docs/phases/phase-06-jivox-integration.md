# Phase 6: Submit and activate contracts in Jivox (per agent)

**Status:** 🔄 6.0–6.3 done (deploy prep, live on Render, fake Jivox writes). **Plan approved 2026-10-12** with the user's choices (P6-2 any https host, P6-3 Submit anyway allowed); the Render deploy is live (user) → 6.1 check next. Real qa3 writes (6.6) still one by one with the user's OK.
**Roadmap:** [../ROADMAP.md](../ROADMAP.md) · **Big picture:** [../PLAN-v2-api-first.md](../PLAN-v2-api-first.md)
**Depends on:** Phase 5 (agents, contracts, checklist, out of date) · the Render deploy (a public https address)

---

## 0. Progress tracker

| # | Task | Side | Status |
|---|---|---|---|
| 6.0 | Deploy prep (Render + Neon, one address, sign-up allowlist, attempt limit, ping) | Both | ✅ |
| 6.1 | **Live deploy** (the user, with the guide) + check it: deploy script against the Render address; every agent's "Jivox can reach the base URL" ✓ | Infra | ✅ |
| 6.2 | **Fake Jivox learns to write**: `submit_contract` / `list_contracts` / `activate_contract` on the fake MCP server with every outcome (verified vN, failed + evidence, invalid + fixes, gate_failed, slow, unreachable, activate refused) and real version numbering, so 6.3–6.5 are built and tested without touching qa3 | Backend | ✅ |
| 6.3 | Database: `jivox_contract_actions` (every submit / activate per agent: document, shape, design version, outcome, Jivox version, Jivox's answer, who, when) + one-at-a-time guard | Backend | ✅ |
| 6.4 | Backend: **Submit** (fresh contract → `submit_contract`), **Versions** (`list_contracts`, live), **Activate** (`activate_contract`), **History**; write tools only to allowed Jivox hosts | Backend | ⬜ |
| 6.5 | Frontend: a **Jivox** section in each agent's panel (Submit, result explained, versions + Activate, history) + a Jivox status chip per agent in the table | Frontend | ⬜ |
| 6.6 | **Real qa3 run, step by step with the user's OK before each write**: agent 1 submit → verified v1 → activate; agent 2 the same; a broken contract → failed with evidence; Studio status checked | Both | ⬜ |
| 6.7 | End-to-end + docs (the fake for every edge case; the qa3 record as proof) | Both | ⬜ |

(Old plan: tunnel → replaced by the Render deploy; "connect / read agent info / sync fields" → done in Phase 5
as Read from Jivox.)

---

## 1. Goal (simple words)

From an agent's panel: **Submit** its contract to Jivox → Jivox checks it and calls our live API once → we show
**verified v3** (or **failed** and exactly why) → **Activate v3** → it's the contract Jivox uses for that agent. Each
agent has its own versions; two agents on one API never affect each other.

## 2. What Jivox does (from its spec, 5.0 snapshot)

```
Submit(document) ──► Jivox: validate ─► gates (agent, fields, credential) ─► ONE live call to our /v1
                     (sample_request, the agent's token from Studio)
        ◄── verified, new version N          (stored, not active yet)
        ◄── failed / invalid / gate_failed   (stored as failed, NO version; errors carry a fix, failed carries evidence)
Activate(N) ──► Jivox re-runs the gates + the live call ─► N active, the previous active one retired
List ──► the verified versions + which one is active   (failed and retired are final)
```

The exact answer shapes of submit / activate aren't known yet (no write tool was ever called): we keep Jivox's whole
answer (capped), read the parts we know (status, version, errors with their fix, evidence) and always show the rest
as-is. 6.6 records the real shapes in `docs/jivox/` like 5.0 did.

## 3. What we store

| Table | Columns | Notes |
|---|---|---|
| `jivox_contract_actions` (new) | agent_id, kind (`submit` / `activate`), state (`running` → `done` / `error`), outcome (`verified` / `failed` / `invalid` / `gate_failed` / `activated` / `refused` / `unreachable` …), jivox_version, document (submit), shape + design version, Jivox's answer (≤ 64 KB, scrubbed), started_by, started_at, finished_at | Our history per agent. **Jivox stays the source of truth** for versions and which one is active |
| guard | a unique partial index "one `running` action per agent" | a double click, two tabs, two people → the second gets 409 `JIVOX_BUSY` |
| `jivox_agents` | `last_contract_*` (5.6) also set by a **verified** submit (how = `submit`) | "Out of date" then compares with what Jivox has |

## 4. Decisions (proposed, for review)

| # | Decision | Why |
|---|---|---|
| P6-1 | *(revised)* Public address = the **Render deploy** (6.0 / 6.1), not a tunnel | User's choice 2026-10-12 |
| P6-2 | *(user, 2026-10-12: **any https host**)* Same small JSON-RPC client as Read from Jivox; the write tools may go to the agent's MCP URL whatever its host (https; http only for localhost = the fake). `JIVOX_WRITE_HOSTS` stays as an optional setting (not set = any) for a later lock-down; the confirmation dialog always names the host | User's choice; the dialog keeps it visible |
| P6-3 | *(user, 2026-10-12: **Submit anyway allowed**)* Submit always sends the agent's **freshly generated** contract (never one edited in the browser) and runs the checklist first; with a ✗ the dialog says which and offers **Submit anyway** (QA: testing Jivox's own refusals) | Each submit is stored in Jivox, failed ones too |
| P6-4 | One submit / activate **at a time per agent** (409 `JIVOX_BUSY`); different agents in parallel. Timeout 60 s (Jivox calls our API during submit); an interrupted one is marked `error` and the versions list tells the truth | No duplicate versions from double clicks |
| P6-5 | **Activate** is a separate click with a confirmation ("v3 becomes active for axas · Agent 1; v2 is retired; can't be undone"); a verified result offers "Activate v3 now" | The spec: verified first, then activate |
| P6-6 | Versions are read **live** from Jivox (`list_contracts`) when the panel opens; our history adds what we know (which document / design version made each version) | Jivox is the source of truth |
| P6-7 | Jivox's errors are shown as Jivox wrote them, plus our link when we recognise one (e.g. a type error → Design tab, token not registered → Studio steps) | Honest + helpful |
| P6-8 | Out of date (5.6) after a submit compares with the **submitted** contract; the table chip shows "v3 active" / "v4 verified, not active" / "out of date" / "not submitted" | One glance per agent |
| P6-9 | Our API token is never sent (Jivox reads it from Studio); access keys and tokens never in answers, history or logs | Same rules as Phase 5 |

## 5. Endpoints (app, logged in, owner only)

| Method | Path | Result |
|---|---|---|
| POST | `/apis/:apiSlug/agents/:agentId/jivox/submit` `{ anyway?: true }` | checklist → `submit_contract` → `{ action: { outcome, version?, errors?, evidence?, answer } }` · 409 `JIVOX_BUSY` / `CHECKLIST_FAILED` · 403 `JIVOX_WRITE_HOST_NOT_ALLOWED` |
| GET | `/apis/:apiSlug/agents/:agentId/jivox/versions` | `list_contracts` (live) + what we know of each version |
| POST | `/apis/:apiSlug/agents/:agentId/jivox/versions/:version/activate` | `activate_contract` → activated / refused + why |
| GET | `/apis/:apiSlug/agents/:agentId/jivox/actions` | our history (newest first, paged) |

## 6. Frontend (mockup shown in chat 2026-10-12)

Agents table: + a **Jivox** column (not submitted · v3 verified · **v2 active** · out of date). Agent panel: a new
**Jivox** section under the checklist: **Submit to Jivox** (what will happen + the checklist summary; confirm) →
result card (verified v3 ✓ + "Activate v3" / failed ✗ with Jivox's evidence / invalid with each error + fix) →
**Versions** (v1 retired · v2 active · v3 verified [Activate]) → **History**.

## 7. How to verify (filled in during 6.7)

- [ ] The live Render address answers `/v1`; every agent's base_url check ✓
- [ ] With the fake: every outcome shown right; double click / two tabs → one submit; two agents at once → both fine; timeouts and errors marked; nothing written to a host not allowed
- [ ] On qa3: two agents on one API → each **verified v1** with only its fields, then **activated**; Studio shows it
- [ ] A broken contract on qa3 → **failed** with Jivox's evidence shown; the other agent unaffected
- [ ] Versions on screen = Jivox's list; activate v2 → v1 retired
- [ ] No token or access key in any answer, history row or log

## 8. Open questions

- What does Studio's **Waiting** status mean (we'll see it change in 6.6)?
- Does a live `""` replace an ingested value (Phase 5 §8)?
- The real answer shapes of `submit_contract` / `activate_contract` (recorded in 6.6).

## 6.0 Deploy prep ✅ (2026-10-12)

**Why:** the user chose to deploy on a free host before Phase 6, so Jivox (qa3) can reach a public https address.
Compared (sources in chat): Render free web (sleeps after 15 min idle, 30–60 s wake → a pinger keeps it awake; 750
h/month = one service always on; its free Postgres is deleted after 30 days) + **Neon** free Postgres (0.5 GB, no
expiry, pauses after 5 min, wakes in < 1 s) = chosen. Oracle Always Free VM (most power, most setup) kept for later;
Koyeb (1 h sleep, 5 h DB) and a Mac tunnel (Mac must be on) rejected for now. Docker / company deploy stays in Phase 8.

| Part | What | Where |
|---|---|---|
| One address | In production the backend serves `frontend/dist`: `/assets/*` cached a year (immutable), a missing asset → 404 (never the page), every other page → `index.html` (`no-cache`), `/api/*` + `/v1/*` stay JSON. `X-Frame-Options: DENY`, `nosniff`, referrer policy on pages. Off in development (Vite serves) unless `FRONTEND_DIST` is set | `middleware/serve-frontend.ts`, `app.ts` |
| Sign-up allowlist | `SIGNUP_ALLOWED_EMAILS` (`*`, emails, `@domain`); not set → open in development, **closed in production**; checked before hashing; 403 `SIGNUP_CLOSED` shown under the email field | `lib/signup-policy.ts`, `auth.service.ts`, `SignupPage.tsx` |
| Attempt limit | login + sign-up: `AUTH_ATTEMPTS_PER_15_MIN` per IP (default 0 in development, 30 in production) → 429 `TOO_MANY_ATTEMPTS` + `Retry-After`; in-memory fixed window, swept | `lib/rate-limit.ts`, `middleware/auth-rate-limit.ts`, `LoginPage.tsx` |
| Behind a proxy | `TRUST_PROXY` hops (Render: 1) → `req.ip` = the caller | `app.ts`, `config/env.ts` |
| Pinger URL | `/api/ping`: no DB, no log line (keeps Render awake, lets Neon sleep) | `app.ts` |
| Own address | `PUBLIC_BASE_URL` falls back to Render's `RENDER_EXTERNAL_URL` | `config/env.ts` |
| Render | `render.yaml` Blueprint: free web service, build (frontend → backend, dev tools included), start (`prisma migrate deploy` then the server), health `/api/ping`, env (secrets asked, smaller limits for 512 MB + 0.5 GB); `engines` node ≥ 22, `.nvmrc` | `render.yaml`, `package.json` ×2 |
| Guide | step by step for the user (Neon, GitHub, Render, pinger, checks) | `docs/DEPLOY-render-neon.md` |

**Tests:** `phase-06-task-6.0-deploy-lib.test.ts` **10** (allowlist incl. look-alike domains; limiter windows, other
keys, sweeping 10 000 keys). `phase-06-task-6.0-deploy.sh` **19** against a **production build** on :4300 (built
files, `NODE_ENV=production`, a NEW empty database: all 13 migrations applied from scratch): pages / deep links /
assets / missing asset / API JSON / `/v1` / ping / health; not-allowed email 403 (no account), allowed 201, cookie
HttpOnly + Secure + SameSite=Lax; upload → design → Try it at the server's own address → publish → a real `/v1`
call; 40 wrong logins → the 41st 429 (+ sign-up refused, one budget), another caller fine, `/v1` + ping never
limited. The **5.7 (42), 4.9 (52) and 5.6 (59, without 5 lakh rows) end-to-end scripts pass on the production
build**. Log: JSON lines only, no ping lines, no token text, no errors. Browser on :4300: not-allowed email → message
under the field; allowed → signed in; deep link served; only the expected 401 / 403 in the console.
Dev regression: 4.2 64 · 5.2 56; types + lint clean.

| Found while doing it | Fix |
|---|---|
| Public sign-up: anyone on the internet could make an account | allowlist, closed by default in production |
| No limit on login attempts (password guessing; argon2 hashing would eat the 0.1 CPU) | per-IP attempt limit |
| `/api/health` touches the DB: a pinger on it would keep Neon awake (its free compute hours) | `/api/ping` without the DB |
| The dev backend served an old `frontend/dist` if one was lying around | built pages only in production (or `FRONTEND_DIST`) |

## 6.1 Live deploy ✅ (2026-10-12, the user)

`https://api-platform-phnn.onrender.com` (Render free, Ohio) + Neon (`RealTimeAgent`, AWS US East 2 Ohio). The user pushed
**Claude's working folder** (`~/Documents/api-platform`) to the private repo `VIVEKJHA7777/RealTimeAgentApiPlatform`; Render
deploys it on every push (the user pushes; Claude never commits). Their `Real-Time-data-Platform` copy stays for the
company deploy (patches / copies as before). Checked from outside: ping, health (DB up), pages + deep links, immutable
assets, JSON 404, `/v1` 401 envelope, `nosniff` + `DENY`, cookie `Secure`. **Found:** sign-up was open to anyone
(the server is in production, so `SIGNUP_ALLOWED_EMAILS` must have been set to a value letting everyone in, likely `*`);
told the user to set their email and delete the account the check created (`nobody@not-allowed.example`). Lesson: never
create accounts on the live host from here (it isn't a local test server); the user checks the lock in a private
window. The user's screenshot of the live Jivox tab: every check ✓ incl. **"Jivox can reach the base URL"**
(`https://api-platform-phnn.onrender.com/v1/<brand>`) and the token registered in Studio.
MCP URLs differ per Jivox environment (qa3 known; qa2's host comes from the user): each agent keeps its own URL, so
environments live side by side.

## 6.2 Fake Jivox writes ✅ (2026-10-12)

| Part | What | Where |
|---|---|---|
| Write side | `submit_contract`: validate (format, keys, `{item_id}` once, `_meta` keys, max ids, `{token}` once, id first, flat `at`) → **invalid** with a fix per error; gates (feed type, credential `service`, ≥ 1 field, unknown / mandatory / not-bound fields) → **gate_failed**; ONE live call to the contract's `base_url + path` with `sample_request` and the agent's "Studio token" (3 s) judged like the spec (2xx, no-store, success, every id once, every field of its type or missing → default) → **failed** with evidence (request with the token masked, our answer, problems) or **verified** with the next version. `list_contracts`: verified + active only. `activate_contract`: unknown / already active / not verified → refused; gates + live call again → refused with evidence, else active and the previous active **retired** | `test-scripts/phase-06-fake-jivox-writes.mjs` |
| Per agent | one fake agent per MCP URL path: own versions, own Studio token, own forced modes | same |
| Side doors | `POST /__control { path, studioToken?, submit?, activate?, reset? }` (modes: tool-error, http500, slow 5 s, hang 90 s), `GET /__state?path=…` | `phase-05-fake-jivox-mcp.mjs` |
| Answer shapes | **our guess** (`status`, `version`, `errors[{ code, path?, message, fix }]`, `evidence`, `reason`, `retired`) until 6.6 records Jivox's real ones; the backend (6.4) will read them loosely and keep the raw answer | — |
| Helper | `phase-06-mcp-call.mjs`: one tool call like our backend makes (key from `MCP_KEY`) | `test-scripts/` |

**Tests:** `phase-06-task-6.2-fake-writes.sh` **32** (green twice) against OUR real `/v1`: no Studio token → failed
(401 evidence with our `/v1` URL + sample ids); token set → verified v1, again → v2; the verification call is in our
**Recent calls** with the token's name; list v1 + v2 verified; activate 2 → active; activate 1 → v2 retired and gone
from the list; refused: retired / already active / unknown; invalid (4 codes, each with a fix); gate_failed (credential,
not bound, mandatory); failed for a wrong type (field, id, value named), id at a wrong key, a sample id not in our data;
a missing key falls back to its default; unpublished → submit failed 404 and activate refused (re-checked), republished
→ activate works; wrong Studio token → 401 with the token masked; per-agent numbering; forced tool error / HTTP 500 /
slow; wrong access key 401. Regression (the fake's read side): 5.2 56 · 5.4 29 · 5.7 42.

## 6.3 Contract actions table ✅ (2026-10-12)

User note: the live deploy keeps `SIGNUP_ALLOWED_EMAILS=*` on purpose for now (to be tightened on the company server).

| Part | What | Where |
|---|---|---|
| Table | `jivox_contract_actions`: agent, kind (submit / activate), state (running → done / error), outcome, Jivox's own status word, version, MCP host, design version, the document sent, the ✗ checks at the time ("anyway"), Jivox's answer, error message, who, start / finish. Agent deleted → its history goes; user deleted → "started by" empty | `schema.prisma`, migration `20261012160000_jivox_contract_actions` |
| Rules (21) | **one running action per agent** (partial unique index); kind / state / outcome lists; outcome fits the kind; running = no result, done = outcome + answer, error = outcome + message; submit has its document, activate its version, verified a version; version > 0; times in order; sizes (document 256 KB, answer 64 KB, message 1000, status 50, host 1–255); failed checks list | same (hand-written) |
| Library | `startAction` (409 `JIVOX_BUSY` saying what runs and since when; a running row older than 3 min = cut off by a restart → `interrupted` and replaced; 413 `CONTRACT_TOO_BIG`), `finishAction` / `failAction` (only a still-running row; answer + message scrubbed: token-shaped text, the access key, credential headers), `interruptRunningOnBoot` (start-up; ONE server), `listActions` (newest first, 20 per page, light rows), `getAction` (one in full) | `modules/apis/agents/jivox-actions.ts`, `index.ts` |
| Outcomes | done: verified · failed · invalid · gate_failed · activated · refused · **unknown** (a status we don't know yet, its word kept); error: unreachable · auth_failed · bad_answer · timeout · interrupted | — |

**Tests:** `phase-06-task-6.3-actions-db.test.mts` **43**, green 3 runs in a row: scrubbing (headers, URL, text, lists;
short "secrets" ignored), the 64 KB cap (marked preview, multi-byte safe); every database rule (rolled back), cascade /
SET NULL, the history index; the library on real rows (busy with its reason, parallel agents, finish once, scrubbed
answer / message, stale takeover vs a 1-minute-old row, start-up cleanup, 413, 300 KB answer → preview, unknown status,
25 rows → 20 + 5 pages); races: **20 clicks at once on one agent → exactly 1 started, 19 JIVOX_BUSY**; 5 agents at once
→ 5 started. A NEW empty database: all 14 migrations apply. Regression: 5.2 56 · 5.5 31; types clean.
