import { db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { can } from '@/lib/permissions';
import {
  type CalendarDate,
  type Clock,
  type Month,
  companyToday,
  companyZone,
  dateFromDb,
  dateToDb,
  eachDate,
  formatInstantOrNull,
  monthAsDate,
  monthRange,
  systemClock,
} from '@/lib/time';
import { findDayEmployee } from '@/modules/attendance/attendance.repository';
import type { AuthContext } from '@/modules/auth/auth.types';
import { forEmployeeDay } from '@/modules/audit/audit.service';
import type { DayKind, DayStatus, DayType } from '@/modules/day-engine/compute-day';
import { type LoadedDay, loadDays } from '@/modules/day-engine/day-context';

/**
 * The employee calendar (API_CONTRACT.md "Employee calendar"): every day of a
 * month with its type, schedule, attendance, leave and overtime, plus a
 * summary. Months ahead show holidays, weekly offs and planned leave.
 *
 * `leaves[]` lists pending, approved and rejected requests touching the day;
 * cancelled leave is left out.
 */

export type CalendarLeaveDto = {
  id: string;
  leaveType: { id: string; name: string };
  status: 'pending' | 'approved' | 'rejected';
  isHalfDay: boolean;
};

export type CalendarDayDto = {
  date: CalendarDate;
  dayType: DayType;
  holidayName: string | null;
  schedule: { startTime: string; endTime: string; expectedMinutes: number } | null;
  /** Null on future days, before joining, and on holidays/weekly offs without work. */
  attendance: {
    id: string | null;
    status: DayStatus;
    dayKind: DayKind;
    punchIn: string | null;
    punchOut: string | null;
    workedMinutes: number | null;
    corrected: boolean;
  } | null;
  leaves: CalendarLeaveDto[];
  overtimeMinutes: number;
};

export type CalendarSummaryDto = {
  workingDays: number;
  present: number;
  absent: number;
  leaveDays: number;
  holidays: number;
  weekOffs: number;
  holidayWorked: number;
  weekOffWorked: number;
  expectedMinutes: number;
  workedMinutes: number;
  overtimeMinutes: number;
};

/** `GET /employees/{id}/calendar?month` */
export async function month(employeeId: number, month: Month, clock: Clock = systemClock) {
  const { first, last } = monthRange(month);
  const { days, today } = await buildDays(employeeId, first, last, clock);
  return { month: monthAsDate(month), days: days.map((d) => d.dto), summary: summarize(days, today) };
}

/** `GET /employees/{id}/calendar/{date}`: the day plus its change history (only with `audit.view`). */
export async function day(employeeId: number, date: CalendarDate, auth: AuthContext, clock: Clock = systemClock) {
  const { days } = await buildDays(employeeId, date, date, clock);
  const history = can(auth, 'audit.view') ? await forEmployeeDay(employeeId, date) : [];
  return { day: days[0]!.dto, history };
}

type BuiltDay = { dto: CalendarDayDto; loaded: LoadedDay | null };

async function buildDays(employeeId: number, from: CalendarDate, to: CalendarDate, clock: Clock) {
  const employee = await findDayEmployee(employeeId);
  if (!employee) throw new NotFoundError('This employee could not be found.');
  const now = clock();
  const today = companyToday(() => now);

  const [loaded, holidays, leaveRows] = await Promise.all([
    loadDays({ employees: [employee], from, to, now, zone: companyZone() }),
    db().companyHoliday.findMany({
      where: { deletedAt: null, date: { gte: dateToDb(from), lte: dateToDb(to) } },
      select: { date: true, name: true },
    }),
    db().leave.findMany({
      where: {
        employeeId,
        status: { in: ['pending', 'approved', 'rejected'] },
        startDate: { lte: dateToDb(to) },
        endDate: { gte: dateToDb(from) },
      },
      select: { id: true, startDate: true, endDate: true, status: true, isHalfDay: true, leaveType: { select: { id: true, name: true } } },
      orderBy: { startDate: 'asc' },
    }),
  ]);
  const leavesOn = (date: CalendarDate): CalendarLeaveDto[] =>
    leaveRows
      .filter((l) => dateFromDb(l.startDate) <= date && dateFromDb(l.endDate) >= date)
      .map((l) => ({
        id: String(l.id),
        leaveType: { id: l.leaveType.id, name: l.leaveType.name },
        status: l.status as CalendarLeaveDto['status'],
        isHalfDay: l.isHalfDay,
      }));
  const byDate = new Map(loaded.map((d) => [d.date, d]));
  const holidayOn = new Map(holidays.map((h) => [dateFromDb(h.date), h.name]));

  const days: BuiltDay[] = eachDate(from, to).map((date) => {
    const day = byDate.get(date);
    if (!day) {
      // Before the joining date there's no schedule (so no weekly offs) and
      // nothing recorded: only a company holiday shows.
      const holidayName = holidayOn.get(date) ?? null;
      return {
        loaded: null,
        dto: {
          date,
          dayType: holidayName ? 'holiday' : 'working',
          holidayName,
          schedule: null,
          attendance: null,
          leaves: leavesOn(date),
          overtimeMinutes: 0,
        },
      };
    }
    const { result, record, schedule } = day;
    const working = result.dayType === 'working';
    const show = date <= today && (working || record?.punchIn != null);
    return {
      loaded: day,
      dto: {
        date,
        dayType: result.dayType,
        holidayName: day.holidayName,
        schedule:
          working && schedule
            ? { startTime: schedule.startTime, endTime: schedule.endTime, expectedMinutes: schedule.expectedMinutes }
            : null,
        attendance: show
          ? {
              id: record ? String(record.id) : null,
              status: result.status,
              dayKind: result.dayKind,
              punchIn: formatInstantOrNull(record?.punchIn),
              punchOut: formatInstantOrNull(record?.punchOut),
              workedMinutes: result.workedMinutes,
              corrected: record?.correctedAt != null,
            }
          : null,
        leaves: leavesOn(date),
        overtimeMinutes: show ? result.overtimeMinutes : 0,
      },
    };
  });
  return { days, today };
}

/**
 * Attendance figures count days up to today; holidays and weekly offs cover
 * the whole month. An absence today counts once it's due (after start + grace).
 */
function summarize(days: BuiltDay[], today: CalendarDate): CalendarSummaryDto {
  const summary: CalendarSummaryDto = {
    workingDays: 0,
    present: 0,
    absent: 0,
    leaveDays: 0,
    holidays: 0,
    weekOffs: 0,
    holidayWorked: 0,
    weekOffWorked: 0,
    expectedMinutes: 0,
    workedMinutes: 0,
    overtimeMinutes: 0,
  };
  for (const { dto, loaded } of days) {
    if (dto.dayType === 'holiday') summary.holidays += 1;
    if (dto.dayType === 'week_off') summary.weekOffs += 1;
    if (!loaded || dto.date > today) continue;

    const { result, leave } = loaded;
    summary.workedMinutes += result.workedMinutes ?? 0;
    summary.overtimeMinutes += dto.overtimeMinutes;
    if (result.dayKind === 'holiday_worked') summary.holidayWorked += 1;
    if (result.dayKind === 'week_off_worked') summary.weekOffWorked += 1;
    if (result.dayType !== 'working') continue;

    summary.workingDays += 1;
    summary.expectedMinutes += result.expectedMinutes;
    if (result.status === 'present' || result.status === 'late' || result.status === 'half_day') summary.present += 1;
    if (result.status === 'absent' && result.due) summary.absent += 1;
    summary.leaveDays += leave === 'full_day' ? 1 : leave === 'half_day' ? 0.5 : 0;
  }
  return summary;
}
