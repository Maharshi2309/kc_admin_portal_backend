import { type CalendarDate, type TimeOfDay, companyDateOf, companyInstant, isoWeekday, minutesBetween } from '@/lib/time';

/**
 * `computeDay` (DATABASE_V2.md §3): everything the backend decides about one
 * employee on one date. Punches, corrections, attendance lists, the calendar,
 * overtime and the dashboard all use this one function; the app only shows
 * its results.
 *
 * It's a pure function (no database, no clock of its own), ported from the
 * app's reference implementation (`mock_day_calculator.dart`) so both agree
 * exactly. Where the spec is silent, the app's behaviour is followed and the
 * open client question is named:
 * - T-14: before shift start + grace today, a missing punch shows `absent`
 *   with the note "Not in yet"; `due` is false so counts can leave it out.
 * - T-10: half-day leave with a punch → `half_day` (no late check); without a
 *   punch → `absent`.
 * - T-15: a past day with a punch in but no punch out has no worked minutes.
 */

/** Late means a punch in after the start time plus this grace (approved 2026-09-30). */
export const LATE_GRACE_MINUTES = 15;

export type DayType = 'working' | 'week_off' | 'holiday';
export type DayKind = 'working' | 'holiday_worked' | 'week_off_worked';
export type DayStatus = 'present' | 'late' | 'half_day' | 'on_leave' | 'absent' | 'weekly_off' | 'holiday';
/** Approved leave on the date, as far as the day's hours are concerned. */
export type DayLeave = 'none' | 'full_day' | 'half_day';

export type DaySchedule = {
  startTime: TimeOfDay;
  endTime: TimeOfDay;
  breakMinutes: number;
  breakStart: TimeOfDay | null;
  breakEnd: TimeOfDay | null;
  weeklyOffDays: readonly number[];
  expectedMinutes: number;
};

export type DayInput = {
  date: CalendarDate;
  /** The current instant; decides "today", live worked time and "not due yet". */
  now: Date;
  /** The schedule version in effect on [date]; null before the employee joined. */
  schedule: DaySchedule | null;
  /** Whether a company holiday falls on [date]. */
  isHoliday: boolean;
  leave: DayLeave;
  punchIn: Date | null;
  punchOut: Date | null;
  /** Company time zone (IANA). */
  zone: string;
};

export type DayResult = {
  dayType: DayType;
  dayKind: DayKind;
  status: DayStatus;
  /** Short remark, e.g. "Not in yet". Never a duration (the app formats those). */
  note: string | null;
  /** Minutes after the start time when the punch in was late; null otherwise. */
  lateMinutes: number | null;
  expectedMinutes: number;
  /** Null until there's a punch in (and, on a past day, a punch out). */
  workedMinutes: number | null;
  overtimeMinutes: number;
  /** Worked share of expected time, 0–100 with one decimal; null when nothing is expected. */
  workedPercent: number | null;
  /** True once a missing punch counts as an absence (false before start + grace today). */
  due: boolean;
};

export function computeDay(input: DayInput): DayResult {
  const { date, now, schedule, leave, punchIn, punchOut, zone } = input;
  const isToday = companyDateOf(now, zone) === date;

  // §3.1 Day type: holidays win over weekly offs.
  const dayType: DayType = input.isHoliday
    ? 'holiday'
    : schedule && schedule.weeklyOffDays.includes(isoWeekday(date))
      ? 'week_off'
      : 'working';
  const working = dayType === 'working';

  // §3.2 Expected minutes.
  const scheduled = schedule?.expectedMinutes ?? 0;
  const expected = !working ? 0 : leave === 'full_day' ? 0 : leave === 'half_day' ? Math.floor(scheduled / 2) : scheduled;

  // §3.3 Worked minutes: the stay, less the break on working days. An open
  // punch counts up to now, but only today.
  let worked: number | null = null;
  const end = punchOut ?? (isToday ? now : null);
  if (punchIn && end) {
    const stay = Math.max(0, minutesBetween(punchIn, end));
    const deduction = working && schedule ? breakDeduction(schedule, date, punchIn, end, stay, zone) : 0;
    worked = Math.max(0, stay - deduction);
  }

  // §3.3 Overtime: never negative on working days; all of it on holidays and weekly offs.
  const overtime = worked === null ? 0 : working ? Math.max(0, worked - expected) : worked;

  const dayKind: DayKind =
    punchIn === null ? 'working' : dayType === 'holiday' ? 'holiday_worked' : dayType === 'week_off' ? 'week_off_worked' : 'working';

  const { status, note, lateMinutes, due } = statusOf({ dayType, schedule, leave, date, now, isToday, punchIn, zone });

  return {
    dayType,
    dayKind,
    status,
    note,
    lateMinutes,
    expectedMinutes: expected,
    workedMinutes: worked,
    overtimeMinutes: overtime,
    workedPercent: worked === null || expected === 0 ? null : roundTo1(Math.min(100, (worked * 100) / expected)),
    due,
  };
}

/**
 * The break is deducted only when the stay covers the whole break window, or,
 * without a window, when the stay is longer than the break (§3.3).
 */
function breakDeduction(
  schedule: DaySchedule,
  date: CalendarDate,
  punchIn: Date,
  end: Date,
  stay: number,
  zone: string,
): number {
  const length = schedule.breakMinutes;
  if (length === 0) return 0;
  if (!schedule.breakStart || !schedule.breakEnd) return stay > length ? length : 0;
  const windowStart = companyInstant(date, schedule.breakStart, zone);
  const windowEnd = companyInstant(date, schedule.breakEnd, zone);
  return punchIn <= windowStart && end >= windowEnd ? length : 0;
}

function statusOf(args: {
  dayType: DayType;
  schedule: DaySchedule | null;
  leave: DayLeave;
  date: CalendarDate;
  now: Date;
  isToday: boolean;
  punchIn: Date | null;
  zone: string;
}): { status: DayStatus; note: string | null; lateMinutes: number | null; due: boolean } {
  const { dayType, schedule, leave, date, now, isToday, punchIn, zone } = args;
  const plain = { note: null, lateMinutes: null, due: true };

  // Holidays and weekly offs are never absences; work on them shows as present.
  if (dayType !== 'working') {
    if (punchIn) return { status: 'present', ...plain };
    return { status: dayType === 'holiday' ? 'holiday' : 'weekly_off', ...plain };
  }
  if (leave === 'full_day') return { status: 'on_leave', ...plain };

  const start = schedule ? companyInstant(date, schedule.startTime, zone) : null;
  if (!punchIn) {
    const dueBy = start ? new Date(start.getTime() + LATE_GRACE_MINUTES * 60_000) : null;
    const notDueYet = isToday && dueBy !== null && now < dueBy;
    return { status: 'absent', note: notDueYet ? 'Not in yet' : null, lateMinutes: null, due: !notDueYet };
  }
  if (leave === 'half_day') return { status: 'half_day', ...plain };
  if (start) {
    const lateBy = minutesBetween(start, punchIn);
    if (lateBy > LATE_GRACE_MINUTES) return { status: 'late', ...plain, lateMinutes: lateBy };
  }
  return { status: 'present', ...plain };
}

function roundTo1(value: number): number {
  return Math.round(value * 10) / 10;
}
