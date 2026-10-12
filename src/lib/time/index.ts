import { DateTime } from 'luxon';
import { env } from '@/config/env';

/**
 * Dates and times, always in the company time zone (DATABASE_V2.md §1,
 * approved 2026-09-30). The server's own zone never matters.
 *
 * Three kinds of value, kept apart on purpose:
 * - **Calendar date** `CalendarDate` "2026-09-28": attendance date, leave
 *   dates, holidays. Never shifted by a time zone.
 * - **Instant** `Date`: a real moment (punch in/out, created at). Stored as
 *   UTC; sent to the app with the company offset ("…T09:35:00+05:30").
 * - **Time of day** `TimeOfDay` "09:30": schedule start/end, company
 *   wall-clock time.
 */

/** `YYYY-MM-DD` */
export type CalendarDate = string;
/** `YYYY-MM` */
export type Month = string;
/** `HH:mm`, 24-hour */
export type TimeOfDay = string;

/** Current time source. Injected so tests can fix "now". */
export type Clock = () => Date;
export const systemClock: Clock = () => new Date();

export function companyZone(): string {
  return env().COMPANY_TIMEZONE;
}

// --- Instants ---------------------------------------------------------------

function inZone(instant: Date, zone: string): DateTime {
  return DateTime.fromJSDate(instant, { zone });
}

/** The company calendar date of [instant] (e.g. the date of a punch). */
export function companyDateOf(instant: Date, zone = companyZone()): CalendarDate {
  return inZone(instant, zone).toISODate()!;
}

/** "Today" in the company zone. */
export function companyToday(clock: Clock = systemClock, zone = companyZone()): CalendarDate {
  return companyDateOf(clock(), zone);
}

/** Company wall-clock time of [instant] as `HH:mm` (e.g. for audit display). */
export function companyTimeOf(instant: Date, zone = companyZone()): TimeOfDay {
  return inZone(instant, zone).toFormat('HH:mm');
}

/**
 * How the API sends instants: ISO 8601, whole seconds, with the company
 * offset, e.g. `2026-09-28T09:35:00+05:30`.
 */
export function formatInstant(instant: Date, zone = companyZone()): string {
  return inZone(instant, zone).startOf('second').toISO({ suppressMilliseconds: true })!;
}

export function formatInstantOrNull(instant: Date | null | undefined): string | null {
  return instant ? formatInstant(instant) : null;
}

/** The instant when the company clock shows [time] on [date] (e.g. a shift start). */
export function companyInstant(date: CalendarDate, time: TimeOfDay, zone = companyZone()): Date {
  const result = DateTime.fromISO(`${date}T${time}`, { zone });
  if (!result.isValid) throw new RangeError(`Invalid company date/time: ${date} ${time}`);
  return result.toJSDate();
}

/** Start of [date] in the company zone, as an instant (for range queries on instants). */
export function startOfCompanyDay(date: CalendarDate, zone = companyZone()): Date {
  return DateTime.fromISO(date, { zone }).startOf('day').toJSDate();
}

/** Whole minutes from [from] to [to], rounded down (worked minutes, DATABASE_V2.md §1). */
export function minutesBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 60_000);
}

// --- Calendar dates ---------------------------------------------------------

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const monthPattern = /^\d{4}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

/** True for a real date in `YYYY-MM-DD` form (rejects 2026-02-30). */
export function isCalendarDate(value: string): value is CalendarDate {
  return datePattern.test(value) && DateTime.fromISO(value, { zone: 'utc' }).isValid;
}

export function isMonth(value: string): value is Month {
  return monthPattern.test(value) && DateTime.fromISO(`${value}-01`, { zone: 'utc' }).isValid;
}

export function isTimeOfDay(value: string): value is TimeOfDay {
  return timePattern.test(value);
}

function utcDate(date: CalendarDate): DateTime {
  return DateTime.fromISO(date, { zone: 'utc' });
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  return utcDate(date).plus({ days }).toISODate()!;
}

/** ISO weekday: 1 = Monday … 7 = Sunday (as in `weeklyOffDays`). */
export function isoWeekday(date: CalendarDate): number {
  return utcDate(date).weekday;
}

/** Every date from [from] to [to], both included. Empty if [to] is before [from]. */
export function eachDate(from: CalendarDate, to: CalendarDate): CalendarDate[] {
  const dates: CalendarDate[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) dates.push(day);
  return dates;
}

/** First and last date of [month]. */
export function monthRange(month: Month): { first: CalendarDate; last: CalendarDate } {
  const start = utcDate(`${month}-01`);
  return { first: start.toISODate()!, last: start.endOf('month').toISODate()! };
}

/** The month of [date], `YYYY-MM`. */
export function monthOf(date: CalendarDate): Month {
  return date.slice(0, 7);
}

/** The month after [month]. */
export function nextMonth(month: Month): Month {
  return utcDate(`${month}-01`).plus({ months: 1 }).toISODate()!.slice(0, 7);
}

/** Every month from [from] to [to], inclusive. */
export function eachMonth(from: Month, to: Month): Month[] {
  const months: Month[] = [];
  for (let month = from; month <= to; month = nextMonth(month)) months.push(month);
  return months;
}

/** How responses name a month: its first day (`"month": "2026-09-01"`). */
export function monthAsDate(month: Month): CalendarDate {
  return `${month}-01`;
}

// --- Database mapping -------------------------------------------------------
// Prisma represents DATE and TIME columns as JS Dates in UTC. These helpers
// are the only place that converts, so a date can never shift by a day.

/** `CalendarDate` → value for a DATE column. */
export function dateToDb(date: CalendarDate): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** DATE column → `CalendarDate`. */
export function dateFromDb(value: Date): CalendarDate {
  return value.toISOString().slice(0, 10);
}

/** `TimeOfDay` → value for a TIME column. */
export function timeToDb(time: TimeOfDay): Date {
  return new Date(`1970-01-01T${time}:00.000Z`);
}

/** TIME column → `TimeOfDay`. */
export function timeFromDb(value: Date): TimeOfDay {
  return value.toISOString().slice(11, 16);
}

/** Minutes since midnight of a `TimeOfDay` ("09:30" → 570). */
export function minutesOfDay(time: TimeOfDay): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours! * 60 + minutes!;
}

/** Inverse of [minutesOfDay] (570 → "09:30"). */
export function timeFromMinutes(minutes: number): TimeOfDay {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 24 * 60) {
    throw new RangeError(`Not a time of day: ${minutes} minutes`);
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}
