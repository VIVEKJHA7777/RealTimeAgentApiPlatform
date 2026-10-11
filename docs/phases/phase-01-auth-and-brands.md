# Phase 1: Login and Brands

**Status:** ✅ Built and verified end to end by Claude (2026-10-10). Waiting for your final check.
**Roadmap:** [../ROADMAP.md](../ROADMAP.md)
**Depends on:** Phase 0 (done)
**Backend structure rules:** [../ARCHITECTURE.md](../ARCHITECTURE.md) (layers + error flow, from 1.3b on)

---

## 0. Progress tracker

> Updated after every task. ✅ = verified by you · 🔨 = built by Claude, waiting for your check · 📝 = plan in review · ⬜ = not started

| # | Task | Side | Status |
|---|---|---|---|
| 1.1 | Database tables + migrations (incl. many brands per owner) | Backend | 🔨 |
| 1.2 | Shared helpers: `AppError`, request validation, better error responses | Backend | 🔨 |
| 1.3 | Sign up (`POST /api/auth/signup`) | Backend | 🔨 |
| 1.3b | Refactor: routes → controller → service layers + error `cause` chain | Backend | 🔨 |
| 1.4 | Log in, log out, "who am I", session middleware | Backend | 🔨 |
| 1.5 | Brands API (create, list mine, open one of mine) | Backend | 🔨 |
| 1.6 | Frontend: API helper, auth state, Sign up + Log in pages, user menu + log out | Frontend | 🔨 |
| 1.7 | Frontend: "Your brands" list, "Create brand" page, brand page | Frontend | 🔨 |
| 1.8 | End-to-end isolation test (2 users, several brands) + docs wrap-up | Both | 🔨 |

**Order:** backend first (1.1 → 1.5, each testable with `curl`), then frontend (1.6 → 1.7),
then the full check (1.8). Each task is small enough to finish and verify in one sitting.

---

## 1. Goal (simple words)

People can **sign up**, **log in** and **log out**. A logged-in account can create
**one or more brands** (organizations). **Each brand has exactly one owner account**:
whoever has that account's email + password manages all of its brands; there are no
team members or roles. An account can only ever see the brands it owns. This is the
first "wall" between brands, and every later phase builds on it.

## 2. Why we need it

Everything later (CSV data, APIs, tokens) belongs to a brand. To keep brands apart we
must always know two things on every website request:
1. **Who** is calling? (the logged-in user)
2. **Which brand** are they working on, and do they own it? (`slug` in the URL **and** `ownerId` = that user)

> Note: this login is for **people using our website**. Jivox calling our `/v1` API will
> use **tokens** (Phase 3), a completely separate mechanism.

## 3. How it works (the big picture)

### 3.1 Sign up / log in

```
Browser                        Express                                PostgreSQL
  │ POST /api/auth/login          │                                        │
  │ {email, password} ──────────► │ 1. Zod checks the body                 │
  │                               │ 2. find user by email ───────────────► │ users
  │                               │ 3. argon2.verify(password, hash)       │
  │                               │ 4. make random session token (32 bytes)│
  │                               │ 5. save SHA-256(token) + expiry ─────► │ sessions
  │ ◄──────────────────────────── │ 6. Set-Cookie: sid=<token>; HttpOnly   │
  │   200 {user}                  │                                        │
```

### 3.2 Every later request

```
Browser                        Express
  │ GET /api/organizations/acme   │
  │ Cookie: sid=<token> ────────► │ loadSession middleware:
  │                               │   hash the token → find session → not expired?
  │                               │   → req.user = that user
  │                               │ requireAuth: no req.user → 401
  │                               │ requireOrganization:
  │                               │   SELECT ... WHERE slug='acme' AND owner_id = req.user.id
  │                               │   not found → 404
  │ ◄──────────────────────────── │ 200 {brand acme}
```

The browser sends the cookie **automatically** on every `/api` call (same origin thanks
to the Vite proxy). JavaScript in the page **cannot read it** (`HttpOnly`), so an XSS bug
can't steal it.

**Isolation rule (all phases):** the URL may *name* a brand (`/api/organizations/:slug/...`),
but the brand is always looked up **together with** `owner_id = req.user.id`, in one query.
Someone else's slug simply isn't found → **404** (not 403, so we don't even confirm it
exists). We never trust an `organizationId` sent in a request body.

### 3.3 Session vs cookie: what's the difference?

They are two halves of one mechanism:

| | **Session** | **Cookie** |
|---|---|---|
| What it is | A **record on the server** saying "this login belongs to user X, valid until Y" | A **small piece of text stored by the browser**, which it sends back on every request to our site |
| Where it lives | Our database, `sessions` table | The browser |
| What's inside | `userId`, `expiresAt`, `tokenHash` | Only `sid=<random token>`: no user id, no email, nothing meaningful |
| Who creates it | Express, at login | Express **asks** the browser to store it with the `Set-Cookie` response header |
| Who can read it | Only our server | The browser sends it; page JavaScript can't read it (`HttpOnly`) |

**Analogy: a coat check.** You hand in your coat (log in). The counter keeps the coat and
a record (the **session**) and gives you a numbered **ticket** (the **cookie**). The ticket
itself is worthless; it only *points to* the record. Show the ticket and you get your
coat. If the counter tears up the record (log out), the ticket stops working, even if you
still hold it.

**So: we send the cookie to the client, never the session.** The session data stays in
our DB. The cookie only carries the random token that identifies the session.

What actually goes over the wire:
```
── Login response (server → browser) ──
HTTP/1.1 200 OK
Set-Cookie: sid=Jx8f...41 chars...Q2; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800
{"user":{"id":"cm1…","email":"a@acme.com"}}

── Every later request (browser → server), added by the browser automatically ──
GET /api/auth/me
Cookie: sid=Jx8f...Q2
```

Why the DB stores `SHA-256(token)` and not the token: if someone stole a copy of the
database, they'd have only hashes. They can't turn a hash back into the token, so they
can't build a working cookie.

**Compared to JWT** (what we did *not* choose): with JWT the server puts the user data
*inside* the cookie/token and signs it, so it doesn't need a sessions table. But then
"log out now" or "kick this user out" is hard, because the server has no record to delete.

## 4. Design decisions (please review)

| # | Decision | Why | Trade-off |
|---|---|---|---|
| P1-1 | **Sessions in the DB + cookie**, not JWT | Log out = delete the row, instant. Easy to understand. | One DB lookup per request (fine at our size). |
| P1-2 | Cookie holds a **random token**; DB stores only its **SHA-256 hash** | If the DB leaks, attackers still can't use the sessions. Same idea we'll use for API tokens in Phase 3. | None really. |
| P1-3 | Cookie settings: `HttpOnly`, `SameSite=Lax`, `Secure` in production, `Path=/`, 7 days | `HttpOnly` blocks JS access; `Lax` stops other sites from making logged-in POSTs (basic CSRF protection). | `Secure` is off locally because localhost is http. |
| P1-4 | Session lasts **7 days, fixed** (no "sliding" renewal) | Simple. | User logs in again weekly. |
| P1-5 | Passwords hashed with **argon2id** (`argon2` package) | Current best practice; slow on purpose so stolen hashes are hard to crack. | Needs a native module (prebuilt for Mac, no setup). |
| P1-6 | Password rule: **8–128 characters**, nothing else | Length matters most; complex rules annoy people. | No "must contain a number" rule. |
| P1-7 | Email is **trimmed + lower-cased** before saving/searching | `Bob@X.com` and `bob@x.com` are the same account. | None. |
| P1-8 | Wrong email **or** wrong password → same message: "Invalid email or password" | Don't reveal which emails have accounts. | Slightly less helpful to the user. |
| P1-9 | Brand has **name + slug**. The user gives the slug's **start** (frontend suggests it from the name: `Acme Shoes` → `acme-shoes`); the server appends **`-` + 6 random characters** (`acme-shoes-k3x9q2`). The final slug is **fixed** | Nobody has to hunt for a free slug; same start by many users never conflicts. The slug becomes part of the API URL `/v1/<slug>/...`; changing it later would break Jivox contracts. | Slugs are a bit longer and less pretty. Typos can't be fixed in Phase 1. |
| P1-10 | Slug **start** rules: 3–30 chars, `a-z 0-9 -`, starts with a letter, single hyphens, reserved words blocked (`api`, `admin`, `v1`, `new`...). Final slug ≤ 37 chars, globally unique | Safe in URLs; no clashes with our own routes. | |
| P1-11 | **One owner account per brand; one account can own many brands.** `organizations.owner_id` is a normal (non-unique) foreign key. No memberships, roles or invites (removed from scope, see section 9) | Matches the use case: whoever has the credentials manages those brands. | Sharing a brand = sharing the login (and with it, all that login's brands). |
| P1-12 | A brand is opened by **slug in the URL + owner check in the same query**; not yours → 404 | Nobody can reach another account's brand, and we don't reveal which slugs exist. | |
| P1-15 | The **current brand lives in the URL** (`/brands/acme`), not in the session | Two browser tabs can work on two different brands at the same time without interfering. Links can be bookmarked. | Every brand route carries `:slug`. |
| P1-16 | **No limit** on brands per account for now | Simple; we're the only users. | Add a limit later if needed (would need a transaction to be race-safe). |
| P1-13 | Frontend forms use plain React state + shadcn `Input`/`Label`; no form library, no data-fetching library | Fewer things to learn at once. | A bit more code per form. Can add later. |
| P1-14 | Errors always look like `{ "error": { "code", "message", "details"? } }`. Validation errors list each bad field in `details` | One shape for the frontend to handle. | |

## 5. Database tables (task 1.1)

```
users                         sessions
─────────────────────────     ─────────────────────────
id            (cuid, PK)      id          (cuid, PK)
email         (unique)        userId      → users.id   (delete user → delete sessions)
passwordHash                  tokenHash   (unique)     ← SHA-256 of the cookie value
name          (optional)      expiresAt
createdAt / updatedAt         createdAt

organizations
─────────────────────────
id            (cuid, PK)
ownerId       → users.id (indexed) ← one user can own many brands
name
slug          (unique)
createdAt / updatedAt
```

- `users` 1 ──── 0..many `organizations`: a user may have no brand yet (just signed up)
  or several. Each brand has exactly one owner (`ownerId` is required).
- `slug` stays **UNIQUE across all brands**, because it appears in public API URLs.
- History: migration `init_auth` first made `ownerId` UNIQUE (one brand per user);
  migration `allow_many_orgs_per_owner` replaced that with a normal index after the
  scope change.
- Every table we add later (projects, datasets, tokens...) will carry `organizationId`.
- Table and column names in the database will be snake_case (`owner_id`) via Prisma `@@map` / `@map`.

## 6. API endpoints

| Method | Path | Login needed | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/api/auth/signup` | no | `{ email, password, name? }` | `201 { user }` + cookie | 400 validation · 409 email already used |
| POST | `/api/auth/login` | no | `{ email, password }` | `200 { user }` + cookie | 400 validation · 401 invalid email or password |
| POST | `/api/auth/logout` | yes | – | `204` (cookie cleared, session deleted) | 401 |
| GET | `/api/auth/me` | yes | – | `200 { user }` | 401 |
| POST | `/api/organizations` | yes | `{ name, slug }` (`slug` = start; server adds `-xxxxxx`) | `201 { organization }` | 400 validation · 409 `SLUG_TAKEN` (only if 3 random suffixes in a row collide, practically never) |
| GET | `/api/organizations` | yes | – | `200 { organizations: [...] }` (**only mine**, newest first) | 401 |
| GET | `/api/organizations/:slug` | yes + owner | – | `200 { organization }` | 401 · 404 (doesn't exist **or** not mine) |

From Phase 2 on, everything inside a brand hangs under its slug, e.g.
`/api/organizations/:slug/projects`, and always passes through the same owner check.

`user` in responses = `{ id, email, name, createdAt }`, **never** `passwordHash`.

## 7. Frontend pages and pieces

| URL | Who can see it | What it shows |
|---|---|---|
| `/signup` | logged-out only | Email, name (optional), password → creates account, logs in, goes to `/` |
| `/login` | logged-out only | Email, password → goes to `/` |
| `/` ("Your brands") | logged-in | List of my brands as cards; empty state "Create your first brand"; **New brand** button |
| `/brands/new` | logged-in | Create brand: name + slug (auto-filled from name, editable) → goes to the new brand |
| `/brands/:slug` | logged-in **owner** | Brand page: name, slug, "your future API base URL: `/v1/<slug>`". Not mine → not-found message |
| any other | – | Not found page |

Pieces:
- `lib/api.ts`: one `apiFetch()` helper that turns `{ error: {...} }` responses into a typed `ApiError`.
- `auth/AuthProvider.tsx`: loads `/api/auth/me` once at startup; gives every page `user`, `login()`, `signup()`, `logout()`.
- `auth/RequireAuth.tsx`: route guard. Not logged in → `/login`.
- Sidebar: **Brands** link. Header: user email, **Log out** button, health badge. On a brand page the header also shows the brand name.

## 8. Tasks in detail

### 1.1 Database tables + first migration
- Add `User`, `Session`, `Organization` to `schema.prisma`.
- Run the first migration → creates the tables + a `prisma/migrations/` folder (committed to Git).
- **New concept:** migrations (versioned, repeatable DB changes).
- **Verify:** `npx prisma studio` (or `psql`) shows the 3 empty tables.

### 1.2 Shared helpers
- `AppError` class: `throw new AppError(409, 'EMAIL_TAKEN', 'Email already in use')`.
- `validate()` helper: checks `req.body` against a Zod schema; bad input → `400 VALIDATION_ERROR` with per-field `details`.
- Update `error-handler.ts` to understand both.
- **Verify:** a temporary bad request returns a clean 400 with field messages.

### 1.3 Sign up
- Install `argon2` (`cookie-parser` moved to 1.4, where cookies are first read).
- `auth.schemas.ts` (Zod), `auth.service.ts` (hash password, create user, create session), `auth.routes.ts`.
- `lib/session.ts`: create token, hash it, set/clear cookie (one place for cookie settings).
- **Verify (curl):** sign up → 201 + `Set-Cookie: sid=...; HttpOnly`; same email again → 409; short password → 400; in the DB the password column holds `$argon2id$...`, not the password.

### 1.4 Log in, log out, me, session middleware
- Install `cookie-parser` + `@types/cookie-parser`.
- `middleware/load-session.ts`: cookie → session → `req.user` (deletes expired sessions it finds).
- `middleware/require-auth.ts`: no `req.user` → 401.
- Login, logout, me: routes + controller + service functions (see ARCHITECTURE.md). `cookie` is already redacted in logs; check it.
- **Verify (curl with a cookie jar):** login → me works → logout → me gives 401; wrong password → 401 same message as unknown email.

### 1.5 Brand API: detailed plan (for review before coding)

#### What "brand API" means here

A **brand** (table `organizations`) is a workspace that belongs to one account. Everything
we build later (projects, CSV data, tokens, the public `/v1/<slug>/...` API) lives *inside*
a brand. Task 1.5 builds only the brand itself: **create one, list mine, open one of mine**.
It also builds the **"is this brand yours?" check** that every later brand route will reuse.

#### The 3 endpoints

All three need a logged-in user (`requireAuth`), so without a session cookie → `401 UNAUTHENTICATED`.

**1. Create a brand: `POST /api/organizations`**

```
Request body:  { "name": "Acme Shoes", "slug": "acme-shoes" }

201 Created
{ "organization": { "id": "cm…", "name": "Acme Shoes", "slug": "acme-shoes", "createdAt": "2026-10-10T…Z" } }
```

| Problem | Response |
|---|---|
| name/slug missing or breaks a rule (below) | `400 VALIDATION_ERROR` with per-field `details` |
| slug already used by **anyone** (any account) | `409 SLUG_TAKEN` "This slug is already in use" |
| not logged in | `401 UNAUTHENTICATED` |

The owner is **always** the logged-in user (`req.user.id`). The body has no `ownerId`
field, and if someone sends one it is ignored.

**2. List my brands: `GET /api/organizations`**

```
200 OK
{ "organizations": [
    { "id": "…", "name": "Acme Kids",  "slug": "acme-kids",  "createdAt": "…" },
    { "id": "…", "name": "Acme Shoes", "slug": "acme-shoes", "createdAt": "…" }
] }
```
- Only brands where `owner_id = me`, newest first. No brands yet → `[]` (not an error).
- No pagination for now (an account will have a handful of brands; see "Not in 1.5").

**3. Open one of my brands: `GET /api/organizations/:slug`**

```
GET /api/organizations/acme-shoes
200 OK  { "organization": { "id": "…", "name": "Acme Shoes", "slug": "acme-shoes", "createdAt": "…" } }
```

| Case | Response |
|---|---|
| slug exists and is **mine** | `200` |
| slug exists but belongs to **another account** | `404 ORGANIZATION_NOT_FOUND` |
| slug doesn't exist at all | `404 ORGANIZATION_NOT_FOUND` (same answer, on purpose) |

#### The ownership check: `requireOrganization` middleware

The most important piece, reused by every later brand route
(`/api/organizations/:slug/projects`, `/tokens`, ...):

```
GET /api/organizations/acme-shoes/...
  └─ requireAuth          → req.user (who is calling)
  └─ requireOrganization  → ONE query:  WHERE slug = 'acme-shoes' AND owner_id = req.user.id
                               found     → req.organization = that brand → continue
                               not found → 404 ORGANIZATION_NOT_FOUND
  └─ controller           → uses req.organization (never looks up a brand itself)
```

Why **one** query with both conditions, instead of "find by slug, then check owner"?
- There's no gap between "find" and "check" where a mistake could slip in.
- Someone else's brand and a non-existent brand look exactly the same (404), so nobody can
  probe which slugs exist by trying URLs. (`POST` with a taken slug does reveal it's taken;
  that's unavoidable, because slugs are globally unique and public in `/v1/<slug>` URLs anyway.)

#### Input rules

| Field | Rule | Examples |
|---|---|---|
| `name` | trimmed, 1–100 characters, any text | `"Acme Shoes"`, `"Café Ünïcode"` ✔ · `"   "` ✘ |
| `slug` | trimmed + lower-cased first, then: 3–40 chars, only `a-z`, `0-9`, `-`; starts with a letter; no `--`; doesn't end with `-`; not a reserved word | `acme-shoes`, `brand2` ✔ · `ab`, `2brand`, `acme_shoes`, `acme--shoes`, `acme-`, `api` ✘ |

- `"  Acme-Shoes "` becomes `acme-shoes` (same cleaning idea as emails).
- **Reserved slugs** (would clash with our own URLs or look official): `api`, `v1`, `v2`,
  `admin`, `app`, `www`, `auth`, `login`, `logout`, `signup`, `health`, `docs`, `static`,
  `assets`, `new`, `settings`, `brands`, `organizations`.
- `new` is reserved because the frontend uses `/brands/new` for the "create brand" page.
- The **frontend** (task 1.7) will suggest a slug from the name (`Acme Shoes` → `acme-shoes`),
  but the **backend requires `slug`** explicitly. The API stays simple and predictable: the
  backend never invents slugs, and there's no surprise `acme-shoes-2`.

#### Concurrency: what happens when requests race

| Race | Expected result | Why it's safe |
|---|---|---|
| Two accounts create `acme-shoes` at the same instant | one `201`, one `409 SLUG_TAKEN` | `organizations_slug_key` UNIQUE index; the service maps P2002 → 409 (with `cause`) |
| One account creates 10 brands with different slugs at once | 10 × `201` | no shared counter or lock needed |
| Same request sent twice (double-click) | `201` + `409 SLUG_TAKEN` | the slug is the natural "idempotency key" |
| Account deleted while a create is in flight | `401` on the next request; the in-flight insert fails on the foreign key | `organizations_owner_id_fkey`; very rare, will show as a 500 with cause `P2003` in logs (acceptable) |
| Many users listing/opening brands at once | all succeed | read-only queries; `req.organization` lives on each request |

We do **not** check "is the slug free?" before inserting (that would race). We insert and let
the unique index decide, like sign-up.

#### Files I plan to touch

| File | Change |
|---|---|
| `src/modules/organizations/organizations.schemas.ts` | **new**: `createOrganizationSchema` (name + slug rules, reserved list) |
| `src/modules/organizations/organizations.service.ts` | **new**: `createOrganization(ownerId, input)`, `listOrganizations(ownerId)`, `findOwnedOrganization(ownerId, slug)`, `publicOrganizationSelect`, `PublicOrganization` type |
| `src/modules/organizations/organizations.controller.ts` | **new**: `create`, `list`, `getOne` |
| `src/modules/organizations/organizations.routes.ts` | **new**: `router.use(requireAuth)`; `POST /`, `GET /`, `GET /:slug` (with `requireOrganization`) |
| `src/middleware/require-organization.ts` | **new**: the ownership check above → `req.organization` |
| `src/types/express.d.ts` | add `organization?: PublicOrganization` to `Request` |
| `src/app.ts` | mount `app.use('/api/organizations', organizationsRouter)` |
| `docs/test-scripts/phase-01-task-1.5-organizations.sh` | **new**: scenario script like 1.4's |
| `docs/ARCHITECTURE.md` | add `SLUG_TAKEN`, `ORGANIZATION_NOT_FOUND` to the error-code table |

No DB migration needed: the table and indexes exist since task 1.1.

#### Scenarios I will test

1. **Create:** valid → 201 with the right owner in the DB; `"  Acme-Shoes "` → stored `acme-shoes`;
   missing name/slug, each bad slug example from the table, reserved slug → 400 with field details;
   extra `ownerId` in the body is ignored.
2. **Duplicates:** same slug by the same account → 409; by another account → 409 `SLUG_TAKEN`.
3. **List:** A has 2 brands, B has 1 → A sees exactly 2 (newest first), B sees 1; new account → `[]`.
4. **Open:** own slug → 200; other account's slug → 404; unknown slug → 404; **the two 404
   bodies are identical** (apart from `requestId`).
5. **Auth:** all 3 endpoints without a cookie → 401; with a logged-out cookie → 401.
6. **Concurrency:** 10 parallel creates of the *same* slug by different accounts → 1 × 201 + 9 × 409,
   1 row; 10 parallel creates of *different* slugs by one account → 10 × 201; 20 parallel
   list/open requests → all 200.
7. **Cascade:** delete an account → its brands are gone; their slugs become free again.
8. **Logs:** a 409 shows `causes: [{ code: "P2002", … organizations_slug_key }]`.

#### Not in 1.5 (deliberately)

| Not doing | Why |
|---|---|
| Rename brand / change slug | Slug is fixed by design (P1-9); renaming the *name* isn't needed yet |
| Delete brand | Not needed for testing Jivox; adds "what happens to its data" questions (Phase 2+) |
| Pagination of the brand list | A handful of brands per account |
| Limit on brands per account | P1-16 |
| Server-generated slugs | Frontend suggests; backend stays explicit |

#### Review outcome (2026-10-10)

All suggestions accepted, **plus one change from you**: the server appends a random
6-character suffix to the slug (`acme-shoes` → `acme-shoes-k3x9q2`). The sections above that
say "409 when the slug is taken" are superseded: same-start slugs now all succeed
(see "Built" notes in sections 12–14).

| # | Question | Decision |
|---|---|---|
| Q-1.5-a | Backend **requires** `slug` (frontend suggests it), rather than generating it? | ✅ Required, as the *start*; server adds the random suffix |
| Q-1.5-b | Reserved slug list | ✅ As listed |
| Q-1.5-c | Slug length | ✅ start 3–30 (+ 7 for `-xxxxxx` = max 37) |
| Q-1.5-d | Renaming a brand's name | ✅ Later |
| Q-1.5-e | Other account's brand → 404 | ✅ 404 |

### 1.6 Frontend: auth pages: detailed plan (for review before coding)

#### Look and feel

A clean, modern SaaS look (think Linear / Vercel / Stripe dashboard): lots of white space,
one accent color, crisp typography, subtle borders, smooth but small animations.

| Element | Choice |
|---|---|
| Base | shadcn/ui "Nova" theme we already have (neutral grays, Geist font) |
| Accent color | **Violet** (`violet-600`), used for primary buttons, links, focus rings, active nav. Close to Jivox's purple/magenta, but calmer |
| Corners / borders | `rounded-xl` cards, 1px light borders, very soft shadow on cards only |
| Dark mode | Follows the computer's setting automatically (shadcn tokens already support `.dark`) |
| Icons | `lucide-react` (already installed) |
| Feedback | Inline field errors + a small **toast** (top-right) for success and network errors, via shadcn's `sonner` |
| Motion | 150 ms fades on page change and on errors; button spinner while waiting. No heavy animation libraries |

#### Auth pages layout (`/login`, `/signup`)

```
┌──────────────────────────────┬──────────────────────────────────┐
│  ◆ API Platform              │                                  │
│                              │        Welcome back              │
│  Live product data for       │        Log in to your account    │
│  AI agents, in minutes.      │                                  │
│                              │   Email     [ name@company.com ] │
│  ┌────────────────────────┐  │   Password  [ ••••••••     👁 ]  │
│  │ GET /v1/acme…/prices   │  │                                  │
│  │ { "status": "success", │  │   [       Log in        ]  ← violet
│  │   "data": [ … ] }      │  │                                  │
│  └────────────────────────┘  │   No account? Create one →       │
│  (dark violet panel)         │                                  │
└──────────────────────────────┴──────────────────────────────────┘
   left panel hidden on mobile; form becomes full width
```

- **Left panel**: dark violet brand panel with a tagline and a small code card showing a
  sample API response (it says what the product does at a glance). Hidden on small screens.
- **Right panel**: the form, centered, max 360 px wide.
- **Sign up** has the same layout, with fields Name (optional), Email, Password (with the hint
  "At least 8 characters"), button "Create account", and the link "Already have an account? Log in".

#### Form behaviour

| Situation | What the user sees |
|---|---|
| Typing | Nothing shouts at them while typing |
| Submit with empty / invalid fields | Quick **browser-side** check (required, email format, 8+ chars) → red text under the field. No request sent |
| Waiting for the server | Button shows a spinner + "Logging in…", **button disabled → no double submit** |
| `400 VALIDATION_ERROR` from server | Each `details[]` message under its field (server is the final judge) |
| `401 INVALID_CREDENTIALS` | Red box above the button: "Invalid email or password" (same text for both cases) |
| `409 EMAIL_TAKEN` | Under the email field: "An account with this email already exists", plus a "Log in instead" link |
| Server/network down | Toast: "Can't reach the server. Try again." |
| Success | Toast "Welcome back" / "Account created", then go to the app |

Extras: show/hide password button (eye icon), correct `autoComplete` attributes so password
managers work (`email`, `current-password`, `new-password`), autofocus on the first field,
labels + `aria-invalid` + `aria-describedby` for screen readers, Enter submits.

#### App shell after login (small update to Phase 0's layout)

```
┌────────────┬──────────────────────────────────────────────────────┐
│ ◆ API      │                          ● Backend OK · DB OK   (AL)▾ │
│  Platform  ├──────────────────────────────────────────────────────┤
│            │                                                      │
│ ▣ Brands   │   Your brands            (page content; Phase 1.7)   │
│            │                                                      │
│            │                                                      │
│            │                                                      │
│ alice@…    │                                                      │
└────────────┴──────────────────────────────────────────────────────┘
       (AL)▾ = avatar with initials → menu: name, email, "Log out"
```

**Log out moves into 1.6** (it's part of the auth flow); 1.7 then only adds the brand pages.

#### How the code is organised

```
frontend/src/
├── lib/
│   ├── api.ts            apiFetch(): one place for every backend call; turns
│   │                     { error: { code, message, details } } into an ApiError
│   └── api-types.ts      User, Organization, ApiErrorBody types (match the backend)
├── auth/
│   ├── AuthProvider.tsx  holds `user`; on app start calls GET /api/auth/me once;
│   │                     login(), signup(), logout() functions
│   ├── useAuth.ts        hook: const { user, login, logout } = useAuth()
│   ├── RequireAuth.tsx   guard: not logged in → /login (remembers where you were going)
│   └── RedirectIfAuthed.tsx  guard: logged in and visiting /login → /
├── pages/
│   ├── LoginPage.tsx
│   ├── SignupPage.tsx
│   └── DashboardPage.tsx (stays as the logged-in home until 1.7)
└── components/
    ├── auth/AuthLayout.tsx   the two-panel layout above
    ├── auth/PasswordInput.tsx  input + show/hide button
    ├── layout/AppLayout.tsx  (updated) user menu in the header
    ├── layout/UserMenu.tsx   avatar + dropdown + log out
    └── ui/…                  shadcn: input, label, alert, dropdown-menu, avatar, sonner
```

Same layering idea as the backend: **pages** (what you see) → **AuthProvider / api.ts**
(state + calls) → **backend**. Pages never call `fetch` directly.

#### Robustness: many tabs, expired sessions, slow networks

| Scenario | Behaviour |
|---|---|
| App opens | One `GET /api/auth/me` → full-page spinner (≤ a moment) → app or login. No flash of the login page for logged-in users |
| Session expires / logged out in **another tab** | The next API call returns `401` → `apiFetch` tells AuthProvider → user cleared → redirected to `/login` with a toast "Your session expired. Log in again." |
| Double-click on "Log in" | Button disabled while waiting; only one request is sent |
| Page refresh | Still logged in (cookie + `/me`) |
| Visiting `/brands/…` while logged out | Sent to `/login`; after login, **back to the page you wanted** |
| Already logged in, visiting `/login` | Sent to `/` |
| Backend down | Health badge red + toast on submit; forms stay filled in (nothing lost) |

#### New packages / shadcn components

- `npx shadcn add input label alert dropdown-menu avatar sonner`
  (copies components; installs `sonner` + Radix parts). **No other libraries**: no form
  library, no data-fetching library (decision P1-13).

#### How I'll test it (in the built-in browser + curl)

1. Sign up → lands in the app, toast shown, header shows initials/email.
2. Refresh → still logged in. Log out → `/login`; Back button doesn't reveal the app.
3. Log in with wrong password / unknown email → same red message.
4. Sign up with an existing email → error under email + "Log in instead".
5. Empty submit / bad email / 7-char password → field errors, **no request sent** (checked in the network log).
6. Double-click submit → exactly **one** request in the network log.
7. Two tabs: log out in tab A → any action in tab B → redirected to `/login` with the toast.
8. Visit a protected URL while logged out → login → returns to that URL.
9. Mobile width (375 px) → single column, nothing cut off. Dark mode → readable.
10. Backend stopped → friendly toast, badge red, form keeps its values.
11. Regression: backend scripts 1.4 (44) and 1.5 (53) still pass; `npm run build` passes.

#### Review outcome (2026-10-10)

All suggestions approved (violet, dark mode follows system, two-panel login, toasts,
log out in 1.6, "API Platform"). See sections 12–14 for what was built and tested.

| # | Question | My suggestion |
|---|---|---|
| Q-1.6-a | Violet accent color? (or match Jivox magenta exactly, or another color) | Violet |
| Q-1.6-b | Dark mode follows the computer setting automatically? | Yes |
| Q-1.6-c | Two-panel login (brand panel + form)? | Yes |
| Q-1.6-d | Toasts with `sonner` for success / network errors? | Yes |
| Q-1.6-e | Move **Log out + user menu** into 1.6 (1.7 = brand pages only)? | Yes |
| Q-1.6-f | Product name shown in the UI: "API Platform"? (or another name) | "API Platform" for now |

### 1.7 Frontend: guards, brands list, create brand, brand page, header
- `RequireAuth` guard; "Your brands" list; `/brands/new` with slug auto-suggest; `/brands/:slug` page; header with email + Log out.
- **Verify:** logged out → visiting `/` redirects to `/login`; create two brands → both listed; open each; two tabs on two brands work side by side; typing another account's slug in the URL shows not-found; log out → back to `/login`.

### 1.8 End-to-end isolation test + wrap-up
- Two users in two browser windows (one normal, one private).
- Check every row of section 10 below; fill in commands log, files table and summary.

## 9. Scope check (against the ROADMAP)

**In scope (from ROADMAP section 4 + decision D6):**

| Roadmap item | Covered by |
|---|---|
| Sign up / log in (session cookie) | 1.3, 1.4, 1.6 |
| One owner per brand; an owner can have many brands (D7) | 1.1 (`owner_id` FK + index), 1.5 |
| Brands with strict data isolation | 1.5 (`require-organization`: slug **and** owner in one query), 1.8 |
| D6: session stored in DB + httpOnly cookie | P1-1 … P1-4 |

**Removed from the whole project (your decision, 2026-10-09):**
multiple people per brand: memberships, roles, team invites.
Each brand has one owner login; whoever has the credentials manages that login's brands.

**Added (your decision, 2026-10-09):** one account can own **many** brands.

**Deliberately NOT in Phase 1:**

| Not doing | Why / when |
|---|---|
| Forgot password, email verification | Needs an email service; out of scope |
| Google / SSO login | Out of scope |
| Multiple users per brand, roles, invites | **Removed from the project** (see above) |
| Editing / deleting the brand or account; changing the slug | Not needed for Jivox testing; slug is fixed on purpose (P1-9) |
| Login rate limiting / account lockout | Rate limits are out of scope; noted as a known risk below |
| "Remember me", sliding sessions | Fixed 7 days is enough (P1-4) |
| CSRF tokens | `SameSite=Lax` + JSON-only bodies are enough for now |
| Form library (react-hook-form), data library (TanStack Query) | Learn the basics first (P1-13) |
| Automated tests | Project rule |

**Known risks we accept for now:** no limit on login attempts (password guessing);
no way to reset a forgotten password (fine for local/test use). Both are listed for Phase 10.

**New packages this phase:**
- Backend: `argon2`, `cookie-parser`, `@types/cookie-parser`
- Frontend: shadcn `input`, `label` components (no new npm libraries beyond what shadcn needs)

## 10. How to verify the whole phase

Checked end to end in task 1.8 (2026-10-10) with two users: **Alice** in the browser and
**Bob** through curl, then Bob in the browser. Evidence next to each item.

- [x] **Sign up, log in, refresh: still logged in.** Alice signed up in the browser → "Your brands"; reload → still there.
- [x] **Log out: `/` redirects to `/login`; the old cookie no longer works.** Alice: user menu → Log out → visiting `/` → `/login`. Bob: logout `204`, then his old cookie → `/me` **401** and `/api/organizations` **401**.
- [x] **Wrong password and unknown email show the same error.** Bodies identical apart from `requestId`: `{"code":"INVALID_CREDENTIALS","message":"Invalid email or password"}`.
- [x] **`password_hash` starts with `$argon2id$`; `token_hash` is not the cookie value.** All 3 users argon2id; the raw cookie value is **not** in `sessions`; `sha256(cookie)` **is**.
- [x] **A request with a cookie logs `"cookie":"[Redacted]"`.** 81 redacted lines; the session token appears **0** times and passwords **0** times in the log.
- [x] **User A only ever sees A's brands; user B only B's (curl and browser); opening the other's slug → 404.** Alice's list: her 2 brands. Bob's list (browser): his 12, none of Alice's. Alice opening `bolt-bikes-8ocs76` → "Brand not found"; Bob opening `acme-shoes-ukrdab` → "Brand not found" (API **404**).
- [x] **Duplicate email → 409 (also when sign-ups race).** `ALICE@acme.com` → **409**; 10 parallel sign-ups `carol@race.com` → **1 × 201 + 9 × 409**.
- [x] **Slugs never conflict (scope change: random suffix); one account can own several brands.** Alice created "Acme Shoes" twice → `acme-shoes-ukrdab` + `acme-shoes-8jv2um`; Bob used the same start → `acme-shoes-m3vb07`; Bob's 10 parallel creates → **10 × 201**; all 14 slugs unique.
- [x] **The cookie is `HttpOnly`; `SameSite=Lax`.** In the browser `document.cookie` does **not** contain `sid` (JavaScript can't read it); the `Set-Cookie` header shows `HttpOnly; SameSite=Lax` (1.4 script).
- [x] **Everything still passes.** Backend scripts: auth **44/44**, brands **53/53**; backend typecheck clean; frontend build ✓, lint only the 2 known shadcn warnings; **0** server errors (5xx) during the whole run.

Per-task scenario lists: 1.4 (44 checks), 1.5 (53 checks), 1.6 (12 browser scenarios),
1.7 (12 browser scenarios), all in section 12.

## 11. Questions for your review

| # | Question | My suggestion |
|---|---|---|
| Q1 | ~~One brand per user?~~ **Answered:** one owner account per brand, an account can own many brands, no team members | ✅ Decided |
| Q2 | Slug chosen at creation and then **fixed** (P1-9)? | Yes |
| Q3 | Session length 7 days (P1-4)? | Yes |
| Q4 | Password rule: only 8–128 characters (P1-6)? | Yes |
| Q5 | Name at sign-up optional? | Yes |

---

## 12. Commands log

### Task 1.1: Database tables + first migration

| # | Where | Command | Why |
|---|---|---|---|
| 1 | `backend/` | *(replace `prisma/schema.prisma`, see Files touched)* | Describe the 3 tables in Prisma's language. |
| 2 | `backend/` | `npx prisma format` | Auto-formats the schema (lines up columns). Optional but tidy. |
| 3 | `backend/` | `npx prisma validate` | Checks the schema for mistakes **without** touching the DB. Expect `The schema ... is valid 🚀`. |
| 4 | `backend/` | `npx prisma migrate dev --name init_auth` | Compares the schema to the DB, **writes the SQL** into `prisma/migrations/<timestamp>_init_auth/migration.sql`, and **runs it**. `--name` labels the migration. |
| 5 | `backend/` | `npx prisma generate` | Rebuilds the TypeScript client so `prisma.user`, `prisma.session`, `prisma.organization` exist in code. (In Prisma 7, `migrate dev` does **not** do this for you.) |
| 6 | `backend/` | `npm run typecheck` | Make sure the existing code still compiles. No output = OK. |
| 7 | `backend/` | `npx prisma migrate status` | Expect `Database schema is up to date!` |
| 8 | anywhere | `psql "postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev" -c '\dt'` | List tables: `users`, `sessions`, `organizations` + Prisma's own `_prisma_migrations`. Use **your** DB name (`api_platform_mine`). |
| 9 | anywhere | `psql "<your DB url>" -c '\d users'` | Show columns, indexes and constraints of one table (try `\d sessions`, `\d organizations` too). |

**Concurrency test** (optional, but this is how we proved it). Two inserts run **at the same
time** (`&` = run in background, `wait` = wait for both):

```bash
DB="postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_mine"
for i in 1 2; do psql "$DB" -qtAc "INSERT INTO users (id,email,password_hash,updated_at) VALUES ('race$i','race@test.com','x',now())" & done; wait
psql "$DB" -tAc "SELECT count(*) FROM users WHERE email='race@test.com'"   # → 1
psql "$DB" -qtAc "DELETE FROM users"                                       # clean up
```

One request prints `duplicate key value violates unique constraint "users_email_key"`, and
exactly **1** row exists. Results we got:

| Race | Result |
|---|---|
| Two sign-ups with the same email at once | 1 saved, 1 rejected by `users_email_key` |
| Same user creates two brands at once | ~~1 saved, 1 rejected~~ → after the scope change: **both saved** (different slugs) ✔ |
| Two users claim the same slug at once | 1 saved, 1 rejected by `organizations_slug_key` (re-tested after the change ✔) |
| Brand for a user that doesn't exist | Rejected by the foreign key `organizations_owner_id_fkey` |
| Delete a user with a brand + session | Brand and session deleted automatically (`ON DELETE CASCADE`) |

### Task 1.2: Shared helpers (AppError, validate, 409 mapping)

No new packages. Everything uses Zod (installed in Phase 0) and Prisma's error classes.

| # | Where | Command | Why |
|---|---|---|---|
| 1 | `backend/` | *(create `src/lib/app-error.ts`, `src/lib/validate.ts`, `src/lib/prisma-errors.ts`; replace `src/middleware/error-handler.ts` and `src/middleware/not-found.ts`, see Files touched)* | |
| 2 | `backend/` | `npm run typecheck` | No output = OK. |
| 3 | `backend/` | `npm run dev` | Start the server to test. |

**How I found where Prisma 7 puts the constraint name** (worth knowing for debugging):
a throw-away script inserted the same email twice and printed the error. With the `pg`
driver adapter the classic `err.meta.target` is **missing**; the name is in
`err.meta.driverAdapterError.cause.constraint.index` (`"users_email_key"`). Codes:
`P2002` = unique violation, `P2025` = row to update/delete not found.

**Optional: try it yourself with a temporary debug router.** Create
`src/modules/debug/debug.routes.ts`:

```ts
// TEMPORARY: delete after testing.
import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/app-error.js';
import { prisma } from '../../lib/prisma.js';
import { validate } from '../../lib/validate.js';

export const debugRouter = Router();

const demoSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  age: z.number().int().min(18),
});

debugRouter.post('/validate', (req, res) => {
  res.json({ received: validate(demoSchema, req.body) });
});
debugRouter.get('/app-error', () => {
  throw new AppError(409, 'DEMO_CONFLICT', 'This is a demo conflict');
});
debugRouter.get('/crash', () => {
  throw new Error('secret internal detail: db password is hunter2');
});
debugRouter.post('/users', async (req, res) => {
  const { email } = validate(z.object({ email: z.email() }), req.body);
  const user = await prisma.user.create({ data: { email, passwordHash: 'not-a-real-hash' } });
  res.status(201).json({ id: user.id });
});
```

and in `src/app.ts` add `import { debugRouter } from './modules/debug/debug.routes.js';`
and `app.use('/api/_debug', debugRouter);` right after the health route. Then (second terminal):

| # | Command | Expected |
|---|---|---|
| 4 | `curl -X POST localhost:4000/api/_debug/validate -H 'content-type: application/json' -d '{"email":"not-an-email","age":12}'` | `400 VALIDATION_ERROR` with `details` for **both** `email` and `age` |
| 5 | `curl -X POST localhost:4000/api/_debug/validate -H 'content-type: application/json' -d '{"email":"  Bob@X.COM ","age":30}'` | `{"received":{"email":"bob@x.com","age":30}}` (trimmed + lower-cased) |
| 6 | `curl -i localhost:4000/api/_debug/app-error` | `409 {"error":{"code":"DEMO_CONFLICT",...,"requestId":"..."}}`; `requestId` = the `X-Request-Id` header |
| 7 | `curl -i localhost:4000/api/_debug/crash` | `500 INTERNAL_ERROR "Something went wrong"`. `hunter2` appears **only** in the server log |
| 8 | `curl -X POST localhost:4000/api/_debug/validate -H 'content-type: application/json' -d '{bad'` | `400 INVALID_JSON` |
| 9 | `curl localhost:4000/api/nope` | `404 NOT_FOUND`, now also with `requestId` |
| 10 | `for i in $(seq 1 10); do curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:4000/api/_debug/users -H 'content-type: application/json' -d '{"email":"race@test.com"}' & done \| sort \| uniq -c; wait` | **10 requests at once** → `1 201` and `9 409`. **No 500s.** DB has exactly 1 row |
| 11 | `psql "<your DB url>" -c "DELETE FROM users"` | Clean up test rows |

Then **delete** `src/modules/debug/` and the two lines in `app.ts` (I did; `app.ts` is back to how it was).

### Task 1.3: Sign up

| # | Where | Command | Why |
|---|---|---|---|
| 1 | `backend/` | `npm install argon2` | Password hashing (argon2id). Ships prebuilt native code for Mac, nothing to compile. `cookie-parser` is **not** installed yet: sign-up only *sets* a cookie (`res.cookie` is built into Express); *reading* cookies starts in 1.4. |
| 2 | `backend/` | *(create `src/lib/session.ts`, `src/modules/auth/auth.schemas.ts`, `auth.service.ts`, `auth.routes.ts`; edit `src/app.ts` and `src/lib/prisma.ts`, see Files touched)* | |
| 3 | `backend/` | `npm run typecheck` | First run failed with `Type 'number' is not assignable to type '0 \| 1 \| 2'` → fixed with `as const` on the argon2 options (see notes). |
| 4 | `backend/` | `npm run dev` | |

**Tests** (second terminal; use your DB name in `psql`):

| # | Command | Expected |
|---|---|---|
| 5 | `curl -i -X POST localhost:4000/api/auth/signup -H 'content-type: application/json' -d '{"email":"  Alice@Acme.com ","password":"correct horse battery","name":"Alice"}'` | `201`, header `Set-Cookie: sid=...; Path=/; Expires=<7 days>; HttpOnly; SameSite=Lax`, body `{"user":{"id":...,"email":"alice@acme.com","name":"Alice","createdAt":...}}`: **no** password hash |
| 6 | same command with `"email":"ALICE@acme.com"` | `409 EMAIL_TAKEN` (emails are lower-cased, so it's the same account) |
| 7 | `curl -X POST localhost:4000/api/auth/signup -H 'content-type: application/json' -d '{"email":"nope","password":"short"}'` | `400 VALIDATION_ERROR`, details for `email` **and** `password` |
| 8 | `psql "<db url>" -c "SELECT email, left(password_hash,30) FROM users"` | `alice@acme.com \| $argon2id$v=19$m=19456,p=1,t=2...` |
| 9 | `psql "<db url>" -c "SET timezone='UTC'; SELECT created_at FROM users"` and compare with `date -u` | **Same time** (not 5h30 off; see the timezone bug below) |
| 10 | `psql "<db url>" -c "SELECT round(extract(epoch from expires_at - now())/86400.0, 3) FROM sessions"` | `7.000` (days) |
| 11 | Take the `sid` value from #5 and run `printf %s '<sid>' \| shasum -a 256` | Equals `token_hash` in `sessions`: the DB holds only the hash |
| 12 | `for i in $(seq 1 10); do curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:4000/api/auth/signup -H 'content-type: application/json' -d '{"email":"race@test.com","password":"password123"}' & done \| sort \| uniq -c; wait` | `1 201` + `9 409`; DB: 1 user, 1 session, 0 orphan sessions |
| 13 | `grep -c password123 <your server log>` (or just look at the terminal) | `0`: request bodies are never logged |
| 14 | `psql "<db url>" -c "DELETE FROM users"` | Clean up (sessions go too, thanks to `ON DELETE CASCADE`) |

### Task 1.3b: Layers refactor (routes → controller → service) + error `cause` chain

No new packages, no DB changes. Pure restructuring + better error logs. Rules: [../ARCHITECTURE.md](../ARCHITECTURE.md).

| # | Where | Command / action | Why |
|---|---|---|---|
| 1 | `backend/` | *(edit/create the files in "Files touched → 1.3b")* | |
| 2 | `backend/` | `npm run typecheck` | No output = OK. |
| 3 | `backend/` | `npm run dev` | |
| 4 | 2nd terminal | `curl localhost:4000/api/health` | Still `200 {"status":"ok","db":"up",...}` (health now has routes/controller/service too). |
| 5 | 2nd terminal | Sign up `dup@test.com` twice (`curl -X POST localhost:4000/api/auth/signup -H 'content-type: application/json' -d '{"email":"dup@test.com","password":"password123"}'`) | 2nd → `409 EMAIL_TAKEN`. **Server log** shows `WARN: EMAIL_TAKEN: ...` with `"causes":[{"code":"P2002","message":"Unique constraint failed on ... users_email_key"}]` and the stack `AppError ... caused by: PrismaClientKnownRequestError ... auth.service.ts:39`. |
| 6 | 2nd terminal | `brew services stop postgresql@18`, then sign up `down@test.com` | Caller: `500 INTERNAL_ERROR "Something went wrong"` + `requestId`. Log: `ERROR: INTERNAL_ERROR: unhandled error` with `"causes":[{"code":"ECONNREFUSED",...}]`: the real reason. |
| 7 | 2nd terminal | `brew services start postgresql@18` and `psql "<db url>" -c "DELETE FROM users"` | Restore + clean up. |

### Task 1.4: Log in, log out, me, session middleware

| # | Where | Command | Why |
|---|---|---|---|
| 1 | `backend/` | `npm install cookie-parser` | Reads the `Cookie:` request header into `req.cookies` (`{ sid: "..." }`). |
| 2 | `backend/` | `npm install -D @types/cookie-parser` | TypeScript types for it. |
| 3 | `backend/` | *(create/edit the files in "Files touched → 1.4")* | |
| 4 | `backend/` | `npm run typecheck` | No output = OK. |
| 5 | `backend/` | `npm run dev 2>&1 \| tee /tmp/backend.log` | Start the server **and** keep a copy of the log for the test script's log checks. |
| 6 | `api-platform/` (2nd terminal) | `DB_URL="postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_mine" LOG_FILE=/tmp/backend.log bash docs/test-scripts/phase-01-task-1.4-auth.sh` | Runs **44 checks** (below). Expect `RESULT: 44 passed, 0 failed`. ⚠️ Deletes all users in that DB and briefly stops/starts PostgreSQL. |

**Manual curl version** (if you want to see each step). A **cookie jar** file (`-c` saves cookies, `-b` sends them) plays the role of a browser:

| # | Command | Expected |
|---|---|---|
| 7 | `curl -c /tmp/jar -X POST localhost:4000/api/auth/signup -H 'content-type: application/json' -d '{"email":"alice@acme.com","password":"password123"}'` | `201`; cookie saved in `/tmp/jar` |
| 8 | `curl -b /tmp/jar localhost:4000/api/auth/me` | `200 {"user":{...alice...}}` |
| 9 | `curl localhost:4000/api/auth/me` | `401 UNAUTHENTICATED` (no cookie) |
| 10 | `curl -c /tmp/jar2 -X POST localhost:4000/api/auth/login -H 'content-type: application/json' -d '{"email":"alice@acme.com","password":"password123"}'` | `200`; a second "browser" (`jar2`) is logged in |
| 11 | same with `"password":"nope"` and with `"email":"nobody@acme.com"` | both `401 INVALID_CREDENTIALS "Invalid email or password"`: identical |
| 12 | `curl -i -b /tmp/jar -c /tmp/jar -X POST localhost:4000/api/auth/logout` | `204`, `Set-Cookie: sid=; ... Expires=Thu, 01 Jan 1970` (browser drops it) |
| 13 | `curl -b /tmp/jar localhost:4000/api/auth/me` → `401`; `curl -b /tmp/jar2 localhost:4000/api/auth/me` → `200` | logging out one browser leaves the other logged in |

**The 44 checks, by group** (all passed):

| Group | What is checked |
|---|---|
| A. Sign-up session | signup cookie works for `/me`; `/me` sends `Cache-Control: no-store` |
| B. No valid session | no cookie → 401 `UNAUTHENTICATED`; garbage cookie → 401 **and** the browser is told to delete it; logout without cookie → 401 |
| C. Login | correct → 200 + `HttpOnly; SameSite=Lax` cookie, no `passwordHash` in body; `"  ALICE@Acme.com "` works; wrong password and unknown email → **identical** 401 bodies; bad input / broken JSON / 129-char password → 400 |
| D. Timing | wrong password ≈ unknown email (≈20 ms each), so response time doesn't reveal which emails exist |
| E. Logout | 204, cookie cleared, session row deleted, **replaying the old token → 401**, other browser still logged in |
| F. Re-login, same browser | old session deleted (count unchanged), old cookie → 401, new cookie works |
| G. Expired session | (expiry set to the past in SQL) → 401 and the row is deleted |
| H. User deleted | `/me` → 401 (sessions removed by `ON DELETE CASCADE`) |
| I. Concurrency | 20 parallel logins → 20 × 200 + 20 distinct sessions; 20 parallel `/me` → 20 × 200; **5 parallel logouts of the same session → 5 × 204, no 500**; 10 parallel wrong passwords → 10 × 401 |
| J. DB down | `/api/health` **with** a cookie → 503 (not 500); `/me` → 500 (can't check the session); DB back → same cookie works again |
| K. Logs | session token, passwords: 0 occurrences; `cookie` header shows `[Redacted]` |

Two checks failed on the first run; both were **bugs in the test script** (it accidentally logged in again with browser B's cookie, which correctly replaced B's session), not in the app. Fixed in the script.

### Task 1.5: Brands API

No new packages, no migration.

| # | Where | Command | Why |
|---|---|---|---|
| 1 | `backend/` | *(create/edit the files in "Files touched → 1.5")* | |
| 2 | `backend/` | `npm run typecheck` | No output = OK. |
| 3 | `backend/` | `npm run dev 2>&1 \| tee /tmp/backend.log` | Server + log copy for the test script. |
| 4 | `api-platform/` | `DB_URL="<your DB url>" LOG_FILE=/tmp/backend.log bash docs/test-scripts/phase-01-task-1.5-organizations.sh` | **53 checks** → `RESULT: 53 passed, 0 failed`. ⚠️ Deletes all users in that DB. |
| 5 | `api-platform/` | `DB_URL="<your DB url>" LOG_FILE=/tmp/backend.log bash docs/test-scripts/phase-01-task-1.4-auth.sh` | Regression: auth still `44 passed`. |

**Manual curl version:**

| # | Command | Expected |
|---|---|---|
| 6 | `curl -c /tmp/jar -X POST localhost:4000/api/auth/signup -H 'content-type: application/json' -d '{"email":"alice@acme.com","password":"password123"}'` | logged in |
| 7 | `curl -b /tmp/jar -X POST localhost:4000/api/organizations -H 'content-type: application/json' -d '{"name":"Acme Shoes","slug":"acme-shoes"}'` | `201 {"organization":{"id":…,"name":"Acme Shoes","slug":"acme-shoes-k3x9q2",…}}` (your suffix differs) |
| 8 | run #7 again | `201` again, **different** suffix |
| 9 | `curl -b /tmp/jar localhost:4000/api/organizations` | both brands, newest first |
| 10 | `curl -b /tmp/jar localhost:4000/api/organizations/<slug from #7>` | `200 { organization }` |
| 11 | sign up a 2nd user into `/tmp/jar2`, then `curl -b /tmp/jar2 localhost:4000/api/organizations/<slug from #7>` | `404 ORGANIZATION_NOT_FOUND` |
| 12 | `curl -b /tmp/jar -X POST localhost:4000/api/organizations -H 'content-type: application/json' -d '{"name":"X","slug":"api"}'` | `400`, `details: [{ field: "slug", message: "This slug is reserved" }]` |

**The 53 checks** (all passed):

| Group | Checked |
|---|---|
| A. Create (8) | 201; slug = `<start>-` + 6 chars `[a-z0-9]`; response has only `id, name, slug, createdAt`; owner = logged-in user; `"  Acme-Sport "` → `acme-sport-…`; name trimmed; **`ownerId` in body ignored**; 30-char start → 37-char slug |
| B. Same start (2) | same account twice → 2 different slugs; other account → a third different slug |
| C. Validation (16) | missing/blank/101-char name; missing slug; `ab`, `2brand`, `acme_shoes`, `acme--shoes`, `acme-`, `acme shoes`, 31 chars, `api`, `NEW`, `123` → each **400 on the right field**; `{}` → both fields; broken JSON → 400 |
| D. List (5) | each account sees exactly its own; no brands → `[]`; newest first; no cross-account leaks |
| E. Open (7) | own → 200; other account's → 404; unknown → 404; **both 404 bodies identical**; code `ORGANIZATION_NOT_FOUND`; uppercase slug → 404 |
| F. Auth (4) | create/list/open without cookie → 401; logged-out cookie → 401 |
| G. Concurrency (6) | 10 parallel creates, same start, one account → 10 × 201, 10 distinct slugs; 2 accounts × 5 parallel → 10 × 201, 5 each; 20 parallel list/open → 200; 10 parallel "open someone else's" → 10 × 404 |
| H. Cascade (2) | delete account → its brands deleted |
| I. Database (2) | no slug > 40 chars; all slugs unique |
| J. Logs (1) | no 5xx on `/api/organizations` during the run |

**Retry path (forced once by hand, not in the script):** temporarily set `SUFFIX_ALPHABET = 'a'`
so every suffix is `aaaaaa`. 1st create → `201 retry-aaaaaa`; 2nd → all 3 attempts collide →
`409 SLUG_TAKEN`, log `causes: [{ code: "P2002", … organizations_slug_key }]`. Then restored
the real alphabet and re-ran both scripts (44 + 53 passed).

### Task 1.6: Frontend auth (login, sign-up, user menu, log out)

| # | Where | Command | Why |
|---|---|---|---|
| 1 | `frontend/` | `npx shadcn@latest add input label alert dropdown-menu avatar sonner --yes` | Copies 6 UI components into `src/components/ui/` and installs what they need (`sonner`, Radix parts, `next-themes`). |
| 2 | `frontend/` | *(edit `src/index.css`: violet `--primary`, `--ring`, `--sidebar-primary` in `:root` and `.dark`; see Files touched)* | Accent color. |
| 3 | `frontend/` | *(create/edit the files in "Files touched → 1.6")* | |
| 4 | `frontend/` | `npm uninstall next-themes` | shadcn's toast used it for dark mode, but its provider printed a React 19 console error. Replaced by a 6-line script in `index.html` (see notes). ⚠️ **Also edit `src/components/ui/sonner.tsx`**: delete `"use client"`, the `import { useTheme } from "next-themes"` line and `const { theme = "system" } = useTheme()`, and change `theme={theme as ToasterProps["theme"]}` to `theme="system"`. Otherwise `npm run build` fails with `TS2307: Cannot find module 'next-themes'`. Check with `grep -rn "next-themes" src index.html` (should print nothing). |
| 5 | `frontend/` | `npm run build` | Type-check + production build → `✓ built`. |
| 6 | `frontend/` | `npm run lint` | Only the 2 known warnings in shadcn's `badge.tsx` / `button.tsx`. |
| 7 | `backend/` + `frontend/` | `npm run dev` in each (2 terminals) | Open http://localhost:5173 |
| 8 | `api-platform/` | both backend scripts (1.4 → 44, 1.5 → 53) | Regression: still all pass. |

**Browser tests (all passed)**, done in the in-app browser, with the network log checked where it matters:

| # | Scenario | Result |
|---|---|---|
| 1 | Open `/` logged out | Redirected to `/login` |
| 2 | Submit empty login form | "Email is required" + "Password is required", red borders, `aria-invalid=true`; **0 requests** sent |
| 3 | Sign-up: `alice@acme` + 7-char password | Both field errors, **0 requests**; errors clear while typing; hint comes back; show/hide password toggles (`Hide password` label) |
| 3b | Sign-up valid | **1** `POST /signup` → 201, redirect to `/`, toast "Account created", "Welcome, Alice Smith" |
| 4 | Refresh while logged in · visit `/login` while logged in | Still logged in · redirected to `/` |
| 5 | User menu → Log out | Name + email in menu; → `/login`, toast "Logged out", DB session deleted; **browser Back stays on `/login`** |
| 6 | Wrong password · unknown email | Same red alert "Invalid email or password"; Enter submits; email kept |
| 7 | Sign-up with `ALICE@acme.com` (exists) | Error under email + "Log in instead →" link |
| 8 | **Double-click** "Log in" | Exactly **1** `POST /login` |
| 9 | Session ended elsewhere (deleted in DB), then tab becomes visible | → `/login` + toast "Your session expired. Log in again." |
| 10 | Open `/brands/acme-shoes-abc123?tab=tokens` logged out → log in | Back on exactly that URL (incl. `?tab=tokens`) |
| 10b | Planted redirect `//evil.example.com/phish` | Ignored → stays on `localhost`, goes to `/` |
| 11 | Backend stopped | Badge "Backend offline"; log out → logged out locally + one warning toast; login → "Can't reach the server. Try again.", **email + password kept**, button usable; page load → same toast (proxy answered 502) |
| 11b | Backend restarted | Badge green again, login works, no reload needed |
| 12 | Layouts | Desktop light: two-panel login, sidebar app shell. Phone width, dark: single column, header on one line |

### Task 1.7: Brand pages (list, create, detail)

| # | Where | Command | Why |
|---|---|---|---|
| 1 | `frontend/` | `npx shadcn@latest add skeleton --yes` | Grey pulsing placeholders while data loads. |
| 2 | `frontend/` | *(create/edit/delete the files in "Files touched → 1.7")* | `DashboardPage.tsx` is **deleted** (replaced by `BrandsPage.tsx`). |
| 3 | `frontend/` | `npm run build` · `npm run lint` | `✓ built`; only the 2 known shadcn warnings. |
| 4 | both | `npm run dev` in `backend/` and `frontend/` | ⚠️ If Vite says `Port 5173 is in use, trying another one...`, another copy is running (e.g. yours vs mine). Use the URL it prints (e.g. `http://localhost:5174`). |
| 5 | `api-platform/` | backend scripts 1.4 (44) + 1.5 (53) | Regression: unchanged. |

**Browser tests (all passed):**

| # | Scenario | Result |
|---|---|---|
| 1 | New account, no brands | Empty state "Create your first brand" + **New brand** |
| 2 | Type name `Café Ünïcode & Co.` | Slug auto-suggested `cafe-unicode-co`; preview `/v1/cafe-unicode-co-xxxxxx` |
| 3 | Type slug `API` → Create | Lower-cased to `api`, "This slug is reserved", **0 POST requests**. Then changing the name leaves the hand-typed slug alone and offers a **Suggest** button (`cafe-unicode-co-ltd`) |
| 4 | Suggest → **double-click** Create | **Exactly 1** `POST /api/organizations` (201) → `/brands/cafe-unicode-co-ltd-sg5b2z`, toast, avatar, API path, details |
| 5 | Copy API path | Button turns into a tick ("Copied") for 1.5 s; value written to the clipboard |
| 6 | Brand created elsewhere (curl), then tab becomes visible | List quietly updates 2 → 3, newest first, no skeleton flash |
| 7 | Open Bob's brand · unknown slug · `..%2F..%2Fauth%2Fme` | All show "Brand not found"; the traversal stays encoded (`/api/organizations/..%2F..%2Fauth%2Fme` → 404) |
| 8 | Page load while backend is down | **"Can't reach the server" + Try again** (not the login form); backend back → Try again → straight into the list (session was fine) |
| 9 | Backend down while inside the app | Brand page: "Couldn't load this page" + Try again → works after restart |
| 10 | **Stale answer race**: Acme Kids made 1.5 s slow, switch to Acme Shoes after 100 ms | Page shows **Acme Shoes**; the late Kids answer is ignored |
| 11 | Session ended elsewhere while on a brand page | → `/login`, toast, and **after login back on that brand page** |
| 12 | Layout | Phone (light): no horizontal scroll (`scrollWidth = 362 = viewport`). Desktop light + dark: list grid, create form, brand page |

### Task 1.8: End-to-end check (two users)

| # | Where | Command / action | Result |
|---|---|---|---|
| 1 | anywhere | `psql "<db url>" -c "DELETE FROM users"` | Clean start. |
| 2 | `backend/` | `npx prisma migrate status` · `npm run typecheck` | Up to date · clean. |
| 3 | `backend/` | `npm run dev 2>&1 \| tee /tmp/backend.log` | Log kept for the log checks. |
| 4 | `frontend/` | `npm run dev -- --port 5174 --strictPort` | **Fixed port**: `--strictPort` stops with an error instead of silently moving to another port, so two copies (yours and mine) can't get mixed up again. |
| 5 | browser | Alice: sign up → refresh → create "Acme Shoes" twice → list shows 2 | ✔ |
| 6 | terminal | Bob via curl: sign up, create "Bolt Bikes" + "Acme Shoes", open Alice's slug, duplicate email, wrong vs unknown login, 10 parallel sign-ups, 10 parallel creates, logout, replay old cookie | ✔ (see section 10) |
| 7 | browser | Alice opens Bob's slug → log out → `/` → `/login`; Bob logs in → only his brands → opens Alice's slug | ✔ |
| 8 | terminal | DB checks (argon2id, `token_hash` vs cookie, brands per owner, unique slugs) and log checks (`[Redacted]`, no token, no passwords, no 5xx) | ✔ |
| 9 | `api-platform/` | backend scripts 1.4 + 1.5; `npm run build` + `npm run lint` in `frontend/` | 44/44 · 53/53 · ✓ · 2 known warnings |

Note: in zsh, `[ "$a" == "$b" ]` fails with `= not found`. Run such comparisons in `bash`
(the test scripts start with `#!/bin/bash`) or use a single `=`.

## 13. Files touched

### Task 1.1

| File | Change | What it does |
|---|---|---|
| `backend/prisma/schema.prisma` | **Modified** | Adds models `User`, `Session`, `Organization` (explained below). |
| `backend/prisma/migrations/20261009170856_init_auth/migration.sql` | **Created** (by command #4) | The real SQL: `CREATE TABLE`, `CREATE UNIQUE INDEX`, `FOREIGN KEY`. Your timestamp in the folder name will differ; that's fine. **Never edit an applied migration.** |
| `backend/prisma/migrations/migration_lock.toml` | **Created** (by command #4) | Records that migrations are for PostgreSQL. Commit it; don't edit. |
| `backend/src/generated/prisma/**` | Regenerated (command #5) | Not in Git. Now contains the `User`, `Session`, `Organization` types. |

### Task 1.1b: scope change, one account can own many brands

| File | Change | What it does |
|---|---|---|
| `backend/prisma/schema.prisma` | **Modified** | `User.organization Organization?` → `User.organizations Organization[]`; removed `@unique` from `Organization.ownerId`; added `@@index([ownerId])`; updated comments. |
| `backend/prisma/migrations/20261009173217_allow_many_orgs_per_owner/migration.sql` | **Created** (by the migrate command) | `DROP INDEX "organizations_owner_id_key"; CREATE INDEX "organizations_owner_id_idx" ...` |
| `backend/src/generated/prisma/**` | Regenerated | `user.organizations` is now a list. |

**Which commands do you need?**

- **You already ran `init_auth`** (your tables exist): update `schema.prisma`, then
  `npx prisma migrate dev --name allow_many_orgs_per_owner` and `npx prisma generate`.
  You'll end up with 2 migrations, like mine.
- **You haven't run any migration yet:** just type the **final** schema and run
  `npx prisma migrate dev --name init_auth` + `npx prisma generate`. You'll have 1 migration
  that already has the normal index. Both paths give the same tables.

**Lesson:** a migration that already ran is history; we never edit it. A change of mind
is simply a **new** migration on top.

**The schema, line by line:**

| Prisma syntax | Meaning in the database |
|---|---|
| `model User { ... }` + `@@map("users")` | A table named `users` (Prisma name `User` in code, snake_case in SQL). |
| `id String @id @default(cuid())` | Primary key; Prisma generates a random collision-proof id like `cm2x9…`. Not a sequential number, so nobody can guess other ids by counting. |
| `email String @unique` | `CREATE UNIQUE INDEX users_email_key`: Postgres itself refuses duplicates. |
| `passwordHash String @map("password_hash")` | Code uses `passwordHash`; the column is `password_hash`. |
| `name String?` | `?` = optional (column allows `NULL`). |
| `@default(now())` | The DB fills the time on insert. |
| `@updatedAt` | Prisma sets the time on every update. |
| `@db.Timestamptz(3)` | "Timestamp **with time zone**", millisecond precision. Stored as UTC, so no timezone confusion between servers. |
| `sessions Session[]` / `organizations Organization[]` | **Relation fields**: exist only in Prisma code (`user.sessions`, `user.organizations`), not as columns. `[]` = a list (one-to-many). |
| `user User @relation(fields: [userId], references: [id], onDelete: Cascade)` | A **foreign key**: `sessions.user_id` must point to a real `users.id`; deleting the user deletes its sessions. |
| `ownerId String` + `@@index([ownerId])` | One-to-many: a user can own many brands; the index keeps "list my brands" fast. (Was `@unique` in `init_auth`, i.e. one-to-one, before the scope change.) |
| `@@index([userId])`, `@@index([expiresAt])` | Normal (non-unique) indexes so lookups like "all sessions of user X" and "expired sessions" stay fast as the table grows. |

### Task 1.2

| File | Change | What it does |
|---|---|---|
| `backend/src/lib/app-error.ts` | **Created** | `AppError` class: an error that carries `status`, `code`, `message` and optional `details` (list of `{ field, message }`). Thrown on purpose by our code: `throw new AppError(409, 'SLUG_TAKEN', '...')`. |
| `backend/src/lib/validate.ts` | **Created** | `validate(schema, data)`: runs a Zod schema. Valid → returns the cleaned, **typed** data. Invalid → throws `AppError(400, 'VALIDATION_ERROR')` listing **every** bad field. Called at the top of each route: `const input = validate(signupSchema, req.body)`. |
| `backend/src/lib/prisma-errors.ts` | **Created** | `isUniqueViolation(err, constraint?)`: is this a P2002 (optionally for one specific constraint like `users_email_key`)? `isNotFound(err)`: P2025. `uniqueConstraintName(err)`: digs the constraint name out of Prisma 7's adapter error. Services use these to catch race losers and throw a precise AppError. |
| `backend/src/middleware/error-handler.ts` | **Replaced** | `toAppError()` turns **any** error into an AppError: ours → as is; P2002 → `409 CONFLICT`; P2025 → `404`; invalid JSON → `400 INVALID_JSON`; too large → `413`; anything else → `500` (logged with stack, hidden from caller). Every error response now has the same shape **plus `requestId`**. |
| `backend/src/middleware/not-found.ts` | **Replaced** | Instead of writing the 404 itself, it passes an `AppError(404)` to the error handler, so 404s share the standard shape. |
| `backend/src/app.ts` | Unchanged (net) | Temporarily mounted the debug router; removed again. |
| `backend/src/modules/debug/debug.routes.ts` | Created → **deleted** | Temporary test routes (see commands). |

**The standard error shape** (every error, every endpoint, from now on):

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Some fields are invalid",
    "details": [
      { "field": "email", "message": "Invalid email address" },
      { "field": "age", "message": "Too small: expected number to be >=18" }
    ],
    "requestId": "4b7d2e87-e470-4325-a9e1-0f75b7103ac7"
  }
}
```

- `code`: stable, for code to check (`if (code === 'EMAIL_TAKEN')`). Never changes wording.
- `message`: for humans; may change.
- `details`: only for validation errors; the frontend shows each message under its field.
- `requestId`: same as the `X-Request-Id` header and the log line. "My request failed, id 4b7d…" → we find it in the logs instantly.

**How a request error flows:**

```
route ──throws──► AppError / ZodError-as-AppError / Prisma error / random bug
                     │
                     ▼
             errorHandler → toAppError(err)
                     │
       ┌─────────────┼───────────────────────┐
     4xx: send code/message           5xx: log full err + stack,
     (DB conflicts: one warn line)          send "Something went wrong"
```

### Task 1.3

| File | Change | What it does |
|---|---|---|
| `backend/package.json`, `package-lock.json` | **Modified** (by npm) | Adds `argon2`. |
| `backend/src/lib/session.ts` | **Created** | All session mechanics in one place: `generateSessionToken()` (32 random bytes, base64url), `hashSessionToken()` (SHA-256 hex), `newSessionExpiry()` (+7 days), `setSessionCookie()` / `clearSessionCookie()` with the cookie flags (`httpOnly`, `sameSite: 'lax'`, `secure` in production, `path: '/'`, `expires`). |
| `backend/src/modules/auth/auth.schemas.ts` | **Created** | Zod rules: `emailSchema` (trim → lower-case → max 254 → email format), `passwordSchema` (8–128 chars, not trimmed), `signupSchema` (`email`, `password`, optional `name` 1–100 chars). Exported so login (1.4) reuses them. |
| `backend/src/modules/auth/auth.service.ts` | **Created** | `signup()`: hash the password with argon2id → create the user **and** the first session in one atomic nested write → return `{ user, token, expiresAt }`. Unique-email violation → `409 EMAIL_TAKEN`. `publicUserSelect` = the only user fields ever returned (no `passwordHash`). |
| `backend/src/modules/auth/auth.routes.ts` | **Created** | `POST /api/auth/signup`: `validate()` → `signup()` → `setSessionCookie()` → `201 { user }`. The route is thin; the logic lives in the service. |
| `backend/src/app.ts` | **Modified** | `import { authRouter } ...` and `app.use('/api/auth', authRouter)` after the health route. |
| `backend/src/lib/prisma.ts` | **Modified** | Added `options: '-c timezone=UTC'` so every DB connection uses UTC (timezone bug fix, below). |

**Sign-up, step by step:**

```
POST /api/auth/signup {email, password, name?}
 ├─ validate(signupSchema)        → 400 VALIDATION_ERROR if bad
 ├─ argon2.hash(password)         → "$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>"   (~tens of ms)
 ├─ token = 32 random bytes       → "6dVeUIpl97FF…"            (goes to the cookie)
 ├─ INSERT user + session (one atomic statement)
 │     sessions.token_hash = sha256(token)                     (goes to the DB)
 │     duplicate email → 409 EMAIL_TAKEN
 ├─ Set-Cookie: sid=<token>; HttpOnly; SameSite=Lax; Expires=+7d
 └─ 201 { user: { id, email, name, createdAt } }
```

**Why two different hash functions?**

| | Password → **argon2id** | Session token → **SHA-256** |
|---|---|---|
| Chosen by | a human (often weak, reused) | our code (32 random bytes) |
| Attack if DB leaks | guess billions of common passwords | impossible: 2²⁵⁶ possibilities |
| So the hash must be | **slow + memory-hungry** (each guess costs the attacker) | just one-way; fast is fine |
| Salt | built in (random per hash, stored inside the string) | not needed (token is already unique and random) |

**What's inside an argon2 hash string:** `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`:
algorithm, version, memory (KiB), passes, threads, random salt, result. Because the settings
are stored *inside* each hash, `argon2.verify()` (login, task 1.4) works even if we change the
settings later.

### Task 1.3b

| File | Change | What changed |
|---|---|---|
| `backend/src/lib/app-error.ts` | **Modified** | 4th constructor argument is now an **options object** `{ details?, cause? }` (was `details`). `cause` is passed to the built-in `Error` (`super(message, { cause })`), so the original error travels with ours. |
| `backend/src/lib/validate.ts` | **Modified** | Uses the new form: `new AppError(400, 'VALIDATION_ERROR', '...', { details: [...] })`. |
| `backend/src/lib/prisma-errors.ts` | **Modified** | Removed the unused `export { uniqueConstraintName }` (still used inside the file). |
| `backend/src/middleware/error-handler.ts` | **Modified** | Every converted error keeps the original as `cause`. New `describeCauses()` builds a short `causes` list (`type`, `code`, last message line) for the log, because pino doesn't print a cause's `code` (where `P2002` / `ECONNREFUSED` live). Logs `{ causes, err: appError }`: `error` level for 5xx, `warn` for 4xx that wrap a cause. The JSON response is unchanged. |
| `backend/src/modules/auth/auth.controller.ts` | **Created** | `signup(req, res)`: validate → `authService.signup()` → set cookie → `201`. (Moved out of the routes file.) |
| `backend/src/modules/auth/auth.routes.ts` | **Replaced** | Just `authRouter.post('/signup', authController.signup)`. |
| `backend/src/modules/auth/auth.service.ts` | **Modified** | `EMAIL_TAKEN` now carries `{ cause: err }`; unknown errors re-thrown unchanged; header comment describing the layer. |
| `backend/src/modules/health/health.service.ts` | **Created** | `checkDatabase()` → `{ db: 'up' }` or `{ db: 'down', reason }`. Never throws. |
| `backend/src/modules/health/health.controller.ts` | **Created** | `getHealth(req, res)`: calls the service, logs the reason if down, sends 200/503. |
| `backend/src/modules/health/health.routes.ts` | **Replaced** | Just `healthRouter.get('/', healthController.getHealth)`. |
| `docs/ARCHITECTURE.md` | **Created** | The layer rules + error-flow rules for all future modules. |

**Before → after (sign-up):**

```
BEFORE  auth.routes.ts:  router.post('/signup', async (req, res) => { validate; service; cookie; respond })
AFTER   auth.routes.ts:      authRouter.post('/signup', authController.signup)
        auth.controller.ts:  validate → authService.signup() → setSessionCookie → 201
        auth.service.ts:     argon2 + prisma (unchanged logic) → AppError(..., { cause })
```

### Task 1.4

| File | Change | What it does |
|---|---|---|
| `backend/package.json`, `package-lock.json` | **Modified** (npm) | Adds `cookie-parser` and `@types/cookie-parser`. |
| `backend/src/types/express.d.ts` | **Created** | Adds `user?: PublicUser` and `sessionId?: string` to Express' `Request` type ("declaration merging"), so `req.user` is typed everywhere. |
| `backend/src/modules/auth/auth.schemas.ts` | **Modified** | `loginSchema`: `email` (same cleaning as sign-up) + `password` (1–128 chars; no 8-char rule on login). |
| `backend/src/modules/auth/auth.service.ts` | **Modified** | New: `PublicUser` type; `createSession()` (private helper); `login()` (find user → argon2.verify, with a **dummy hash** for unknown emails → new session; wrong → `401 INVALID_CREDENTIALS`); `logout(sessionId)` (`deleteMany`, so it never fails if already gone); `findSessionByToken(token)` (hash → lookup → `null` if unknown/expired; deletes expired rows). |
| `backend/src/middleware/load-session.ts` | **Created** | On every request after it: read `req.cookies.sid` → `authService.findSessionByToken()` → set `req.user` / `req.sessionId`. Invalid cookie → `clearSessionCookie()`. Never blocks a request. |
| `backend/src/middleware/require-auth.ts` | **Created** | `if (!req.user) throw new AppError(401, 'UNAUTHENTICATED', ...)`. Added per route. |
| `backend/src/modules/auth/auth.controller.ts` | **Modified** | New `login` (also deletes this browser's previous session), `logout` (204 + clear cookie), `me` (`Cache-Control: no-store` + `{ user }`). |
| `backend/src/modules/auth/auth.routes.ts` | **Modified** | `POST /login`, `POST /logout` (requireAuth), `GET /me` (requireAuth). |
| `backend/src/app.ts` | **Modified** | `import cookieParser` + `loadSession`; order is now: logging → JSON → **health** → `cookieParser()` → `loadSession` → `/api/auth` → 404 → errors. |
| `docs/test-scripts/phase-01-task-1.4-auth.sh` | **Created** | The 44-check scenario script (curl + psql). |

**Middleware order in `app.ts` (matters!):**

```
pinoHttp → express.json → /api/health → cookieParser → loadSession → /api/auth → notFound → errorHandler
                              ▲                              ▲
              before loadSession: must answer       needs the DB: if it came before health,
              even when the DB is down              a DB outage would turn health's 503 into a 500
```

**What happens on `GET /api/auth/me` with a cookie:**

```
Cookie: sid=abc…  ──► cookieParser: req.cookies = { sid: "abc…" }
                  ──► loadSession:  sha256("abc…") → SELECT session + user WHERE token_hash = …
                                     found & not expired → req.user, req.sessionId
                                     not found / expired → clear cookie, continue anonymously
                  ──► requireAuth:  req.user? yes → next()   no → 401 UNAUTHENTICATED
                  ──► authController.me → 200 { user }
```

### Task 1.5

| File | Change | What it does |
|---|---|---|
| `backend/src/modules/organizations/organizations.schemas.ts` | **Created** | `createOrganizationSchema`: `name` (trim, 1–100) + `slug` start (trim → lower-case → 3–30 chars → regex `^[a-z][a-z0-9]*(-[a-z0-9]+)*$` → not reserved). `RESERVED_SLUGS` list. |
| `backend/src/modules/organizations/organizations.service.ts` | **Created** | `publicOrganizationSelect` + `PublicOrganization` type; `randomSlugSuffix()` (6 chars via `crypto.randomInt`); `createOrganization(ownerId, input)` (slug = start + suffix; on P2002 for `organizations_slug_key` retry up to 3×, then `409 SLUG_TAKEN` with `cause`); `listOrganizations(ownerId)` (newest first, `id` as tie-breaker); `findOwnedOrganization(ownerId, slug)` (one query, both conditions). |
| `backend/src/modules/organizations/organizations.controller.ts` | **Created** | `create` (owner = `req.user.id`), `list`, `getOne` (returns `req.organization`). |
| `backend/src/modules/organizations/organizations.routes.ts` | **Created** | `router.use(requireAuth)`; `POST /`, `GET /`, `GET /:slug` with `requireOrganization`. |
| `backend/src/middleware/require-organization.ts` | **Created** | Ownership check: `findOwnedOrganization(req.user.id, req.params.slug)` → `req.organization`, else `404 ORGANIZATION_NOT_FOUND`. Reused by every brand route later. |
| `backend/src/types/express.d.ts` | **Modified** | Adds `organization?: PublicOrganization`. |
| `backend/src/app.ts` | **Modified** | `import { organizationsRouter }` + `app.use('/api/organizations', organizationsRouter)` after `/api/auth`. |
| `docs/test-scripts/phase-01-task-1.5-organizations.sh` | **Created** | 53-check scenario script. |
| `docs/ARCHITECTURE.md` | **Modified** | New error codes. |

**Request flow for `GET /api/organizations/acme-shoes-k3x9q2`:**

```
loadSession        cookie → req.user
requireAuth        no user → 401
requireOrganization  SELECT … WHERE slug='acme-shoes-k3x9q2' AND owner_id=<req.user.id>
                     none → 404 ORGANIZATION_NOT_FOUND (same for "not mine" and "doesn't exist")
organizationsController.getOne → 200 { organization: req.organization }
```

### Task 1.6

**Created**

| File | What it does |
|---|---|
| `frontend/src/lib/api-types.ts` | `User`, `ErrorDetail`, `ApiErrorBody` types (match the backend JSON). |
| `frontend/src/lib/validation.ts` | Browser-side checks: `validateEmail`, `validateNewPassword`, `compactErrors`. Mirror the backend rules; the backend still decides. |
| `frontend/src/auth/auth-context.ts` | The React context + its type (`status`, `user`, `login`, `signup`, `logout`). |
| `frontend/src/auth/useAuth.ts` | `useAuth()` hook to read it (throws if used outside the provider). |
| `frontend/src/auth/AuthProvider.tsx` | Holds the logged-in user. (1) `GET /me` once on load; (2) registers the global 401 handler → logged out + toast; (3) re-checks `/me` when the tab becomes visible again; `login`/`signup`/`logout` functions. |
| `frontend/src/auth/RequireAuth.tsx` | Route guard: loading → spinner; logged out → `/login` with `state.from` = where you were going. |
| `frontend/src/auth/RedirectIfAuthed.tsx` | Guard for `/login` + `/signup`: logged in → `state.from` (only if it's an in-app path, never `//…`) or `/`. |
| `frontend/src/components/FullPageSpinner.tsx` | The short spinner while `/me` answers. |
| `frontend/src/components/auth/AuthLayout.tsx` | Two-panel layout + `Logo` component (also used in the app header). |
| `frontend/src/components/auth/PasswordInput.tsx` | Input + show/hide button (`type="button"` so it never submits). |
| `frontend/src/components/forms/FormField.tsx` | Label + input + error/hint, with `aria-invalid` / `aria-describedby` wired once. |
| `frontend/src/components/layout/UserMenu.tsx` | Avatar initials → dropdown with name, email, Log out (one toast, double-click safe). |
| `frontend/src/pages/LoginPage.tsx` | Login form: browser checks → `login()` → toast; `INVALID_CREDENTIALS` → red alert; network → toast; ref + disabled button block double submit. |
| `frontend/src/pages/SignupPage.tsx` | Sign-up form: same pattern; `EMAIL_TAKEN` → error under email + "Log in instead". |
| `frontend/src/components/ui/input.tsx`, `label.tsx`, `alert.tsx`, `dropdown-menu.tsx`, `avatar.tsx`, `sonner.tsx` | shadcn components (copied by the CLI). **`sonner.tsx` edited**: no `next-themes`, `theme="system"`. |

**Modified**

| File | Change |
|---|---|
| `frontend/package.json`, `package-lock.json` | + `sonner` and Radix parts (by shadcn); `next-themes` removed. |
| `frontend/index.html` | Inline script: adds the `dark` class when the computer is in dark mode and follows changes. Runs before React, so there's no flash. |
| `frontend/src/index.css` | Violet accent: `--primary`, `--primary-foreground`, `--ring`, `--sidebar-primary(-foreground)` in `:root` (violet-600 / ring violet-500) and `.dark` (violet-500 / ring violet-400). |
| `frontend/src/main.tsx` | Wraps the app in `<AuthProvider>` and adds `<Toaster position="top-right" richColors closeButton />`. |
| `frontend/src/App.tsx` | Routes: `RedirectIfAuthed` → `/login`, `/signup`; `RequireAuth` → `AppLayout` → `/` and the not-found page. |
| `frontend/src/lib/api.ts` | New `apiFetch()` (JSON in/out, cookie automatic, errors → `ApiError`, network/non-JSON → status 0 "Can't reach the server", 401 `UNAUTHENTICATED` → handler), `fieldErrorsOf()`, `authApi` (`me`, `login`, `signup`, `logout`). `getHealth()` kept. |
| `frontend/src/components/layout/AppLayout.tsx` | Logo, violet active nav item, email in sidebar footer, `UserMenu` in header, sidebar hidden below 768 px (logo moves to header). |
| `frontend/src/components/HealthBadge.tsx` | On phones only the dot is shown (text stays as `title` + `aria-label`). |
| `frontend/src/pages/DashboardPage.tsx` | "Welcome, <name>" + "Your brands" card (placeholder until 1.7). |

**How a login travels through the frontend:**

```
LoginPage  ──validate in browser──► (errors? show them, stop: no request)
    │
    └─ useAuth().login() ──► AuthProvider ──► authApi.login() ──► apiFetch('POST /api/auth/login')
                                   │                                   │
                                   │◄── { user } ──────────────────────┤ 200 + Set-Cookie (browser stores it)
                              setUser(user)                            │ 401 → ApiError('INVALID_CREDENTIALS')
                                   │                                   │ no answer → ApiError(0, 'NETWORK_ERROR')
                                   ▼
                          RedirectIfAuthed sees "authenticated" → <Navigate to={from ?? '/'} />
```

### Task 1.7

**Created**

| File | What it does |
|---|---|
| `frontend/src/pages/BrandsPage.tsx` | `/`: "Your brands". `useRequest('organizations', …, { refetchOnFocus: true })`; states: skeleton → error (Try again) → empty state → grid of `BrandCard`s (avatar, name, slug, "Created 3 minutes ago"). |
| `frontend/src/pages/CreateBrandPage.tsx` | `/brands/new`: name + slug. Slug follows the name (`suggestSlug`) until edited by hand; "Suggest" brings it back; live preview `/v1/<slug>-xxxxxx`; browser checks; ref + disabled button against double submit; success → toast + `navigate(…, { replace: true })`. |
| `frontend/src/pages/BrandPage.tsx` | `/brands/:slug`: breadcrumb, header, API path card (copy), details (slug, ID, created; copy), "Coming next" cards. `ORGANIZATION_NOT_FOUND` → "Brand not found"; other errors → error state. |
| `frontend/src/lib/use-request.ts` | Data-loading hook: `{ data, error, loading, reload }`. Remembers which **key** the data belongs to (no old data under a new key), ignores out-of-date answers (request numbers), optional quiet reload when the tab becomes visible. |
| `frontend/src/lib/slug.ts` | `suggestSlug()` (accents removed, symbols → `-`, starts with a letter, ≤ 30), `normalizeSlugInput()`, `validateSlugBase()` (same rules and reserved list as the backend: keep in sync). |
| `frontend/src/lib/format.ts` | `formatRelativeTime()` ("3 minutes ago") and `formatDateTime()` ("10 Oct 2026, 21:51"). |
| `frontend/src/components/brands/BrandAvatar.tsx` | Initials in a colour picked from the slug (same brand → same colour). |
| `frontend/src/components/CopyButton.tsx` | Copies a value, shows a tick for 1.5 s, toast if the clipboard is blocked. |
| `frontend/src/components/PageStates.tsx` | `EmptyState` and `ErrorState` blocks shared by all pages. |
| `frontend/src/components/ServerUnreachable.tsx` | Full-page "Can't reach the server" + Try again (used by the route guards). |
| `frontend/src/components/ui/skeleton.tsx` | shadcn. |

**Modified**

| File | Change |
|---|---|
| `frontend/src/App.tsx` | Routes: `/` → `BrandsPage`, `/brands/new` → `CreateBrandPage`, `/brands/:slug` → `BrandPage`. |
| `frontend/src/lib/api-types.ts` | + `Organization` type. |
| `frontend/src/lib/api.ts` | + `organizationsApi` (`list`, `get(slug)` with `encodeURIComponent`, `create`). |
| `frontend/src/auth/auth-context.ts` | + status `'unreachable'` and `retry()`. |
| `frontend/src/auth/AuthProvider.tsx` | Page-load `/me`: 401 → anonymous, **no answer → unreachable** (was: anonymous + toast); `applySession()` shared by load and `retry()`. |
| `frontend/src/auth/RequireAuth.tsx`, `RedirectIfAuthed.tsx` | `unreachable` → `<ServerUnreachable onRetry={retry} />`. |
| `frontend/src/components/layout/AppLayout.tsx` | Nav item **Brands** (active on `/` and `/brands/*`); logos link to `/`. |
| `frontend/src/pages/NotFoundPage.tsx` | Uses `EmptyState` with "Back to your brands". |

**Deleted:** `frontend/src/pages/DashboardPage.tsx`.

**Page flow:**

```
/ (Your brands) ──New brand──► /brands/new ──Create (POST)──► /brands/<slug>   (replace: Back → list)
      ▲  └──────────── click a card ────────────────────────────►    │
      └──────────────────────── breadcrumb "Brands" ◄─────────────────┘
```

### Task 1.8

No application code changed. Docs only: this file (verify list ticked with evidence, task 1.8
commands, summary) and `docs/ROADMAP.md` (Phase 1 status).

## 14. Concurrency, common mistakes and security notes

### Concurrency: many users at the same time

Our server handles many requests **at the same time**. Two requests can both run
"does this email exist? → no → insert" in the same millisecond, and both see "no".
This is called a **race condition** (a *check-then-insert* bug). Rules we follow:

1. **Invariants live in the database.** Every "must be unique" or "must exist" rule is a DB
   constraint (`UNIQUE`, `FOREIGN KEY`). Postgres checks them atomically, so only one
   racing request can win. Our code checks are just for friendly error messages.
2. **Catch the loser and answer 409.** When Prisma hits a unique violation it throws error
   code **`P2002`**. From task 1.2 on, the error handler turns that into a clean
   `409 Conflict`, never a 500. (Task 1.3: email taken; task 1.5: slug taken / already has a brand.)
3. **Transactions when several writes must happen together** (all succeed or none).
4. **No shared in-memory state** in the server (no global "current user" variable). Every
   request gets its own `req.user`. This also lets us run several server copies later.
5. **Many sessions per user are normal** (two browsers = two rows). Logging out one deletes
   only that row.
6. **Connection pool:** the `pg` adapter keeps up to **10** DB connections by default and
   shares them between requests; extra requests wait briefly for a free one. Enough for now;
   we'll make it configurable when we deploy (Phase 8).

### Common mistakes (task 1.1)

- Forgetting `npx prisma generate` after a migration: TypeScript says `Property 'user' does not exist on type 'PrismaClient'`.
- Editing `schema.prisma` but not running `migrate dev`: the code and the DB disagree, which causes runtime errors like `column ... does not exist`.
- Editing an old migration file after it ran. Always create a **new** migration instead.
- `migrate dev` failing with "permission denied to create database": the DB user lacks `CREATEDB` (needed for the shadow database).
- `migrate dev` is for development only. On a server we'll use `migrate deploy` (Phase 8).
- If `migrate dev` ever says it must **reset** the database (deleting all data), read before typing `y`.

### Common mistakes (task 1.2)

- **Zod: clean first, then check.** `z.email().trim()` checks the format *before* trimming,
  so `"  Bob@X.COM "` fails. Use `z.string().trim().toLowerCase().pipe(z.email())`. (We hit
  this in testing; sign-up in 1.3 uses the correct order.)
- Reading `err.meta.target` for the constraint name (old tutorials). With Prisma 7 + the `pg`
  adapter it's `undefined`; use `uniqueConstraintName()`.
- Sending `err.message` for 500s leaks internals (paths, SQL, secrets). Only AppErrors and
  known 4xx errors expose their message.
- Writing `res.status(404).json(...)` in many places means slightly different shapes everywhere.
  Throw an `AppError` and let the error handler format it.
- In Express 5, `async` route errors reach the error handler automatically. In Express 4 you
  needed `try/catch` + `next(err)` (many tutorials still show that).

### Concurrency (task 1.2)

The race test fired **10 identical "create user" requests at the same instant**:
1 got `201`, 9 got `409 CONFLICT`, **0 got 500**, and the DB had exactly 1 row. That is the
pattern for every "create" from now on:

1. Validate input (`validate()`).
2. Optionally check "is it free?" for a friendly message. Never rely on it.
3. Insert. The **DB unique constraint** decides the winner.
4. The loser's P2002 becomes a `409`: either specifically in the service
   (`if (isUniqueViolation(err, 'users_email_key')) throw new AppError(409, 'EMAIL_TAKEN', ...)`)
   or, as a safety net, generically in the error handler (`CONFLICT`).

### Bug found in task 1.3: timestamps 5h30 off

**Symptom:** a session made at 04:43 UTC was stored as **23:13 UTC the day before**; sessions
seemed to expire in 6.77 days instead of 7. Even `created_at` was wrong.

**Cause:** Prisma fills `@default(now())` and our `expiresAt` itself and the `pg` adapter sends
them **without a timezone marker** (`2026-10-10 04:43:07`). This Mac's Postgres runs in
`Asia/Kolkata`, so Postgres read that as India time and converted it to UTC by subtracting 5h30.

**Fix:** `options: '-c timezone=UTC'` in `src/lib/prisma.ts` makes every connection the app opens
use UTC. Verified: DB time = real UTC time, expiry = 7.000 days, and Prisma reads the same
value back (round trip).

**Lessons:**
- Store and compute times in **UTC**; convert to local time only when showing them to a person.
- Bugs like this hide on servers that already run in UTC (most cloud DBs) and appear on a
  developer laptop, or the other way round. Always check one real value end to end.
- To look at times in `psql` in UTC: `SET timezone='UTC';` first (psql shows times in the
  server's zone by default).

### Common mistakes (task 1.3)

- Returning the Prisma user object directly leaks `passwordHash`. Always `select: publicUserSelect`.
- Checking "does this email exist?" *before* inserting: it races (two sign-ups both see "no").
  We insert and let the unique index decide.
- Creating the user and the session in two separate queries: if the second fails, you're left
  with a half-done sign-up. Use one nested write (or a transaction).
- `argon2` options typed as plain `number`: add `as const`.
- Cookie flags for `clearCookie` must match those used in `res.cookie`, or the browser keeps
  the cookie (matters in 1.4).
- Trimming passwords. Users may intentionally include spaces; only emails are trimmed.
- No max length on passwords: a 10 MB password makes argon2 burn CPU (cheap DoS).

### Concurrency (task 1.3)

| Scenario | Result |
|---|---|
| 10 sign-ups, **same** email, at once | `1 × 201`, `9 × 409 EMAIL_TAKEN`; 1 user, 1 session, **0 orphan sessions**; all done in ~130 ms |
| 10 sign-ups, **different** emails, at once | `10 × 201`: no false conflicts |

Things that make it safe:
1. **Unique index on email** picks one winner; the service turns the loser into `409 EMAIL_TAKEN`.
2. **Atomic nested write**: user + session are saved together or not at all.
3. **Hashing runs off the main thread.** `argon2.hash` runs in Node's libuv thread pool (4 threads
   by default), so while passwords are being hashed the server keeps answering other requests.
   With many simultaneous sign-ups/logins, extra hashes wait in a queue: that's why we use the
   OWASP minimum (19 MiB, t=2) instead of the library default (64 MiB) to keep memory under
   control (10 parallel hashes ≈ 190 MiB). If logins ever get slow under load, the
   `UV_THREADPOOL_SIZE` env var can raise the pool size (not needed now).
4. **No shared state**: every request gets its own random token.

### Notes (task 1.3b)

- **Why the controller has no `try/catch`:** Express 5 passes errors from `async` handlers to the
  error handler automatically. Adding `try { … } catch (err) { next(err) }` everywhere is the
  Express 4 way and only adds noise.
- **`cause` is standard JavaScript** (ES2022): `new Error('msg', { cause: original })`. Nested
  causes form a chain; pino prints it as `caused by: …` in the stack.
- **Mistake to avoid:** `catch (err) { throw new AppError(500, 'X', 'failed') }` without `cause`
  hides the real problem forever. Either add `{ cause: err }` or don't catch.
- **Mistake to avoid:** `catch (err) { console.log(err) }` and continuing: the caller gets a
  wrong success. Let it bubble.

### Notes (task 1.4)

**Security decisions**
- **Same answer for "no such email" and "wrong password"**, both in the body (`INVALID_CREDENTIALS`)
  and in **timing**: for unknown emails we still run `argon2.verify` against a dummy hash, so
  both take ~20 ms. Without that, unknown emails would answer in ~2 ms and attackers could
  find out which emails have accounts.
- **Re-login in the same browser deletes the old session** (otherwise it would stay valid
  in the DB for 7 days although no browser holds it any more).
- **Invalid cookies are cleared** so the browser stops sending them.
- `/me` sends `Cache-Control: no-store`: personal data must not be cached.
- Still no limit on login attempts (known risk, see section 9).

**Concurrency decisions**
- `logout` and expired-session cleanup use `deleteMany`, not `delete`: if two tabs log out
  at the same moment, the second finds nothing to delete. `delete` would throw P2025 (→ 404);
  `deleteMany` just deletes 0 rows → both get `204`. Logging out is **idempotent**
  (doing it twice = doing it once).
- Each login creates its own random token, so 20 parallel logins → 20 independent sessions.
- `req.user` lives on the request object, never in a shared variable.

**Common mistakes**
- Forgetting `cookieParser()` (or putting `loadSession` before it): `req.cookies` is `undefined` → everyone looks logged out.
- Putting `loadSession` before `/api/health`: a DB outage turns health's 503 into a 500.
- `clearCookie` with different options (`path`, `sameSite`...) than `res.cookie`: the browser keeps the cookie.
- `prisma.session.delete()` for logout: a double logout throws (→ 404) instead of succeeding.
- Testing with curl and forgetting `-c` on a login: the new cookie isn't saved, so the next request uses an old one.

### Notes (task 1.5)

**Why a random suffix instead of "check if free, then insert"?**
"Is `acme-shoes` free? → yes → insert" races: two users can both see "free". And telling a user
"taken, try another" is annoying. With a random 6-character suffix (36⁶ ≈ 2.2 billion options
per start), collisions are practically impossible, and if one ever happens the UNIQUE index
catches it and we just try another suffix. The database still has the final say.

**Why `crypto.randomInt` and not `Math.random`?** `Math.random` is predictable; slugs appear in
public URLs, so we don't want anyone guessing the next one.

**Why the owner never comes from the request body:** if the API accepted `ownerId`, any user could
create brands in someone else's account. The owner is always `req.user.id`, set by the server
from the session.

**Common mistakes**
- Looking up the brand by slug alone and checking the owner afterwards in the controller: easy to
  forget in one route. Always use `requireOrganization` (one query, both conditions).
- Returning 403 for "not yours": tells an attacker the slug exists. We return the same 404.
- Generating random strings with `Math.random()`.
- An unbounded retry loop on unique violations: if something else is wrong it would spin forever.
  We stop after 3 tries and return 409 with the cause.

### Notes (task 1.6)

**Problems found while testing, and fixed**
1. **Console error "Encountered a script tag while rendering React component"**: `next-themes`'
   provider renders an inline `<script>`, which React 19 warns about. Replaced with a 6-line
   script in `index.html` (simpler, and it runs before React so there's no theme flash). Removed
   the package.
2. **Header wrapped to two lines on phones** ("API / Platform"): logo text set to
   `whitespace-nowrap`; health badge shows only its dot below 640 px.
3. **A tab didn't notice a session ended elsewhere** until its next API call: added "re-check
   `/me` when the tab becomes visible again".
4. **Two toasts on logout with the backend down**: `logout()` now returns whether the server
   confirmed; the menu shows exactly one message.
5. (Test tooling, not the app) clicks didn't land while the browser pane emulated a larger
   viewport; clicking tests were run at the pane's real size, layouts checked at emulated sizes.

**Things worth knowing**
- **`state.from` is checked before redirecting** (`startsWith('/')` and not `//`), so nobody can
  craft a link that bounces users to another site after login (an "open redirect").
- **Two layers against double submit**: a `useRef` flag (instant) and `disabled` on the button (visual).
- **The 401 handler only acts if we *thought* we were logged in**, so the normal 401 from `/me`
  on first load (not logged in yet) doesn't show a "session expired" toast.
- **`StrictMode` runs effects twice in development**, so you'll see `/api/auth/me` twice per page
  load in the network tab. Production runs it once. The `cancelled` flag ignores the first answer.
- **401 lines in the browser console** for `/me` while logged out are normal: browsers log every
  4xx response.

**Common mistakes**
- Calling `navigate()` right after `login()` *and* having a redirect guard: two redirects fight.
  Let `RedirectIfAuthed` do it.
- Putting `fetch` calls in pages: error handling ends up different everywhere. Use `apiFetch`.
- Show/hide password button without `type="button"`: clicking it submits the form.
- `autoComplete` missing → password managers don't offer to save or fill.
- Trusting browser-side validation alone. The backend must (and does) check everything again.

### Notes (task 1.7)

**Problems found while testing, and fixed**
1. **Horizontal scrolling on phones** on the brand page (content 373 px in a 362 px screen):
   long monospace text (slug, ID) made the CSS grid column wider than the screen. Fix:
   `grid-cols-1` (= `minmax(0, 1fr)`) on the grids so columns may shrink; text truncates with
   "…" (the copy buttons still copy the full value). Classic CSS-grid trap.
2. **Backend down at page load showed the login form**, which is misleading (the session may be
   fine). New `'unreachable'` auth status with a "Can't reach the server / Try again" screen.
3. **Breadcrumb said "Not found" during a network error.** Now it says "Not found" only for a real 404.
4. **Lint `set-state-in-effect`** in `useRequest` and `AuthProvider`: restructured (key-tagged
   state; `.then()` callbacks) instead of silencing the rule.
5. (Environment) **Two copies running at once**: your copy held port 5173, so Vite started mine on
   **5174**, and my first login attempt hit *your* app and database ("Invalid email or password").
   Not a code bug. If both copies run, watch the port Vite prints.

**Concurrency / robustness**
- **Stale answers can't overwrite newer pages** (`useRequest` request numbers): verified with an
  artificially slow request.
- **Double-click on Create = one brand** (ref + disabled button), and even if two requests got
  through, the server would just create two brands with different random suffixes (no conflict).
- **Two tabs**: the list refreshes when you come back to it; a session ended elsewhere sends you
  to `/login` and back to the same page afterwards.
- **`encodeURIComponent(slug)`**: the slug comes from the address bar, so `../` tricks stay
  inside `/api/organizations/…` and just return 404.

**Common mistakes**
- Using `grid` without `grid-cols-1` and putting long unbreakable text inside: the page scrolls sideways on phones.
- Showing the previous brand's data while the next one loads (not tagging data with its key).
- `navigate('/brands/<slug>')` without `replace` after creating: Back returns to a filled-in form.
- Suggesting a slug forever, even after the user typed their own (overwrites their choice).
- Building URLs with raw user input (`/api/organizations/${slug}`) instead of `encodeURIComponent`.

## 15. Summary

| | Items |
|---|---|
| **Built** | 1.1 DB tables (`users`, `sessions`, `organizations`) · 1.2 `AppError`, `validate()`, Prisma error helpers, one error shape with `requestId` · 1.3 sign-up (argon2id, atomic user + session, HttpOnly cookie, UTC fix) · 1.3b routes → controller → service layers, error `cause` chain (`docs/ARCHITECTURE.md`) · 1.4 login, logout, `/me`, session middleware · 1.5 brands API with random slug suffix and owner check · 1.6 login/sign-up pages, auth state, user menu · 1.7 brand list / create / detail pages · 1.8 end-to-end check |
| **Verified by Claude** | Section 10 (all 10 items), plus scripts 44/44 + 53/53 and 24 browser scenarios across 1.6–1.7 |
| **Verified by you** | your call: tick 1.1–1.8 in the tracker when your copy matches |
| **Scope changes during the phase** | No team members (one owner per brand) · an account can own many brands · random slug suffix · layered backend (ROADMAP change log) |
| **Known, accepted gaps** | No login rate limiting; no password reset (both out of scope, see section 9) |
| **Next** | Phase 2: projects and CSV product data ([phase-02-projects-and-data.md](phase-02-projects-and-data.md)) |
