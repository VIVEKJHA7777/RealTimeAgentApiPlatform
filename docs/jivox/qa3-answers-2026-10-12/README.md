# Jivox's real write answers (qa3, 2026-10-12)

Captured by the user from the live app ("Jivox's answer (raw)" in an agent's history; our copy is scrubbed of
secrets, and these contain none: no token is ever in a contract). API `newsubtitle` of brand Amazon, Agent 1.

| File | Call | Result |
|---|---|---|
| `submit-invalid.json` | `submit_contract` (another API, key `sub-category`) | `status: invalid`, `errors: [{ code: BAD_DOCUMENT, message }]`, no `fix` |
| `submit-verified.json` | `submit_contract` | `status: verified`, `version`, `note` (not `message`), the stored `contract`, `recorded`, `verification` |
| `submit-failed.json` | `submit_contract` with sample id `Nope-1` (on purpose) | `status: failed`, `version: null`, `recorded: true`, `verification { passed: false, failure: "sent ids with no answer: ['Nope-1']", id_check.missing, api_errors }`; no `note`; the active v1 untouched |
| `activate-active.json` | `activate_contract(1)` | `status: active`, `version`, `contract`, `created_at` / `updated_at`, `verification`, `previous_active` (null: nothing was active) |

`verification` (both): `url`, `method`, `passed`, `failure`, `http_status`, `status_ok`, `cache_control_ok`, `sent_ids`,
`echoed_ids`, `id_check { missing, duplicates, unexpected, without_id }`, `api_errors`, `fields [{ column_name, pass,
observed [{ id, raw, coerced }], defaulted, failure_reason }]`, `test_user_token` (a note). The verification calls came
from `python-httpx/0.28.1` and showed up in our Recent calls (20:40:28 submit, 20:40:33 activate). Studio's agent status
afterwards: **success**. Not seen yet: `gate_failed` and a refused activation (their shapes are still guessed in the fake).
