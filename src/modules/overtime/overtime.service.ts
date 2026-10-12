import { NotFoundError, ValidationError } from '@/lib/errors';
import {
  type CalendarDate,
  type Clock,
  addDays,
  companyToday,
  companyZone,
  monthAsDate,
  monthOf,
  monthRange,
  systemClock,
} from '@/lib/time';
import { findDayEmployee } from '@/modules/attendance/attendance.repository';
import { loadDays } from '@/modules/day-engine/day-context';
import * as schedules from '@/modules/schedules/schedule.repository';
import type { DayKind } from '@/modules/day-engine/compute-day';

/**
 * `GET /employees/{id}/overtime?from&to` (API_CONTRACT.md "Overtime",
 * DATABASE_V2.md §3.6). All numbers are whole minutes from the day engine,
 * counting days up to today only.
 */

export type OvertimeReportDto = {
  from: CalendarDate;
  to: CalendarDate;
  totalMinutes: number;
  expectedMinutes: number;
  workedMinutes: number;
  /** Expected length of one working day under the current schedule. */
  dayBasisMinutes: number;
  scheduleChanged: boolean;
  /** Every month of the range up to today, oldest first. */
  months: { month: CalendarDate; minutes: number; expectedMinutes: number; workedMinutes: number }[];
  /** Days with overtime only, newest first. */
  days: {
    date: CalendarDate;
    dayKind: DayKind;
    expectedMinutes: number;
    workedMinutes: number;
    overtimeMinutes: number;
    dayBasisMinutes: number;
  }[];
};

export async function report(
  employeeId: number,
  from: CalendarDate,
  to: CalendarDate,
  clock: Clock = systemClock,
): Promise<OvertimeReportDto> {
  if (to < from) throw ValidationError.field('to', 'Must be on or after the start date');
  const employee = await findDayEmployee(employeeId);
  if (!employee) throw new NotFoundError('This employee could not be found.');

  const now = clock();
  const today = companyToday(() => now);
  const until = to < today ? to : today;
  const days = await loadDays({ employees: [employee], from, to: until, now, zone: companyZone() });

  const current = (await schedules.currentVersions([employeeId], today)).get(employeeId);
  const latestBasis = current?.expectedMinutes ?? days.at(-1)?.schedule?.expectedMinutes ?? 0;

  const months = new Map<string, { minutes: number; expectedMinutes: number; workedMinutes: number }>();
  for (let month = monthOf(from); from <= until && month <= monthOf(until); month = nextMonth(month)) {
    months.set(month, { minutes: 0, expectedMinutes: 0, workedMinutes: 0 });
  }
  const totals = { minutes: 0, expectedMinutes: 0, workedMinutes: 0 };
  for (const day of days) {
    const add = (bucket: typeof totals) => {
      bucket.minutes += day.result.overtimeMinutes;
      bucket.expectedMinutes += day.result.expectedMinutes;
      bucket.workedMinutes += day.result.workedMinutes ?? 0;
    };
    add(totals);
    add(months.get(monthOf(day.date))!);
  }

  return {
    from,
    to,
    totalMinutes: totals.minutes,
    expectedMinutes: totals.expectedMinutes,
    workedMinutes: totals.workedMinutes,
    dayBasisMinutes: latestBasis,
    scheduleChanged: new Set(days.map((d) => d.schedule?.id).filter((id) => id !== undefined)).size > 1,
    months: [...months].map(([month, sums]) => ({ month: monthAsDate(month), ...sums })),
    days: days
      .filter((d) => d.result.overtimeMinutes > 0)
      .reverse()
      .map((d) => ({
        date: d.date,
        dayKind: d.result.dayKind,
        expectedMinutes: d.result.expectedMinutes,
        workedMinutes: d.result.workedMinutes ?? 0,
        overtimeMinutes: d.result.overtimeMinutes,
        dayBasisMinutes: d.schedule?.expectedMinutes ?? latestBasis,
      })),
  };
}

function nextMonth(month: string): string {
  return monthOf(addDays(monthRange(month).last, 1));
}
