# Phase 7: Testing Aids (Request Log and Failure Switches)

**Status:** ⬜ Not started (plan draft: detailed review before we start)
**Roadmap:** [../ROADMAP.md](../ROADMAP.md) · **Big picture:** [../PLAN-v2-api-first.md](../PLAN-v2-api-first.md)
**Depends on:** Phase 4 (live endpoint); most useful together with Phase 6 (real Jivox calls)

---

## 0. Progress tracker

| # | Task | Side | Status |
|---|---|---|---|
| 7.1 | Database: `request_logs` (+ automatic trimming) | Backend | ⬜ |
| 7.2 | Log every `/v1` call (secrets removed) without slowing it down | Backend | ⬜ |
| 7.3 | Logs API: list with filters, one entry in detail | Backend | ⬜ |
| 7.4 | Failure switches: storage, runtime effects, auto-expiry | Backend | ⬜ |
| 7.5 | Frontend: **Logs tab** (live list, filters, detail drawer) | Frontend | ⬜ |
| 7.6 | Frontend: **Test switches** panel + "switches active" banner | Frontend | ⬜ |
| 7.7 | Each switch against Jivox verification on qa3 + docs (expected vs actual table) | Both | ⬜ |

---

## 1. Goal (simple words)

As a QA tool we need two things: **see exactly what Jivox sent us** (method, path, query, body,
ids, locale/location, timing, our answer), and **make an API answer wrongly on purpose** to check
that Jivox's verification catches each kind of mistake.

## 2. Request log

Per call: time, API, token name (never the token), method, path, query, body (first 4 KB),
number of ids, `_meta` values received, HTTP status, envelope status, error codes, duration,
caller IP and user agent.

| Decision | Why |
|---|---|
| Written **after** the answer is sent (doesn't add latency) | Logging must never slow Jivox's 3 s budget |
| Keep the **last 1 000 calls per API** (older ones trimmed automatically) | Bounded storage, no background jobs |
| Headers stored with `authorization` / `x-api-key` / `cookie` removed | Never store secrets |

**Logs tab:** live list (auto-refresh every 5 s), filters (status, time, contains id), click a row →
full request/response; "Copy as curl" (with `<your token>`).

## 3. Failure switches (per API, off by default)

| Switch | What our API does | Jivox verification should report |
|---|---|---|
| Missing `no-store` | omit `Cache-Control: no-store` | missing no-store |
| `status: failure` | answer `status: "failure"` | call failed |
| Duplicate id | send one item twice | duplicate id |
| Drop an id | leave one requested id out of data and errors | sent id not echoed |
| Wrong type | send a field's value as the wrong type (e.g. `"abc"` for a float) | type not coercible |
| Slow answer | wait N ms (e.g. 3 500) before answering | timeout (> 3 000 ms) |
| HTTP 500 | answer 500 | non-2xx |
| Empty data | `data: []` with `status: success` | ids not echoed |
| Not JSON | answer plain text | invalid response |

| Decision | Why |
|---|---|
| Switches **auto-expire** after 60 minutes (configurable) | Nobody forgets a broken API |
| A red banner on the API page while any switch is on | Obvious state |
| Switches also show in the log entries they affected | Easy to match Jivox's evidence to the cause |
| Allowed on published APIs | Needed to test Jivox's activate re-check |

## 3b. Idea (2026-10-11, decide at the review): request check + strict mode

- Every incoming `/v1` call is compared with the API's request template and the result goes into the
  request log: *"ids ✓ (3, comma-separated) · market=US ✓ · locale=en-US ✓ · `cat` missing for SKU-2049 ✗"*.
- **Strict mode** (switch per API): a call that doesn't match the template → `400` in the contract
  envelope, to test how the agent handles a refused request.

## 4. How to verify (filled in during 7.7)

- [ ] Every Jivox verification call appears in the log with its query/body and our answer
- [ ] No secret appears in any stored log entry
- [ ] Each switch causes the matching Jivox failure (table filled with real evidence)
- [ ] Switches turn off by themselves after expiry
- [ ] 200 parallel calls: all logged, answers not slower than without logging
