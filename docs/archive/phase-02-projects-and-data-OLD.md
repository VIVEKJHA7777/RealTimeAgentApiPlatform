# Phase 2: Product Data (CSV datasets)

**Status:** ⏸ On hold. Being replaced by the API-first plan in [../PLAN-v2-api-first.md](../PLAN-v2-api-first.md) (your feedback, 2026-10-10). The CSV rules and concurrency parts below carry over.
**Roadmap:** [../ROADMAP.md](../ROADMAP.md)
**Backend rules:** [../ARCHITECTURE.md](../ARCHITECTURE.md) (routes → controller → service, errors with `cause`)
**Depends on:** Phase 1 (brands, login, ownership check)

---

## 0. Progress tracker

> ✅ = verified by you · 🔨 = built by Claude, waiting for your check · 📝 = plan in review · ⬜ = not started

| # | Task | Side | Status |
|---|---|---|---|
| 2.1 | Database tables `datasets` + `records` + migration | Backend | ⬜ |
| 2.2 | CSV reading: upload handling + parser + **preview** endpoint | Backend | ⬜ |
| 2.3 | Create a dataset = first import (one transaction, fast batch insert) | Backend | ⬜ |
| 2.4 | List / open / delete datasets · browse records (pages + id search) | Backend | ⬜ |
| 2.5 | Re-upload a new version (merge or replace) + safe parallel imports | Backend | ⬜ |
| 2.6 | Frontend: "Product data" on the brand page + upload wizard | Frontend | ⬜ |
| 2.7 | Frontend: dataset page (table, pages, search, re-upload, delete) | Frontend | ⬜ |
| 2.8 | End-to-end check (two brands, edge-case CSVs, races) + docs | Both | ⬜ |

---

## 1. Goal (simple words)

A brand uploads a **CSV file of products** (e.g. `sku, name, price, currency`), picks which
column is the **unique id** (e.g. `sku`), and we store every row. The brand can browse the rows,
search by id, and upload a new version later (e.g. new prices).

```
products.csv                         our database (one brand)
──────────────────────────           ─────────────────────────────────────────────
sku,      name,         price        dataset "Products"  (id column: sku, 3 rows)
SKU-1001, Runner Pro,   79.99   ──►    record  external_id = "SKU-1001"
SKU-2049, Trail Max,    129.00           data = { "name": "Runner Pro", "price": "79.99" }
SKU-3311, City Walk,    59.50          record  external_id = "SKU-2049" ...
```

## 2. Why we need it

The realtime API (Phase 3) answers Jivox with **this data**: Jivox sends ids
(`?ids=SKU-1001,SKU-2049`), we look them up here and return their fields. No data → nothing to answer.

---

## 3. Big decision first: do we need "projects"?

The original roadmap said: **brand → projects → datasets → records**. Looking at what Jivox
actually needs, I suggest **dropping projects**:

| | With projects | **Without projects (suggested)** |
|---|---|---|
| Structure | brand → project → dataset → records | **brand → dataset → records** |
| What a "project" would hold | a folder of datasets | (nothing needed; the brand already is the folder) |
| Extra work | project CRUD API + pages + one more ownership check on every URL | none |
| Jivox fit | Jivox thinks in **feeds per brand** (product / review / store / content) | a dataset **is** a feed; we add a `feed type` field |

So in this plan, **a dataset = one CSV-based feed of a brand**. If we ever need folders, adding
projects later is a small migration. (Question Q1 below.)

---

## 4. How it works

### 4.1 Upload flow (2 steps, so the user sees the data before saving)

```
Step 1: PREVIEW (nothing is saved)
  browser ──file──► POST /api/organizations/:slug/datasets/preview
                    server reads the CSV and answers:
                      columns: [sku, name, price, currency]   + a guessed type for each
                      rowCount: 1 240
                      sampleRows: first 10 rows
                      idCandidates: [sku]   ← columns where every value is present AND unique
                      problems: []          ← e.g. "row 57 has 5 values, header has 4"

Step 2: CREATE (saved in ONE transaction)
  browser ──same file + name + idColumn + feedType──► POST /api/organizations/:slug/datasets
                    server reads the file AGAIN (never trusts step 1), checks everything,
                    then saves the dataset + all rows; all or nothing
                    → 201 { dataset: { id, name, idColumn, rowCount: 1240, ... } }
```

Why send the file twice? The server keeps **nothing** between the two steps (no half-finished
uploads to clean up, no memory between requests), and it always checks the real file it saves.
Files are small (≤ 5 MB), so sending twice costs nothing noticeable.

### 4.2 Re-upload a new version

```
POST /api/organizations/:slug/datasets/:datasetId/imports   (file + mode)

 mode = "merge"    rows in the file are added or updated; rows NOT in the file are kept
 mode = "replace"  afterwards the dataset is EXACTLY the file (missing ids are deleted)

 → { inserted: 12, updated: 1 228, unchanged: 0, deleted: 3, rowCount: 1 237 }
```

The id column is fixed per dataset (it's how rows are matched). New columns in the file are
fine; they're simply added.

### 4.3 How a value is stored

- Every cell is stored **as text, exactly as written** in the CSV (`"007"` stays `"007"`,
  `"79.90"` stays `"79.90"`). Nothing is lost or reformatted.
- An **empty cell** is stored as `null` (= "no value"). This matches the Jivox merge rules,
  where a missing/empty DB value is filled from the live API or the contract default.
- For each column we **guess a type** (`number`, `boolean`, `text`) from its values, only for
  display now. In Phase 5 (API builder) the type is used to convert values into the contract's
  `int` / `float` / `boolean`.

---

## 5. Database

```
organizations (Phase 1)
     │ 1
     │
     ▼ many
datasets                                          records
───────────────────────────────────               ─────────────────────────────────────
id              (cuid)                            id              (cuid)
organization_id → organizations (cascade)  ◄──┐   organization_id → organizations (cascade)
name            "Products"                    └── dataset_id      → datasets (cascade)
feed_type       product | review | store |        external_id     "SKU-1001"
                content  (default product)        data            JSONB {"name": "...", "price": "79.99"}
id_column       "sku"   (fixed)                   created_at / updated_at
columns         JSONB [{ name, type }]
row_count       1240                              UNIQUE (dataset_id, external_id)
last_import_at  …                                 INDEX  (organization_id)
created_at / updated_at

UNIQUE (organization_id, name)    ← no two datasets with the same name in one brand
```

- `organization_id` is also stored on `records` (decision D5 / "every row knows its brand"), so a
  query can always say `WHERE organization_id = <my brand>` directly. This is what Phase 3's
  public API will use.
- `UNIQUE (dataset_id, external_id)` makes duplicate ids **impossible** in the database, even
  if two uploads race.
- Deleting a brand → its datasets → their records (cascade).

---

## 6. API endpoints

All under `/api/organizations/:slug/…`, so they all go through Phase 1's checks:
`requireAuth` (logged in) → `requireOrganization` (this brand is **mine**, else 404).
Dataset URLs add a third check, `requireDataset`: the dataset must belong to **this** brand,
else `404 DATASET_NOT_FOUND`.

| Method | Path | Body | Success | Main errors |
|---|---|---|---|---|
| POST | `/datasets/preview` | multipart: `file` | `200 { columns, rowCount, sampleRows, idCandidates }` | 400 `CSV_INVALID` (with row number) · 413 too big · 415 not a CSV |
| POST | `/datasets` | multipart: `file`, `name`, `idColumn`, `feedType` | `201 { dataset }` | 400 validation / `CSV_INVALID` / `DUPLICATE_IDS` / `MISSING_IDS` · 409 `DATASET_NAME_TAKEN` |
| GET | `/datasets` | – | `200 { datasets: [...] }` (newest first) | – |
| GET | `/datasets/:datasetId` | – | `200 { dataset }` | 404 |
| POST | `/datasets/:datasetId/imports` | multipart: `file`, `mode` | `200 { result: { inserted, updated, unchanged, deleted, rowCount } }` | same CSV errors · 400 `ID_COLUMN_MISSING` |
| GET | `/datasets/:datasetId/records?page=1&pageSize=50&search=SKU-1` | – | `200 { records, page, pageSize, total }` | 400 bad paging |
| DELETE | `/datasets/:datasetId` | – | `204` | 404 |

### CSV rules (the server checks all of these, every time)

| Rule | Error the user sees |
|---|---|
| File ≤ **5 MB**, ≤ **50 000** rows, ≤ **100** columns | "File is too large (max 5 MB)" / "Too many rows…" |
| Must look like a CSV (`.csv`, text) | "Upload a .csv file" |
| First row = headers; headers non-empty and **unique** | "Column 3 has no name" / "Column 'price' appears twice" |
| At least 1 data row | "The file has headers but no rows" |
| Every row has the same number of values as the header | "Row 57 has 5 values, but the header has 4" |
| The chosen id column exists | "Column 'sku' isn't in this file" |
| Every row has an id (not empty) | "Rows 12, 40 and 3 more have no sku" |
| Ids are unique inside the file | "SKU-1001 appears 2 times (rows 2 and 19)…" |
| Handled correctly (not errors): UTF-8 BOM, Windows line endings, quoted values with commas/new lines (`"Shoes, red"`), accents/emoji, spaces around values (trimmed) | – |

The errors list the **first 5 problems** with row numbers, so a broken 10 000-row file doesn't
produce a 10 000-line message.

---

## 7. Concurrency (many users at the same time)

| Situation | What happens | How |
|---|---|---|
| Two people create datasets with the **same name** in one brand at the same instant | 1 × 201, 1 × 409 `DATASET_NAME_TAKEN` | `UNIQUE (organization_id, name)` |
| Two uploads to the **same dataset** at the same time | They run **one after the other**, never mixed; the final data = the later upload; both get correct stats | Each import locks its dataset row (`SELECT … FOR UPDATE`) inside its transaction; the second waits |
| An upload fails half-way (bad row 9 000, DB hiccup) | **Nothing** is saved; the old data stays exactly as it was | Whole import = one transaction (all or nothing) |
| Someone browses the table **while** an upload runs | They see the old data until the upload finishes, then the new data; never half of each | Postgres transactions: readers don't see uncommitted rows |
| Dataset deleted while an upload runs | Upload gets 404 (or the delete waits for it); no orphan rows | same row lock + cascade |
| Uploads in **different** brands / datasets | Fully parallel, no waiting | locks are per dataset |
| Many big uploads at once | Each file ≤ 5 MB in memory; rows written in **batches of 1 000** with one SQL statement per batch | keeps memory and DB round trips small |

---

## 8. Frontend

### 8.1 Brand page: new "Product data" section (replaces the "Coming next: Product data" card)

```
Acme Shoes                                                  
┌──────────────────────────────────────────────────────────────┐
│ Product data                                  [ ⬆ Upload CSV ] │
│ ─────────────────────────────────────────────────────────── │
│ ▤ Products        product · id: sku · 1 240 rows · updated 2 min ago   › │
│ ▤ Store list      store   · id: store_id · 85 rows · updated yesterday   › │
└──────────────────────────────────────────────────────────────┘
 (empty state: "Upload your first CSV" with a short explanation)
```

### 8.2 Upload wizard `/brands/:slug/datasets/new`

```
 ① Choose file          ② Check & configure                          ③ Done
┌──────────────────┐   ┌───────────────────────────────────────────┐
│  ⬆ Drop a CSV    │   │ products.csv · 1 240 rows · 4 columns      │
│  here or browse  │──►│ Name     [ Products           ]           │──► dataset page
│  max 5 MB        │   │ Feed     [ product ▾ ]                    │    + toast
└──────────────────┘   │ Id column[ sku ▾ ]  ✓ unique in every row │
                       │ ┌ preview: first 10 rows ─────────────┐   │
                       │ │ sku ★ │ name │ price # │ currency    │   │
                       │ └────────────────────────────────────┘   │
                       │                [ Back ] [ Import 1 240 rows ] │
                       └───────────────────────────────────────────┘
```

- Drag & drop or click to choose. Wrong type / too big → message **before** uploading.
- Id column dropdown lists every column; the ones that are unique in every row are marked
  "✓ unique" and the best one is preselected (`id`, `sku`, `*_id`… preferred).
- Problems from the preview (e.g. "Row 57 has 5 values") are shown clearly; Import is blocked
  until the file is fixed.
- Import button disabled while saving (no double import).

### 8.3 Dataset page `/brands/:slug/datasets/:datasetId`

```
Brands › Acme Shoes › Products
Products   product · id column: sku · 1 240 rows · last upload 2 min ago
                                         [ ⬆ Upload new version ] [ ⋯ Delete ]
┌ 🔍 Search by sku… ─────────────────────────────────────────────┐
│ sku       │ name        │ price  │ currency                        │
│ SKU-1001  │ Runner Pro  │ 79.99  │ USD                             │
│ SKU-2049  │ Trail Max   │ 129.00 │ USD                             │
│ …                                                               │
│                         Rows 1–50 of 1 240   ‹ 1 2 3 … 25 ›         │
└──────────────────────────────────────────────────────────────────┘
```

- **Search** by id (starts with), so you can quickly check the SKUs Jivox will ask for.
- **Upload new version**: dialog with the file, mode (Merge / Replace, explained in plain words),
  then a result summary: "12 added · 1 228 updated · 3 removed".
- **Delete**: confirmation dialog that names the dataset and its row count.
- Empty cells show a muted "—". Long values are truncated with the full text on hover.
- Wide tables scroll **inside** the table (never the whole page).

---

## 9. Tasks in detail

| # | Task | What's built | How I'll test it |
|---|---|---|---|
| 2.1 | DB tables | `Dataset`, `Record`, enum `FeedType`; migration `add_datasets_and_records` | tables, indexes, cascade; race on duplicate name in SQL |
| 2.2 | CSV reading + preview | `multer` (memory, 5 MB), `csv-parse`; `lib/csv.ts` (parse + all rules + type guess + id candidates); `requireDataset` middleware; `POST …/datasets/preview` | edge-case CSV files in `docs/test-data/` (BOM, CRLF, quotes, unicode, empty cells, bad rows, duplicates, header only, 50 000 rows, 6 MB, not-a-CSV) |
| 2.3 | Create dataset | `POST …/datasets`: validate → transaction → create dataset → batch insert rows (1 000 per SQL statement) → row count | create, name taken, parallel same-name creates, rollback on bad file (nothing saved), 50 000-row speed |
| 2.4 | Read / delete | list, get, records with paging + id search, delete | paging edges (last page, page 0, huge page size), search, other brand's dataset → 404, delete cascade |
| 2.5 | Re-upload | `POST …/imports` with merge / replace; dataset row lock; stats | merge vs replace results, missing id column, **two parallel imports**, readers during an import |
| 2.6 | Frontend upload | brand page section, upload wizard (drop zone, preview table, id column picker) | browser: happy path, wrong file, too big, bad CSV, double-click |
| 2.7 | Frontend dataset page | table, pagination, search, re-upload dialog, delete dialog | browser: paging, search, merge/replace, delete, phone width, dark mode |
| 2.8 | End to end | two brands, scripts + browser | full verify list (section 11) |

**New packages:** backend `multer` + `@types/multer` (file uploads), `csv-parse` (a well-tested
CSV parser; CSV has many tricky cases, we don't write our own). Frontend: shadcn `table`,
`select`, `dialog`, `alert-dialog`, `radio-group`.

---

## 10. Scope check

**In scope (ROADMAP: "Projects, CSV upload, data table"):** CSV upload with preview, id column,
storage as `external_id` + JSON `data` (D5), paginated table with id search, re-upload
(merge/replace), delete dataset, feed type label.

**Not in Phase 2:**

| Not doing | Why |
|---|---|
| Projects (folders) | Q1: not needed for the Jivox use case |
| Excel / JSON / Google Sheets import | CSV only for now |
| Files > 5 MB, background jobs | Out of scope (ROADMAP); limits stated clearly in the UI |
| Editing single rows in the UI | Re-upload instead |
| Changing a dataset's id column | Would break matching; create a new dataset instead |
| Schema mapping to Jivox fields (`current_price`...) | Phase 5 (API builder) |
| Keeping old versions / undo | Out of scope |
| Rename dataset | Small; can add if you want (Q6) |

---

## 11. How to verify the whole phase (filled in during 2.8)

- [ ] Upload `products.csv`, pick `sku`, see the rows in the table
- [ ] Change one price, re-upload (merge): the price updates, no duplicate row
- [ ] Replace mode removes rows that are no longer in the file
- [ ] A broken CSV (bad row, duplicate ids, missing ids) shows a clear error with row numbers and saves **nothing**
- [ ] Brand B can't see or open brand A's datasets or records (404)
- [ ] Two uploads to the same dataset at the same time → consistent result, no mixed data
- [ ] 50 000-row file imports in a few seconds; table pages fast

---

## 12. Questions for you

| # | Question | My suggestion |
|---|---|---|
| Q1 | **Drop "projects"** and put datasets directly under the brand? | Yes |
| Q2 | Add a **feed type** per dataset (product / review / store / content), default product? | Yes (cheap, matches Jivox) |
| Q3 | Re-upload modes: offer **both Merge and Replace**? Which default? | Both; default **Replace** ("the file is my full catalog") |
| Q4 | Limits: **5 MB, 50 000 rows, 100 columns**? | Yes for now |
| Q5 | Store values **as text, exactly as in the file**; empty cell = no value? | Yes |
| Q6 | Allow **renaming** a dataset? | Yes, small (name only) |
| Q7 | Search records by **id only** (starts-with), not by other columns? | Id only for now |

---

## 13. Commands log
_Filled in while implementing._

## 14. Files touched
_Filled in while implementing._

## 15. Concurrency, common mistakes and security notes
_Filled in while implementing._

## 16. Summary
| | Items |
|---|---|
| Implemented | none yet |
| Verified | none yet |
| Outstanding | 2.1 – 2.8 |
