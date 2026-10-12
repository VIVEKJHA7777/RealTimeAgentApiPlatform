# HANDOFF: read this first in a new session

> Single file that tells a new session (or a new person) everything needed to continue.
> Last updated: **2026-10-12**, **Phase 5 done**; **Phase 6 in progress**: 6.0 deploy prep, **6.1 LIVE** at `https://api-platform-phnn.onrender.com` (Render + Neon; Render deploys `~/Documents/api-platform` from the user's private GitHub repo `VIVEKJHA7777/RealTimeAgentApiPlatform` when THEY push), 6.2 fake Jivox writes (submit / list / activate), 6.3 `jivox_contract_actions` (+ `agents/jivox-actions.ts`: one running action per agent, scrubbed answers, start-up cleanup). 6.4 Submit / Versions / Activate / History endpoints (`agents/jivox-writes.service.ts`, loose answer reading `agents/jivox-answers.ts`). 6.5 the Jivox section in each agent panel (`jivox/JivoxSection.tsx`: Submit / result explained / Versions + Activate / History) + Jivox chip column. **6.6 in progress**: Jivox's first real answer (invalid, BAD_DOCUMENT: keys may only be `[A-Za-z0-9_]`) → fixed (no `-` in keys; checklist names such keys). Pending, proposed: Recent calls keep the response headers (no-store proof), no ETag on /v1, an "app updated" bar. **First real success on qa3** (Agent 1 of `newsubtitle`: verified v1 + activated). Jivox's real answer shapes saved in `docs/jivox/qa3-answers-2026-10-12/` and read (`note`, `previous_active`, `verification`). Jivox tab UI: Jivox section first, collapsible checklist / contract (remembered), "Jivox's answer (raw)" in history. **6.6 done** (verified + activated + a deliberate failure on qa3; all 4 real answer shapes saved and read). **6.7**: end-to-end `phase-06-task-6.7-end-to-end.sh` 21/21; Phase 6 summary in the phase doc §6.8; only the user's qa3 two-agents-on-one-API check left, then Phase 6 ✅ → Phase 7 (testing aids) or Phase 8 (Docker / company deploy). Proposed, not built: an "app updated" bar. **Phase 7 in progress** (testing aids; plan + the user's choices P7-1…P7-4 in `phases/phase-07-testing-aids.md`): **7.1** tables `api_call_logs` (newest 500 per API) + `api_test_switches`; **7.2** every `/v1` call logged AFTER answering (`v1/call-log.ts`: queue, 0.5 s batches, retry while the DB is away, max 5 000 waiting; `v1/request-check.ts`: the call vs the request template; `sendV1` in `envelope.ts`: no ETag / 304 any more, our headers as sent kept). **7.3** logs API (`apis/logs/`: list + filters + pages / `after`, one entry + Copy as curl, Clear; new column `api_call_logs.token_id`, migration `20261013090000`). **7.4** test switches (`v1/test-switches.ts`: 12 kinds, fixed order, scope, own checks; read in the token query; `apis/switches/`: GET / PUT / DELETE + audit lines + 30 s sweeper; Renew moves them; the contract never sees them). **7.5** Logs tab (`components/apis/call-log/`: live list + filters in the address + drawer `?open=` + Copy as curl + Clear; `lib/logs.ts`, `lib/use-call-log.ts`; Recent calls reads the log). NOTE: `frontend/.gitignore` ignores any folder named `logs` (hence `call-log/`). **7.6** switches panel on the Test tab (`test/SwitchesCard.tsx`) + red banner on every tab (`api-page/SwitchBanner.tsx`) + agent-panel line; shared state `lib/use-switches.ts` in the page context. Next 7.7: each switch against Jivox on qa3 (the user submits) → expected vs actual table. Dev-DB finding: `records` index bloat made /v1 46 ms → fixed on the dev DB with `VACUUM (FULL, ANALYZE) records`; a production guard is proposed as a separate task. The user's copy has the 7.2 patch applied (`docs/patches/7.2-your-copy.patch`, replaced the 6.4 one) and builds. The live deploy keeps `SIGNUP_ALLOWED_EMAILS=*` by the user's choice. Plan + user choices (Submit anyway allowed; writes to any https host) in `phases/phase-06-jivox-integration.md`. Phase 5 summary: `phases/phase-05-contract-generator.md` §18.
> Details live in: [ROADMAP.md](ROADMAP.md) (scope, decisions, change log) · [PLAN-v2-api-first.md](PLAN-v2-api-first.md)
> (product design) · [ARCHITECTURE.md](ARCHITECTURE.md) (code rules) · [phases/](phases/) (one doc per phase, with
> commands, files, test results per task).

---

## 1. What this project is

A **multi-tenant "API-as-a-service" platform** built step by step as a **learning project**, whose
real purpose is to **test Jivox BrandStore "Real Time Agents"**. A brand (organization) creates
**APIs**; each API answers from uploaded data (CSV now; JSON / Google Sheets later) in the exact
**Jivox contract/1 format** (`status`, `generated_at`, `data[]`, `errors[]`, `Cache-Control: no-store`),
gets tokens, a curl to test it, and a generated **contract** that can be submitted / activated on the
Jivox data MCP server from our UI.

Journey: Brand → Create API → upload data (preview → import) → design response/request (Phase 3)
→ token + live `/v1/<brand-slug>/<api-slug>` + test (Phase 4) → contract (Phase 5) → Jivox MCP
submit/activate (Phase 6) → request log + failure switches (Phase 7) → deploy (Phase 8).

## 2. How we work with the user (IMPORTANT)

- **Mentor mode.** The user (Vivek, QA at Jivox) is learning: explain *why*, in simple English, small steps.
- **Two copies of the code:**
  - **Claude's reference copy:** `/Users/vivekkumarjha/Documents/api-platform/` (backend :4000, frontend :5174)
  - **User's hand-typed copy:** `/Users/vivekkumarjha/Documents/jivox-qa-internal-repo/jivox-qa-internal-projects/Real-Time-data-Platform/`
    (usually backend **:4001**, frontend :5173; **their copy has its OWN changes**: `LOG_OUTPUT` / `LOG_FILE` (file logging) in `config/env.ts` + `lib/logger.ts` + `.env.example`, other `package.json` names / fields, no comments in `app-error.ts`: for those files give a PATCH (`diff -u` built from their file, dry-run with `patch --dry-run`), never a `cp`; DB from THEIR `backend/.env` (database `api` as of 2026-10-12, not `api_platform_mine`: test commands should read it with `grep -o 'postgresql://[^"]*' backend/.env`); their scripts live in `test-scripts/`, test data in `docs/test-data/`)
  - **Never stop/kill the user's processes.** Kill only by Claude's path pattern: `pkill -f "api-platform/backend"`.
- **Per task:** (1) plan for review when asked (2) implement properly structured (3) **test every scenario**
  (scenario script in `docs/test-scripts/`) (4) update the phase doc: commands log, **files touched**
  (created/modified/deleted), test results, problems found + fixes, notes (5) reply with a **files-touched
  table**, results, bugs fixed, and "for your copy" commands. Wait for the user before the next task.
- **Concurrency first:** invariants in the DB (UNIQUE, composite FKs, partial unique indexes, CHECKs),
  race losers → clean 409, transactions where needed, prove races in tests (10 parallel requests).
- **No automated test framework** (user's choice): bash + curl + psql scenario scripts instead.
- **Shell is zsh** in tool calls: run bash-specific scripts with `bash`, e.g. `[ a == b ]` and word
  splitting of `$VAR` don't work in zsh.
- Code style: backend TS with semicolons, single quotes, comments explaining *why* (prettier:
  `npx prettier@3 --single-quote --print-width 100 --trailing-comma all`); frontend without semicolons.
- No git commits yet (user said not needed).

## 3. Stack and environment

| | |
|---|---|
| Backend | Node 22, Express 5, TypeScript 7 (`tsc`), `tsx watch`, Zod 4, pino + pino-http, Prisma **7** (`prisma-client` generator → `src/generated/prisma`, `@prisma/adapter-pg`, `prisma.config.ts`), `argon2`, `cookie-parser`, `multer` 2, `csv-parse` 7, `pg` + `pg-copy-streams` |
| Frontend | React 19 + Vite 8 + React Router 8 + Tailwind 4 + shadcn/ui (radix-nova, violet accent), `sonner` toasts; dark mode via script in `index.html` (no next-themes) |
| DB | PostgreSQL 18 (Homebrew, port 5432, Mac TZ Asia/Kolkata). User `api_platform` / `api_platform_dev_pw`. Claude DB `api_platform_dev`, user DB: see their `backend/.env` (`api`) |
| Run | `cd backend && npm run dev` (4000) · `cd frontend && npm run dev -- --port 5174 --strictPort` (Vite proxies `/api` → 4000) |

## 4. Status

| Phase | Status |
|---|---|
| 0 Setup | ✅ verified |
| 1 Login + brands | ✅ built & verified by Claude (scripts 1.4: 44/44, 1.5: 53/53) |
| 2 APIs + data | ✅ done (2.1–2.8; end-to-end check in phase doc section 12) |
| 3 API design | ✅ done (3.1–3.8; end-to-end check + summary in phase doc §18) |
| 4 Tokens + live endpoint | ✅ done (4.1–4.9, 4.8b/4.8c Recent calls, R11 `""` for empty values; end-to-end + summary in phase doc §20) |
| **5 Jivox agents + contracts** | **done 2026-10-12**: plan approved (many Real Time Agents per API, one contract per agent). **5.0 ✅** read-only qa3 MCP discovery (phase doc §10: Bearer key, 5 tools, agent facts, token lives in Studio, 5 tiers changed). Decisions P5-1…P5-17 agreed. **5.1 ✅** `jivox_agents` table (composite token link, DB rules), `lib/secret-box.ts`, product tiers corrected. **5.2 ✅** agents endpoints + read-only Read from Jivox (`lib/jivox-mcp.ts`, `modules/apis/agents/`), tested with a fake MCP server and once on real qa3. **5.3 ✅** contract generator per agent (`agents/contract.ts`; reproduces Jivox's own Sample A + B exactly). **5.4 ✅** per-agent checklist (`agents/contract-check.ts`, `POST …/contract/check`). **5.5 ✅** Jivox tab (`components/apis/jivox/`, `lib/agents.ts`; renew moves agents to the new token). **5.6 ✅** design changes vs agents: a design save that takes fields away from agents → 409 `AGENT_FIELDS_DROPPED` (`error.extra.agents`) until the exact pairs are confirmed (`confirmDroppedFields`); save answer `agentImpact`; "Out of date" = today's contract shape vs the one last copied / downloaded (`POST …/contract/taken`, columns `last_contract_*`, `agents/contract-shape.ts`, `agents/design-impact.ts`); AppError `extra`. **5.7 ✅** end-to-end (GET API like Sample A + POST API like Sample B, two agents each; `fields` / `call_rules` identical to Jivox's). Next: Phase 6 |
| 5–8 | plan drafts in `docs/phases/phase-05…08-*.md` (detailed review before each starts) |

### Phase 2 task list ([phase-02-apis-and-data.md](phases/phase-02-apis-and-data.md))
- 2.1 ✔ DB: `data_sources`, `data_imports`, `records`, `apis` (composite FKs, partial unique index "one active import per data source", CHECKs)
- 2.2 ✔ source connectors (interface + registry) + streaming CSV connector + upload to temp file + **preview** endpoint
- 2.3 ✔ import engine (background job, COPY into a new generation, merge/replace counts, atomic switch, recovery after restart) + create / start import / import status endpoints
- 2.4 ✔ `GET /` (list + `usedBy` + `latestImport`), `GET /:id`, `GET /:id/imports` (history, 20), `GET /:id/records` (keyset `?limit&afterPosition`, id prefix search `?search&afterId`, REPEATABLE READ), `GET /:id/download` (Postgres `COPY … TO STDOUT` streamed, byte-identical, max 4 at once → 429), `DELETE /:id` (409 `DATA_SOURCE_IN_USE` / `IMPORT_IN_PROGRESS`, race-safe); migration `records_external_id_byte_order` (`COLLATE "C"`); deadlock fix (`deleteGeneration` lock order)
- 2.5 ✔ APIs under `/api/organizations/:slug/apis`: `GET /`, `POST /` (201), `GET|PATCH|DELETE /:apiSlug` (`requireApi`). PATCH changes any of name / **slug** / feed type (draft only, else 409 `API_PUBLISHED`, race-safe inside the UPDATE) / **dataSourceId**; changes apply at once; published APIs get `warnings` (decided 2026-10-11, simple design; live/draft split parked). DELETE keeps the data. Publishing comes in Phase 4 (tests set `status` by SQL)
- 2.6 ✔ frontend: brand page (API cards + Data list, live progress while importing), **Create API wizard** `/brands/:slug/apis/new` (3 steps; preview sends only the first ~2 MB; rows estimated from start + end; file uploaded ONCE with progress via XMLHttpRequest; if the API create fails the data is kept and reused), minimal **API page** `/brands/:slug/apis/:apiSlug` (import card polling 1 s, checklist, details). Backend: `data_imports.estimated_rows` (migration `import_estimated_rows`), API slug `new` reserved, `400 UPLOAD_CANCELLED`, log "closed by the client"
- 2.7 ✔ API page = frame + tab routes (`/apis/:apiSlug`, `/apis/:apiSlug/data`); **Data tab**: records (pinned `#`/id, page jump, 25/50/100, id prefix search, state in `?page&size&q`, row side panel), Download CSV link, **Upload new version** (shared `useFilePreview` hook, checks: id column, column diff, problems; Replace/Merge; 409 shown), import history; **Edit API** dialog (slug change moves the page), **Delete API** confirm (data kept); brand page Data ⋯ menu (Download, Delete when unused). Focus returns to the opener after every dialog/panel
- 2.8 ✔ end-to-end check (phase doc section 12, all ticked): 500k upload/preview/pages/search/download byte-identical, broken row 400 001 changes nothing, merge counts, brand isolation in the UI, server `kill -9` during an import → INTERRUPTED + old data intact, delete rules. Fix: server-side import failures say "nothing is wrong with the file"
- **Jivox reference:** `docs/jivox/` = contract/1 spec (`contract-1.md`) + the 4 feed schemas (`feed-schemas/*.csv`: column_name, tier, description, example; NO type column) + `README.md` (mapping idea, proposed type inference, open questions)
- **Next: Phase 3 review** (`docs/phases/phase-03-api-design.md`): response fields (subset of columns, key names, types, defaults, Jivox field names), request design as a contract/1-style template (P3-14, proposed), data-switch guard. Needs from the user: the Jivox field-name list. Present a plan + sketches first.
- 2.6 frontend: APIs on brand page + Create API wizard (details → upload CSV with preview + import progress, or use existing data)
- 2.7 frontend: API page with tabs + Data tab (table, search, pages, download, new version with progress)
- 2.8 end-to-end check + docs

## 5. Key decisions (full list: ROADMAP §4 + phase docs)

- One owner account per brand; an account can own many brands; no team members (D7). Brand slug = chosen start + random 6-char suffix.
- Brand isolation: every lookup `WHERE slug/id = … AND owner/organization = me` in ONE query; not mine → **404**.
- Backend layers: **routes → controller → service → DB**; middleware may call services; errors bubble up with `cause`; error shape `{ error: { code, message, details?, requestId } }`.
- Sessions: DB table + httpOnly cookie `sid` (SHA-256 of token stored), 7 days.
- **API-first (v2):** brand → APIs; each API uses ONE brand **data source** (shared, D8); tokens per API; header style per API; only published APIs answer `/v1` (D9).
- **Data:** stored **as text exactly as written** (no type guessing; user's decision); empty cell = null; id column fixed; rows keep file `position`; columns = list of names.
- **Big files (5 lakh+):** limits 200 MB / 1 000 000 rows / 200 columns (env); streaming upload to `<tmp>/api-platform-uploads/<uuid>.upload`; preview scans first 1 000 rows; imports are **background jobs** (Postgres table, in-process runner, `IMPORT_CONCURRENCY=2`, no Redis); **generations**: write a new version with COPY, switch `active_generation` in one tiny transaction, delete the old one.
- **Pluggable sources:** `connectors/connector.ts` interface (`open()` → `{ header, rows, progress, close }`), `connectors/index.ts` registry; `kind` is text + `config` JSONB → adding JSON / Google Sheets = new connector file + one registry line.

## 6. Code map (backend `src/`)

```
index.ts              recoverImports() then listen; graceful shutdown (prisma + pgPool)
app.ts                pinoHttp → /v1 (own parser + errors) → json → /api/health → cookieParser → loadSession → /api/auth,
                      /api/organizations, /api/organizations/:slug/data-sources, /api/organizations/:slug/apis → notFound → errorHandler
config/env.ts         Zod env (PORT, DATABASE_URL, UPLOAD_*, IMPORT_*, DOWNLOAD_/VALUE_CHECK_CONCURRENCY, DB_POOL_MAX, **TOKEN_ENCRYPTION_KEY** (required), PUBLIC_BASE_URL)
lib/                  prisma.ts (adapter-pg, timezone=UTC!) · pg-pool.ts (COPY in + out only) · logger.ts (redacts auth/cookie/x-api-key + scrubTokens: rtk_… in URLs / any header → rtk_[Redacted])
                      app-error.ts · validate.ts · prisma-errors.ts (isUniqueViolation reads Prisma 7 adapter meta, isForeignKeyViolation) · session.ts
                      api-token.ts (Phase 4: newApiToken → token/hash/hint/encrypted; decryptToken → null on any problem; tokenState)
middleware/           load-session · require-auth · require-organization · require-data-source · upload-file (multer disk, utf8 names) · error-handler · not-found
modules/auth/         signup/login/logout/me (argon2id OWASP params, dummy hash for timing)
modules/organizations/ create (random suffix, 3 retries) / list / getOne
modules/apis/         routes · controller · service · schemas (CRUD; middleware/require-api.ts)
modules/v1/           (4.3) live API for Jivox, mounted BEFORE cookies/sessions: envelope.ts (V1Error, failure envelope, no-store) · v1.service.ts (token → API → method → ids → one rows query with the active generation inside → buildResponse) · v1.routes.ts (own json parser any content type 1 MB, own error handler) · recent-calls.ts (4.8b: note per call → memory → one upsert ≤ 1/s per API keeping the newest 5; list / Clear; not self-checks)
modules/apis/testing/ (4.5) curl.ts (buildCurl, tokenHeader, <your token>) · testing.service (tryApi in-app; selfCheck live via fetch PUBLIC_BASE_URL + x-platform-self-check header, else in-app; contentChecks) · controller · schemas
modules/apis/publish.service.ts (4.4) reasonsFor (design + request rules vs current data, data version + rows, active tokens) · publishCheck · publishApi / unpublishApi (API row FOR UPDATE → data source FOR SHARE)
modules/apis/tokens/  (4.2) schemas · service (API row FOR UPDATE for every change; list/create/reveal/update(=Extend)/renew/revoke, setAuthHeader, headerStyle) · controller (all no-store)
modules/jivox/        feed-schemas.ts (loads backend/jivox-schemas/*.csv at start, typeHintFor, id column per feed) · GET /api/jivox/feed-schemas[/:feedType]
modules/apis/design/  design.schemas (Zod shape) · design-rules (checkDesign: problems + warnings, pure) · convert (shared JS/SQL type patterns) · design.service (GET/PUT, version check, locks) · request-rules (contract/1 request template: checkRequest → problems + requestSummary) · build-response (pure: rows → contract/1 envelope + sample request; reuse in /v1) · preview (POST design/preview) · column-guard (3.6: used columns must stay; upload, import switch, PATCH) · value-checks (GET design/columns type detection, POST design/check-values counts, 429 limit)
modules/data-sources/ routes · controller · service · schemas · source-rules.ts (header checks, normalizeCell, row width, IdCandidateFinder)
  connectors/         connector.ts · csv.connector.ts (BOM, CRLF, quotes, delimiter , ; tab |, UTF-8 check, binary → 415) · index.ts
  import/             copy-writer.ts (COPY stream, abort = nothing stored) · import-engine.ts (+ deleteGeneration: lock order!) · import-runner.ts (queue + recovery)
  download/           csv-download.ts (slot limit, REPEATABLE READ READ ONLY, header + COPY TO STDOUT piped)
```

Data-sources routes today: `GET /`, `POST /preview`, `POST /` (202), `GET /:dataSourceId`, `DELETE /:dataSourceId` (204 / 409), `GET /:dataSourceId/records`, `GET /:dataSourceId/download`, `GET /:dataSourceId/imports`, `POST /:dataSourceId/imports` (202 / 409), `GET /:dataSourceId/imports/:importId`.
Migrations: `init_auth`, `allow_many_orgs_per_owner`, `add_apis_and_data_sources` (+ hand-written partial index & CHECKs), `slim_records_constraints`, `records_external_id_byte_order` (hand-written: `external_id COLLATE "C"`), `import_estimated_rows`, `api_design`, `api_design_plain_json`, `api_tokens`, `api_tokens_checks` (hand-written CHECKs: revoked ⇔ no copy, hash/hint format, published ⇒ published_at).

Frontend `src/`: `auth/` (AuthProvider with statuses loading/authenticated/anonymous/**unreachable**, RequireAuth, RedirectIfAuthed),
`lib/api.ts` (`apiFetch`, `ApiError`, `toApiError`, authApi, organizationsApi, dataSourcesApi, apisApi), `lib/upload.ts` (XHR + progress + abort),
`lib/preview-sample.ts`, `lib/use-request.ts` (key-tagged, stale-answer safe, refetchOnFocus, quiet `refresh`), `lib/use-polling.ts` (pauses in hidden tabs),
`lib/imports.ts`, `lib/feed-types.ts`, `lib/api-slug.ts`, `lib/use-file-preview.ts`; pages: Login, Signup, Brands, CreateBrand, Brand, **CreateApi** (wizard), **Api** (frame; tabs in `components/apis/api-page/` + `components/apis/data/`), NotFound;
`components/apis/` (ApiCard, DataSourceList, FeedTypeIcon, ImportStatus, `wizard/*`, **`design/*`**: DesignTab, ResponseFields, field-controls, RequestEditor, PreviewPanel; **`test/*`** (4.6/4.7): TestTab (shares token list + ids box), TokensCard (useShownTokens, HeaderStyle), TokenDialogs, ExpiryPicker, CallCard, SelfCheckCard, result-bits; `api-page/` PublishButton + UnpublishDialog; context `readinessChanged/readinessTick`), AuthLayout, UserMenu, AppLayout, CopyButton, PageStates…; `lib/design.ts` + `lib/use-design-checks.ts` (Design tab helpers/hooks); `lib/tokens.ts` (expiry choices / looks, 4.6); `lib/testing.ts` (ids box, self-check headline), `lib/clipboard.ts`, `lib/use-tokens.ts` (4.7); `tokensApi` + `testingApi` in `lib/api.ts`
Lint rule: component files export only components (helpers live in `lib/`).

## 7. Tests (all passing at handoff)

| Script (`docs/test-scripts/`) | Checks |
|---|---|
| `phase-01-task-1.4-auth.sh` | 44 (**stops/starts Postgres briefly**; deletes ALL users in its DB) |
| `phase-01-task-1.5-organizations.sh` | 53 with `LOG_FILE=…` (52 without: log section skipped); deletes ALL users in its DB |
| `phase-02-task-2.2-preview.sh` | 53 (own test users only) |
| `phase-02-task-2.3-import.sh` | 56 (own test users only) + manual crash test (see phase doc 11c) |
| `phase-03-task-3.1-feed-schemas.sh` | 45 (own test user) |
| `phase-03-task-3.2-response-design.sh` | 69 (own test users) |
| `phase-03-task-3.8-end-to-end.sh` | 33 (own test users; the whole Phase 3 journey) |
| `phase-03-task-3.6-data-guard.sh` | 24 (own test user) |
| `phase-03-task-3.7-design-lib.test.ts` | 26 (frontend helpers; `cd frontend && npx tsx ../docs/test-scripts/…`) |
| `phase-03-task-3.5-preview.sh` | 38 (own test users) |
| `phase-03-task-3.4-request-design.sh` | 51 (own test user) |
| `phase-03-task-3.3-value-types.sh` | 34 (own test users; needs `npx tsx` + `pg` from backend/) |
| `phase-02-task-2.5-apis.sh` | 87 (own test users only; small files) |
| `phase-04-task-4.8-load-and-races.mts` | 41 (`cd backend && npx tsx ../docs/test-scripts/…`; needs `/tmp/products-500k.csv` + `/tmp/products-500k-eur.csv`; ~2 min; env `API`, `DB_URL`) |
| `phase-04-task-4.8-busy-503.sh` | 5 (starts + stops its OWN backend on `BUSY_PORT`, default 4100) |
| `phase-04-task-4.8b-recent-calls.sh` | 51 (own test users; adds + drops a temporary trigger to count saves) |
| `phase-04-task-4.8c-recent-calls-lib.test.ts` | 21 (`cd frontend && npx tsx ../docs/test-scripts/…`) |
| `phase-04-task-4.9-end-to-end.sh` | 53 with `LOG_FILE` (52 without); the whole Phase 4 journey |
| `phase-05-task-5.0-mcp-discovery.mjs` | read-only qa3 MCP discovery (`JIVOX_MCP_KEY=…`; refuses write tools) |
| `phase-05-task-5.1-agents-db.test.mts` | 37 (`cd backend && npx tsx ../docs/test-scripts/…`; rolled back + its own race rows deleted) |
| `phase-05-task-5.3-contract-lib.test.ts` | 24 (`cd backend && npx tsx …`; Jivox's Sample A + B reproduced exactly) |
| `phase-05-task-5.3-contract.sh` | 30 (own fake MCP on `FAKE_PORT` 4792; sends the contract's sample_request to live /v1) |
| `phase-05-task-5.4-checklist.sh` | 29 (own fake MCP on `FAKE_PORT` 4793) · `…-checklist-lib.test.ts` 4 |
| `phase-05-task-5.5-edit-scenarios.sh` | 31 (two agents; every API / token / agent change; own fake MCP on 4794) · `…-agents-lib.test.ts` 20 (`cd frontend`) |
| `phase-05-task-5.6-design-vs-agents.sh` | 62 (save guard, out of date, validation + DB, races, 20 agents, 5 lakh rows; own fake MCP on 4796; `SKIP_BIG=1` skips the 500k part, ~25 s with it) · `…-shape-lib.test.ts` 33 (`cd backend`) |
| `phase-07-task-7.1-db.test.mts` | 26 (`cd backend && npx tsx …`; rules rolled back, trimming rows deleted) |
| `phase-07-task-7.2-call-log.sh` | 36 (every /v1 call in the log; secrets; sizes; no ETag/304; 200 parallel; newest 500; deleted API; starts ITS OWN backend on `SHUT_PORT` 4101 for the shutdown check) |
| `phase-07-task-7.5-logs-lib.test.ts` | 24 (`cd frontend`; filters ⇄ address, line text, switch lines, check lines) |
| `phase-07-task-7.6-switches-lib.test.ts` | 13 (`cd frontend`; ends in, who gets it, banner lines, per-agent split, form checks) |
| `phase-07-task-7.4-switches.sh` | 50 (`SKIP_SWEEP=1` → 49, skips the 30 s sweeper wait): every switch, options, scope, order, own checks + contract untouched, expiry, Renew, races |
| `phase-07-task-7.3-logs-api.sh` | 45 (filters, pages, Renew = same name / new id, curl re-run gives the same data, other account 404, Clear race, 20 000-row speed) |
| `phase-07-task-7.2-queue-lib.test.mts` | 14 (`cd backend`; the queue with a fake writer: DB away / back, 5 000 cap, refused rows; request-check edge cases) |
| `phase-06-task-6.7-end-to-end.sh` | 21 with `LOG_FILE` (20 without); the Phase 6 journey, two fake Jivox servers on `FAKE_PORT` 4807 + 4808 |
| `phase-06-task-6.6-hyphen-keys.sh` | 15 (response keys Jivox can read; the live case of a key saved with "-"; own fake on 4805) |
| `phase-06-task-6.5-jivox-ui-lib.test.ts` | 9 (`cd frontend`; chip states + wording) |
| `phase-06-task-6.4-endpoints.sh` | 40 (41 with `SLOW=1`: the 60 s timeout) against the fake on `FAKE_PORT` 4802 · `…-answers-lib.test.ts` 25 (`cd backend`) |
| `phase-06-task-6.3-actions-db.test.mts` | 43 (`cd backend && npx tsx …`; rules rolled back, library rows deleted; marks EVERY running action interrupted, like a restart) |
| `phase-06-task-6.2-fake-writes.sh` | 32 (the fake's submit / list / activate against our real /v1; own fake on `FAKE_PORT` 4801; `phase-06-mcp-call.mjs` = one MCP tool call, key from `MCP_KEY`) |
| `phase-06-task-6.0-deploy.sh` | 19 against a PRODUCTION server (`BASE=…`; a build on :4300 or the Render address; `SKIP_LIMIT=1` → 15) · `…-deploy-lib.test.ts` 10 (`cd backend`) |
| `phase-05-task-5.7-end-to-end.sh` | 43 with `LOG_FILE` (42 without); the whole Phase 5 journey, two own fake MCP servers on `FAKE_PORT` 4798 + 4799; `KEEP=1` keeps the account |
| (5.3 / 5.4 / 5.5 scripts) | their `save` helper confirms `AGENT_FIELDS_DROPPED` automatically (`confirm_drops`) since 5.6 |
| `phase-05-task-5.2-agents.sh` | 57 with `LOG_FILE`; starts + stops its OWN fake Jivox MCP server (`phase-05-fake-jivox-mcp.mjs`, `FAKE_PORT` default 4791) |
| `phase-04-task-4.7-testing-lib.test.ts` | 13 (frontend helpers) |
| `phase-04-task-4.6-tokens-lib.test.ts` | 25 (frontend helpers; `cd frontend && npx tsx ../docs/test-scripts/…`; also run with `TZ=…`) |
| `phase-04-task-4.5-try-and-self-check.sh` | 41 (own test users; backend's PUBLIC_BASE_URL must reach itself) |
| `phase-04-task-4.4-publish.sh` | 37 (own test users) |
| `phase-04-task-4.3-v1-endpoint.sh` | 59 (own test user; real Publish; `LOG_FILE=…` adds 4 log checks) |
| `phase-04-task-4.3-v1-big.sh` | 3 (timing on `/tmp/products-500k.csv`; avg ~100 ms per 100-id call) |
| `phase-04-task-4.2-tokens.sh` | 65 (own test users; `LOG_FILE=/tmp/api-platform-backend.log` adds the no-token-in-logs check) |
| `phase-04-task-4.1-tokens-db.test.mts` | 39 (`cd backend && npx tsx ../docs/test-scripts/…`; one transaction, rolled back) |
| `phase-02-task-2.4-browse-download-delete.sh` | 98 (own test users only; needs `/tmp/products-500k-eur.csv`, see its header; expects `DOWNLOAD_CONCURRENCY=4`) |

Run: `DB_URL="postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev" bash docs/test-scripts/<script>` (backend running).
Big files (not committed, in `/tmp`): `python3 docs/test-data/generate-big-csv.py 500000 /tmp/products-500k.csv`
(+ `sed 's/,USD,/,EUR,/' /tmp/products-500k.csv > /tmp/products-500k-eur.csv` for 2.4, `/tmp/products-1.1m.csv` 1 100 000 rows, `/tmp/too-big.csv` 206 MB, `--bad-row 400001`, `--duplicate-at 300001`; commands at the top of each script).
Small fixtures: `docs/test-data/csv/` (28 files). After heavy testing: `psql … -c "VACUUM records"`.

## 8. Gotchas learned (don't repeat)

- Prisma 7: `migrate dev` doesn't run `generate`; P2002 constraint name is in `err.meta.driverAdapterError.cause.constraint.index`; interactive transactions time out after **5 s** by default.
- pg adapter sends timestamps without a zone → connections forced to **UTC** (`options: '-c timezone=UTC'`).
- Right after a big COPY, Postgres stats are stale → nested-loop plans can take minutes: `ANALYZE records` before big compares + `SET LOCAL enable_nestloop = off`.
- FK checks dominate bulk-insert time (records has ONLY the composite FK on purpose).
- Zod: clean first then check: `z.string().trim().toLowerCase().pipe(z.email())`.
- multer 2 default file-name charset is latin1 → `defParamCharset: 'utf8'`.
- csv-parse reads ahead: estimate progress from the last *consumed* row's `info.bytes`.
- Vite silently moves to the next port if 5173 is taken (user's copy) → use `--port 5174 --strictPort`.
- CSS grid + long monospace text → `grid-cols-1` (`minmax(0,1fr)`) or the page scrolls sideways on phones.
- Browser-pane clicks don't land in an emulated (scaled) viewport: click at the pane's real size.
- Test scripts must find fixtures relative to the script (`SCRIPT_DIR`) and fail fast if the backend is down.
- `LIKE 'abc%'` can't use a normal index under `en_US` collation → `records.external_id` is `COLLATE "C"` (hand-written migration; Prisma can't express it and sees no drift).
- An import is "succeeded" **before** its old version's rows are deleted (~1–2 s later). Anything deleting records must lock the data source row first (`deleteGeneration`), else deadlock (P2034). Tests must wait for the clean-up before counting rows.
- `COPY` can't take `$1` parameters: escape with `client.escapeLiteral`. Postgres CSV output = minimal quoting, LF → a normal CSV downloads byte-identical.
- Prisma `deleteMany` with a relation filter (`imports: { none: … }`) is ONE `DELETE … WHERE NOT EXISTS` statement (checked with `log: ['query']`).
- Lock order: API row FOR UPDATE → data source row FOR SHARE (design save, PATCH dataSourceId). The import switch UPDATEs the data source row, then reads designs. Any new code touching both must keep this order.
- JSONB reorders object keys: map stored JSON to a fixed key order before answering.
- Type rules live ONCE as pattern strings in `design/convert.ts`, used by JS and by Postgres: only `[0-9]` and explicit ASCII spaces (no `\d`/`\s`), or the two engines disagree. Test E of 3.3 compares them.
- Prettier has no config file: run it with `--single-quote --print-width 100` (defaults rewrite to double quotes).
- macOS grep: no `\|` in basic regex → `grep -E '(a|b)'`. tsx `-e`: no top-level await (wrap in an async IIFE).
- `apis.design` is `json` (not jsonb) on purpose: jsonb re-sorts keys; request templates must keep their order. Use `json_*` functions / `::jsonb` casts in SQL.
- Test scripts: a 400 check can pass for the wrong reason (invalid JSON is 400 too): also check `.error.code`.
- API slugs need ≥ 3 characters: a test API named "b" silently isn't created → check create answers in ad-hoc scripts.
- Toggling between views of different heights (GET/POST, form/JSON): keep the card's tallest min-height + restore the clicked control's screen position (RequestEditor `holdPosition`), or the page jumps.
- R10: a value that doesn't fit its field's type is SENT AS WRITTEN by default (`onMismatch: send`); `default` = strict. Missing in old designs = send.
- Long option lists (columns): use `components/SearchSelect.tsx`, NOT a native `<select>` (macOS menu grows while scrolling) and NOT Radix Select item-aligned (2.6). Short fixed lists may stay native.
- `<fieldset>` is min-content wide by default: give it `min-w-0` when it holds long names (or the page scrolls sideways on phones).
- Login return page: `lib/last-user.ts` (sessionStorage) + RequireAuth `state.forUser` + RedirectIfAuthed: the remembered page is reopened only for the same user.
- Frontend router is a data router (`createBrowserRouter` in main.tsx) only for `useBlocker`; pages are still `<Routes>` in App.tsx.
- Design tab draft rules: the page keeps itself mounted after a rename (`state.apiRenamed`), a draft resets when `api.id` changes, the preview key includes feed type + data version.
- Browser tool: screenshots lag on an emulated viewport; read the DOM (javascript_tool / read_page) to verify, set `<select>` values with the native setter + `change` event.
- Column names never need to match Jivox names (R9): any data column → any Jivox field.
- macOS bash 3.2: JSON written with `\"` inside `"$( … )"` gets brace-expanded at commas → build it in a variable first.
- Frontend browser tests: hand files to the real `<input type=file>` with `DataTransfer` + a `change` event; set React inputs with the native value setter + `input` event. The browser pane often resizes: re-apply the viewport or use preset "desktop" (≈362 px wide = a phone test).
- Every new frontend grid that can hold wide content needs `grid-cols-1` (found again in 2.6).
- Dialogs/panels opened from menus or rows (not Radix triggers) must return focus themselves (`onCloseAutoFocus` → the opener).
- Browser tests: don't click twice in one JS task (React hasn't re-rendered); measure UI timing with a MutationObserver, not a polling loop (the pane may be unfocused → timers slowed).
- `prisma migrate dev` stops for confirmation (non-interactive here) when a change needs one: generate the SQL with `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` into a new migration folder, then `npx prisma migrate deploy` + `npx prisma generate`.
- Node's `fetch` refuses some ports outright ("bad port", e.g. 4190, 6000, 6665-6669): pick test ports outside that list.
- Test scripts: grep for token parts with `grep -cF -e "$part"` (a token can start with `-`). Postgres' `pg_stat_user_tables` counters update lazily: count writes with a temporary trigger instead.
- Long option lists (columns: up to 200): use a native `<select>`, not the shadcn/Radix Select (its default "item-aligned" mode grows/jumps while scrolling; found by the user in 2.6).
- Busy/limit errors are **429** (warn log); 503 means "something is down" (health) and logs as ERROR.
- Heavy testing leaves millions of dead rows; autovacuum running mid-test can slow one call → `VACUUM records`.
- `backend/.env` needs `TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`) or the server won't start (Phase 4). The user's copy needs its OWN key.
- DB rule: `status='published'` requires `published_at` → test scripts that fake publishing must set both. Since 4.4 use `POST …/publish` (needs design + active token); only 2.5 / 3.2 still fake it on purpose.
- Backend `.ts` tests inside `docs/` must be `.mts` (top-level await; `docs/` isn't an ES-module package) and load `pg` with `createRequire` from `backend/package.json`.
- Shell `ls` is aliased to eza (colour codes in output): use `/bin/ls` in scripts / `$(…)`.
- Parallel curl helpers: write bodies to a separate folder; `cat result-*` must not match JSON bodies (no trailing newline → lines glue together).
- `node -e … "$x"` with a negative number: add `--` before it or node treats `-1` as an option.
- EXPLAIN checks on tiny tables: Postgres may rightly seq-scan; use `SET LOCAL enable_seqscan = off` to test that an index CAN serve a query.
- `/v1` errors are contract envelopes (never the app's `{error:{…}}`): it has its own error handler; anything new under `/v1` must throw `V1Error`.
- /v1 reads the active generation INSIDE the rows statement (`generation = (SELECT active_generation …)`); reading it in an earlier query can return 'nothing' during a replace (old rows deleted ~1 s after the switch).
- Test scripts that remember tokens for the log check: keep only `^rtk_[A-Za-z0-9_-]{43}$` lines.
- Self-check calls /v1 over HTTP at PUBLIC_BASE_URL: if that points somewhere else (a tunnel to another machine), the live checks test THAT server.
- Browser pane: React inputs ignore `form_input`; click the field and `type` instead. A ref from `find` must be used AS RETURNED and right away (layout shifts after Show etc. move elements: a stale ref clicks something else). Scripted `.click()` is fine for flows; clipboard needs a REAL click.
- Copy-to-clipboard after an `await` fails in Safari: start the write in the click with `navigator.clipboard.write([new ClipboardItem({'text/plain': promise})])` (TokensCard).
- Focus fallback after a list reload: check `document.activeElement` in an effect on the new data (after React commits), not when the request promise resolves.
- A Radix Popover opened by state (PopoverAnchor, no Trigger) needs its own `onCloseAutoFocus` → the button, or focus falls to the page and the next Escape can be swallowed.
- Browser tests: never type values from memory (emails, slugs): read them from the setup output / scratch files first.
- Statistics after a big import: the import runs `ANALYZE records` BEFORE the switch (first upload too, and after a merge's carry-over). Without it /v1 read all 500 000 rows per call (735 ms vs 1 ms) and bursts ran the pool dry. Any new code that bulk-writes records must do the same before making them live.
- `/v1` overload (no DB connection within 3 s) = 503 SERVICE_BUSY + Retry-After, never 500 (`isBusy` in v1.routes.ts).
- Bash scripts that start a server in the background: never use a bare `wait` (it waits for the server too); collect `$!` of the jobs to wait for. Stop only the PID listening on the port you started.
- macOS has no `timeout` command; zsh treats `==` in `[ ]` specially (put multi-line test commands in a bash file).
