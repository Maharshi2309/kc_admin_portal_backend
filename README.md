# Keshav Admin Portal — Backend

REST API for the Keshav Admin Portal. The Flutter app (`kc_admin_portal`, Android, iOS and Web) is the only client.

- **Stack:** Next.js (App Router route handlers) · TypeScript · Zod · Prisma + **MySQL 8** (switched from PostgreSQL on 2026-10-02 for GoDaddy's Node.js hosting)
- **API contract:** the Flutter repository's `docs/API_CONTRACT.md` and `docs/api-examples/`. Responses are plain JSON (no envelope), camelCase keys, snake_case enum values, and errors look like `{ code?, message, errors?: { field: [msg] } }`.
- **Status:** all 18 steps are done. Some leave rules follow the app until the client confirms them (see below). Leave (step 12) waits for client answers. Modules are added one at a time; see *Build progress* below.

## Requirements

- Node.js 22 or later (developed on 22.20)
- npm 11

## Setup

```bash
npm install            # also generates the Prisma client
cp .env.example .env   # then edit the values
npm run db:up          # starts MySQL 8.4 in Docker (development only)
npm run db:migrate     # applies migrations to the development database
npm run db:seed        # permission catalogue + first admin from BOOTSTRAP_ADMIN_* in .env
npm run db:sample      # optional, local only: re-adds the default departments, positions and leave types
npm run dev            # http://localhost:3000/api/health
```

## Database

MySQL 8 through Prisma 7 (`prisma/schema.prisma`, driver adapter `@prisma/adapter-mariadb`, which also speaks MySQL). The generated client lives in `src/generated/prisma` (not committed) and only `src/lib/db` creates it (`src/lib/db/connection.ts` turns `DATABASE_URL` into driver settings; the session runs in UTC).

- **Development:** `docker-compose.yml` runs `mysql:8.4` on port 3306 with two databases: `kc_admin_portal` and `kc_admin_portal_test` (for integration tests). Data persists in the `kc-mysql-data` volume. Docker Desktop must be running. Use `127.0.0.1` rather than `localhost` in `DATABASE_URL` on Windows (much faster).
- **Production:** `npm start` applies pending migrations before starting the server (`prisma migrate deploy`; it only adds, never resets data).
- **MySQL notes:** text comparison is case-insensitive (default collation), so unique emails and searches ignore case; weekly offs are a JSON array; "one holiday per date" uses a `live_date` column that is cleared on soft delete; the audit log's database-level append-only triggers are optional (`database/audit-triggers.sql`, needs trigger privileges), the API never changes audit rows either way.
- **Changing the schema:** edit `schema.prisma`, run `npm run db:migrate -- --name <change>`, commit the new folder in `prisma/migrations`. Never edit or delete an applied migration.

| Command | Does |
|---|---|
| `npm run db:up` / `db:down` | Start / stop the development database |
| `npm run db:migrate` | Create and apply a migration (development) |
| `npm run db:deploy` | Apply pending migrations (production, CI) |
| `npm run db:generate` | Regenerate the Prisma client |
| `npm run db:seed` | Sync the permission catalogue and create the bootstrap admin (safe to re-run; never changes existing passwords) |
| `npm run db:sample` | **Development only:** re-add the default departments, positions and leave types (refuses non-local databases) |
| `npm run db:studio` | Browse data in Prisma Studio |

The Flutter app's `API_BASE_URL` for local development is `http://localhost:3000/api` (web and iOS simulator) or `http://10.0.2.2:3000/api` (Android emulator).

## Environment variables

All configuration comes from environment variables, validated at start-up by `src/config/env.ts`. A missing or invalid value stops the server with a message naming the key (values are never printed).

| Key | Required | Default | Meaning |
|---|---|---|---|
| `NODE_ENV` | no | `development` | Set by Next.js for `dev`, `build` and `start` |
| `COMPANY_TIMEZONE` | no | `Asia/Kolkata` | IANA zone that decides "today", day boundaries and punch dates |
| `CORS_ALLOWED_ORIGINS` | no | empty | Comma-separated browser origins allowed to call the API (the Flutter web build) |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn` or `error` |
| `DATABASE_URL` | **yes**, or the `DB_*` settings | — | MySQL connection string (`mysql://USER:PASSWORD@HOST:3306/DATABASE`, optional `?ssl=true`). Never logged. |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | instead of `DATABASE_URL` | port `3306` | What GoDaddy's Hosted Database provides; the connection URL is built from them (`database-url.js`). `DATABASE_URL` wins if both are set |
| `MIGRATE_ON_START` | no | `true` | `npm start` applies pending migrations first (`false` to skip) |
| `BOOTSTRAP_ON_START` | no | `true` | Load permissions and the bootstrap admin when the server starts (`false` to skip) |
| `JWT_SECRET` | **yes** | — | Signs access tokens; at least 32 random characters. Changing it signs everyone out. |
| `AUTH_SESSION_HOURS` | no | `12` | How long a sign-in lasts (proposed default; client question T-13) |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_WINDOW_MINUTES` | no | `5` / `15` | Failed sign-ins per email and address before a pause (proposed default) |
| `API_REQUESTS_PER_MINUTE` | no | `300` | Requests per signed-in user per minute (proposed default) |
| `LEAVE_ACCRUAL_START_MONTH` | no | `2026-01` | First month that earns Casual leave, 1 day a month (client answer 2026-10-06) |
| `BOOTSTRAP_ADMIN_NAME` / `_EMAIL` / `_PASSWORD` | seed only | `Admin` / — / — | Used by `npm run db:seed` to create the first admin if that email doesn't exist. Remove the password afterwards. | Never commit `.env`.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Development server with reload |
| `npm run build` | Production build |
| `npm start` | Apply pending migrations, then run the production build (`server.js`) |
| `npm run start:local` | Run the production build without migrating |
| `npm run package:godaddy` | Make the GoDaddy upload zip |
| `npm run openapi:export` | Write the OpenAPI spec to `docs/openapi.json` |
| `npm run typecheck` | TypeScript check, no output files |
| `npm test` | Unit, API, contract and integration tests (Vitest). Integration tests use the `kc_admin_portal_test` database, so run `npm run db:up` first |
| `npm run test:db:reset` | Wipe and re-migrate the **test** database only (test runs leave employees behind, since audit history can't be deleted) |

## Project structure

```
src/
├── app/api/        Route handlers only; each one calls a module (kept thin)
├── modules/        Business modules: controller, service, repository, validation, types
├── lib/            Shared infrastructure (logger, db, errors, http, validation, time; later auth)
├── config/env.ts   Validated configuration
├── proxy.ts        CORS and security headers for /api/*
└── instrumentation.ts  Start-up hook: validates configuration once
tests/
├── unit/           Pure functions and libraries
├── api/            Route handlers
└── integration/    Against the real test database
```

## Endpoints

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /api/auth/login` | none | `{ email, password }` → `{ accessToken, user }` |
| `GET /api/auth/me` | signed in | The signed-in user with their permission keys |
| `POST /api/auth/logout` | signed in | Ends this device's session → 204 |
| `GET /api/departments` | signed in | `{ id, code, name, employeeCount }` by name |
| `POST /api/departments` | `permission.manage` | `{ name, code? }` → 201 (code made from the name if left out) |
| `GET /api/positions` | signed in | Same shape as departments; positions are independent of departments |
| `POST /api/positions` | `permission.manage` | `{ name, code? }` → 201 |
| `GET /api/leave-types` | `leave.view` | Casual and Unpaid: `{ id, name, hasBalance, isPaid }` |
| `GET /api/leaves` | `leave.view` | `status`, `search`, `from`, `to`, `leaveTypeId`, `department`, paging → page + `counts` per status |
| `GET /api/leaves/{id}` | `leave.view` | One leave, with `isPaid`, `balanceAfter`, `unpaidPartId` |
| `POST /api/leaves` | `leave.create` (+ `leave.approve` to add it approved) | `{ employeeId, leaveTypeId, startDate, endDate, isHalfDay, reason, remarks?, status, splitExcessAsUnpaid? }` → 201. Casual beyond the balance: 422 `INSUFFICIENT_LEAVE_BALANCE` unless `splitExcessAsUnpaid` |
| `PATCH /api/leaves/{id}` | `leave.edit` | Same body; pending leave only (409 `LEAVE_NOT_EDITABLE`) |
| `PATCH /api/leaves/{id}/status` | `leave.approve` / `leave.cancel` | `approved`, `rejected` (from pending) or `cancelled` (from pending or approved) |
| `POST /api/leaves/preview` | `leave.create` or `leave.edit` | `{ days, paidDays, unpaidDays, availableCasual }` |
| `GET /api/leave-balances` | `leave.view` | `search`, `department`, paging → active employees' Casual balances + `summary` totals |
| `GET /api/leave-calendar` | `leave.view` | `month`, `employeeId?` → holidays and the employee's weekly offs |
| `GET /api/employees/{id}/leave-balance` | `employee.view` | `{ asOf, accrued, used, pending, remaining, unpaidTaken }` (Casual) |
| `GET /api/employees/{id}/leaves` | `employee.view` | The employee's leave history, newest first, with `isPaid` and `balanceAfter` |
| `GET /api/employees` | `employee.view` | `search` (name or EC), `department`, `position`, `status`, `joinedFrom`, `joinedTo`, `page`, `pageSize` → `{ items, total, page, pageSize, counts }`; items carry `overtimeMinutesThisYear` (null without `overtime.view`) |
| `GET /api/employees/next-ec-number` | `employee.view` | `{ ecNumber }`: highest number + 1 (a suggestion) |
| `POST /api/employees` | `employee.create` | Employee + first working `schedule` (starts on the joining date) → 201 |
| `GET /api/employees/{id}` | `employee.view` | One employee with today's schedule |
| `PATCH /api/employees/{id}` | `employee.edit` | Same body as create, without `schedule`. Changing `status` here also needs `employee.deactivate` |
| `PATCH /api/employees/{id}/status` | `employee.deactivate` | `{ status: "active" \| "inactive" }`. Employees are never deleted |
| `GET /api/employees/{id}/schedules` | `employee.view` | Schedule versions, newest first |
| `POST /api/employees/{id}/schedules` | `schedule.edit` | New version from `effectiveFrom`; the previous one ends the day before. 409 `SCHEDULE_OVERLAP` if one already starts that day |
| `GET /api/holidays` | `holiday.view` | `year`, `search` → plain list by date |
| `GET /api/holidays/{id}` | `holiday.view` | One holiday (used by the app; not in the contract table) |
| `POST /api/holidays` | `holiday.create` | `{ date, name, description? }` → 201. One per date: 409 with `errors.date` ("Diwali is already on this date") |
| `PATCH /api/holidays/{id}` | `holiday.edit` | Same body |
| `DELETE /api/holidays/{id}` | `holiday.delete` | Soft delete → 204; the date becomes free again |
| `GET /api/attendance` | `attendance.view` | `date` (required, not future), `status`, `search`, `department`, `page`, `pageSize` (default 20) → `{ summary, items, total, page, pageSize }` |
| `GET /api/attendance/{id}` | `attendance.view` | One record |
| `POST /api/attendance/punch-in` | `attendance.punch` | `{ employeeId }`, at the server's time |
| `POST /api/attendance/punch-out` | `attendance.punch` | `{ employeeId }` |
| `POST /api/attendance/punch-in/bulk` | `attendance.punch` | `{ date }` (must be today) → `{ count }`: everyone still absent today |
| `PATCH /api/attendance/{id}` | `attendance.correct` | Correction: `{ date, punchIn, punchOut?, reason, remarks? }` |
| `POST /api/attendance` | `attendance.correct` | Add a missing day: same body plus `employeeId` → 201 |
| `GET /api/employees/{id}/attendance-log` | `attendance.view` | `month=YYYY-MM` → every day up to today, newest first |
| `GET /api/employees/{id}/overtime` | `overtime.view` | `from`, `to` → totals, months and overtime days (minutes) |
| `GET /api/employees/{id}/calendar` | `calendar.view` | `month=YYYY-MM` → every day + summary |
| `GET /api/employees/{id}/calendar/{date}` | `calendar.view` | The day + change history (history needs `audit.view`) |
| `GET /api/permissions` | `permission.manage` | The permission catalogue, grouped by module |
| `GET /api/users` | `permission.manage` | `search` (name or email), `page`, `pageSize` |
| `GET /api/users/{id}` | `permission.manage` | One staff user with permissions and linked employee |
| `POST /api/users` | `permission.manage` | `{ name, email, password, employeeId?, permissions? }` → 201. `password` required, 8–200 characters, stored as an Argon2id hash (T-06) |
| `PATCH /api/users/{id}` | `permission.manage` | `{ name, email, employeeId, isActive?, password? }`; `employeeId: null` unlinks. Deactivating, or setting a new `password`, ends the user's other sessions |
| `PUT /api/users/{id}/permissions` | `permission.manage` | `{ permissions: [...] }`, the full list |
| `GET /api/audit-logs` | `audit.view` | `employeeId`, `date`, `from`, `to` (affected date), `entityType`, paging; newest first |
| `DELETE /api/admin/employees/{id}` | main admin | Deletes the employee and their attendance, leave, adjustments and schedules (history kept, unlinked) |
| `DELETE /api/admin/attendance/{id}` | main admin | Deletes one attendance record |
| `DELETE /api/admin/leaves/{id}` | main admin | Deletes a leave (with its Unpaid part); recalculates approved days |
| `DELETE /api/admin/holidays/{id}` | main admin | Deletes a holiday permanently; recalculates that date |
| `DELETE /api/admin/users/{id}` | main admin | Deletes a staff user; their records are credited to the main admin |
| `DELETE /api/admin/departments/{code}`, `/positions/{code}` | main admin | Deletes an unused list entry (409 while employees use it) |
| `POST /api/admin/clear-data` | main admin | `{ "confirm": "DELETE ALL DATA", includeMasterData? }`: deletes all data except the main admin, permissions and leave types |
| `GET /api/dashboard/summary` | `dashboard.view` | `date=YYYY-MM-DD` (not future) → today's figures among scheduled employees, attention items, not-punched-in list; overtime only with `overtime.view` |
| `GET /api/dashboard/attendance-chart` | `dashboard.view` | `month=YYYY-MM` → present share of scheduled per day up to today |
| `GET /api/health` | none | Liveness check for hosting tools: `200 { "status": "ok" }`, or `503 { "status": "unavailable" }` when the database can't be reached |

Choices made where the sources were silent, and items for the Flutter side, are in [docs/API.md](docs/API.md).

## API documentation (Swagger)

- **Swagger UI:** `/api/swagger` (e.g. `http://localhost:3000/api/swagger`; `/api/docs` also works). Sign in with `POST /auth/login`, click **Authorize** and paste the `accessToken` to try the other endpoints.
- **OpenAPI 3.1 spec:** `/api/swagger/spec` (also `/api/openapi.json`), saved as [docs/openapi.json](docs/openapi.json) for Postman or code generators (`npm run openapi:export` refreshes it; a test fails if it's stale).
- Request bodies and query parameters are generated from the API's own Zod validation; response shapes are in `src/lib/openapi/components.ts`. A test fails if a route is added or removed without updating `src/lib/openapi/spec.ts`.
- Both are public (they contain no data). Set `API_DOCS=false` to hide them; they then answer 404 "API documentation is turned off on this server".

## API conventions

Every route is wrapped by `route()` (`src/lib/http/handler.ts`), which gives each request an id (`X-Request-Id`), logs it, and turns any thrown error into the app's error body. Route files stay thin and never build error JSON themselves.

| Situation | Status | Body |
|---|---|---|
| Success | 200 / 201 / 204 | The object or list itself (no envelope) |
| Body is not JSON | 400 | `{ code: "BAD_REQUEST", message }` |
| Validation failed | 422 | `{ code: "VALIDATION_ERROR", message, errors: { field: [msg] } }` (nested fields use dots) |
| Not signed in / session ended | 401 | `{ code: "UNAUTHENTICATED", message }` |
| Missing permission | 403 | `{ code: "PERMISSION_DENIED", message }` |
| Not found (incl. unknown `/api/...` paths) | 404 | `{ code: "NOT_FOUND", message }` |
| Duplicate or state conflict | 409 | `{ code, message, errors? }`, e.g. `DUPLICATE`, `LEAVE_NOT_EDITABLE` |
| Body over 100 KB | 413 | `{ code: "PAYLOAD_TOO_LARGE", message }` |
| Rate limited | 429 | `{ code: "RATE_LIMITED", message }` + `Retry-After` |
| Anything unexpected | 500 | `{ code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." }`; details are logged, never returned |

Database errors are mapped in `src/lib/errors/prisma-errors.ts`: each unique index or foreign key that user input can violate is listed there with its request field and message. Add an entry whenever a migration adds one.

**Pagination:** query `page` (1-based, default 1) and `pageSize` (default 10, max 100); response `{ items, total, page, pageSize }`.

**CORS and headers** (`src/proxy.ts`, Next.js 16's replacement for middleware): preflights for `/api/*` are answered for origins in `CORS_ALLOWED_ORIGINS`; responses get `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a deny-all CSP and `Cache-Control: no-store`. No credentials/cookies are allowed. Authentication is not done in the proxy.

## Authentication

Staff sign in with email and password and get an access token, sent as `Authorization: Bearer <token>` (what the Flutter app does).

- Passwords are hashed with Argon2id and never returned or logged.
- The token is a signed JWT naming the user and a **session** row. Every request re-checks the session and the user, so logout, deactivation and permission changes apply immediately.
- Sessions last `AUTH_SESSION_HOURS`; there is no refresh token (the app returns to login).
- Login gives the same "Invalid email or password." for an unknown email, a wrong password or an account without a password yet; "Your account has been deactivated." is shown only after a correct password.
- Protected routes use `authed()` (`src/lib/auth/authed.ts`) instead of `route()`; the handler receives `auth` with the user id and permission keys.

## Authorization

There are **no roles**: each staff user has their own permission keys (client decision 2026-10-02). The catalogue of 22 keys lives in `src/lib/permissions/catalogue.ts`; `npm run db:seed` copies it into the database and a contract test fails if it drifts from the app's `permissions.response.json`.

- Routes declare what they need: `authed({ permission: 'employee.edit' }, handler)`, or a list where any one is enough. Missing → `403 { code: "PERMISSION_DENIED", message: "You do not have permission to edit employees." }`.
- Order of checks: session (401) → permission (403) → validation (422) → state rules (404/409).
- Rules that depend on the request (approve vs cancel leave, etc.) use `requirePermission(auth, key)` in the service.
- Permissions are loaded on every request, so changes apply immediately.
- The bootstrap admin gets every permission the first time it is seeded.

## Audit log

Changes listed in DATABASE_V2.md §5 are recorded in `audit_logs` by `writeAudit(tx, entry)` (`src/modules/audit`), **in the same transaction** as the change. `diffForAudit` builds the `[{ field, label, before, after }]` list with display-ready values. The table is append-only: a database trigger rejects every UPDATE and DELETE.

## Employees and working schedules

- EC number: `KC` + digits, unique. `next-ec-number` suggests the highest + 1 (`KC1001` on an empty database, a proposed default until the client confirms, T-05).
- Employees have no email (removed 2026-10-05); mobile is 10 digits.
- `department` and `position` are codes from the `departments` and `positions` lists (`accountant`, `graphic_designer`, `tailor` to start with; more can be added).
- Employees are never deleted; status is `active` or `inactive`. Every create, edit and status change is in the audit log.
- Each employee has **versioned** schedules (start/end time, break with optional window, weekly offs as ISO weekdays 1–7). Creating an employee sets the first version from the joining date; editing the joining date moves it. A change adds a version from its date and closes the previous one the day before, so past days keep their schedule. Versions can't start before the joining date or on the same day as another.
- `expectedMinutes` = end − start − break, computed by the server. Overnight shifts aren't supported.
- The employee's `schedule` is the version in effect today (or the first one still to come for a future joiner).

## Attendance and the day engine

`computeDay` (`src/modules/day-engine/compute-day.ts`) decides everything about one employee on one date: day type (holiday beats weekly off), expected, worked and overtime minutes, status, `lateMinutes` and a short note (e.g. "Not in yet"), following DATABASE_V2.md §3. It is ported from the app's reference calculator so both agree, and every screen goes through `loadDays` (`day-context.ts`), so lists, logs and (later) the calendar, overtime and dashboard can't disagree.

- A row exists only once something is recorded; absences have no row (`"id": null`). Rows store snapshots of the computed values; responses recompute them live, because today's status depends on the time of day.
- Punches use the server's clock. Punch in is refused if already punched in or on full-day leave; punch out needs a punch in; inactive employees can't punch.
- Corrections and added days need a reason; times must be on the record's date (company time), in order and not in the future. Both are audited ("Corrected punch in" with before/after times).
- Lists cover **active** employees who had joined by the date, sorted absent → late → present → half day → on leave → holiday → weekly off.
- Where the spec is silent the app's behaviour is followed, pending client answers: "Not in yet" before start + grace (T-14), half-day leave statuses (T-10), no worked time for a past day without a punch out (T-15), who "punch in all" covers (T-08).
- Approved leave makes a working day `on_leave` (full day) or halves its expected time (half day); pending leave doesn't excuse an absence.
- Stored snapshots follow what they depend on (`recalculateRecords`, §3.5): adding, moving or deleting a holiday recalculates the rows on those dates; a schedule change recalculates the employee's rows from its date; moving the joining date is refused if attendance is already recorded before the new date.

## Leave

- Days: the employee's working days in the range (weekly offs and company holidays excluded); a half day is 0.5 on a single date. Recounted when holidays or schedules change, so a holiday added inside leave gives the day back.
- Types: only **Casual** (paid, with a balance) and **Unpaid** (2026-10-05).
- Casual balance (`src/modules/leaves/leave-balance.ts`, calculated, never stored): 1 day earned per month from `LEAVE_ACCRUAL_START_MONTH` (January 2026) or the joining month if later, plus any `leave_balance_adjustments`; carried forward with no cap or year-end reset; a month in which the employee was inactive on any day earns nothing. Approved and pending Casual leave use it; a month's day can't be used before that month.
- Casual leave beyond the balance: 422 `INSUFFICIENT_LEAVE_BALANCE`, or with `splitExcessAsUnpaid` the covered days stay Casual and the latest days become a linked Unpaid leave (`leaves.unpaid_part_of`), in one transaction. Saving locks the employee row, so two requests can't spend the same day.
- Overlapping pending or approved leave is refused; inactive employees can't get new leave; nothing is ever deleted.
- Approving, cancelling or editing approved leave recalculates the attendance it covers, in the same transaction. Every change is audited.

## Staff users

- Lock-out protection: there is always at least one active user with `permission.manage` (409 `LAST_PERMISSION_MANAGER`), and nobody can deactivate themselves or remove their own `permission.manage` (409 `CANNOT_CHANGE_OWN_ACCESS`). Access changes run one at a time (a transaction-level advisory lock).
- A user can be linked to at most one employee, and each employee to at most one user.
- Staff users sign in with the password the admin set for them (T-06, decided 2026-10-10: the admin sets it; stored as an Argon2id hash; no invitation email). Users created before this change have no password and can't sign in until an admin sets one with `PATCH /api/users/{id}`.
- Every create, edit and permission change is in the audit log (one line per permission granted or removed).

## Dates and times

Everything is decided in the company time zone (`COMPANY_TIMEZONE`, default `Asia/Kolkata`), never the server's. `src/lib/time` is the only place that converts:

| Kind | API format | Database |
|---|---|---|
| Calendar date (attendance date, leave dates, holidays) | `"2026-09-28"` | `DATE` |
| Instant (punches, created/updated at) | `"2026-09-28T09:35:00+05:30"`; requests must include an offset | `DATETIME(3)` holding UTC |
| Time of day (schedule start/end) | `"09:30"` | `TIME` |
| Month (queries) | `month=2026-09`; responses use `"2026-09-01"` | — |
| Durations | whole minutes, rounded down | `INTEGER` |

Services take a `Clock` so tests can fix "now".

## Validation

Request schemas are built from shared rules in `src/lib/validation` (`id`, `requiredText`, `email`, `ecNumber`, `mobile`, `calendarDate`, `timeOfDay`, `instant`, `oneOf`, `searchQuery`, …), worded like the Flutter app's own messages. Emails are lower-cased; blank optional text becomes `null`; unknown body fields are ignored and never stored. Business rules (uniqueness, overlaps, balances) are checked in services.

## Security

- Passwords: Argon2id; never returned or logged. Sessions are revocable and checked on every request.
- Rate limits (`src/lib/rate-limit`): sign-in pauses after `LOGIN_MAX_ATTEMPTS` wrong passwords for one email from one address (429 with `Retry-After`, cleared by a successful sign-in); each signed-in user gets `API_REQUESTS_PER_MINUTE`. Counters are in memory, which suits one server; if the API runs as several instances, swap in a shared store (the `RateLimitStore` interface).
- Behind a proxy, the client address comes from the first `X-Forwarded-For` hop; make sure the proxy sets it.
- Validation on every input, Prisma for all queries, no raw SQL built from strings, safe error messages, deny-all CSP and `nosniff` headers, CORS allow-list.
- `npm audit` lists 4 high-severity advisories in packages pulled in by the Prisma command-line tool (`mysql2`, `deepmerge-ts`). The app doesn't use MySQL, and the only fix today is downgrading Prisma, so they're left until Prisma updates them.

## Logging

Structured JSON lines on stdout/stderr (`src/lib/logger`), so any host can collect them. Passwords, tokens and request bodies are never logged.

## Deployment

- **GoDaddy Node.js hosting ("My Apps"):** `npm run package:godaddy` makes `build/kc-admin-api-godaddy.zip` (source only). GoDaddy runs `npm install`, `npm run build` and `npm start`; on start the API applies migrations and loads the permissions and bootstrap admin from its settings. Steps: [deploy/DEPLOY.md](deploy/DEPLOY.md) (also inside the zip).
- **Any other Node 22 host with MySQL 8:** `npm install`, `npm run build`, `npm start` with the environment variables below.
- `start.js` is the production entry point (`main`, `npm start`): it works out the database connection, applies pending migrations, then runs `server.js`, which serves the built Next.js app on `PORT` on all interfaces.

## Build progress

| Step | Module | Status |
|---|---|---|
| 1 | Foundation: project, configuration, logger, health check | Done |
| 2 | Database: Prisma, MySQL connection, initial schema | Done (MySQL since 2026-10-02) |
| 3 | Common HTTP: errors, responses, pagination, CORS | Done |
| 4 | Validation and time utilities | Done |
| 5 | Authentication | Done |
| 6 | Authorization and audit writer | Done |
| 7 | Master data | Done |
| 8 | Employees and schedules | Done |
| 9 | Holidays | Done |
| 10 | Day-calculation engine | Done |
| 11 | Attendance | Done |
| 12 | Leave | Done |
| 13 | Recalculation hooks | Done |
| 14 | Overtime and employee calendar | Done |
| 15 | Dashboard | Done |
| 16 | Users, permissions, audit list | Done |
| 17 | Security hardening and contract tests | Done |
| 18 | Documentation | Done ([docs/API.md](docs/API.md)) |
