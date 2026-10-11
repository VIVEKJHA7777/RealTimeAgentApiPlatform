# Phase 2: APIs and Their Data

**Status:** In progress (2.1–2.3 built)
**Roadmap:** [../ROADMAP.md](../ROADMAP.md) · **Big picture:** [../PLAN-v2-api-first.md](../PLAN-v2-api-first.md)
**Backend rules:** [../ARCHITECTURE.md](../ARCHITECTURE.md) (routes → controller → service, errors with `cause`)
**Depends on:** Phase 1 (login, brands, `requireOrganization`)

> **Updated 2026-10-10 (your requirements during 2.1):**
> 1. Files with **500 000 rows (5 lakh)** must work → streaming, background import jobs with
>    progress, versioned data ("generations"), limits raised to 1 000 000 rows / 200 MB.
> 2. **More sources later** (Google Sheets, JSON…) without touching existing code → a
>    **source connector** design: each source is one plug-in file; everything else is shared.

---

## 0. Progress tracker

> ✅ = built and verified end to end (task 2.8, by Claude) · 🔨 = built, waiting for checks · ⬜ = not started

| # | Task | Side | Status |
|---|---|---|---|
| 2.1 | Database: `data_sources`, `data_imports`, `records`, `apis` (+ hand-written safety rules) | Backend | ✅ |
| 2.2 | **Source connectors** (interface + registry) + **CSV connector** (streaming) + upload to a temp file + **preview** endpoint | Backend | ✅ |
| 2.3 | **Import engine** (source-agnostic background job): validate while streaming, write a new generation fast, switch atomically, progress, merge/replace, recovery after a restart (+ create / start import / import status endpoints) | Backend | ✅ |
| 2.4 | Data sources: list, open, browse rows (fast pages + id search), **streaming download**, delete | Backend | ✅ |
| 2.5 | APIs: create, list, open, change (name, slug, feed type, data source), delete (linked to a data source) | Backend | ✅ |
| 2.6 | Frontend: "APIs" on the brand page + **Create API wizard** (details → data, upload progress + import progress) | Frontend | ✅ |
| 2.7 | Frontend: **API page** with tabs; **Data tab** (table, search, pages, download, new version with progress) + edit / delete API + delete data | Frontend | ✅ |
| 2.8 | End-to-end check (two brands, edge-case files, **500 000-row file**, races) + docs | Both | ✅ |

---

## 1. Goal (simple words)

Inside a brand, the user **creates APIs**. Each API **answers from a data source**: data the user
uploads while creating the API (a CSV today; Google Sheets / JSON later), or data already
uploaded for another API of the same brand. The user can **see, search, download and replace**
that data, even for files with **500 000 rows**.

```
Brand "Acme Shoes"
 ├── API "Live prices"      (live-prices, product, draft)  ──uses──┐
 ├── API "Product details"  (product-details, product)     ──uses──┤
 │                                                                  ▼
 └── Data source "products.csv"  kind csv · id sku · 7 columns · 500 000 rows · used by 2 APIs
        generation 3 (live) ← the version APIs read
        imports: #3 replace ✓ 500 000 rows · #2 merge ✓ · #1 initial ✓
```

---

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| P2-1 | **Data sources belong to the brand; an API uses exactly one** (several APIs can share one) | Upload once, several APIs send different columns |
| P2-2 | Screens are **API-first** (data uploaded inside "Create API", managed in the API's Data tab) | How you think about the product |
| P2-3 | API slug: chosen (suggested from the name), 3–40 chars, `a-z 0-9 -`, unique **within the brand**, fixed | Readable `/v1/<brand-slug>/<api-slug>` |
| P2-4 | Feed type per API (product · review · store · content), status `draft`/`published` | contract/1 `feed_type`; only published answers Jivox (Phase 4) |
| P2-5 | Cells stored **as text exactly as written**; empty = `null`. **No type guessing** (your decision, 2026-10-11): columns are just names | No data loss; types are chosen per API field in Phase 3 |
| P2-6 | Rows keep their file **position** → downloads come back in the same order | Download = what you uploaded |
| **P2-7** | **Generations (versions):** every import writes a **new generation** of rows; when it's complete and valid, one tiny update switches `active_generation`; the old generation is deleted afterwards | 500 000 rows can't be one quick transaction; readers (and Jivox) always see one **complete** version; a failed import leaves the old data untouched |
| **P2-8** | **Imports are background jobs** (`data_imports` table, run inside our server, no Redis): upload → `202` with an import id → the page polls progress | A 5-lakh-row import takes several seconds; no request should hang that long; progress is visible |
| **P2-9** | **One active import per data source**, enforced by a partial unique index → a second upload at the same moment gets `409 IMPORT_IN_PROGRESS` | Simple, predictable, guaranteed by Postgres |
| **P2-10** | After a server restart, imports left "running" are marked **failed (interrupted)** and their partial generation is deleted | No stuck jobs, no half data |
| **P2-11** | **Streaming everywhere**: upload to a temp file (not memory), read row by row, write with **Postgres `COPY`** (one streamed statement = all-or-nothing; benchmark in 2.3), download streamed | Memory stays small even for 200 MB files |
| **P2-12** | **Limits** (configurable in `.env`): 200 MB, **1 000 000 rows**, 200 columns | Covers 5 lakh with room to spare |
| **P2-13** | **Preview reads only the start of the file** (first 1 000 rows → columns, types, sample, id candidates); the **full** checks (every id present and unique, every row well-formed) run during the import and are reported with row numbers | Previewing a 5-lakh file must be instant |
| **P2-14** | **Source connectors:** a source = one file implementing `preview()` + `readRows()`; registered in one list. Source `kind` is **text** + a JSON `config` (e.g. a sheet URL), **not** an enum | Adding Google Sheets / JSON later = new connector file + one registry line + its upload screen; **no migration, no change** to the import engine, APIs or pages |
| P2-15 | Re-upload modes: **Replace** (default) and **Merge** (add/update, keep rows missing from the file) | Q3 |
| P2-16 | A data source **can't be deleted while an API uses it** (DB-level, 409); deleting an API keeps its data | No API loses its data by surprise |
| P2-17 | An API can only use a data source **of its own brand**, enforced by a composite foreign key | Even a bug in our code can't mix brands |
| P2-18 | The id column is fixed; a new version must contain it (and, from Phase 3, every column an API sends) | Rows are matched by it; APIs mustn't silently break |

---

## 3. Source connectors (the plug-in design)

```
                ┌──────────────── one file per source (plug-ins) ────────────────┐
 upload / config│  csv.connector.ts        (Phase 2)                             │
 ──────────────►│  json.connector.ts       (later)                               │
                │  google-sheet.connector.ts (later)                             │
                └───────────────┬─────────────────────────────────────────────────┘
                                │  every connector offers the same 2 things:
                                │   preview(input)  → { columns, sampleRows, totalRowsHint }
                                │   readRows(input) → rows one by one: { rowNumber, values }
                                ▼
          ┌──────────── shared import engine (never changes per source) ───────────┐
          │ id column present & unique · well-formed rows · problems              │
          │ write new generation in batches · progress · merge/replace · switch     │
          └─────────────────────────────────────────────────────────────────────────┘
                                ▼
                 records (generation N) → APIs read the active generation
```

```ts
// backend/src/modules/data-sources/connectors/connector.ts  (built in 2.2)
export interface SourceConnector {
  kind: string                                   // "csv"
  // Check the settings a source needs (a sheet URL...); files have none.
  configSchema: z.ZodType
  // Fast look at the start of the data: columns + first rows (+ a row count if cheap).
  preview(input: SourceInput): Promise<SourcePreview>
  // Every row, one by one, never all in memory.
  readRows(input: SourceInput): AsyncIterable<SourceRow>
}
// connectors/index.ts: the ONLY place that lists them
export const connectors = { csv: csvConnector /*, json: jsonConnector, google_sheet: ... */ }
```

---

## 4. Database (task 2.1, built)

```
organizations
 ├── data_sources   id, organization_id, name, kind ("csv"), config JSONB, id_column,
 │                  columns JSONB ["sku","price",…] (names), row_count, active_generation, last_import_at
 │                  UNIQUE(organization_id, name) · UNIQUE(id, organization_id)
 │     ├── data_imports  mode (initial|replace|merge), status (queued|running|succeeded|failed),
 │     │                 generation, file_name, file_size, temp_path, processed_rows,
 │     │                 inserted, updated, unchanged, deleted, problems JSONB, error_code,
 │     │                 started_at, finished_at
 │     │                 ⚑ only ONE queued/running import per data source (partial unique index)
 │     └── records       id BIGSERIAL, organization_id, data_source_id, generation,
 │                       external_id, position, data JSONB
 │                       UNIQUE(data_source_id, generation, external_id)
 │                       INDEX(data_source_id, generation, position) · INDEX(organization_id)
 └── apis           name, slug, feed_type (enum), status (enum), data_source_id
                    UNIQUE(organization_id, slug)
                    FK (data_source_id, organization_id) → data_sources  (same brand only; NO ACTION)
```

The composite foreign keys `(data_source_id, organization_id)` on `apis`, `records` and
`data_imports` make it **impossible** (not just forbidden by our code) to connect one brand's
API, rows or imports to another brand's data source.

---

## 5. API endpoints (2.2–2.5 built)

All under `/api/organizations/:slug/…` (`requireAuth` + `requireOrganization`); plus
`requireDataSource` (404 `DATA_SOURCE_NOT_FOUND`) and `requireApi` (404 `API_NOT_FOUND`).

### Data sources

| Method | Path | Body | Success | Main errors |
|---|---|---|---|---|
| POST | `/data-sources/preview` | multipart `file`, `kind` (default `csv`) | `200 { preview: { kind, fileName, fileSize, columns (names), sampleRows[{rowNumber,values}], rowsScanned, totalRows, estimatedTotalRows, idCandidates, suggestedIdColumn, problems[{row,message}] } }` ✔ built | 400 `SOURCE_INVALID` / `FILE_REQUIRED` / `UPLOAD_INVALID` / `UNSUPPORTED_SOURCE` · 413 `FILE_TOO_LARGE` · 415 `UNSUPPORTED_FILE` |
| POST | `/data-sources` | multipart `file`, `idColumn`, `name?` (default: file name), `kind?` | `202 { dataSource, import }` (import runs in the background) ✔ built | 400 `ID_COLUMN_NOT_FOUND` / `SOURCE_INVALID` / `VALIDATION_ERROR` · 409 `DATA_SOURCE_NAME_TAKEN` · 413 · 415 |
| GET | `/data-sources` | – | `200 { dataSources: [{ …, usedBy: [{id,name,slug,status}], latestImport }] }` newest first ✔ built | – |
| GET | `/data-sources/:id` | – | `200 { dataSource }` (same fields as the list) ✔ built | 404 |
| GET | `/data-sources/:id/imports` | – | `200 { imports }` newest 20 (history for the Data tab) ✔ built | 404 |
| GET | `/data-sources/:id/imports/:importId` | – | `200 { import: { status, processedRows, inserted, updated, unchanged, deleted, problems, errorCode, … } }` (polled; `no-store`) ✔ built | 404 `DATA_SOURCE_NOT_FOUND` / `IMPORT_NOT_FOUND` |
| GET | `/data-sources/:id/records?limit&afterPosition` · `?search&afterId` | – | `200 { columns, idColumn, total, records: [{ position, id, values }], next }` ✔ built | 400 `VALIDATION_ERROR` |
| GET | `/data-sources/:id/download` | – | `200 text/csv` streamed, file order ✔ built | 404 · 409 `NO_DATA_YET` · 429 `TOO_MANY_DOWNLOADS` |
| POST | `/data-sources/:id/imports` | multipart `file`, `mode` (`replace` default / `merge`) | `202 { import }` ✔ built | 409 `IMPORT_IN_PROGRESS` · 400 `ID_COLUMN_NOT_FOUND` / `SOURCE_INVALID` |
| DELETE | `/data-sources/:id` | – | `204` ✔ built | 409 `DATA_SOURCE_IN_USE` (lists the APIs) · 409 `IMPORT_IN_PROGRESS` |

### APIs

| Method | Path | Body | Success | Main errors |
|---|---|---|---|---|
| POST | `/apis` | `{ name, slug, feedType?, dataSourceId }` | `201 { api }` ✔ built | 400 · 404 `DATA_SOURCE_NOT_FOUND` (not this brand's) · 409 `API_SLUG_TAKEN` |
| GET | `/apis` · `/apis/:apiSlug` | – | `{ apis }` newest first · `{ api }` (+ `path`, data source summary) ✔ built | 404 `API_NOT_FOUND` |
| PATCH | `/apis/:apiSlug` | `{ name?, slug?, feedType?, dataSourceId? }` | `200 { api, warnings }` ✔ built | 400 · 404 · 409 `API_SLUG_TAKEN` / `API_PUBLISHED` (feed type of a published API) |
| DELETE | `/apis/:apiSlug` | – | `204` (data kept) ✔ built | 404 |

---

## 6. Import, step by step (2.3)

```
POST …/data-sources/:id/imports (file, mode)
  1. file streamed to a temp file on disk (≤ 200 MB, else 413)
  2. INSERT data_imports (status queued, generation = active + 1)   ← partial unique index: 409 if one is active
  3. 202 { import }  ── the browser now polls GET …/imports/:importId every second
  4. background job (same server process):
       status running → connector.readRows(file) row by row
         · check: same number of values as the header, id present, id not seen before
         · collect at most 5 problems (row numbers); too many problems → stop early
         · merge mode: rows not in the file are copied from the active generation
         · write rows into generation N in big batches; update processed_rows now and then
       all good  → one transaction: active_generation = N, row_count, columns, last_import_at,
                   import succeeded (+ inserted / updated / unchanged / deleted)
                 → delete generation N-1 (old version) and the temp file
       any error → import failed (+ problems), delete generation N, delete the temp file
                   (the old version was never touched)
  5. server restarts while running → on start-up: mark failed (INTERRUPTED), clean up
```

---

## 7. Concurrency (whole phase)

| Situation | Result | Guaranteed by |
|---|---|---|
| Same API slug / data source name created twice at once | 1 × success, 1 × 409 | UNIQUE (tested in 2.1 with 10 parallel inserts) |
| Two uploads to one data source at once | 1 × 202, 1 × 409 `IMPORT_IN_PROGRESS` | partial unique index (tested in 2.1) |
| Reading / downloading / Jivox calls during an import | Always the complete old version until the switch, then the complete new one | generations + one-row switch |
| Import fails or server crashes half-way | Old version untouched; partial rows removed | separate generation + start-up recovery |
| Data source deleted while an API is created on it | One of them fails cleanly (404 or 409) | FK `NO ACTION` |
| Different data sources / brands | Fully parallel | locks are per data source |

---

## 8. Frontend (2.6–2.7)

- **Brand page → APIs**: cards (name, `/v1/<brand>/<api-slug>`, feed type, Draft badge, data source + row count, updated).
- **Create API wizard** `/brands/:slug/apis/new`: ① name → slug → feed type ② data: **Upload a CSV** (drop zone → upload progress bar → preview of the first rows, id column with ✓ unique-in-preview → name) **or Use existing data** ③ create → API page; the first import runs with a **progress bar** ("312 000 / 500 000 rows").
- **API page** `/brands/:slug/apis/:apiSlug`: header (name, Draft, URL path + copy, rename, delete) + tabs **Overview · Data** · Design · Test · Contract · Jivox (later phases).
- **Data tab**: summary (kind, file, id column, columns, rows, last import, used by N APIs), table with fast pages + search by id, **Download CSV**, **Upload new version** (Replace / Merge → progress → "12 added · 1 228 updated · 3 removed"), import history.

---

## 9. Tasks in detail

| # | Build | Test |
|---|---|---|
| **2.1** ✔ | Models `DataSource`, `DataImport`, `DataRecord`, `Api`, enums `FeedType`, `ApiStatus`; migration `add_apis_and_data_sources` + hand-written partial unique index and CHECKs | see section 11 (done) |
| **2.2** ✔ | `connectors/connector.ts` (interface), `connectors/index.ts` (registry), `connectors/csv.connector.ts` (`csv-parse` stream: BOM, CRLF, quotes, delimiter detection, UTF-8 check); shared `source-rules.ts`; `multer` disk storage in a temp folder (200 MB); preview endpoint (`requireDataSource` moved to 2.4, where it's first used) | test CSVs in `docs/test-data/` (good, BOM, CRLF, quoted commas/new lines, unicode, empty cells, ragged row, duplicate/empty headers, header only, empty file, not a CSV, 201 MB) |
| **2.3** | `import-engine.ts` (job runner, validation, batch writer, merge/replace, switch, cleanup, progress, start-up recovery); benchmark batched INSERT vs `COPY` and keep the faster | **500 000-row CSV generated by a script**: time + memory; failing row 400 000 → nothing changes; merge vs replace counts; kill the server mid-import → recovery |
| **2.4** ✔ | list (+ usedBy, latest import), get, import history, records (keyset pages + id prefix search), streaming download (Postgres `COPY … TO STDOUT`), delete | paging at row 1 / 499 950; search; download of 5 lakh rows = upload (byte-compare); other brand → 404; delete used/unused |
| **2.5** ✔ | `requireApi`; API CRUD (+ change slug / feed type / data source, decided 2026-10-11) | slug rules; 409 race; other brand's data source → 404; two APIs on one data source; delete API keeps data |
| **2.6** ✔ | APIs section; wizard with upload + import progress; minimal API page | browser: happy path, big file, bad file, slug taken then fixed (no re-upload), double-click |
| **2.7** ✔ | API page as a frame with tab routes, Data tab, edit / delete API, data menu on the brand page | browser: pages, search, download, replace/merge with progress, phone, dark mode |
| **2.8** | full run | verify list (section 12) |

**New packages:** backend `multer`, `@types/multer`, `csv-parse`, `csv-stringify` (+ `pg-copy-streams` if `COPY` wins the 2.3 benchmark). Frontend: shadcn `table`, `tabs`, `select`, `dialog`, `alert-dialog`, `radio-group`, `progress`.

---

## 10. Not in Phase 2

Field selection, keys, types (Phase 3) · request design (Phase 3) · tokens, `/v1`, testing (Phase 4) ·
contracts (Phase 5) · Jivox (Phase 6) · **JSON / Google Sheets connectors** (designed for now,
built later as separate plug-ins) · editing single rows · version history / undo · changing the id column.

---

## 11. Task 2.1: what was built and tested

### Commands log

| # | Where | Command | Why |
|---|---|---|---|
| 1 | `backend/` | *(edit `prisma/schema.prisma`, see Files touched)* | 4 new models + 2 enums |
| 2 | `backend/` | `npx prisma format` · `npx prisma validate` | tidy + check |
| 3 | `backend/` | `npx prisma migrate dev --create-only --name add_apis_and_data_sources` | **Create the SQL without running it**, so we can add rules Prisma's schema can't express |
| 4 | `backend/` | *(append the hand-written block to the new `migration.sql`, see below)* | partial unique index + CHECK constraints |
| 5 | `backend/` | `npx prisma migrate dev` | apply it |
| 6 | `backend/` | `npx prisma generate` · `npm run typecheck` · `npx prisma migrate status` | client rebuilt · clean · up to date |

The hand-written block added to the end of `migration.sql`:

```sql
CREATE UNIQUE INDEX "data_imports_one_active_per_data_source"
  ON "data_imports" ("data_source_id") WHERE "status" IN ('queued', 'running');
ALTER TABLE "data_imports"
  ADD CONSTRAINT "data_imports_status_check" CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed')),
  ADD CONSTRAINT "data_imports_mode_check"   CHECK ("mode"   IN ('initial', 'replace', 'merge'));
ALTER TABLE "records"
  ADD CONSTRAINT "records_generation_check" CHECK ("generation" >= 1),
  ADD CONSTRAINT "records_position_check"   CHECK ("position" >= 1);
ALTER TABLE "data_sources"
  ADD CONSTRAINT "data_sources_row_count_check" CHECK ("row_count" >= 0);
```

### Files touched

| File | Change |
|---|---|
| `backend/prisma/schema.prisma` | **Modified**: relations on `Organization`; new `DataSource`, `DataImport`, `DataRecord` (table `records`), `Api`, enums `FeedType`, `ApiStatus` |
| `backend/prisma/migrations/<timestamp>_add_apis_and_data_sources/migration.sql` | **Created** (generated) **+ hand-written block** at the end |
| `backend/src/generated/prisma/**` | Regenerated |
| `docs/phases/phase-02-apis-and-data.md`, `docs/ROADMAP.md` | Updated for 5 lakh rows + connectors |

### Test results (SQL, against the real database)

| Check | Result |
|---|---|
| API of brand A using brand B's data source | ❌ rejected by `apis_data_source_id_organization_id_fkey` |
| Row of brand A inside brand B's data source | ❌ rejected by `records_data_source_id_organization_id_fkey` |
| Same data source name in two different brands | ✔ allowed |
| 10 parallel APIs with the same slug in one brand | 1 row |
| 10 parallel data sources with the same name in one brand | 1 row |
| 10 parallel **queued imports** on one data source | 1 active; after it finished, a new one was allowed |
| status `banana` / mode `append` | ❌ rejected by CHECK constraints |
| Same id twice in one generation · same id in generations 1 and 2 | ❌ rejected · ✔ allowed |
| Delete a data source used by an API | ❌ rejected (FK NO ACTION) |
| Delete an unused data source | ✔ (its rows and imports cascade) |
| Delete a whole brand (APIs + data + rows + imports together) | ✔, 0 left (NO ACTION is checked at the end of the statement) |

**500 000-row test** (7 columns per row, generated inside Postgres; each time includes ~35 ms of `psql` connection overhead):

| Operation | Time |
|---|---|
| Insert 500 000 rows (one SQL statement, inside the DB) | 8.4 s |
| Table + indexes size | 148 MB |
| **Look up 100 ids** (what Phase 4's API does per call) | **46 ms**, using the unique index |
| First page (50 rows by position) | 41 ms |
| Last page with `OFFSET 499950` | 132 ms |
| Last page with keyset (`position > 499950`) | 41 ms → we'll use keyset paging |
| Count rows | 72 ms |
| Switch the active generation | 38 ms |
| Delete a whole old generation (500 000 rows) | 340 ms |

Takeaways: lookups and pages stay fast at 5 lakh rows; the import's cost is in **getting rows
into the DB** (8.4 s even from inside Postgres), so 2.3 will benchmark batched `INSERT` against
`COPY` from our server and pick the faster.

### Notes

- **Why `--create-only`:** Prisma can't describe a *partial* unique index or a CHECK constraint in
  `schema.prisma`, but a migration is just SQL: create it, add our lines, then apply it. Prisma
  keeps them (it compares the schema, not hand-written extras). Never edit a migration **after**
  it has been applied.
- **Why `NO ACTION` instead of `RESTRICT` for apis → data_sources:** both refuse to delete a used
  data source, but `RESTRICT` checks immediately, which would break deleting a whole brand (the
  cascade may reach the data source before the API). `NO ACTION` checks at the end of the
  statement, when the APIs are already gone.
- **Why `BIGSERIAL` ids for rows:** bulk inserts don't need ids from our code, and 500 000+ rows fit easily.
- **Why the model is `DataRecord`:** `Record` is a built-in TypeScript type name.

---

## 11b. Task 2.2: what was built and tested

### Commands log

| # | Where | Command | Why |
|---|---|---|---|
| 1 | `backend/` | `npm install multer csv-parse` · `npm install -D @types/multer` | uploads (v2) · CSV parsing (v7) |
| 2 | scratchpad | a throw-away script feeding tricky text to `csv-parse` | confirm BOM / CRLF / quotes / line breaks / ragged rows / broken quote behaviour and its error shape before building on it |
| 3 | `backend/` | *(create/edit the files below)* | |
| 4 | `backend/` | `npm run typecheck` | clean |
| 5 | `api-platform/` | `python3 docs/test-data/generate-big-csv.py 500000 /tmp/products-500k.csv` (and `1100000 /tmp/products-1.1m.csv`) | big test files (26 MB / 57 MB; not committed) |
| 6 | `api-platform/` | `python3 -c "f=open('/tmp/too-big.csv','w');f.write('sku,blob\n');[f.write('X,'+'a'*1000+'\n') for _ in range(215000)]"` | a 206 MB file for the size limit |
| 7 | `backend/` | `npm run dev` | |
| 8 | `api-platform/` | `DB_URL="<your db url>" bash docs/test-scripts/phase-02-task-2.2-preview.sh` | **53 checks** → `RESULT: 53 passed, 0 failed` (creates and deletes its own test user only) |
| 9 | `api-platform/` | Phase 1 scripts 1.4 and 1.5 | regression: 44/44 · 53/53 |

**Manual curl version** (after logging in with a cookie jar, see Phase 1):

```bash
curl -b /tmp/jar -X POST localhost:4000/api/organizations/<brand-slug>/data-sources/preview \
     -F "file=@docs/test-data/csv/good.csv"
```

### Files touched

| File | Change | What it does |
|---|---|---|
| `backend/package.json`, `package-lock.json` | Modified (npm) | + `multer`, `csv-parse`, `@types/multer` |
| `backend/src/config/env.ts` | Modified | + `UPLOAD_MAX_MB` (200), `UPLOAD_TMP_DIR` (optional), `IMPORT_MAX_ROWS` (1 000 000), `IMPORT_MAX_COLUMNS` (200), all with defaults |
| `backend/.env.example` | Modified | documents the four new settings |
| `backend/src/modules/data-sources/connectors/connector.ts` | **Created** | The plug-in contract: `SourceInput`, `SourceRow`, `OpenedSource` (`header`, `rows` stream, `progress()`, `close()`), `SourceConnector` (`kind`, `label`, `usesFile`, `fileExtensions`, `open()`), `SourceError` (message + row + code) |
| `backend/src/modules/data-sources/connectors/csv.connector.ts` | **Created** | The only CSV-specific code: reads the first 64 KB to reject binary files (byte 0) and pick the delimiter (`,` `;` tab `\|`), then streams the file through `csv-parse` (BOM, quotes, empty lines); rejects non-UTF-8 text; turns parser errors into "Row N: …"; reports progress by bytes of rows actually used |
| `backend/src/modules/data-sources/connectors/index.ts` | **Created** | The registry: `getConnector(kind)` (unknown → `400 UNSUPPORTED_SOURCE`), `listConnectors()`. **The one line to change when adding a source** |
| `backend/src/modules/data-sources/source-rules.ts` | **Created** (first named `source-analysis.ts`, renamed when type guessing was removed) | Shared, source-independent rules: `normalizeCell` (trim, empty → null), `isEmptyRow`, `checkHeader` (names present, unique ignoring case, ≤ 200 columns), `rowWidthProblem`, `IdCandidateFinder` (columns with a value in every row seen and no duplicates, ranked by name: `id`/`sku`/`item_id` first). **No type guessing** |
| `backend/src/middleware/upload-file.ts` | **Created** | `uploadFile`: multer writing to `<tmp>/api-platform-uploads/<random uuid>.upload` (never the user's file name), 200 MB / 1 file limits, UTF-8 file names; multer errors → `413 FILE_TOO_LARGE` / `400 UPLOAD_INVALID`. `removeUploadedFile()` |
| `backend/src/modules/data-sources/data-sources.schemas.ts` | **Created** | `previewSchema` (`kind`, default `"csv"`) |
| `backend/src/modules/data-sources/data-sources.service.ts` | **Created** | `previewSource(kind, file)`: picks the connector, checks the file (present, extension), opens the source, checks the header, scans the first **1 000** rows (id candidates, problems), keeps **10** sample rows, estimates the total from the byte position, warns above the row limit; always closes the source |
| `backend/src/modules/data-sources/data-sources.controller.ts` | **Created** | `preview`: validate → service → `{ preview }`; deletes the temp file in `finally` (success **or** error) |
| `backend/src/modules/data-sources/data-sources.routes.ts` | **Created** | Router with `mergeParams`; `requireAuth` + `requireOrganization` **before** the upload; `POST /preview` |
| `backend/src/app.ts` | Modified | mounts `/api/organizations/:slug/data-sources` |
| `docs/test-data/csv/*` (22 files) | **Created** | Tricky test files (see the table below); reusable for frontend tests |
| `docs/test-data/generate-big-csv.py` | **Created** | Generates N-row product CSVs; `--duplicate-at` / `--bad-row` for import tests (2.3) |
| `docs/test-scripts/phase-02-task-2.2-preview.sh` | **Created** | The 53-check script |

**How a preview flows through the layers:**

```
POST /api/organizations/:slug/data-sources/preview  (multipart: file, kind)
  requireAuth → requireOrganization          (strangers stop here: no file is written)
  uploadFile (multer)                         file streamed to <tmp>/api-platform-uploads/<uuid>.upload
  controller.preview
    └─ service.previewSource(kind, file)
         getConnector("csv")                  registry
         csvConnector.open(file)              sniff 64 KB: binary? delimiter? → header + row stream
         checkHeader()                        shared rules
         first 1 000 rows → normalizeCell, rowWidthProblem, IdCandidateFinder
         close()                              the rest of a big file is never read
    finally: removeUploadedFile()             temp file deleted, whatever happened
  → 200 { preview }
```

### Test results: 53/53

| Group | What was checked |
|---|---|
| A. Happy path (9) | 7 columns in order; values exactly as written (no type guessing); exact total 12; 10 sample rows; row numbers from 2; suggested id `sku`; no problems; kind + file name |
| B. Tricky but valid (13) | BOM removed; Windows line endings; quoted comma; `""` → `"`; line break inside a cell; row numbers = records (like Excel); Hindi / German / emoji values; **Unicode file name** (`prodüct-हिंदी.csv`); `;` and tab delimiters detected; decimal comma kept as text; spaces trimmed + empty → null; `,,,` rows and empty lines skipped; id candidates (duplicates / empty cells excluded) |
| C. Problems in the data (3) | ragged rows → 200 with "Row 3 has 3 values, but the header has 2 columns"; unclosed quote → "Row 4: a quote (") is opened but never closed" |
| D. Rejected files (13) | duplicate header (any case) and unnamed column → 400 naming them; header only / empty / whitespace-only → 400; PNG renamed `.csv`, `.xlsx`, `.txt` → 415; non-UTF-8 header → 400, non-UTF-8 row → problem; 201 columns → 400; unknown `kind` → 400 `UNSUPPORTED_SOURCE` |
| E. Bad requests (3) | no file → `FILE_REQUIRED`; two files / wrong field name → `UPLOAD_INVALID` |
| F. Access (3) | no cookie → 401, other account → 404, and **no temp file is written** for either |
| G. Big files (7) | **500 000 rows (26 MB): upload + preview ≈ 60 ms**, 1 000 rows scanned, estimate within 10 % (527 348); 1 100 000 rows → "limit is 1,000,000" problem; 206 MB → 413 |
| H. Concurrency (1) | 20 parallel previews of the 26 MB file → 20 × 200 |
| I. Clean-up (1) | upload folder empty afterwards |

Backend memory: **184 MB → 200 MB** after the whole run including 20 parallel 26 MB uploads:
files go to disk and only the first 1 000 rows are ever parsed.

### Problems found while testing, and fixed

1. **Row estimate 17 % too low** (415 797 instead of ~500 000). `csv-parse` reads ahead in the
   background, so its byte counter was ahead of the rows we'd actually taken. Fix: remember the
   byte position of the **last row handed out** (each row's `info.bytes`). Now 527 348 (+5 %).
   The 1.1 M-row file then correctly triggers the limit warning.
2. (Test expectation) `id-candidates.csv`: the `name` column is genuinely unique and complete, so
   it **is** a candidate; `item_id` still ranks first thanks to the name scoring.

### Change after review (2026-10-11): no type guessing

You decided we don't guess column types: data is stored exactly as written, and types are
chosen per API field in Phase 3. Removed `ColumnsTracker` / types; `source-analysis.ts` →
`source-rules.ts` (header checks, cleaning, row width, id candidates only); the preview's
`columns` is now a plain list of names; the schema comment for `data_sources.columns` updated
(no migration: it's JSONB). Test A2 now checks values come back **exactly as written**.
Re-run: **53/53**.

### Notes

- **Why a preview only reads 1 000 rows:** previewing a 5-lakh-row file must be instant. Id
  candidates are therefore "unique in the first 1 000 rows"; the import (2.3) checks **every** row
  and reports duplicates with row numbers.
- **Why the upload middleware comes after the brand check:** otherwise anyone could make the
  server write 200 MB files to disk without logging in.
- **Why random temp file names:** the user's file name never becomes a path (`../../etc/…`
  tricks are impossible) and parallel uploads can't overwrite each other.
- **multer 2 defaults to `latin1` file names:** `defParamCharset: 'utf8'` keeps `prodüct-हिंदी.csv` readable.
- **Adding JSON later:** `connectors/json.connector.ts` implementing `open()` → `{ header, rows }`
  + one line in `connectors/index.ts`. The preview endpoint, header rules and id
  candidates work unchanged.

---

## 11c. Task 2.3: what was built and tested

### Commands log

| # | Where | Command | Why |
|---|---|---|---|
| 1 | `backend/` | `npm install pg pg-copy-streams` · `npm install -D @types/pg @types/pg-copy-streams` | plain Postgres driver + COPY streaming (Prisma can't do COPY) |
| 2 | scratchpad | benchmark: 500 000 rows via batched `INSERT` vs `COPY`, then parse-only, then COPY into a table without indexes/FKs, then with each index/FK | find where the time goes (results below) |
| 3 | `backend/` | *(edit `schema.prisma`: `DataRecord` keeps ONLY the composite FK; drop the org relation and index)* · `npx prisma migrate dev --name slim_records_constraints` | ~2.5 s faster per 5-lakh import (results below) |
| 4 | `backend/` | `npx prisma generate` · `npm run typecheck` · `npm run build` | clean |
| 5 | `api-platform/` | `python3 docs/test-data/generate-big-csv.py 500000 /tmp/products-500k-bad-row-400k.csv --bad-row 400001` and `... /tmp/products-500k-duplicate.csv --duplicate-at 300001` | broken big files |
| 6 | `api-platform/` | `DB_URL="<your db url>" bash docs/test-scripts/phase-02-task-2.3-import.sh` | **54 checks** → `RESULT: 54 passed, 0 failed` (own test users only) |
| 7 | `api-platform/` | the crash test (section "Restart during an import" below), run with **bash** | recovery after `kill -9` |
| 8 | `api-platform/` | scripts 2.2, 1.4, 1.5 | regression: 53 · 44 · 53 |
| 9 | anywhere | `psql "<db url>" -c "VACUUM records"` | optional: reclaims space after many test imports (see notes) |

**Manual curl version:**

```bash
# create a data source from a CSV (answers 202 at once; the import runs in the background)
curl -b /tmp/jar -X POST localhost:4000/api/organizations/<brand>/data-sources \
     -F "file=@docs/test-data/csv/products-v1.csv" -F idColumn=sku -F name=Products
# poll the import (status, processedRows, counts, problems)
curl -b /tmp/jar localhost:4000/api/organizations/<brand>/data-sources/<dataSourceId>/imports/<importId>
# upload a new version (mode=replace is the default; mode=merge keeps rows missing from the file)
curl -b /tmp/jar -X POST localhost:4000/api/organizations/<brand>/data-sources/<dataSourceId>/imports \
     -F "file=@docs/test-data/csv/products-v2.csv" -F mode=merge
```

### Files touched

| File | Change | What it does |
|---|---|---|
| `backend/package.json`, `package-lock.json` | Modified (npm) | + `pg`, `pg-copy-streams`, `@types/pg`, `@types/pg-copy-streams` |
| `backend/prisma/schema.prisma` | Modified | `DataRecord`: only the composite FK `(data_source_id, organization_id) → data_sources`; `Organization.records` relation and `records.organization_id` index removed |
| `backend/prisma/migrations/<ts>_slim_records_constraints/migration.sql` | **Created** (generated) | `DROP CONSTRAINT records_organization_id_fkey`, `DROP INDEX records_organization_id_idx` |
| `backend/src/config/env.ts`, `.env.example` | Modified | + `IMPORT_CONCURRENCY` (default 2) |
| `backend/src/lib/pg-pool.ts` | **Created** | Small `pg` pool used only for COPY (UTC like Prisma) |
| `backend/src/modules/data-sources/import/copy-writer.ts` | **Created** | `CopyWriter`: `open()` (COPY … FROM STDIN), `write()` with backpressure, `finish()` (commit), `abort()` (Postgres rolls back: nothing stored) |
| `backend/src/modules/data-sources/import/import-engine.ts` | **Created** | `runImport(id)`: claim (queued → running), read every row through the connector, checks (row width, missing id, duplicate id, row limit; stop after 5 problems), COPY into generation N, second pass for the **first** row of each duplicate, `ANALYZE` (big compares only), counts + merge carry-over in one transaction with nested loops off, **switch** (one small transaction), delete the old generation; failures → `markFailed` (status, code, problems, remove generation N). Also `findIdColumn`, `markFailed` |
| `backend/src/modules/data-sources/import/import-runner.ts` | **Created** | In-process queue (`IMPORT_CONCURRENCY` at a time), `enqueueImport`, `recoverImports` (at start: interrupted → failed + cleanup, orphan old generations, upload files > 1 h) |
| `backend/src/modules/data-sources/data-sources.schemas.ts` | Modified | + `createDataSourceSchema` (`idColumn`, `name?`, `kind?`), `startImportSchema` (`mode`) |
| `backend/src/modules/data-sources/data-sources.service.ts` | Modified | + `toPublicDataSource`, `toPublicImport` (no temp paths / generations), `findOwnedDataSource`, `checkSourceHeader` (header + id column, synchronous), `createDataSource` (transaction: data source + first import; 409 on name), `startImport` (next generation; 409 `IMPORT_IN_PROGRESS` from the partial unique index), `getImport` |
| `backend/src/modules/data-sources/data-sources.controller.ts` | Modified | + `create` (202), `startImport` (202), `getImport` (`no-store`); `withUploadCleanup` deletes the file if the request fails before the job owns it |
| `backend/src/modules/data-sources/data-sources.routes.ts` | Modified | + `POST /`, `POST /:dataSourceId/imports`, `GET /:dataSourceId/imports/:importId` (`requireDataSource` before the upload) |
| `backend/src/middleware/require-data-source.ts` | **Created** | Data source of THIS brand (via the service) → `req.dataSource`, else `404 DATA_SOURCE_NOT_FOUND` |
| `backend/src/types/express.d.ts` | Modified | + `dataSource?: DataSource` |
| `backend/src/index.ts` | Modified | `await recoverImports()` before listening; shutdown also closes the `pg` pool |
| `docs/test-data/csv/products-v1.csv`, `-v2`, `-v3-new-column`, `-no-sku`, `-duplicate-ids`, `-missing-ids` | **Created** | Versions with known counts |
| `docs/test-scripts/phase-02-task-2.3-import.sh` | **Created** | 54-check script |

**One import, end to end:**

```
POST …/data-sources/:id/imports  (file, mode)
  requireAuth → requireOrganization → requireDataSource → uploadFile (to disk)
  service.startImport: header + id column checked NOW (400 at once if wrong)
                       INSERT data_imports (queued, generation N)   ← 409 if one is active (DB)
  ← 202 { import }                                     browser polls GET …/imports/:importId
  runner (background, max IMPORT_CONCURRENCY):
    engine.runImport
      claim: queued → running
      connector.open(file) → every row: width ✓ id ✓ unique ✓ → CopyWriter.write (COPY stream)
          first problem → stop writing, collect up to 5 → CopyWriter.abort() → failed (nothing stored)
      CopyWriter.finish()                      generation N stored, NOT live
      ANALYZE (if comparing ≥ 10 000 rows)
      tx (nested loops off): counts · merge: carry over untouched rows
      tx: data_sources.active_generation = N (+ row_count, columns) · import succeeded (+ counts)
      DELETE old generation
      finally: delete the temp file
```

### Benchmarks that shaped the design (500 000 rows, 7 columns)

| Measurement | Time |
|---|---|
| batched `INSERT` (5 000 rows/statement) · `COPY` (one stream) | 8.2 s · 8.5 s → **writing method isn't the bottleneck** |
| parse the CSV + build JSON only | **0.76 s** |
| COPY into a table with no indexes and no FKs | 2.0 s |
| real table: 3 indexes + 2 FKs | 7.9 s |
| 3 indexes, no FKs | 3.0 s |
| **2 indexes + only the composite FK** (chosen) | **5.4 s** |

→ The **foreign-key checks** (one lookup per row per key) cost most. The `records → organizations` key
was **redundant** (the composite key to `data_sources` already guarantees the brand, and data sources
are deleted with their brand), so it and its index were dropped. The composite key **stays**: the
database still makes cross-brand mixing impossible. COPY was kept for its all-or-nothing behaviour.

### Test results: 54/54 (+ the crash test)

| Group | Checked |
|---|---|
| A. Create (10) | 202 at once; status queued/running; `hasData false`; no `tempPath`/`generation` in responses; succeeded; counts `5 0 0 0`; DB 5 live rows, generation 1; values as text without the id inside `data`; file order kept; name defaults to file name; id column matched ignoring case (`SKU` → `sku`) |
| B. Rejected at once (6) | same name → 409 `DATA_SOURCE_NAME_TAKEN`; id column not in the file → 400 `ID_COLUMN_NOT_FOUND`; id column missing → 400; bad header → 400; not a CSV → 415; **no data source created** by any of them |
| C. Row problems (6) | duplicate ids → failed `DUPLICATE_IDS`, `"D-1" appears more than once (rows 2 and 4)`; nothing stored; missing ids → rows 3 and 5 named; ragged rows; broken quote |
| D. Replace / merge (9) | replace: **1 added · 1 updated · 3 unchanged · 1 removed**, live data = the file, old version deleted; merge: **1 · 1 · 3 · 0**, removed row kept, 6 rows; merge with a new column → columns `sku,name,price,badge`; replace → exactly the file in its order; new version without the id column → 400; unknown mode → 400 |
| E. Access (3) | other account → 404; unknown data source → 404; another data source's import id → 404 |
| F. **500 000 rows** (4) | **202 in ~60 ms**; succeeded in **6.8–9 s**; 500 000 live; progress visible while running (0 → 30 000 → … → 500 000) |
| G. Broken big files (6) | bad row 400 001 → failed with its row; **readers saw the old 500 000 during the import**; live data and generation unchanged; **no half-written rows**; duplicate at row 300 001 → "rows 2 and 300001" |
| H. Concurrency (5) | 2nd upload while one runs → 409 `IMPORT_IN_PROGRESS`; the running one still succeeds (500 000 unchanged); new upload accepted afterwards; 5 parallel creates with the same name → 1 × 202 + 4 × 409; **3 × 500 000-row imports at once** (2 run, 1 waits) → all succeed (~20 s) |
| J. Deleted mid-import (2) | data source deleted during a 500 000-row COPY → no rows left behind; import + data source gone |
| I. Clean-up (2) | upload folder empty; no rows outside live generations |

**Restart during an import** (by hand, `bash`): first import 5 rows → start a 500 000-row
replace → at 100 000 processed, `kill -9` the backend → while down the import row still says
`running` and **0** rows of its generation exist (COPY never committed) → restart →
`failed INTERRUPTED · The server restarted during the import. Upload the file again.`; live data
still 5 rows / generation 1; temp file removed; log `Recovered after restart {"interruptedImports":1}`;
a new upload is accepted (202).

### Problems found while testing, and fixed

1. **A 500 000 vs 500 000 compare ran for 6½ minutes.** Right after loading, Postgres's statistics
   didn't know about the new rows, so it planned a *nested loop* comparing every new row with
   every old one (250 billion comparisons). Fix: `ANALYZE records` before big compares, **and**
   `SET LOCAL enable_nestloop = off` in the compare/merge transaction (a safety net). Now **0.4 s**.
2. **Prisma's interactive transactions time out after 5 s by default**; a 500 000-row merge
   carry-over takes ~8 s. Fix: explicit `{ maxWait: 10 s, timeout: 10 min }` on that transaction.
3. **A 5-row import took 2 s** after fix 1: the table held 9.7 million deleted rows from tests, which
   made `ANALYZE` slow. Fix: only ANALYZE when comparing ≥ 10 000 rows (small imports: 4–14 ms again).
4. **Data source deleted during an import was logged as an unexpected error.** Fix: detected and
   reported as `DATA_SOURCE_DELETED` (warning), both when COPY hits the missing data source and when
   the switch finds nothing to switch.
5. (Tests) my JSON helper mangled expressions starting with `[`, my `uniq -c` comparison included
   padding spaces, and the progress check was too weak; all fixed. In **zsh**, `kill -9 $PIDS` doesn't
   split the variable into words (bash does), so the first crash test killed nothing; it was redone under `bash`.

### Notes

- **Why every import writes a new generation:** readers (and Jivox later) keep reading the old
  complete version until one tiny update switches `active_generation`. No long locks, no half data.
- **Why COPY gives "all or nothing" without a big transaction:** COPY is one statement; cancelling
  it (or the server dying) rolls the whole statement back.
- **Why the id duplicates need a second pass:** to show *both* rows ("rows 2 and 300001") without
  keeping 500 000 row numbers in memory; only the ids are kept (~50 MB), and the file is re-read
  only when there are duplicates.
- **Why one import per data source at a time:** simple and predictable; enforced by the partial
  unique index from 2.1, so even two servers couldn't start two.
- **Dead rows / disk space:** every replace deletes a whole old generation. Postgres's autovacuum
  reclaims the space over time; after heavy testing run `VACUUM records`.
- **One server process assumed** (recovery marks *all* running imports as interrupted at start). Fine for this project.
- **Shutdown:** `Ctrl+C` doesn't wait for running imports; they're recovered as interrupted on the next start.

---

## 11d. Task 2.4: what was built and tested

**In one sentence:** you can now list a brand's data sources (with the APIs that use them),
open one, page through its rows or search them by id, download them as a CSV, and delete them,
all fast on 500 000 rows and safe when several things happen at once.

### Commands log

```bash
cd backend
# 1. A hand-written migration (Prisma can't express a column collation): ids compared byte by byte
npx prisma migrate dev --create-only --name records_external_id_byte_order
#    → edit prisma/migrations/<timestamp>_records_external_id_byte_order/migration.sql (below)
npx prisma migrate dev                       # applies it
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
#    → "-- This is an empty migration."  = Prisma sees no difference (no drift)
# 2. Code (files below), then:
npx tsc --noEmit
npm run dev
# 3. Tests (second big file, once):
sed 's/,USD,/,EUR,/' /tmp/products-500k.csv > /tmp/products-500k-eur.csv
bash ../docs/test-scripts/phase-02-task-2.4-browse-download-delete.sh
bash ../docs/test-scripts/phase-02-task-2.3-import.sh      # regression (engine changed)
bash ../docs/test-scripts/phase-02-task-2.2-preview.sh     # regression
```

The migration (`migration.sql`):

```sql
ALTER TABLE "records" ALTER COLUMN "external_id" TYPE TEXT COLLATE "C";
```

### Files touched

| File | Change | What it does |
|---|---|---|
| `backend/prisma/migrations/<ts>_records_external_id_byte_order/migration.sql` | **Created** (hand-written) | `external_id` → `COLLATE "C"` so `LIKE 'SKU-12%'` uses the unique index |
| `backend/prisma/schema.prisma` | Modified (comment only) | Explains the collation on `DataRecord.externalId` |
| `backend/src/config/env.ts`, `backend/.env.example` | Modified | + `DOWNLOAD_CONCURRENCY` (default 4) |
| `backend/src/lib/pg-pool.ts` | Modified | Also used for `COPY … TO STDOUT`; `max` = imports + downloads + 1 |
| `backend/src/lib/prisma-errors.ts` | Modified | + `isForeignKeyViolation` (P2003) |
| `backend/src/modules/data-sources/data-sources.schemas.ts` | Modified | + `listRecordsSchema` (`limit` 1–500, `afterPosition` · or `search` + `afterId`; wrong combos → 400) |
| `backend/src/modules/data-sources/data-sources.service.ts` | Modified | + `listDataSources`, `getDataSource` (+ `usedBy`, `latestImport` in one query), `listImports`, `listRecords` (REPEATABLE READ, keyset pages, prefix search with `escapeLike`), `deleteDataSource` (409 in use / import running, race-safe); `startImport`: FK error → 404 (data source deleted a moment ago); `enqueueImport(id, tempPath)` |
| `backend/src/modules/data-sources/download/csv-download.ts` | **Created** | `openCsvDownload`: limit check (429), read-only REPEATABLE READ transaction, 404 / 409 `NO_DATA_YET` before the first byte, `pipeTo(out)`: header row + Postgres `COPY (SELECT …) TO STDOUT WITH (FORMAT csv)` piped with backpressure; always gives the connection back |
| `backend/src/modules/data-sources/data-sources.controller.ts` | Modified | + `list`, `getOne`, `listImports`, `listRecords`, `download` (headers + cancel handling), `remove` (204); `attachmentHeader` (UTF-8 file names) |
| `backend/src/modules/data-sources/data-sources.routes.ts` | Modified | + `GET /`, `GET /:id`, `DELETE /:id`, `GET /:id/records`, `GET /:id/download`, `GET /:id/imports` |
| `backend/src/modules/data-sources/import/import-engine.ts` | Modified | **Deadlock fix:** new `deleteGeneration()` (locks the data source row first) used for the old version and in `markFailed`; old-version clean-up failure no longer marks a succeeded import as failed; `runImport(id, tempPath)` removes the upload file if the import row vanished before it started |
| `backend/src/modules/data-sources/import/import-runner.ts` | Modified | Queue items carry `tempPath` |
| `backend/src/modules/data-sources/connectors/csv.connector.ts` | Formatting only | prettier re-wrapped lines; no code change |
| `docs/test-data/csv/ids-special.csv` | **Created** | Ids with `_ % \` and lower case (search must treat them as plain text) |
| `docs/test-data/csv/tricky-columns.csv` | **Created** | Column names with a comma, quotes, `'); DROP TABLE records; --` and `größe` |
| `docs/test-scripts/phase-02-task-2.4-browse-download-delete.sh` | **Created** | 98-check script |

### How each endpoint works (and why)

```
GET …/data-sources                       one Prisma query: data sources + apis (usedBy) + newest import
GET …/data-sources/:id                   same, for one (requireDataSource did the brand check)
GET …/data-sources/:id/imports           newest 20 imports (history)
GET …/data-sources/:id/records           REPEATABLE READ transaction:
      ?limit=50&afterPosition=100          1. which generation is live?   2. rows of THAT generation
      ?search=SKU-12&afterId=SKU-1299      → both reads see the same moment: a page is never half old / half new
GET …/data-sources/:id/download          slot (max 4) → read-only REPEATABLE READ → 404 / 409 checks
                                         → header row + COPY (SELECT …) TO STDOUT → piped to the browser
DELETE …/data-sources/:id                APIs use it? → 409 · one DELETE … WHERE NOT EXISTS (active import)
                                         → 204 · 0 rows deleted → 409 IMPORT_IN_PROGRESS or 404
```

**Keyset paging vs OFFSET.** `OFFSET 499950` makes Postgres read and throw away 499 950 rows.
"Rows with `position > 499950`, first 50" jumps there through the index: page 10 000 is as fast
as page 1. Positions are 1, 2, 3… without gaps (every import renumbers), so the UI can still
open "page N" directly with `afterPosition = (N − 1) × limit`.

**Id prefix search.** Search is by **id prefix, case-sensitive, sorted by id** (`SKU-12` finds
`SKU-12`, `SKU-120`, `SKU-1299`…). With the database's language rules (`en_US`), Postgres can't
use an index for `LIKE 'SKU-12%'`, so it would read all 500 000 rows. With `COLLATE "C"` it turns
the search into a range on the existing unique index (`SKU-12` ≤ id < `SKU-13`). `_`, `%` and `\`
typed by the user are escaped, so they're plain text, not wildcards. No total count for searches
(counting all `S…` matches would read the whole index); `next` says whether there's more.

**Download.** Postgres writes the CSV itself (`COPY … TO STDOUT WITH (FORMAT csv)`) and Node only
passes the bytes on: 500 000 rows in ~0.4 s, server memory +13 MB. `pipeline()` handles
backpressure (a slow browser pauses Postgres). Values are quoted only when needed (comma, quote,
line break), empty cell = nothing, LF line ends; so a normal CSV comes back **byte for byte**.
Files that were "unusual" come back cleaned: BOM removed, CRLF → LF, `;` → `,`, spaces trimmed,
empty rows dropped (that's how they were stored). COPY can't take `$1` parameters, so column names
(user data!) are escaped with `client.escapeLiteral` (tested with a column named `x'); DROP TABLE records; --`).

**Delete.** Two rules: (1) an API uses it → 409 `DATA_SOURCE_IN_USE` naming the APIs; (2) an
import is queued/running → 409 `IMPORT_IN_PROGRESS`. Rule 2 is inside the DELETE statement itself
(`WHERE … AND NOT EXISTS (active import)`, checked: Prisma sends exactly one statement), so an import
can't slip in between a check and the delete. Rule 1 is checked first (fast, friendly message)
**and** guaranteed by the foreign key `apis → data_sources` (NO ACTION): if an API is created at
the same moment, Postgres makes the delete wait for it and then refuses → also 409.

### Test results: 98/98 (+ 2.2: 53/53, 2.3: 54/54 regression)

| Group | Checked |
|---|---|
| A. List / get / history (10) | empty list; `no-store`; newest first; row count, `hasData`, `usedBy []`, latest import (succeeded / failed `DUPLICATE_IDS`); no internal fields; get one; history `replace,initial`; latest import counts |
| B. Pages (17) | limit 2 → `P-1,P-2`, `next {afterPosition:2}`, `total 5`; values in column order; pages 2 / last / after the end; default limit; data source without data → empty; 8 bad queries → 400; after a merge that added `badge`, old rows show `null` |
| C. Search (10) | `A_` → only `A_1`; `A%` → `A%%,A%1`; `A\` → `A\1`; `a` → `a_1` (case-sensitive); spaces trimmed; no match; 3 pages sorted by id with `afterId` |
| D. Download, small (12) | 6 files **byte for byte** (quotes, new lines in values, unicode, tricky column names); BOM+CRLF → clean; trimmed/empty cells; `;` file → comma CSV; headers (`text/csv`, UTF-8 file name `Größen Liste.csv`, `no-store`); no data yet → 409 `NO_DATA_YET`; merged data downloads its new column |
| E. Access (12) | other account → 404 on list/get/history/records/download/delete; another brand's data source under my brand → 404 ×4; can't delete it; logged out → 401 |
| F. **500 000 rows** (12) | page 1 **4–16 ms**; last page (after 499 950) **3–4 ms**; 500-row middle page **4–6 ms**; search `SKU-04999` **5–7 ms** (50 hits + `next`); 10-hit search; no-match search; EXPLAIN uses the id index; **download byte-identical, ~0.4 s, 27 MB, server memory +13 MB** |
| G. During an import (6) | records show the old version; a slow download (3 MB/s) that started **before** the switch and ended **after** it = exactly the **old** file; a new download = exactly the new file; old version's rows removed afterwards |
| H. Limits (4) | 6 slow downloads at once → 4 × 200 + 2 × 429; cancelled downloads give back slots and DB connections (no COPY left running); next download complete; 429 is the normal JSON error |
| I. Delete (13) | unused → 204, rows + imports gone, again → 404; failed-import data source → 204; `usedBy` names the APIs; used → 409 `DATA_SOURCE_IN_USE` naming both, nothing deleted; **API created at the same moment** → delete waits ~1.5 s then 409; import running → 409 `IMPORT_IN_PROGRESS`, import undisturbed; **delete during the old-version clean-up → 204 (was a deadlock)**; 10 parallel deletes → 1 × 204 + 9 × 404; delete + upload at the same moment → clean end state |
| J. Clean-up (2) | upload folder empty; no rows outside live generations |

### Problems found while testing, and fixed

1. **Deadlock (500, Prisma `P2034`) when deleting right after an import.** An import says
   "succeeded" and *then* deletes the old version's 500 000 rows (~1–2 s). A data-source delete in
   that moment also deletes those rows (cascade), but locks things in the opposite order (data
   source row → records) to the clean-up (records → …), so each waited for the other and Postgres
   killed the delete. Fix: `deleteGeneration()` locks the data source row **first**
   (`SELECT … FOR KEY SHARE`), the same order as a delete; now the delete simply waits for the
   clean-up and returns 204. The script checks this exact moment.
2. **Upload during a delete could answer 500.** If the data source disappeared between
   `requireDataSource` and inserting the import, the foreign key error wasn't handled. Now → 404.
3. **Upload file could be left on disk** if the import row was deleted before its job started
   (e.g. with its brand). The job now gets the file path and removes it.
4. **"Too many downloads" was logged as an unhandled ERROR** with a stack (status 503). It's a normal
   "try again later", so it's now **429 Too Many Requests** (logged as a warning). 503 stays for
   "database down" on `/api/health`.
5. (Tests) one slow-looking last page (254 ms) was autovacuum cleaning 1.5 million dead test rows at
   that moment (the query itself takes 0.4 ms: `EXPLAIN ANALYZE`); a check ran before the old
   version's clean-up had finished (now waits up to 10 s); my fixture expectation missed a row.

### Notes

- **Changed from the plan:** download uses Postgres `COPY … TO STDOUT` instead of `csv-stringify`
  (faster, no new package, one consistent snapshot). Records use `afterPosition` / `afterId`
  (readable, and page N can be opened directly) instead of an opaque cursor.
- **Added (small, needed by 2.7's Data tab):** `GET /data-sources/:id/imports` (history).
- **Search is case-sensitive** (ids like `SKU-1001` are usually typed as shown). Case-insensitive
  search would need an extra index on `lower(external_id)`, i.e. slower imports; add it only if needed.
- **Download format:** always comma-separated, UTF-8 without BOM. Excel on Windows may want a BOM
  for non-English text; a later option, if asked.
- **Downloads hold a DB connection** while streaming (max `DOWNLOAD_CONCURRENCY`, default 4).
  Imports have their own share of the pool, so downloads never block imports.
- **Deleting 500 000 rows takes ~2–4 s** (inside the request). Fine for now; a background delete
  would be the next step if data sources grow much bigger.

---

## 11e. Task 2.5: what was built and tested

**In one sentence:** a brand can now create **APIs** (a name + a URL slug + a feed type + which
data it answers from), list and open them, change any of those later, and delete them, while
the data stays.

### Decisions taken in the review just before (2026-10-11)

| Question | Decision |
|---|---|
| Can the slug change after creation? | **Yes.** The URL changes at once (`/v1/<brand>/<new-slug>`); on a published API the answer carries a warning to make a new contract |
| Can an API switch to other data? | **Yes**, any data source of the same brand (from Phase 3: only if it has the columns the design uses) |
| Feed type editable? | **Yes while draft**; published → 409 `API_PUBLISHED` |
| Live/draft split (old slug keeps working until a new contract is active)? | **Not now** (simple design: changes apply immediately); parked, only if needed |

### Commands log

```bash
cd backend
mkdir -p src/modules/apis
# code (files below), then:
npx tsc --noEmit
npm run dev
bash ../docs/test-scripts/phase-02-task-2.5-apis.sh
bash ../docs/test-scripts/phase-02-task-2.4-browse-download-delete.sh   # regression
```

No new package, no migration (the `apis` table was created in 2.1).

### Files touched

| File | Change | What it does |
|---|---|---|
| `backend/src/modules/apis/apis.schemas.ts` | **Created** | `createApiSchema` (`name`, `slug` 3–50 `a-z 0-9 -` starting with a letter, cleaned first; `feedType` default `product`; `dataSourceId`), `updateApiSchema` (any subset, at least one; unknown fields ignored) |
| `backend/src/modules/apis/apis.service.ts` | **Created** | `createApi`, `listApis`, `findOwnedApi`, `getApi`, `updateApi` (one `UPDATE … WHERE` incl. "still a draft" when the feed type changes; warnings for published APIs), `deleteApi`; `toPublicApi` (+ `path`, data source summary); unique → 409 `API_SLUG_TAKEN`, FK → 404 `DATA_SOURCE_NOT_FOUND` |
| `backend/src/modules/apis/apis.controller.ts` | **Created** | `create` (201), `list` / `getOne` (`no-store`), `update` (200 `{ api, warnings }`), `remove` (204) |
| `backend/src/modules/apis/apis.routes.ts` | **Created** | `GET /`, `POST /`, `GET` / `PATCH` / `DELETE /:apiSlug` (`requireAuth` + `requireOrganization` for all; `requireApi` for one) |
| `backend/src/middleware/require-api.ts` | **Created** | API with this slug **in this brand** (one query) → `req.api`, else 404 `API_NOT_FOUND` |
| `backend/src/types/express.d.ts` | Modified | + `api?: Api` |
| `backend/src/app.ts` | Modified | + `app.use('/api/organizations/:slug/apis', apisRouter)` |
| `docs/test-scripts/phase-02-task-2.5-apis.sh` | **Created** | 85-check script |

### How it works

```
POST  …/apis            validate → data source is THIS brand's? (404) → INSERT
                        UNIQUE(organization_id, slug) → 409 · composite FK → other brand's data impossible
PATCH …/apis/:apiSlug   validate → requireApi → new data source is this brand's? (404)
                        → ONE  UPDATE apis SET … WHERE id = … AND organization_id = …
                                                       [AND status = 'draft'   when the feed type changes]
                        0 rows → re-read: gone → 404 · published → 409 API_PUBLISHED
                        published + new slug / new data → warnings[] in the answer
DELETE …/apis/:apiSlug  DELETE … WHERE id AND organization_id → 204 (data source untouched)
```

Why the "still a draft" rule is **inside** the UPDATE: if it were a separate check ("is it a
draft? → yes → update"), the API could be published between the two steps (Phase 4 adds
publishing). In one statement, Postgres checks and changes together.

A PATCH with several fields is **all or nothing**: a name change sent together with a taken
slug changes nothing (tested).

### Test results: 85/85 (+ 2.4: 98/98 regression)

| Group | Checked |
|---|---|
| A. Create (29) | 201; slug cleaned (`  Live-Prices  ` → `live-prices`); defaults `product` / `draft`; `path` `/v1/<brand>/live-prices`; data source summary; no internal fields; two APIs on one data source; duplicate **name** allowed; same slug → 409 `API_SLUG_TAKEN`; same slug in another brand → 201; 11 bad slugs → 400 (`ab`, 51 chars, `_`, starts with a digit, `--`, hyphen at start/end, space, `é`, empty, a number); name missing / spaces / > 100 → 400; bad feed type → 400; data source missing → 400, unknown / my other brand's / another account's → 404; `status` in the body ignored; invalid JSON → 400; data without a finished import → 201 (`hasData false`); nothing created by refused requests |
| B. List / open (7) | newest first; `no-store`; only this brand; open by slug; unknown → 404 `API_NOT_FOUND`; other case `LIVE-PRICES` → 404; data source `usedBy` lists its APIs |
| C. Change (24) | rename (trimmed, no warnings); slug change → new path, old slug 404, same API; own slug again → 200; taken slug → 409 and **nothing** changed (also not the name sent with it); feed type on a draft; switch data → summary + `usedBy` move; other brand / other account / unknown data → 404, unchanged; empty body / only unknown fields / bad slug / bad feed type / empty name → 400; unknown API → 404; **published:** feed type change → 409 `API_PUBLISHED` (same value → 200), slug change → 200 + warning with the new URL, data switch → 200 + warning, rename → no warning |
| D. Delete (6) | 204; open/delete again → 404; **data kept**; slug free again; data used by APIs → 409; after deleting its last APIs → data deletable |
| E. Isolation (10) | other account → 404 on list / create / open / change / delete, my API untouched; another brand's API slug under my brand → 404; my other brand's API → 404; logged out → 401; the **database** refuses an API linked to another brand's data |
| F. Races (9) | 10 creates with one slug → 1 × 201 + 9 × 409; 5 APIs renamed to one slug at once → 1 × 200 + 4 × 409, exactly one has it; 10 deletes → 1 × 204 + 9 × 404; **create an API + delete its data at the same moment** ×6 → always "API + data kept (409)" or "data gone + 404", seen both ways; switch to data + delete it at once → clean; every API points to data of its own brand |

The server log of the race run shows the **database** made the decisions, not only our early
checks: 16 × unique violation (P2002), 7 × foreign-key violation (P2003: 6 deletes refused because
the API was inserted after the delete's own check, 1 create whose data vanished after its check),
1 × P2025 (the published rule). 0 errors.

### Problems found while testing, and fixed

1. (Tests) **macOS bash 3.2 brace expansion:** a JSON body written with `\"` *inside* `"$( … )"`
   got split at the commas (`{a,b}` is brace expansion) and the server rightly answered
   `INVALID_JSON`. Fix: build the JSON in a variable first (`BODY="{\"name\":…}"`), then pass `"$BODY"`.
2. (Tests) `$(code)` used inside a `sed` in the same pipeline ran before curl finished: read the
   code in a separate step. `good.csv` has 12 rows, not 10.

No code bugs found in this task.

### Notes

- **API names don't have to be unique** in a brand (only slugs, which are the URLs).
- **No random suffix** on API slugs (unlike brand slugs): the brand slug in the URL already makes
  it unique worldwide, and the user wants a readable, chosen URL.
- **Two people editing the same API at once:** each field sent is saved; the last save wins per
  field. Fine for name/slug; Phase 3's design editor will add a version check (P3-12).
- **Phase 4 will add** `publish` / `unpublish`, tokens and the live `/v1` endpoint; until then
  tests set `status = 'published'` with SQL.

---

## 11f. Task 2.6: what was built and tested

**In one sentence:** the brand page now lists the brand's APIs and data, and a 3-step **Create API
wizard** takes you from "I have a CSV" to a working API page that follows the import live.

Design reviewed and approved before building (mockups of the 4 screens; answers: preview from the
first 2 MB · failed import keeps the API with the problems listed · keep the Data list on the brand page).

### Screens

| Screen | What's on it |
|---|---|
| **Brand page** `/brands/:slug` | Header (avatar, name, slug + copy, Create API). **APIs**: cards (feed-type icon + colour, name, Draft, `/v1/…` path + copy, data + rows, live progress bar / "Import failed"). First visit: "Create your first API" with 3 steps. **Data**: list of data sources (rows, columns, id column, "Used by N APIs", import badge). Refreshes every 1.5 s **only while an import runs** |
| **Wizard** `/brands/:slug/apis/new` | Stepper (1 Details · 2 Data · 3 Review; "Step 2 of 3" on phones). **1:** name → slug suggestion (`Live Prices (US) – Été!` → `live-prices-us-ete`) + live `/v1/…` preview + 4 feed-type cards; Next asks the server if the slug is free. **2:** Upload a CSV (drop zone → preview table with the id column highlighted → id column chips / "Other column" → data name) or Use existing data (cards). **3:** summary → Create → upload progress → API page |
| **API page** `/brands/:slug/apis/:apiSlug` | Breadcrumb, feed icon, name, Draft, path + copy, tabs (Overview; Data/Design/Test/Contract "soon"), **import card** (progress → "Imported 500,000 rows in 6 s" or the problems with row numbers), "Getting this API live" checklist, details (data, id column, columns, API ID). Polls every 1 s while importing, stops after |

### How the wizard avoids slow or repeated uploads

```
choose file ──► browser checks: .csv? empty? > 200 MB?            (no request at all)
           ──► preview: only the first ~2 MB (cut at a line end) is sent ──► 0.2 s for a 26 MB file
                rows ≈ file size ÷ average line length of the START + the last 1 MB (read locally)
                → "about 505,953 rows" for a 500,000-row file (start only: 527,326, 5 % off)
Next ──────► problems in the preview? id column empty/repeating in the first rows? → blocked, with the reason
Create ────► 1. upload the WHOLE file once (XMLHttpRequest → progress bar)  POST /data-sources
             2. POST /apis
             if 2 fails (slug taken a moment ago…): the data is kept, the wizard switches to
             "Use existing data: <it>", back to step 1 → fixing the slug never uploads again
```

### Backend changes made for the UI

| Change | Why |
|---|---|
| `data_imports.estimated_rows` (migration `import_estimated_rows`), filled while importing from how far into the file the job is; exact at the end; sent as `estimatedRows` | The progress bar needs a total on the API page and the brand cards, also after a reload |
| API slug `new` reserved (400) | `/brands/:slug/apis/new` is the wizard |
| Upload cancelled by the browser → `400 UPLOAD_CANCELLED` (one warning) instead of `500 INTERNAL_ERROR` | Leaving the page mid-upload is normal, not a bug |
| Request log: "→ closed by the client" instead of "→ 200" when the browser left before the answer | The 200 was a lie (Node's default status) |

### Commands log

```bash
cd frontend
npx shadcn@latest add progress radio-group select --yes   # 3 files in src/components/ui (no new package)
cd ../backend
npx prisma migrate dev --name import_estimated_rows        # + prisma generate
# code (files below), then:
cd ../frontend && npx tsc -b && npm run lint && npm run build
npm run dev -- --port 5174 --strictPort                    # browser tests (the user's copy uses 5173)
bash ../docs/test-scripts/phase-02-task-2.2-preview.sh     # and 2.3 / 2.4 / 2.5 (regression)
```

### Files touched

| File | Change |
|---|---|
| **Frontend** | |
| `src/App.tsx` | + routes `/brands/:slug/apis/new`, `/brands/:slug/apis/:apiSlug` |
| `src/pages/BrandPage.tsx` | Rewritten: header, APIs grid + first-API invite, Data list, polling while importing |
| `src/pages/CreateApiPage.tsx` | **Created**: the wizard (state, checks per step, create flow, error → right step, never re-upload) |
| `src/pages/ApiPage.tsx` | **Created**: minimal API page (header, tabs, import card, checklist, details) |
| `src/components/apis/ApiCard.tsx`, `DataSourceList.tsx`, `FeedTypeIcon.tsx`, `ImportStatus.tsx` | **Created** |
| `src/components/apis/wizard/WizardStepper.tsx`, `steps.ts`, `DetailsStep.tsx`, `DataStep.tsx`, `FileDropZone.tsx`, `SourcePreviewTable.tsx`, `IdColumnPicker.tsx`, `ExistingDataPicker.tsx`, `ReviewStep.tsx` | **Created** |
| `src/components/ui/progress.tsx`, `radio-group.tsx`, `select.tsx` | **Created** (shadcn) |
| `src/lib/upload.ts` | **Created**: `uploadForm` (XMLHttpRequest with progress + abort → same `ApiError`s) |
| `src/lib/preview-sample.ts` | **Created**: `sampleOf` (first ~2 MB at a line end), `rowEstimate` (start + end) |
| `src/lib/api-slug.ts`, `use-polling.ts`, `feed-types.ts`, `imports.ts` | **Created** |
| `src/lib/api.ts` | + `dataSourcesApi`, `apisApi`, `toApiError`, PATCH/DELETE methods |
| `src/lib/api-types.ts` | + `DataSource`, `DataImport`, `SourcePreview`, `Api`, `FeedType`… |
| `src/lib/format.ts` | + `formatNumber`, `formatBytes`, `formatDuration` |
| `src/lib/use-request.ts` | + `refresh()` (quiet reload, used by polling) |
| **Backend** | |
| `prisma/schema.prisma`, `prisma/migrations/<ts>_import_estimated_rows/` | + `DataImport.estimatedRows` |
| `src/modules/data-sources/import/import-engine.ts` | saves `estimatedRows` with the progress, exact at the end |
| `src/modules/data-sources/data-sources.service.ts` | `toPublicImport` + `estimatedRows` |
| `src/modules/apis/apis.schemas.ts` | slug `new` reserved |
| `src/middleware/upload-file.ts` | cancelled upload → `400 UPLOAD_CANCELLED` |
| `src/app.ts` | request log "closed by the client" |
| **Tests** | |
| `docs/test-scripts/phase-02-task-2.3-import.sh` | + cancelled upload leaves nothing; `estimatedRows` exact (56 checks) |
| `docs/test-scripts/phase-02-task-2.5-apis.sh` | + slug `new` / `NEW` reserved (87 checks) |

### Browser test results (Claude, built-in browser; files handed to the real file input with `DataTransfer`)

| Area | Checked | Result |
|---|---|---|
| Brand page | first-visit invite; cards; data list; phone (362 px, no sideways scroll); dark mode | ✔ |
| Step 1 | empty Next → both errors; slug from a name with accents/symbols; taken slug caught **before** upload; error clears when typing | ✔ |
| Step 2: browser checks | no file; `.txt`; empty file; 201 MB file → refused without a request | ✔ |
| Step 2: server checks | header only; duplicate headers; binary file renamed `.csv`; latin-1 file; ragged rows (amber list with row numbers, Next blocked) | ✔ |
| Step 2: **500,000 rows (26 MB)** | preview in **0.2 s** (only the first ~2 MB sent), "about 505,953 rows", id `sku` recommended | ✔ |
| Id column | "Other column" with repeating values → warning, **Next blocked** with the reason; back to `sku` clears it | ✔ |
| Existing data | disabled when the brand has none; cards; choose → review | ✔ |
| Back / forward | stepper back to Details, forward again: name, slug, feed type, file, data name, id column all kept | ✔ |
| Data name taken | caught before upload | ✔ |
| Create | **3 quick clicks → 1 upload + 1 create**; "Uploading 0% → 100% → Creating → created" → API page in 0.35 s | ✔ |
| API page | "Importing … 5%" → "Finishing up…" → "Imported 500,000 rows in 6 s"; polling stops afterwards (0 requests in 3.5 s) | ✔ |
| Live progress on brand page | card + data list: 3% → 35% → 67% → 97% → Finishing… → 500,000 rows | ✔ |
| **Race: slug taken after step 1** | existing data → back to step 1 with the reason; **uploaded file** → data kept, wizard switches to it, retry with a new slug → **1 upload in total** | ✔ |
| Import fails later (duplicate id at row 2001, beyond the preview) | API page: "failed. Nothing was saved." + `row 2,001 "X-1" appears more than once (rows 2 and 2001)`; checklist shows the failure | ✔ |
| Backend down | preview → "Can't reach the server" + Try again (works after restart); Create → toast, stays on Review, button usable; retry → created once | ✔ |
| Leaving during a 145 MB upload | upload cancelled, nothing created, no temp file left | ✔ |
| Not found | wizard for an unknown brand; unknown API (breadcrumb keeps the brand name); unknown brand | ✔ |
| Console | no JavaScript/React errors or warnings (only the expected 404/502 network lines from these tests) | ✔ |

### Problems found while testing, and fixed

1. **Phones: the page scrolled sideways** with a wide file (30 long columns): CSS grid columns grew
   to the table/file name width. Fix: `grid-cols-1` (= `minmax(0, 1fr)`) on the wizard grids (the
   Phase 1 gotcha again); the table now scrolls inside its own box.
2. **Row estimate 5 % high** (first rows are shorter than later ones). Fix: average line length of
   the start AND the last 1 MB → 1.2 % off.
3. **Next did nothing visible** for a file with problems (the message was only shown with the drop zone). Fix: message under the file card, scrolled into view.
4. **Wrong toast** "Your data is saved" when no file had been uploaded (existing data). Fix: only after an upload by this wizard.
5. **Id column that repeats** was only a warning, but its import is certain to fail. Fix: Next blocked with the reason.
6. **Cancelled upload logged as a 500 "unhandled error"** and the request line said "→ 200". Fix: `UPLOAD_CANCELLED` (warning) + "closed by the client".
7. **Progress bar without a total** on the API page / after a reload. Fix: `estimatedRows` from the backend.
8. **Found by you (after delivery): the "Other column" dropdown misbehaved with many columns**
   (20 in `productData - Sheet1.csv`): it scrolled a little, then grew and stopped scrolling. Cause:
   Radix Select's default "item-aligned" mode, which moves/grows the list around the button while
   scrolling. Fix: a **native `<select>`** styled like the chips (the browser draws the list: always
   scrolls with wheel/trackpad/keys, type a letter to jump, phone picker on mobile; `color-scheme`
   for dark mode). File: `components/apis/wizard/IdColumnPicker.tsx`. (`components/ui/select.tsx`
   is no longer used; kept for short lists later.)
9. **Found by you: "Use existing data" ran off the screen** with a 20-column file (the card was 2 358 px
   wide: the radio group is a CSS grid and the one-line column list stretched it; my test data had
   only short columns). Fix: `grid-cols-1` + `min-w-0`, columns shown as 6 chips + "+14 more columns"
   (all names on hover); selected card = filled + ring (clearly different from the hover border).
   **Review step "10 · Id1" was cramped:** now three labelled fields, **Data | Rows | Id column**
   (stacked on phones). Re-tested at 1 100 px and 362 px with 20 columns: no sideways scroll on the
   wizard, the API page or the brand page.
10. Small: "99% · Importing" while the job is switching versions → "Finishing up…"; "in 0 s" → "in under a second"; duplicated error text for binary files; feed-type cards had no accessible name (now `aria-label`); phone: Create API button squeezed the brand name (moved below), choice buttons wrapped ("Upload CSV" / "Existing data" on phones); brand name missing in the breadcrumb of "API not found"; truncated data name without a tooltip; failed import shown as an empty circle in the checklist.

### Notes

- **Why XMLHttpRequest for uploads:** `fetch()` can't report upload progress. `lib/upload.ts` wraps it so
  pages still get the same `ApiError` objects.
- **Why the brand page doesn't poll all the time:** only while an import runs (and paused in hidden
  tabs). An import started from somewhere else shows up on reload / when you come back to the tab.
- **Slug check before upload** uses `GET /apis/:slug` (404 = free). The browser console shows that 404
  as a network line; it's expected.
- **Not built yet (2.7):** Data tab (table, search, download, new version, delete), renaming/deleting
  APIs in the UI. The API page's other tabs say "soon".
- **Bundle size warning** (539 kB, one file): fine for now; code-splitting per page is a Phase 8 (deploy) item.

---

## 11g. Task 2.7: what was built and tested

**In one sentence:** every API now has a real page with tabs; the **Data** tab shows the rows
(pages, jump to any page, id search, a side panel per row), downloads them, takes new versions
(Replace or Merge, with checks before uploading), and keeps an import history; APIs can be
**edited** and **deleted**, and unused data can be deleted from the brand page.

Reviewed before building (sketches): tabs as addresses ✔ · row details panel ✔ · simple delete
confirmation (no typing) ✔ · 25 / 50 / 100 rows per page, 50 by default ✔.

### Screens

| Where | What |
|---|---|
| API page header | **Edit** (dialog: name, slug + "old address stops working" warning, feed type (locked when published), data) and **⋯ → Delete API** (confirmation: the address stops, the data is kept and who else uses it) |
| Tabs | `/apis/:apiSlug` = Overview · `/apis/:apiSlug/data` = Data (Design/Test/Contract "soon"); Back/Forward/reload work; an unknown tab → Page not found |
| Data tab | summary (rows, columns, id, updated, used by N APIs) · **Download CSV** (plain link, streamed) · **Upload new version** (disabled with a tooltip while an import runs) · latest import card (running / failed after the live version / finished in the last 5 min) · rows · import history (20, failed ones open to show all problems) |
| Rows | `#` and the id column stay pinned while scrolling sideways; long values cut with a tooltip; "Rows 101–150 of 500,000"; ‹ Page [ n ] of N › (type a page, Enter); 25/50/100 per page; search by id prefix (300 ms after typing stops; one request); search pages with Previous/Next; state in the address (`?page=3&size=100&q=SKU-12`) |
| Row panel | click a row (or Enter on its id): all columns one under another, copy buttons, long URLs wrap |
| Upload new version | instant preview (same hook as the wizard) + checks: id column present and usable, same/new/missing columns (what Replace vs Merge does with them), preview problems → blocked; Replace / Merge; "also used by …" warning; upload progress; cancel; 409 "an import is already running" shown in the dialog |
| Brand page Data list | ⋯ per data: Download CSV · Delete data (disabled with the reason when APIs use it or an import runs; the server's 409 shown if it changed meanwhile) |

### Commands log

```bash
cd frontend
npx shadcn@latest add dialog alert-dialog sheet tooltip --yes   # 4 files in src/components/ui
npx tsc -b && npm run lint && npm run build
# browser tests on :5174 (backend :4000); backend regression:
bash ../docs/test-scripts/phase-02-task-2.4-browse-download-delete.sh   # 98/98
bash ../docs/test-scripts/phase-02-task-2.5-apis.sh                     # 87/87
```

No backend change, no new package (shadcn parts use `radix-ui`, already installed).

### Files touched (frontend `src/`)

| File | Change |
|---|---|
| `main.tsx` | + `TooltipProvider` |
| `App.tsx` | API page = frame with child routes: index → `OverviewTab`, `data` → `DataTab` |
| `pages/ApiPage.tsx` | Rewritten as the frame: breadcrumb, header + `ApiActions`, tab links (`NavLink`), `<Outlet context>` |
| `pages/CreateApiPage.tsx` | Uses `useFilePreview` (file checks + preview moved out) |
| `components/apis/api-page/context.ts` | **Created**: `useApiPage()` (organization, api, dataSource, refresh) |
| `components/apis/api-page/OverviewTab.tsx` | **Created** (moved from ApiPage) + "Open the Data tab" |
| `components/apis/api-page/ApiActions.tsx`, `EditApiDialog.tsx`, `DeleteApiDialog.tsx` | **Created** |
| `components/apis/data/DataTab.tsx`, `RecordsView.tsx`, `RowDetailsSheet.tsx`, `UploadVersionDialog.tsx`, `ImportHistory.tsx` | **Created** |
| `components/apis/DataSourceActions.tsx` | **Created**: ⋯ menu + delete confirmation |
| `components/apis/DataSourceList.tsx` | + actions column (`brandSlug`, `onChanged` props) |
| `components/apis/ImportStatus.tsx` | `hasOlderVersion`: "The current version is still live, unchanged" for failed new versions |
| `components/apis/wizard/DataStep.tsx` | `UploadState` / `UPLOAD_MAX_MB` from the hook; `formatRows` |
| `components/ui/dialog.tsx`, `alert-dialog.tsx`, `sheet.tsx`, `tooltip.tsx` | **Created** (shadcn) |
| `lib/use-file-preview.ts` | **Created**: browser checks + 2 MB preview + estimate + cancel, shared by wizard and upload dialog |
| `lib/api.ts` | + `dataSourcesApi.records / imports / startImport / remove / downloadUrl`, `apisApi.update / remove` |
| `lib/api-types.ts` | + `RecordsPage`, `ImportMode` |
| `lib/imports.ts` | + `isImportWorthShowing`, `IMPORT_MODE_LABELS`, `findIdColumn` |
| `lib/use-request.ts` | + `keepPreviousData` option |
| `lib/format.ts` | + `formatRows` ("1 row" / "about 505,953 rows") |
| `pages/BrandPage.tsx` | passes `brandSlug` + refresh to the Data list |

### Browser test results

| Area | Checked | Result |
|---|---|---|
| Pages (500,000 rows) | Next → rows 51–100; type page 10 000 → rows 499,951–500,000, Next disabled; page 99 999 → stays on the last page (no extra history step); Back/Forward; 100 per page → "of 5,000"; jump visible after **84 ms** (server 13 ms) | ✔ |
| Search | typing "SKU-04999" → **1 request**; 100 matches; "SKU-049" pages 1→2→3→2 correct ids; refine → page 1; no match → message + Clear; **Back** returns to the page before the search, box emptied; **Forward** restores it | ✔ |
| Row panel | 20 columns, long URL wraps, focus moves in; Escape → focus back on the row's id button | ✔ |
| Upload checks | missing id column / repeating ids / ragged row → blocked with reason; `SKU` matches `sku`; new + missing columns listed, text changes Replace ↔ Merge; "also used by Product details" | ✔ |
| **Replace 500,000 rows** | dialog closes → Importing → Finishing up → "Imported 500,000 rows in 7 s · 500,000 updated"; Upload disabled meanwhile; **table showed the current version (EUR) during the import, the new one (USD) right after** | ✔ |
| Merge | 5-row file → "2 added · 3 updated · 0 unchanged", 500,002 rows; same file again → "5 unchanged" | ✔ |
| Two imports at once | dialog shows "An import is already running…", stays open, button usable again | ✔ |
| Edit | opens with saved values; no changes → closes, no request; invalid slug; taken slug; warning for a new slug; name+slug saved → page moves to `/apis/prices/data` (same tab), old slug 404; feed type → Review (icon + text); data switched → Data tab shows the new data; focus back on Edit | ✔ |
| Delete API | confirmation text (address, data kept); Cancel → still there, focus back on ⋯; Delete → brand page + toast, API 404, data kept | ✔ |
| Data menu (brand page) | used data: Delete disabled + reason; unused: confirm (500,002 rows) → deleted in 1.4 s; Cancel → focus back on ⋯; **race** (API linked from another tab while the dialog is open) → server's 409 message, list refreshed; Download link → `text/csv`, right file name, 11 lines | ✔ |
| Failed first import | failure card + "No data yet" + Download disabled → "Upload a file" with a fixed file → imported, table appears | ✔ |
| Wizard (after the refactor) | .txt / ragged refused; good file → preview + `sku` recommended; typed data name kept when picking another file; create → API page "Imported 1 row" | ✔ |
| Layout | phone (362 px) dark mode: no sideways page scroll, table 2,932 px scrolls inside 328 px with `#`/id pinned; pager fits | ✔ |
| Other | unknown tab → Page not found; Overview link → Data tab; console: no errors/warnings; lint: only the 2 old shadcn warnings | ✔ |

### Problems found while testing, and fixed

1. **Range label didn't match the rows while loading** ("Matches 1–100" over the previous page's
   rows, because old rows stay visible during a load). Fix: the label says "Loading…" until the new page arrives.
2. **Back after a search jumped past the page you were on** (every search step replaced history).
   Fix: starting a search adds one history entry; refining replaces it.
3. **Typing a page beyond the last** added a duplicate history step and left "99999" in the box. Fix: same page → just reset the box.
4. **Keyboard focus was lost** after closing the row panel, Edit, Delete API and Delete data
   (they're opened from rows/menus, not Radix triggers). Fix: focus goes back to the button that opened them.
5. "1 rows" → `formatRows` ("1 row").
6. (Tests, not app bugs) a jump looked like ~1 s because my polling loop was slowed by the browser
   (the pane wasn't focused): measured with a MutationObserver it's 84 ms; two "failures" came from my
   scripts (two clicks in one JavaScript task → React hadn't re-rendered; a variable lost on reload).

### Notes

- **Shared preview code:** the wizard and "Upload new version" use one hook (`lib/use-file-preview.ts`), so both check files the same way.
- **Download** is a plain link: the browser saves the stream; big files never go through JavaScript.
- **Polling:** while an import runs the API page asks for the API + data once a second; it stops when the import ends.
- **Not in 2.7:** editing single rows, undo of a version (out of scope, Phase 2 §10).

---

## 11h. Task 2.8: end-to-end check of Phase 2

Every item of section 12 was checked as a new user in the browser, plus all backend scripts.
Results are in section 12.

### Problem found and fixed

1. **Wrong advice after a crash:** the import card said "Fix the file and upload it again" for an
   import cut off by a server restart, but the file was fine. Now server-side failures
   (`INTERRUPTED`, `INTERNAL_ERROR`) say "Nothing is wrong with the file: upload it again".
   File: `frontend/src/components/apis/ImportStatus.tsx`.

### Notes

- Script 1.5 shows 52 checks without `LOG_FILE` (its log section is skipped by design) and 53 with it.
- Decided by you before 2.8: changing the id column on a new version is **parked** (ROADMAP change log).
- Phase 2 is complete. Next: the **Phase 3 review** (response fields, types, request template).

---

## 12. How to verify the whole phase (done in 2.8)

Run by Claude on 2026-10-11 in the browser (fresh account, `:5174` → backend `:4000`) + all backend scripts.

- [x] Create API "Live prices" by uploading `products.csv` (**500 000 rows**) → API page follows the import → "Imported 500,000 rows in 7 s"
- [x] Create API "Product details" **reusing** the same data (wizard → Use existing data) → brand page "Used by 2 APIs"
- [x] **500 000-row CSV**: preview **58 ms**; import with progress (uploading → creating → importing → finishing up → imported); last page **51 ms**; id search **387 ms** incl. the 300 ms typing pause; **download byte-for-byte identical** to the upload (27 MB, 0.46 s)
- [x] Replace / Merge counts correct (merge: 1 added · 1 updated · 1 unchanged → 500,001 rows); a **broken file at row 400 001 changes nothing** ("The current version is still live, unchanged", row named; download still identical to the original)
- [x] Brand B can't see or open brand A's brand page / API / Data tab / wizard ("Brand not found"); A's list, records, download, API → 404 for B
- [x] Two uploads at once → one 409 (script 2.3 H + browser 2.7); parallel same slug → one 409 (script 2.5 F)
- [x] **Server killed (`kill -9`) during an import** (in the "finishing up" step) → while down the page keeps the old state calmly; after restart: `failed INTERRUPTED`, old data intact (500,001 rows, exactly 500,001 in the table: the half-written version was removed), the page updates by itself, Upload enabled again
- [x] Can't delete data used by an API (menu item disabled with the APIs named); deleting an API keeps its data

Backend scripts (same day): 1.5 **53/53** (with `LOG_FILE`), 2.2 **53/53**, 2.3 **56/56**, 2.4 **98/98**, 2.5 **87/87**.
(1.4 not re-run: it stops the shared Postgres, which would also stop your backend; auth code unchanged since its 44/44.)

## 13. Summary
| | Items |
|---|---|
| Implemented | 2.7 frontend: tabs as addresses, Data tab (pages + page jump, id search, row panel, download, Replace/Merge upload with checks, import history), Edit API, Delete API, Download / Delete data on the brand page · 2.6 frontend: brand page (API cards + data list, live progress), Create API wizard (3 steps, instant preview of 200 MB files, one upload only), API page (live import card) · 2.5 APIs: create / list / open / change (name, slug, feed type while draft, data source) / delete · 2.4 list / get / import history / records (keyset pages, id prefix search) / streaming CSV download / delete · 2.1 database (4 tables, composite FKs, partial unique index, CHECKs) · 2.2 connector interface + registry, streaming CSV connector, shared rules, disk uploads, preview endpoint · 2.3 import engine (COPY into generations, switch, merge/replace counts, background runner, recovery) + create / import / status endpoints |
| Verified by Claude | **2.8: whole-phase end-to-end check (section 12), all backend scripts green** · 2.7: browser walk-through of every state (see 11g; 500k replace/merge, races, keyboard focus, phone + dark) + backend 2.4 98 · 2.5 87 · 2.6: browser walk-through of every state (see 11f: 500k file, broken files, races, backend down, cancelled upload, phone, dark mode) + backend scripts 2.2 53 · 2.3 56 · 2.4 98 · 2.5 87 · 2.5: 85/85 (slug rules, brand isolation, published rules + warnings, races: 10 same-slug creates, 5 renames to one slug, create API vs delete its data ×6, switch vs delete) + 2.4 regression · 2.4: 98/98 checks (500k rows: any page or search ≤ 15 ms, download byte-identical in ~0.4 s, one version even while an import switches, deadlock found + fixed) + 2.2/2.3 regression · 2.1: isolation, races, delete rules, cascade, 500 000-row performance · 2.2: 53/53 preview checks (incl. 500k-row file in ~60 ms, 20 parallel uploads, flat memory) + Phase 1 regression · 2.3: 54/54 import checks (500 000 rows in ~7 s, broken row 400 001 changes nothing, readers see the old version during imports, 409 on parallel uploads, 3 parallel 5-lakh imports) + crash/restart recovery + regression |
| Verified by you | none yet |
| Outstanding | none · parked: changing the id column on a new version (ROADMAP change log) |
