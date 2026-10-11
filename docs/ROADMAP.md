# Realtime API Platform: Roadmap and Scope

> **This file is the single source of truth for scope.**
> If something is not written here, we do not build it yet.
> To change the scope, add a line to the "Scope change log" at the bottom first.

- **Current state + how to continue in a new session: [HANDOFF.md](HANDOFF.md)**
- Big-picture explanation (how the token flow works): see [PLAN.txt](PLAN.txt), Part 2
- Detailed notes per phase: see the [phases/](phases/) folder
- Backend structure rules (layers, error flow): see [ARCHITECTURE.md](ARCHITECTURE.md)

---

## 1. What we are building (one paragraph)

One website plus one backend server that many brands share. A brand signs up,
uploads product data (CSV), and gets an API URL and a secret token. The brand
pastes these into BrandStore Studio (Real Time Agent). Jivox then calls our API,
and we answer with live data in the exact Jivox "contract" format.
All brands use the same server, and their data never mixes.

---

## 2. How we work (the rules)

1. **Two folders:**
   - `~/Documents/api-platform/`: Claude writes code here (the reference copy).
   - Your own folder: you type the same code by hand, so you learn it.
2. **One small task at a time.** Claude builds it and explains it, you rebuild and run it,
   and you say "works" before we move on.
3. **Every command goes in the docs.** Each phase file has a "Commands log" section.
   Every install, init or fix command Claude runs is written there with
   *where to run it* and *why*, so you can run the exact same command.
4. **Every file is explained.** Each phase file has a section
   "Files created and what they do".
5. **No extra features.** Nothing outside this roadmap gets built without a scope change.
6. **No automated tests for now.** We verify manually (browser, curl, Postman).

---

## 3. Tech stack (fixed for this scope)

| Part | Choice | Why |
|---|---|---|
| Backend runtime | Node.js 20+ | JavaScript on the server |
| Backend framework | Express | Simple, popular, easy to understand |
| Language | TypeScript (backend and frontend) | Catches mistakes before running |
| Database | PostgreSQL | Reliable SQL database, supports JSON columns |
| Database tool | Prisma | Write DB queries in TypeScript, manage tables with migrations |
| Validation | Zod | Check incoming data and env variables |
| Logging | pino + pino-http | Fast structured logs that can hide secrets |
| Frontend | React + Vite + React Router | Fast React setup, page routing |
| Styling | Tailwind CSS + shadcn/ui | Utility CSS plus ready-made components |
| Package manager | npm | Already installed with Node, nothing extra to learn |
| Local database | PostgreSQL 18 via Homebrew (already installed) | Docker isn't installed; Homebrew Postgres already runs on this Mac |
| Public URL (testing) | ngrok or cloudflared | Lets Jivox qa3 reach our laptop |

---

## 4. Scope

### IN scope (we will build these)

- Project setup, logging, config, health check
- Sign up / log in (session cookie); **one owner account per brand, an account can own many brands** (no team members)
- Brands (organizations), with strict data isolation between brands
- **APIs per brand** (API-first, see [PLAN-v2-api-first.md](PLAN-v2-api-first.md)); each API uses one brand **data source**
- Data: **source connectors** (CSV now; JSON, Google Sheets later as plug-ins), files up to **500 000+ rows** (background imports with progress, versioned data), view / search / download / replace (merge or replace)
- Response design (subset of columns, keys, types, defaults, Jivox field names) and request design (GET / POST)
- Tokens **per API**: generate, viewable any time by the owner (hash for checks + encrypted copy), optional expiry (Never default) with Renew / Extend, revoke, several per API; `X-Api-Key` or `Bearer`
- Public realtime endpoint `/v1/<brand>/<api>` in the Jivox contract format
- Testing: curl, "Try it", self-check of every Jivox verification rule
- Contract generator (contract/1) with rule checklist
- Jivox MCP integration: connect (encrypted access key), submit, list versions, activate
- Request log viewer and failure switches
- Deploy online (one simple host); cloudflared tunnel during development

### OUT of scope (not now, maybe later)

| Feature | Why not now |
|---|---|
| Redis / caching | The database is fast enough for our data size |
| Redis / BullMQ job queues | Imports run as background jobs stored in a Postgres table inside our server (no extra infrastructure) |
| Multiple people per brand: memberships, team invites, roles | **Removed for good**: each brand has one owner login; whoever has the credentials manages it |
| API versioning | Nobody depends on our API yet |
| "user" credential (login-based tokens) | Jivox says this comes later |
| Rate limits / usage quotas / billing | No real traffic yet |
| Usage analytics dashboards | Not needed for testing Jivox |
| Automated tests | Your choice; we keep the code easy to test later |
| Excel import, files > 200 MB / > 1 000 000 rows | Limits configurable; JSON and Google Sheets are planned as later **source connectors** |
| File storage (S3, etc.) | We read the CSV and store the rows; the file itself is not kept |

### Decisions taken (from the plan review)

| # | Decision | Can change later? |
|---|---|---|
| D1 | ~~One token per brand first~~ → **Tokens belong to an API**, several per API (rotation), each revocable | No |
| D2 | URL style: `/v1/<brand-slug>/<api-slug>` | No |
| D3 | ~~X-Api-Key first~~ → **Header style chosen per API**: `X-Api-Key: {token}` or `Authorization: Bearer {token}` | No |
| D4 | ~~Tokens and the first API together~~ → API-first order: API + data → design → token/test → contract → Jivox | No |
| D5 | Product rows stored as `external_id` plus JSON `data` | No (core design) |
| D6 | Login uses a session stored in the DB plus an httpOnly cookie | No |
| D8 | **Data sources belong to the brand; each API uses exactly one** (several APIs can share one) | No |
| D9 | Only `published` APIs answer on `/v1`; new APIs start as `draft` | Yes |
| D7 | Each brand has exactly one owner account; one account can own many brands. A brand is opened by slug **and** owner check in one query (not yours → 404). The current brand lives in the URL. | No |

---

## 5. Phases

| Phase | Name | Doc file | Status |
|---|---|---|---|
| 0 | Project setup and foundation | [phase-00-setup.md](phases/phase-00-setup.md) | Verified |
| 1 | Login and brands | [phase-01-auth-and-brands.md](phases/phase-01-auth-and-brands.md) | Built + verified by Claude (2026-10-10); waiting for your check |
| 2 | APIs and their data | [phase-02-apis-and-data.md](phases/phase-02-apis-and-data.md) | ✅ Done (built + verified end to end by Claude, task 2.8) |
| 3 | Response and request design | [phase-03-api-design.md](phases/phase-03-api-design.md) | Not started (plan draft) |
| 4 | Tokens, live endpoint, testing | [phase-04-tokens-endpoint-testing.md](phases/phase-04-tokens-endpoint-testing.md) | Not started (plan draft) |
| 5 | Contract generator | [phase-05-contract-generator.md](phases/phase-05-contract-generator.md) | Not started (plan draft) |
| 6 | Public URL + Jivox MCP integration | [phase-06-jivox-integration.md](phases/phase-06-jivox-integration.md) | Not started (plan draft) |
| 7 | Testing aids (request log, failure switches) | [phase-07-testing-aids.md](phases/phase-07-testing-aids.md) | Not started (plan draft) |
| 8 | Deploy online | [phase-08-deploy.md](phases/phase-08-deploy.md) | Not started (plan draft) |

Plan drafts for Phases 3–8 give the direction; each gets a detailed review (decisions, questions) right before it starts.
Status values: `Not started` → `In progress` → `Built` (Claude done) → `Verified` (you checked it)
Old Phase 2–8 plans (before the API-first change) are kept in [archive/](archive/).

### Phase summaries

**Phase 0: Project setup and foundation**: done.

**Phase 1: Login and brands**: done (sign-up/login/logout, sessions, brands with random slug suffix, isolation).

**Phase 2: APIs and their data**
Create APIs inside a brand; give each API data by uploading a CSV (preview, id column) or
reusing a brand data source; view, search, download and replace (merge/replace) the data.
*Done when:* two APIs share one uploaded CSV, data can be downloaded and replaced, broken CSVs
save nothing, and brand B can't see brand A's APIs.

**Phase 3: Response and request design** ✅ Done (2026-10-11)
Per API: id + chosen fields (subset of columns), response keys, types, defaults, Jivox field
names; GET (`ids` param, literals, locale) or POST (`items` objects, per-row columns, context).
*Done when:* two APIs on one data source send different fields, and the design passes every contract rule.

**Phase 4: Tokens, live endpoint, testing** ✅ Done (2026-10-12)
Tokens per API (X-Api-Key or Bearer), `/v1/<brand>/<api>` answering in the contract envelope
with `no-store`, ready-made curl, "Try it" panel, self-check of all Jivox verification rules.
*Done when:* curl with a good / missing / wrong / revoked / other-API token behaves correctly and the self-check is all green.

**Phase 5: Contract generator** ✅ done 2026-10-12 (many Jivox agents per API, one contract each)
contract/1 JSON built from the API design with real sample ids; rule checklist; copy/download.
*Done when:* the generated contract for a GET and a POST API pass the checklist.

**Phase 6: Public URL + Jivox MCP integration**
cloudflared tunnel; per-API Jivox connection (MCP URL + encrypted agent access key); read the
agent's bound fields; submit_contract, get_contracts, activate_contract; history.
*Done when:* a contract is submitted, **verified** and activated on qa3 from our UI.

**Phase 7: Testing aids**
Request log (what Jivox sent), failure switches (no `no-store`, `status: failure`, duplicate
id, missing id, wrong type, slow > 3 s, HTTP 500).
*Done when:* each switch makes Jivox verification fail with matching evidence.

**Phase 8: Deploy online**
Host backend + DB + frontend with a fixed HTTPS URL; contracts use it.
*Done when:* Jivox qa3 works with the laptop switched off.

---

## 6. Scope change log

| Date | Change | Reason |
|---|---|---|
| 2026-10-09 | Initial scope agreed | First plan review |
| 2026-10-09 | Use Homebrew PostgreSQL instead of Docker Compose for local dev | Docker not installed; Postgres 18 already running. Docker may come back in Phase 8 (deploy). |
| 2026-10-09 | Removed multiple people per brand (memberships, roles, invites). One account = one brand (D7). | Not needed for the use case: whoever has the brand's credentials manages it. Simpler isolation. |
| 2026-10-09 | One account can own **many** brands (still one owner per brand, no members). D7 updated; migration `allow_many_orgs_per_owner`. | Your use case needs several brands per login. |
| 2026-10-10 | Backend layering: routes → controller → service → DB; errors bubble up with `cause` kept (docs/ARCHITECTURE.md). | Clear responsibilities per file; the real root cause of any error is always in the logs. |
| 2026-10-10 | Brand slugs get a random 6-character suffix (`acme-shoes` → `acme-shoes-k3x9q2`); the user only picks the start. | Users never have to hunt for a free slug; no conflicts between brands with the same name. |
| 2026-10-10 | **API-first plan (v2)**: brand → APIs; each API uses a brand data source; tokens per API; header style per API; contract generator + Jivox MCP submit/activate from our UI. Phases 2–8 replaced (old plans in `docs/archive/`). | Your product vision: users create several APIs, each with its own data, fields, token, curl and contract. |
| 2026-10-10 | **5 lakh rows + pluggable sources**: streaming uploads, background import jobs (Postgres table, no Redis), versioned data (generations), limits 200 MB / 1 000 000 rows; source connector interface so JSON / Google Sheets can be added later without changing existing code. | Your requirements during task 2.1. |
| 2026-10-11 | **No column type guessing**: data is stored exactly as written; column = name only. Types are chosen per API field (Phase 3). | Not a requirement; keeps the data layer simple. |
| 2026-10-11 | **APIs are editable after creation:** name, **slug**, feed type (only while draft) and **data source** can all change (`PATCH`). Changes apply **immediately** (simple design); on a published API the answer carries a warning: "regenerate and activate a new contract". A live/draft split (old slug + old design keep answering until the new contract is activated) is **parked** for later, only if needed. | Your review before task 2.5: users change slugs and response structures over time and resubmit the contract. |
| 2026-10-11 | **Request design = a contract/1-style template** (`query` / `body` with `{item_id}`, `{column}`, `{_meta.openai/…}` placeholders and literals, any nesting), built by a form + an advanced JSON editor. The `/v1` runtime reads the same template; the contract copies it. (Proposed; confirmed at the Phase 3 review.) | "We will support all kinds": whatever contract/1 can describe, the platform can serve. |
| 2026-10-11 | **Parked:** changing a data source's **id column** when uploading a new version (Replace only, warning for every API using it, all-or-nothing). Designed in the 2.7 review; to build later only if needed. Until then the id column is fixed (upload the data as a new data source to use another id). | Your request after 2.7; postponed by you. |
| 2026-10-11 | **Phase 3 decisions R9 + R10:** any data column can feed any Jivox field (names never need to match); a value that doesn't fit its field's type is **sent as written** by default (per field `onMismatch`: send / default), because the user tests Jivox with imperfect feeds. | Your requests during 3.2 and 3.7. |
| 2026-10-11 | Idea for Phase 7: **check every incoming call against the template** (log what Jivox sent vs what the contract says) + optional **strict mode** (wrong request → 400). (Proposed; decided at the Phase 7 review.) | The platform's main job is testing Jivox agents. |
| 2026-10-12 | **Phase 4 done.** Added during it at the user's request: tokens viewable any time, expiry per token with Extend + Renew, **Recent calls** (last 5 live calls per API), and **R11** empty values sent as `""` by default. | User decisions during Phase 4. |
