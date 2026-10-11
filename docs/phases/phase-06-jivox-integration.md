# Phase 6: Public URL and Jivox MCP Integration (per agent)

**Status:** 🔄 6.0 done (deploy prep: ready for Render + Neon, 2026-10-12). Rest: plan review before we start (everything is **per agent**, many agents per API)
**Roadmap:** [../ROADMAP.md](../ROADMAP.md) · **Big picture:** [../PLAN-v2-api-first.md](../PLAN-v2-api-first.md)
**Depends on:** Phase 5 (agents + valid contracts; 5.0 discovery tells us the real MCP tools)

---

## 0. Progress tracker

| # | Task | Side | Status |
|---|---|---|---|
| 6.0 | **Deploy prep** (user, 2026-10-12: deploy on a free host BEFORE Phase 6, Docker stays in Phase 8): one address (backend serves the built frontend), sign-up allowlist, login / sign-up attempt limit, `/api/ping`, proxy setting, `render.yaml`, deploy guide | Both | ✅ |
| 6.1 | Public URL: ~~cloudflared tunnel~~ **the Render deploy** (`docs/DEPLOY-render-neon.md`, done by the user); `PUBLIC_BASE_URL` = Render's address by itself | Infra | ⬜ |
| 6.2 | ~~MCP client + read agent info~~ moved to Phase 5 (5.2 "Read from Jivox", read-only). Here: reuse it for the write tools | Backend | ⬜ |
| 6.3 | **Sync fields**: Jivox's bound fields → the agent's fields (or show the differences) | Both | ⬜ |
| 6.4 | Database: `contract_submissions` (per agent: document, hash, result, version, evidence) | Backend | ⬜ |
| 6.5 | Submit an agent's contract: `submit_contract({ contract })` → verified vN / failed + evidence / invalid / gate_failed with fixes (the token is registered in Studio, never sent by us: 5.0) | Backend | ⬜ |
| 6.6 | Versions (`list_contracts`) + activate (`activate_contract({ version })`) per agent | Backend | ⬜ |
| 6.7 | Frontend: Connect / Submit / result / versions / activate inside each agent's panel; Jivox status in the agents table | Frontend | ⬜ |
| 6.8 | Real end-to-end on qa3: **one API, two agents** (two brandstores), both verified + activated from our UI + docs | Both | ⬜ |

(Old 6.2 "discovery" moved to Phase 5 as 5.0; old `jivox_connections` became Phase 5's `jivox_agents`.)

---

## 1. Goal (simple words)

From the API's **Jivox** tab, for **each agent**: connect to its Jivox MCP destination with its own
access key, see the fields Jivox bound to it, submit its contract, see whether Jivox **verified** it
(or why it **failed**), see its versions, and **activate** one. Two agents on the same API are
fully independent: versions count 1, 2, 3 **per agent** (spec).

## 2. The flow (per agent)

```
Studio (Jivox), per brandstore                   Our platform: API "Price API" → agent "axas · Agent 1"
──────────────────────────────                   ────────────────────────────────────────────────────
1. Add Real Time Agent, select fields
2. Access keys → MCP destination + key ────────► paste into the agent (Phase 5, stored encrypted)
                                                 3. [Connect] → feed type, id column, bound fields
                                                    → sync / compare with the agent's fields
                                                 4. [Submit] → submit_contract(agent's document)
   Jivox gates + calls OUR public URL once ◄─────── (verification call, with the agent's token)
                                                    → verified vN | failed + evidence
                                                 5. [Versions] → v1 ✓, v2 ✓ (active)
                                                 6. [Activate vN] → vN active, previous retired
   Studio status: Waiting → (active)
```

## 3. What we store

| Table | Columns | Notes |
|---|---|---|
| `jivox_agents` (Phase 5) | + `agent_info` JSONB (feed type, id column, bound fields), `last_connected_at`, `last_error` | One row per agent; many per API |
| `contract_submissions` | agent_id, document JSONB, document_hash, submitted_at, result (`verified`/`failed`/`error`), jivox_version, evidence JSONB | Our history per agent; **Jivox stays the source of truth** for versions and the active one |

## 4. Decisions (proposed)

| # | Decision |
|---|---|
| P6-1 | Development uses a **cloudflared quick tunnel** (free, no account). Its URL changes on every start → contracts must be regenerated and resubmitted after a restart (shown as a warning on every agent). Fixed URL in Phase 8 |
| P6-2 | Confirmed by 5.0 (qa3): tools `submit_contract`, `list_contracts`, `activate_contract`; `Authorization: Bearer <access key>`; Streamable HTTP, stateless, SSE answers (Phase 5 §10) |
| P6-3 | The small JSON-RPC client from Phase 5 (P5-13); the official SDK only if we need more |
| P6-4 | Submit always sends the agent's **freshly generated** contract and needs its checklist green |
| P6-5 | **Double submit protection per agent**: button disabled while sending + server refuses a second submit for the same agent while one is in flight (409 `SUBMIT_IN_PROGRESS`); two different agents may submit at the same time |
| P6-6 | Activation asks for confirmation ("v2 becomes active for axas · Agent 1, v1 is retired, cannot be undone") |
| P6-7 | Outgoing calls only to the agent's MCP URL; https required (http only for localhost in development); 30 s timeout; errors shown as `JIVOX_UNREACHABLE` with the reason |
| P6-8 | Jivox's bound fields vs ours: **Sync** replaces the agent's fields with Jivox's (one click); a bound field the design doesn't serve is red ("add it on the Design tab") |
| P6-9 | Out of date: an agent whose current generated contract differs from its **active** version (hash) shows "resubmit"; e.g. after a design change or a new tunnel URL |

## 5. Endpoints (app, logged in)

| Method | Path | Purpose |
|---|---|---|
| POST | `/apis/:apiSlug/agents/:agentId/connect` | test the connection, refresh agent info |
| POST | `/apis/:apiSlug/agents/:agentId/sync-fields` | take Jivox's bound fields |
| POST | `/apis/:apiSlug/agents/:agentId/submit` | generate + submit → `{ result, version?, evidence? }` |
| GET | `/apis/:apiSlug/agents/:agentId/versions` | `get_contracts` → versions + active |
| POST | `/apis/:apiSlug/agents/:agentId/versions/:version/activate` | `activate_contract` |
| GET | `/apis/:apiSlug/agents/:agentId/submissions` | our history |

## 6. Frontend

Agents table: Jivox status per agent (not connected · connected · verified vN · **vN active** · out of
date). Agent panel: Connection (URL, key `••••Tc`, Connect, last checked) → Jivox's fields vs ours
(✓ / ⚠, **Sync**) → **Submit contract** (checklist summary first) → result (verified vN ✓ / failed ✗
with Jivox's evidence explained) → Versions (status badges, **Activate**) → history.

## 7. Security

Access keys encrypted at rest, write-only from the UI, redacted from logs; outgoing requests only to
each agent's configured URL with a timeout. Our API token is **never** sent over MCP (5.0: Jivox reads
it from Studio); the user pastes it in Studio.

## 8. How to verify (filled in during 6.8)

- [ ] Tunnel URL reachable from the internet; `/v1` answers through it
- [ ] Connect shows each agent's real feed type, id column and fields
- [ ] Two agents on one API: both **verified v1** on qa3, each with only its fields
- [ ] A broken contract → **failed** with evidence shown; the other agent unaffected
- [ ] Versions match Studio per agent; Activate v1 → active; activate v2 → v1 retired; Studio status updates
- [ ] Double-click Submit → one submission; two agents submitting at once → both handled
- [ ] Access keys and tokens never appear in responses or logs

## 9. Open questions

- See Phase 5 §8 (how the token reaches Jivox, Waiting status, `""` vs ingested values).
- Does Jivox's verification call come from fixed IPs (to allow-list later)?

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
