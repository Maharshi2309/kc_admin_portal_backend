# Deploying the Keshav Admin Portal API on GoDaddy Node.js hosting ("My Apps")

GoDaddy builds the app itself: you upload the source zip, it runs `npm install`, `npm run build`, then `npm start` (`start.js`). On every start the API:

1. creates or updates the database tables (`prisma migrate deploy`), and
2. loads the permission list and creates the first admin from your settings.

So there's no terminal or seed step to run.

## 1. Make the zip (on your PC)

In the project folder `kc_admin_portal_backend`:

```powershell
npm run package:godaddy
```

This makes `build\kc-admin-api-godaddy.zip` (about 200 KB). It holds the source code, `package.json` and `package-lock.json`. It never includes `node_modules`, tests or your `.env`.

## 2. Attach the database

On the app page, open **Database** (Hosted Database) and create or attach the MySQL database. GoDaddy then gives the app these settings automatically:

`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`

The API reads them directly (it builds its connection from them, password safely encoded), so **you don't need to set `DATABASE_URL`**. Only if you ever use a different MySQL, set `DATABASE_URL=mysql://USER:PASSWORD@HOST:PORT/DATABASE` instead (it takes priority).

## 3. Add the other settings (environment variables)

In the app's **Settings** (environment variables / secrets), add:

| Name | Value |
|---|---|
| `JWT_SECRET` | a long random secret (see below). Keep it private; changing it signs everyone out |
| `COMPANY_TIMEZONE` | `Asia/Kolkata` |
| `CORS_ALLOWED_ORIGINS` | the web address of the Flutter **web** app, e.g. `https://admin.yourdomain.com` (comma-separated if several; leave empty if only the mobile apps are used) |
| `BOOTSTRAP_ADMIN_NAME` | `Admin` |
| `BOOTSTRAP_ADMIN_EMAIL` | the admin's email, e.g. `admin@yourcompany.com` |
| `BOOTSTRAP_ADMIN_PASSWORD` | the admin's first password (8+ characters) |
| `AUTH_SESSION_HOURS` | `12` (how long a sign-in lasts) |
| `LOG_LEVEL` | `info` |

Optional: `LOGIN_MAX_ATTEMPTS` (5), `LOGIN_WINDOW_MINUTES` (15), `API_REQUESTS_PER_MINUTE` (300), `LEAVE_ACCRUAL_START_MONTH` (`2026-01`, the first month that earns Casual leave).

To make a `JWT_SECRET`, run this on your PC and copy the output:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Don't set `PORT`; GoDaddy sets it.

## 4. Upload and start

1. On the app page, use **Update Preview** (or the folder/zip upload) and upload `kc-admin-api-godaddy.zip`.
2. Wait for the build to finish (status **Healthy**). If it fails, open **Runtime Logs**:
   - **"Cannot start: the database settings are missing"**: the database isn't attached (step 2). The message lists which database settings it did find (names only).
   - **"Invalid environment configuration"** names the setting that's missing or wrong (e.g. `JWT_SECRET`).
   - **Prisma "P1001" / "Can't reach database"**: the database details are wrong or the database isn't running.
3. In **Runtime Logs** you should see "All migrations have been successfully applied", then "Permissions: 22 in the catalogue." and "Bootstrap admin: created …".

## 5. Check it

The preview address only opens when you're signed in to GoDaddy, so check it in your browser while signed in:

`https://<your-preview-address>/api/health` → `{"status":"ok"}`

`{"status":"unavailable"}` means the API runs but can't reach the database: check the database is attached (step 2).

Then sign in from the app with the admin email and password from step 3.

**After the first successful start, delete `BOOTSTRAP_ADMIN_PASSWORD` from the settings.** The admin already exists, and the password is never changed by a later start.

## 6. Go live

The Flutter app can't use the private preview address. Click **Publish to Live** (this needs a GoDaddy hosting plan), connect your domain or subdomain (e.g. `api.yourdomain.com`), and set the Flutter app's `env/prod.json`:

```json
{ "APP_ENV": "prod", "API_BASE_URL": "https://api.yourdomain.com/api", "USE_MOCK_API": false }
```

## 7. Real data

Add the real departments and designations, and the leave types with their yearly quotas, in the app's **Database** → table browser / SQL editor:

- `departments` (name)
- `designations` (department_id, name)
- `leave_types`: `id` is a short lower-case code like `casual`; also `name`, `has_balance` (1/0), `annual_quota` (days per year, or empty for no limit) and `sort`

Optional hardening: run `database/audit-triggers.sql` from the zip in the SQL editor. It stops anyone from editing or deleting the change history, even with direct database access. If GoDaddy refuses it (it needs extra privileges), skip it; the API works the same.

## Updating later

1. Run `npm run package:godaddy` again.
2. Upload the new zip with **Update Preview**, check it, then **Publish to Live**.

Database changes are applied automatically on start; they only ever add, never delete data.

## Limits to know

- GoDaddy's Node.js hosting allows outbound connections only on ports 80 and 443, and runs Node.js 22. The API uses the MySQL database GoDaddy provides.
- Sign-in throttling counts live in the app's memory, which is fine for a single app.
