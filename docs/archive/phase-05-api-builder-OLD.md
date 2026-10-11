# Phase 5: API Builder (No-Code)

**Status:** Not started
**Roadmap:** [../ROADMAP.md](../ROADMAP.md)

## 1. Goal (simple words)

Instead of one hard-coded `/live/prices` endpoint, a brand **builds its own API by
clicking**. One generic piece of server code reads the saved settings and answers
for every brand.

## 2. Why we need it

Different Jivox agents need different fields and paths. We do not want to write new
code for every brand or every test case.

## 3. In scope / not in scope

| In scope | Not in scope |
|---|---|
| `api_configs` table | POST (Phase 6) |
| Choose: dataset, path, id query name, id key in response, response fields | Joins across datasets |
| Rename fields in the response (e.g. `price` → `amount`) | Computed fields / formulas |
| One generic `/v1/:brand/*` handler | Versioning / rollback |
| Preview with sample ids before saving | |
| Enable / disable an API | |

## 4. Tasks (planned)

| # | Task |
|---|---|
| 5.1 | `api_configs` table + CRUD endpoints |
| 5.2 | Generic runtime handler: find the config by brand + path, run it |
| 5.3 | Field mapping + type conversion (string / int / float / boolean) |
| 5.4 | Preview endpoint |
| 5.5 | Frontend: API list + create/edit form + preview panel |
| 5.6 | Replace the Phase 3 hard-coded endpoint with a config |

## 5. Commands log
| # | Task | Where | Command | Why |
|---|---|---|---|---|
| | | | | |

## 6. Files created and what they do
| File | What it does |
|---|---|
| | |

## 7. How to verify manually
- [ ] Brand A: `/live/prices` returns `id, price`
- [ ] Brand B: `/stock` returns `sku, qty`, with no code changes
- [ ] A disabled API returns 404
- [ ] The Phase 4 Jivox contract still verifies

## 8. Common mistakes and security notes
_To be filled during the phase._

## 9. Summary
| | Items |
|---|---|
| Implemented | none yet |
| Verified | none yet |
| Outstanding | 5.1 – 5.6 |
