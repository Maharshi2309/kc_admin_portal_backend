# API reference

The contract is the Flutter app's `docs/API_CONTRACT.md`, `docs/V3_CHANGES.md` and `docs/api-examples/` (copied into `tests/contract/fixtures`, synced from `kc_admin_portal@678a5ee`). This backend implements it; this page lists what to know beyond the contract.

All paths are under `/api`. Every endpoint except `POST /auth/login` and `GET /health` needs `Authorization: Bearer <accessToken>`. The endpoint table with permissions is in the [README](../README.md#endpoints).

## Admin-only deletes (2026-10-12)

For the main admin only, from Swagger (`/api/docs`); the app doesn't call them. "Main admin" is the bootstrap admin (`BOOTSTRAP_ADMIN_EMAIL`), or the first user ever created if that isn't set. Everyone else gets 403 `PERMISSION_DENIED`, whatever their permissions. Each delete returns `{ deleted: { <table>: <rows> } }`.

- `DELETE /admin/employees/{id}`: cascades to the employee's attendance, leave, leave adjustments and schedules; a linked staff user is unlinked. Change-history entries stay with the employee link cleared.
- `DELETE /admin/attendance/{id}`, `/admin/leaves/{id}`, `/admin/holidays/{id}`: hard deletes. A leave goes with its Unpaid part; approved leave and live holidays recalculate the affected attendance.
- `DELETE /admin/users/{id}`: records the user created or changed are credited to the main admin; their history entries stay and show the actor as "Deleted user" (`actor: { id: "", name: "Deleted user" }`). The main admin can't be deleted (409).
- `DELETE /admin/departments/{code}`, `/admin/positions/{code}`: 409 while any employee uses the entry.
- `POST /admin/clear-data` with `{ "confirm": "DELETE ALL DATA" }`: deletes everything except the main admin (with permissions and sessions), the permission catalogue, leave types, and departments/positions unless `includeMasterData: true`. With the optional append-only triggers installed, the change history is cleared with `TRUNCATE` (which they don't block); if the database user can't truncate, the response says `auditLogsCleared: false`.

Migration `20261012120000_admin_deletes` makes `audit_logs.actor_user_id` nullable and both audit foreign keys `ON DELETE SET NULL` (MySQL doesn't fire triggers for foreign key actions, so this works with the triggers in place).

## V3 (app 2026-10-05, client answers 2026-10-06)

- **Employees** have no email. `department` and `position` are codes (`accountant`, `graphic_designer`, `tailor`) in requests, responses, every `employee` summary and the `department` / `position` filters.
- **Department and position lists** are tables, so more can be added (client answer 2026-10-06): `GET /departments`, `GET /positions`, and `POST` on both with `{ name, code? }` (needs `permission.manage`, since the app's permission list has no key for it). The app's screens show only the three codes it knows until the app is updated.
- **Leave types:** only Casual (paid) and Unpaid. The migration moved existing Sick and Earned leave to Casual (client answer) and left those types inactive.
- **Casual balance** (`src/modules/leaves/leave-balance.ts`): 1 day a month from January 2026 (`LEAVE_ACCRUAL_START_MONTH`) or the joining month if later; carried forward with no cap or year-end reset; never used ahead of the month that earns it; pending leave reserves its days. Opening balances are 0. A month in which the employee was inactive on any day earns nothing (client answer); deactivation dates come from the change history.
- **Over the balance:** 422 `INSUFFICIENT_LEAVE_BALANCE`, or with `splitExcessAsUnpaid` the covered days stay Casual and the latest days become a linked Unpaid leave. Editing a leave that already has an Unpaid part can't split it again (422 on `endDate`).
- **`lateMinutes`** on attendance records; `note` no longer holds "38 min late".
- **`overtimeMinutesThisYear`** on employees is summed from the stored attendance figures, so an open punch today counts once it is punched out.

## Choices where the sources were silent or disagreed

| Topic | What the backend does | Why / open question |
|---|---|---|
| Worked minutes with a break and no break window | The break is deducted once the stay is longer than it, also for an open punch counted live. So a 10:08 punch at 14:30 (09:30–18:30, 60-min break) is 202 minutes, not the example's 262. | DATABASE_V2.md §3.3 (approved). The example JSON doesn't apply the rule. |
| Attendance tiles `present` | Present + half day; late is its own tile (as the app's mock). | The example numbers only add up if present includes late. |
| Dashboard `presentToday` | Present + late + half day. | Contract: "half days included"; example adds up this way. |
| Before start + 15 min today | Status `absent` with note "Not in yet"; not counted as absent on the dashboard or calendar summary. | App mock vs DATABASE_V2.md §3.4; client question T-14. |
| Half-day leave | With a punch: `half_day` (no late check). Without: `absent`. Expected minutes halved. | App mock; client question T-10. |
| Past day with punch in but no punch out | No worked minutes, no overtime. | App mock; client question T-15. |
| Punch in all | Only for today (422 otherwise); punches everyone still `absent`. | The punch time is "now"; who is covered is client question T-08. |
| Punch on a holiday or weekly off | Allowed; becomes holiday / week-off work, all overtime. | App mock; client question T-16. |
| Inactive employees | Can't punch, get added days or new leave; left out of attendance lists and dashboards. | Contract rule 11 (marked "confirm"). |
| Adding leave as approved | Also needs `leave.approve`. | Approved fix S-5. |
| Leave `addedBy` | The name of the staff user who added it. | No employee self-service exists (T-11). |
| `PATCH /employees/{id}` with a changed `status` | Also needs `employee.deactivate` (403 otherwise). An unchanged status is fine. | Approved fix I-01. |
| First schedule | Starts on the joining date; moving the joining date moves it, refused if a later schedule change or recorded attendance would come before it. | Inferred from the app's forms. |
| Next EC number | Highest number after "KC" + 1; `KC1001` on an empty database. | Client question T-05. |
| Staff user passwords | The admin sets the password in `POST /users` (required) and may set a new one in `PATCH /users/{id}`; stored as an Argon2id hash, never returned, logged or audited (the history shows "Set" / "Changed"). A new password ends the user's other sessions (the admin's own current session is kept when they reset their own). Users without a password can't sign in until one is set. | T-06 decided 2026-10-10. |
| Department and position lists | `GET /departments` and `/positions` need `employee.view`, `employee.create` or `employee.edit`. | Every endpoint but login must check a permission; found in the 2026-10-10 route audit. |
| Leave `balanceAfter` across months | Earned by the month of the leave's end date, less Casual days dated up to that date. | DATABASE_V2.md §3.7. |
| Preview `availableCasual` | When some days would be unpaid, the Casual days that fit (as in the 422 message); otherwise what is free by the end date. | The contract says "available for those dates". |
| Error codes | The app's codes plus `VALIDATION_ERROR`, `BAD_REQUEST`, `UNAUTHENTICATED`, `NOT_FOUND`, `DUPLICATE`, `CONFLICT`, `ATTENDANCE_STATE`, `PAYLOAD_TOO_LARGE`, `RATE_LIMITED`, `INTERNAL_ERROR`. The app shows `message` for codes it doesn't know. | Additive. |
| 429 | Sign-in throttling and per-user request limits return 429 with `Retry-After`. The app currently shows a generic error for 429 (frontend review item I-10). | Approved hardening. |
| Percentages | Rounded to one decimal. | Display only. |

## Frontend review items

- **I-01** Stop sending `status` in `PATCH /employees/{id}` (the backend guards it either way).
- **I-02** "Punch in all" sends a `date`; only today is accepted.
- **I-04** Leave `canDecide` / `canChange` are documented as backend-decided but the app computes them.
- **I-05** `employees.attendance-log.response.json` and `attendance.record.response.json` disagree for the same record, and don't apply the break rule.
- **I-10** Show the server `message` for 429.
