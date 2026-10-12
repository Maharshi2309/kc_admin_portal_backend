import { z } from 'zod';
import {
  type CalendarDate,
  type Month,
  type TimeOfDay,
  isCalendarDate,
  isMonth,
  isTimeOfDay,
} from '@/lib/time';

/**
 * Reusable field rules, worded like the Flutter app's own validators so a
 * server message reads the same as the form's. Module schemas compose these;
 * business rules (uniqueness, overlaps, balances) live in services.
 */

const MAX_DB_INT = 2_147_483_647;

/**
 * A record id. The app sends ids as strings ("7"); numbers are accepted too.
 * Parsed to the integer the database uses.
 */
export const id = (label = 'id') =>
  z
    .union([z.string().trim(), z.number()], { error: `Choose a valid ${label}` })
    .transform((value, ctx) => {
      const text = String(value);
      const number = Number(text);
      if (!/^\d+$/.test(text) || number < 1 || number > MAX_DB_INT) {
        ctx.addIssue({ code: 'custom', message: `Choose a valid ${label}` });
        return z.NEVER;
      }
      return number;
    })
    .meta({ description: `${label} id (a string such as "7"; numbers are accepted too)`, examples: ['7'] });

/** Trimmed required text, 1..[max] characters. */
export const requiredText = (label: string, max: number) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `Use at most ${max} characters`);

/** Optional free text; blank becomes null so it's stored as "no value". */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .nullish()
    .transform((value) => (value ? value : null));

/** Lower-cased, so uniqueness is case-insensitive (architecture N-13). */
export const email = () =>
  z
    .string({ error: 'Email address is required' })
    .trim()
    .min(1, 'Email address is required')
    .max(254, 'Use at most 254 characters')
    .pipe(z.email('Enter a valid email address'))
    .transform((value) => value.toLowerCase())
    .meta({ format: 'email', examples: ['rahul.sharma@keshav.in'] });

/**
 * A department or position code (`graphic_designer`). Whether it exists is
 * checked by the service, since the lists can grow.
 */
export const listCode = (message: string) =>
  z
    .string({ error: message })
    .trim()
    .min(1, message)
    .max(50, message)
    .regex(/^[a-z0-9]+(_[a-z0-9]+)*$/, message)
    .meta({ examples: ['graphic_designer'] });

/** "KC" followed by digits (client rule, confirmed 2026-09-29). */
export const ecNumber = () =>
  z
    .string({ error: 'EC number is required' })
    .trim()
    .min(1, 'EC number is required')
    .max(20, 'Use at most 20 characters')
    .regex(/^KC\d+$/, 'Use KC followed by numbers, e.g. KC1001')
    .meta({ examples: ['KC1001'] });

/** 10 digits, without the +91 prefix the app shows. */
export const mobile = () =>
  z
    .string({ error: 'Mobile number is required' })
    .trim()
    .regex(/^\d{10}$/, 'Enter a 10-digit mobile number')
    .meta({ examples: ['9876543210'] });

/** `YYYY-MM-DD`, a real calendar date. */
export const calendarDate = (label = 'Date') =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .refine(isCalendarDate, 'Use a date in the form YYYY-MM-DD')
    .transform((value) => value as CalendarDate)
    .meta({ format: 'date', examples: ['2026-09-28'] });

/** `YYYY-MM`. */
export const month = () =>
  z
    .string({ error: 'Month is required' })
    .trim()
    .refine(isMonth, 'Use a month in the form YYYY-MM')
    .transform((value) => value as Month)
    .meta({ pattern: String.raw`^\d{4}-\d{2}$`, examples: ['2026-09'] });

/** `HH:mm`, 24-hour. */
export const timeOfDay = (label = 'Time') =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .refine(isTimeOfDay, 'Use a time in the form HH:mm')
    .transform((value) => value as TimeOfDay)
    .meta({ pattern: String.raw`^([01]\d|2[0-3]):[0-5]\d$`, examples: ['09:30'] });

/**
 * An instant from the app: ISO 8601 **with** an offset or Z
 * (`2026-09-28T09:35:00+05:30`). Without an offset the moment would be
 * ambiguous, so it's rejected.
 */
export const instant = (label = 'Time') =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .regex(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/,
      'Use a date and time with a time zone offset, e.g. 2026-09-28T09:35:00+05:30',
    )
    .transform((value, ctx) => {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        ctx.addIssue({ code: 'custom', message: 'This date and time is not valid' });
        return z.NEVER;
      }
      return parsed;
    })
    .meta({ format: 'date-time', examples: ['2026-09-28T09:35:00+05:30'] });

/** One value from a fixed list (snake_case enums from the app). */
export const oneOf = <const T extends readonly [string, ...string[]]>(values: T, message: string) =>
  z.enum(values, { error: message });

/** Optional search text: trimmed, blank means "no search". */
export const searchQuery = () =>
  z
    .string()
    .trim()
    .max(100, 'Use at most 100 characters')
    .optional()
    .transform((value) => (value ? value : undefined));

/**
 * An optional query parameter that must be blank or match [schema]. The app
 * leaves unused filters out, but a blank value is treated as "not set".
 */
export const optionalQuery = <S extends z.ZodType>(schema: S) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
