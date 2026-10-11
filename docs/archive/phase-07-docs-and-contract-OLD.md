# Phase 7: API Docs Page and Contract Generator

**Status:** Not started
**Roadmap:** [../ROADMAP.md](../ROADMAP.md)

## 1. Goal (simple words)

Each API gets a page that explains how to call it, plus a button that produces a
**ready-to-paste Jivox contract JSON**.

## 2. Why we need it

It saves time: no more hand-writing contracts or guessing URLs, headers and field paths.

## 3. In scope / not in scope

| In scope | Not in scope |
|---|---|
| URL, header, example request / response | OpenAPI / Swagger export |
| "Try it" playground | Public docs site |
| Draft / Published state | Version history |
| Generate contract JSON (GET + POST) with `sample_request` from real ids | |

## 4. Tasks (planned)

| # | Task |
|---|---|
| 7.1 | Draft / published flag (draft APIs are not served on /v1) |
| 7.2 | Docs page per API |
| 7.3 | "Try it" panel |
| 7.4 | Contract generator (maps config → contract/1 JSON) |

## 5. Commands log
| # | Task | Where | Command | Why |
|---|---|---|---|---|
| | | | | |

## 6. Files created and what they do
| File | What it does |
|---|---|
| | |

## 7. How to verify manually
- [ ] The generated contract is submitted to Jivox with no edits → `verified`
- [ ] A draft API returns 404 on /v1

## 8. Summary
| | Items |
|---|---|
| Implemented | none yet |
| Verified | none yet |
| Outstanding | 7.1 – 7.4 |
