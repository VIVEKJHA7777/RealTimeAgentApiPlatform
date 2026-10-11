# Backend Architecture: Layers and Error Flow

> Rules every backend module follows. Introduced 2026-10-10 (after task 1.3).
> Roadmap: [ROADMAP.md](ROADMAP.md)

## 1. The layers

```
HTTP request
   │
   ▼
┌───────────────┐  *.routes.ts      "Which URL goes where?"
│    ROUTES     │  method + path → (middleware) → controller function. No logic.
└──────┬────────┘
       ▼
┌───────────────┐  *.controller.ts  "The HTTP side"
│  CONTROLLER   │  read req (validate body/params) → call service →
│               │  set status / cookies / headers → send JSON.
└──────┬────────┘  No business rules, no database.
       ▼
┌───────────────┐  *.service.ts     "The business side"
│    SERVICE    │  rules + database work through Prisma.
│               │  Knows nothing about HTTP: never sees req or res.
└──────┬────────┘  Throws AppError for expected problems.
       ▼
┌───────────────┐  lib/prisma.ts
│   DATABASE    │  PostgreSQL via the shared Prisma client.
└───────────────┘
```

Each module lives in `src/modules/<name>/`:

```
modules/auth/
├── auth.routes.ts       authRouter.post('/signup', authController.signup)
├── auth.controller.ts   export async function signup(req, res) { ... }
├── auth.service.ts      export async function signup(input) { ... }
└── auth.schemas.ts      Zod schemas + input types (used by the controller)
```

Imports go **downwards only**: routes → controller → service → lib. A service never imports
a controller; a controller never imports `prisma`.

Naming: modules are imported as namespaces, so call sites say which layer they use:

```ts
import * as authController from './auth.controller.js';
import * as authService from './auth.service.js';
authService.signup(input);
```

### What goes where

| Question | Layer |
|---|---|
| Which HTTP method and path? Which middleware (login check...)? | routes |
| Is the request body valid? (`validate(schema, req.body)`) | controller |
| Status code, cookies, headers, response JSON | controller |
| Hash a password, check a business rule, create rows, transactions | service |
| Turn a DB unique violation into `409 EMAIL_TAKEN` | service |
| Turn *any* error into the JSON error response and log it | `middleware/error-handler.ts` |

### Why a separate controller and service?

- **Services are reusable**: the same `authService.signup()` could be called from a script,
  a test, or another service, because it doesn't depend on Express.
- **Each file has one reason to change**: a new URL changes routes; a new response field
  changes the controller; a new business rule changes the service.
- **Easier to test later**: services can be tested without HTTP.

**Middleware** (`src/middleware/`) sits *between* routes and controllers for cross-cutting
checks: `loadSession` (global: cookie → `req.user`), `requireAuth` (per route: 401 if no
user) and `requireOrganization` (per brand route: slug + owner → `req.organization`, else 404). Middleware may call services (e.g. `authService.findSessionByToken`) and may throw
`AppError`, like controllers.

**Plug-ins (connectors)**: when the same job has several interchangeable implementations,
each one is a small module behind a shared interface, listed in one registry file. Example:
data sources: `modules/data-sources/connectors/connector.ts` (the contract),
`csv.connector.ts` (one implementation), `index.ts` (the registry). Adding JSON or Google
Sheets = a new connector file + one registry line; nothing else changes.

**Background jobs**: long work (imports) runs outside the request: the request validates what
it can instantly, stores a job row and answers `202`; an in-process runner executes it; the
browser polls the job row. State lives in Postgres, so a restart can recover (`import-runner.ts`).

**Lock order** (learned in task 2.4, a deadlock): code that deletes many `records` of a data source
first locks the data source row (`deleteGeneration()` in `import-engine.ts`: `SELECT … FOR KEY SHARE`),
the same order Postgres uses when a data source is deleted (data source row → its records). Same
order everywhere = one waits for the other instead of both waiting forever.

We do **not** add a separate "repository" layer: Prisma already is a clean data-access
layer. If a service gets big, we split it into more services.

## 2. Error flow: errors bubble UP, never get lost

```
DATABASE   Prisma throws  PrismaClientKnownRequestError (code P2002 / ECONNREFUSED / ...)
   │
SERVICE    expected?  → wrap it:  throw new AppError(409, 'EMAIL_TAKEN', '...', { cause: err })
   │       unexpected? → re-throw unchanged:  throw err
   │
CONTROLLER does NOT catch. (Express 5 forwards errors from async functions automatically.)
   │
ROUTES     does NOT catch.
   │
ERROR HANDLER  (middleware/error-handler.ts), the only place errors end:
           ├─ to the CALLER: { error: { code, message, details?, requestId } }   (safe parts only)
           └─ to the LOG:    the AppError + its whole cause chain + a short "causes" summary
```

### The rules

1. **Don't catch an error unless you add meaning to it.** Most code has no `try/catch` at all.
2. **When you wrap, always keep the original as `cause`.**
   `throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists', { cause: err })`
3. **If you catch something you don't recognise, re-throw it unchanged** (`throw err`).
   Never `catch {}` (swallowing), never `throw new Error('failed')` without `cause`.
4. **Services throw `AppError`, they never send responses.** Controllers never build error JSON.
5. **The caller never sees internals**: no `cause`, no stack, no SQL. 5xx errors always say
   "Something went wrong" plus a `requestId`.
6. **Expected "negative answers" are not errors.** E.g. the health check returns
   `{ db: 'down' }` instead of throwing.

### What you see in the log

Duplicate sign-up (409):

```
WARN: EMAIL_TAKEN: An account with this email already exists
      {"req":{"id":"8965c419-…","method":"POST","url":"/api/auth/signup",…},
       "causes":[{"type":"PrismaClientKnownRequestError","code":"P2002",
                  "message":"Unique constraint failed on the constraint: `users_email_key`"}]}
    err: AppError: An account with this email already exists
         caused by: PrismaClientKnownRequestError:
         Invalid `prisma.user.create()` invocation in …/auth.service.ts:39:36
```

Database down during sign-up (500):

```
ERROR: INTERNAL_ERROR: unhandled error
      {"req":{…},"causes":[{"type":"PrismaClientKnownRequestError","code":"ECONNREFUSED",…}]}
    err: AppError: Something went wrong
         caused by: PrismaClientKnownRequestError … auth.service.ts:39:36
```

- `causes` = the quick answer (**what** went wrong: `P2002`, `ECONNREFUSED`).
- `err.stack` with `caused by:` = the full story (**where**: file and line in each layer).
- `req.id` = the `requestId` the caller got, so a user's bug report leads straight to the log line.

### Error codes so far

| Status | `code` | Where it comes from |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `validate()` in a controller; `details` lists each bad field |
| 400 | `INVALID_JSON` | Body isn't valid JSON (Express body parser) |
| 404 | `NOT_FOUND` | Unknown route, or Prisma P2025 (row vanished) |
| 401 | `UNAUTHENTICATED` | `requireAuth` middleware: no valid session cookie |
| 401 | `INVALID_CREDENTIALS` | `authService.login()`: unknown email **or** wrong password (same message) |
| 404 | `ORGANIZATION_NOT_FOUND` | `requireOrganization`: brand doesn't exist **or** isn't yours (same answer) |
| 400 | `SOURCE_INVALID` | Data source content problem (header, empty file, encoding…) with row numbers in `details` |
| 400 | `FILE_REQUIRED` · `UPLOAD_INVALID` · `UNSUPPORTED_SOURCE` | Missing file · not exactly one file in field `file` · unknown connector `kind` |
| 413 | `FILE_TOO_LARGE` | Upload over `UPLOAD_MAX_MB` |
| 415 | `UNSUPPORTED_FILE` | Wrong extension, or not a text/CSV file at all |
| 409 | `EMAIL_TAKEN` | `authService.signup()`: duplicate email |
| 400 | `ID_COLUMN_NOT_FOUND` | Data source create / new version: the id column isn't in the file's header |
| 404 | `DATA_SOURCE_NOT_FOUND` · `IMPORT_NOT_FOUND` | `requireDataSource` (not this brand's, or doesn't exist) · import id not of this data source |
| 409 | `DATA_SOURCE_NAME_TAKEN` · `IMPORT_IN_PROGRESS` | Same data source name in the brand · one import already queued/running (partial unique index), also when deleting during an import |
| 400 | `UPLOAD_CANCELLED` | The browser stopped sending the file (left the page); nobody receives it, logged as one warning |
| 409 | `DATA_SOURCE_IN_USE` | Delete a data source an API uses (`details` lists the APIs; also from the FK when an API appears at the same moment) |
| 409 | `NO_DATA_YET` | Download before the first import succeeded |
| 404 | `API_NOT_FOUND` | `requireApi` (not this brand's, or doesn't exist) |
| 409 | `API_SLUG_TAKEN` · `API_PUBLISHED` | Slug already used by an API of this brand · feed type change on a published API |
| 429 | `TOO_MANY_DOWNLOADS` | More than `DOWNLOAD_CONCURRENCY` CSV downloads at once (try again later) |

**Import job `errorCode`s** (in the import, not HTTP): `SOURCE_INVALID`, `DUPLICATE_IDS`, `ID_COLUMN_NOT_FOUND`, `DATA_SOURCE_DELETED`, `INTERRUPTED` (server restarted), `INTERNAL_ERROR`.
| 409 | `SLUG_TAKEN` | `organizationsService.createOrganization()`: 3 random suffixes in a row collided (practically never) |
| 409 | `CONFLICT` | Safety net: any unhandled unique violation |
| 413 | `PAYLOAD_TOO_LARGE` | Body over 1 MB |
| 500 | `INTERNAL_ERROR` | Anything unexpected (a bug, DB down...) |
