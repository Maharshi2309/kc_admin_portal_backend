import { z } from 'zod';
import { resolveDatabaseUrl } from '../../database-url';

/**
 * Server configuration, read once from environment variables and validated.
 *
 * Every setting the backend uses lives here, so hosting can change without
 * code changes. Keys are added as modules need them (database and auth keys
 * arrive with those modules). Document each key in `.env.example`.
 */

const logLevels = ['debug', 'info', 'warn', 'error'] as const;

/** Comma-separated list → trimmed, non-empty entries. */
const commaList = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /**
   * MySQL connection string (`mysql://USER:PASSWORD@HOST:3306/DATABASE`). When
   * it isn't set, it's built from DB_HOST / DB_PORT / DB_NAME / DB_USER /
   * DB_PASSWORD (what GoDaddy's hosting provides). Never logged.
   */
  DATABASE_URL: z
    .string({ error: 'is required' })
    .regex(/^(mysql|mariadb):\/\//, 'must be a mysql:// connection string'),

  /**
   * Company time zone (approved 2026-09-30, DATABASE_V2.md §1). "Today",
   * day boundaries and punch dates are decided in this zone.
   */
  COMPANY_TIMEZONE: z
    .string()
    .default('Asia/Kolkata')
    .refine(isValidTimeZone, 'must be an IANA time zone, e.g. Asia/Kolkata'),

  /** Origins allowed to call the API from a browser (the Flutter web build). */
  CORS_ALLOWED_ORIGINS: commaList.pipe(z.array(z.url())),

  LOG_LEVEL: z.enum(logLevels).default('info'),

  /**
   * Secret that signs access tokens. At least 32 characters; generate with
   * `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
   * Changing it signs everyone out.
   */
  JWT_SECRET: z
    .string({ error: 'is required' })
    .min(32, 'must be at least 32 characters'),

  /**
   * How long a sign-in lasts, in hours. PROPOSED DEFAULT 12 (client question
   * T-13). The app has no refresh token, so an expired session returns to login.
   */
  AUTH_SESSION_HOURS: z.coerce
    .number()
    .int('must be a whole number of hours')
    .min(1, 'must be at least 1')
    .max(24 * 90, 'must be at most 2160 (90 days)')
    .default(12),

  /**
   * Failed sign-ins allowed per email and address before a pause.
   * PROPOSED DEFAULT: 5 per 15 minutes.
   */
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  LOGIN_WINDOW_MINUTES: z.coerce.number().int().min(1).default(15),

  /** Requests per signed-in user per minute. PROPOSED DEFAULT: 300. */
  API_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).default(300),

  /**
   * First month that earns Casual leave, `YYYY-MM` (DATABASE_V2.md §2.7,
   * `leave_accrual_start_month`). January 2026 (client answer 2026-10-06).
   */
  LEAVE_ACCRUAL_START_MONTH: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must be a month as YYYY-MM, e.g. 2026-01')
    .default('2026-01'),
});

export type Env = z.infer<typeof envSchema>;
export type LogLevel = (typeof logLevels)[number];

/**
 * Validates [source] (defaults to `process.env`). Throws one error listing
 * every invalid key, so a misconfigured deployment fails at start-up rather
 * than on the first request. Values are never included in the message.
 */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse({ ...source, DATABASE_URL: resolveDatabaseUrl(source) ?? undefined });
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}

let cached: Env | undefined;

/** The validated configuration, parsed on first use. */
export function env(): Env {
  cached ??= parseEnv();
  return cached;
}

function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
