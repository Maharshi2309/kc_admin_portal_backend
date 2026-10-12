import { db } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import { can } from '@/lib/permissions';
import {
  type CalendarDate,
  type Clock,
  type Month,
  companyToday,
  companyZone,
  dateFromDb,
  dateToDb,
  monthAsDate,
  monthRange,
  systemClock,
} from '@/lib/time';
import { toEmployeeSummary } from '@/modules/attendance/attendance.mapper';
import type { EmployeeSummaryDto } from '@/modules/attendance/attendance.types';
import type { AuthContext } from '@/modules/auth/auth.types';
import type { DayStatus } from '@/modules/day-engine/compute-day';
import { type LoadedDay, dayEmployeeSelect, loadDays } from '@/modules/day-engine/day-context';
import { casualRemainingOfActive } from '@/modules/leaves/leave.service';

/**
 * Dashboard figures (API_CONTRACT.md "Dashboard"), always computed from the
 * records through the day engine; nothing is stored.
 *
 * "Today" figures count only employees scheduled to work that day (not a
 * company holiday, not their weekly off). Holidays and weekly offs are never
 * absences, and nobody counts as absent before their start + 15 minutes.
 *
 * Leave figures come from the Casual balance calculation (see `leaveUsage`).
 */

/** How many not-punched-in employees are listed (the total is sent too). PROPOSED DEFAULT. */
const NOT_PUNCHED_IN_LIST_SIZE = 10;

const PRESENT: DayStatus[] = ['present', 'late', 'half_day'];

type AttentionItem = { kind: 'not_punched_in' | 'pending_leave' | 'late_arrival'; count: number };

export type DashboardSummaryDto = {
  date: CalendarDate;
  totalEmployees: number;
  scheduledToday: number;
  presentToday: number;
  onLeaveToday: number;
  absentToday: number;
  presentPercent: number | null;
  onLeavePercent: number | null;
  absentPercent: number | null;
  holiday: { id: string; date: CalendarDate; name: string; description: string | null } | null;
  weekOffToday: number;
  holidayWorkedToday: number;
  weekOffWorkedToday: number;
  overtimeMinutesThisMonth: number | null;
  overtimeEmployeesThisMonth: number | null;
  attention: AttentionItem[];
  notPunchedIn: EmployeeSummaryDto[];
  notPunchedInTotal: number;
  onLeave: { employee: EmployeeSummaryDto; leaveType: string; endDate: CalendarDate; days: number; isHalfDay: boolean }[];
  leaveUsage: {
    year: number;
    casualRemainingDays: number;
    casualTakenDays: number;
    unpaidTakenDays: number;
    approvedThisMonth: number;
    pendingThisMonth: number;
    rejectedThisMonth: number;
  };
};

export async function summary(date: CalendarDate, auth: AuthContext, clock: Clock = systemClock): Promise<DashboardSummaryDto> {
  const now = clock();
  if (date > companyToday(() => now)) {
    throw ValidationError.field('date', 'The dashboard is not available for future dates.');
  }
  const zone = companyZone();

  const employees = await activeEmployeesOn(date);
  const [today, holidayRow] = await Promise.all([
    loadDays({ employees, from: date, to: date, now, zone }),
    db().companyHoliday.findFirst({
      where: { date: dateToDb(date), deletedAt: null },
      select: { id: true, date: true, name: true, description: true },
    }),
  ]);

  const scheduled = today.filter((d) => d.result.dayType === 'working');
  const count = (days: LoadedDay[], test: (d: LoadedDay) => boolean) => days.filter(test).length;
  const present = count(scheduled, (d) => PRESENT.includes(d.result.status));
  const onLeave = count(scheduled, (d) => d.result.status === 'on_leave');
  const absent = count(scheduled, (d) => d.result.status === 'absent' && d.result.due);
  const late = count(scheduled, (d) => d.result.status === 'late');
  const notPunchedIn = scheduled
    .filter((d) => d.result.status === 'absent')
    .sort((a, b) => a.employee.name.localeCompare(b.employee.name));
  const share = (n: number) => (scheduled.length === 0 ? null : round1((n * 100) / scheduled.length));

  // Punch-related items are left out when nobody is scheduled (e.g. a company holiday).
  const pendingLeave = await db().leave.count({ where: { status: 'pending' } });
  const attention: AttentionItem[] = [
    ...(scheduled.length > 0 ? [{ kind: 'not_punched_in' as const, count: notPunchedIn.length }] : []),
    ...(pendingLeave > 0 ? [{ kind: 'pending_leave' as const, count: pendingLeave }] : []),
    ...(scheduled.length > 0 ? [{ kind: 'late_arrival' as const, count: late }] : []),
  ];

  const overtime = can(auth, 'overtime.view') ? await overtimeThisMonth(date, now, zone) : null;

  return {
    date,
    totalEmployees: employees.length,
    scheduledToday: scheduled.length,
    presentToday: present,
    onLeaveToday: onLeave,
    absentToday: absent,
    presentPercent: share(present),
    onLeavePercent: share(onLeave),
    absentPercent: share(absent),
    holiday: holidayRow
      ? {
          id: String(holidayRow.id),
          date: dateFromDb(holidayRow.date),
          name: holidayRow.name,
          description: holidayRow.description,
        }
      : null,
    weekOffToday: count(today, (d) => d.result.dayType === 'week_off'),
    holidayWorkedToday: count(today, (d) => d.result.dayKind === 'holiday_worked'),
    weekOffWorkedToday: count(today, (d) => d.result.dayKind === 'week_off_worked'),
    overtimeMinutesThisMonth: overtime?.minutes ?? null,
    overtimeEmployeesThisMonth: overtime?.employees ?? null,
    attention,
    notPunchedIn: notPunchedIn.slice(0, NOT_PUNCHED_IN_LIST_SIZE).map((d) => toEmployeeSummary(d.employee)),
    notPunchedInTotal: notPunchedIn.length,
    onLeave: await onLeaveToday(date, scheduled.filter((d) => d.leave !== 'none')),
    leaveUsage: await leaveUsage(date),
  };
}

/** Who is on approved leave on [date], with the leave that covers it. */
async function onLeaveToday(date: CalendarDate, days: LoadedDay[]): Promise<DashboardSummaryDto['onLeave']> {
  if (days.length === 0) return [];
  const leaves = await db().leave.findMany({
    where: {
      status: 'approved',
      employeeId: { in: days.map((d) => d.employee.id) },
      startDate: { lte: dateToDb(date) },
      endDate: { gte: dateToDb(date) },
    },
    select: { employeeId: true, endDate: true, days: true, isHalfDay: true, leaveType: { select: { name: true } } },
  });
  return days
    .sort((a, b) => a.employee.name.localeCompare(b.employee.name))
    .flatMap((day) => {
      const leave = leaves.find((l) => l.employeeId === day.employee.id);
      return leave
        ? [
            {
              employee: toEmployeeSummary(day.employee),
              leaveType: leave.leaveType.name,
              endDate: dateFromDb(leave.endDate),
              days: Number(leave.days),
              isHalfDay: leave.isHalfDay,
            },
          ]
        : [];
    });
}

/**
 * Leave figures (API_CONTRACT.md "Dashboard", changed 2026-10-05):
 * - `casualRemainingDays`: every active employee's Casual `remaining` on [date];
 * - `casualTakenDays` / `unpaidTakenDays`: approved leave days starting in
 *   [date]'s year (1 Jan – 31 Dec, including leave booked for later in it);
 * - requests by status whose dates overlap [date]'s month.
 */
async function leaveUsage(date: CalendarDate): Promise<DashboardSummaryDto['leaveUsage']> {
  const year = Number(date.slice(0, 4));
  const { first, last } = monthRange(date.slice(0, 7));
  const [remaining, taken, thisMonth] = await Promise.all([
    casualRemainingOfActive(date),
    db().leave.findMany({
      where: {
        status: 'approved',
        startDate: { gte: dateToDb(`${year}-01-01`), lte: dateToDb(`${year}-12-31`) },
      },
      select: { days: true, leaveType: { select: { hasBalance: true } } },
    }),
    db().leave.groupBy({
      by: ['status'],
      where: { startDate: { lte: dateToDb(last) }, endDate: { gte: dateToDb(first) } },
      _count: { _all: true },
      orderBy: { status: 'asc' },
    }),
  ]);
  const takenOf = (paid: boolean) =>
    taken.filter((l) => l.leaveType.hasBalance === paid).reduce((sum, l) => sum + Number(l.days), 0);
  const countOf = (status: string) => thisMonth.find((g) => g.status === status)?._count?._all ?? 0;
  return {
    year,
    casualRemainingDays: remaining,
    casualTakenDays: takenOf(true),
    unpaidTakenDays: takenOf(false),
    approvedThisMonth: countOf('approved'),
    pendingThisMonth: countOf('pending'),
    rejectedThisMonth: countOf('rejected'),
  };
}

export type MonthlyAttendanceDto = {
  month: CalendarDate;
  averagePercent: number | null;
  days: { date: CalendarDate; percent: number }[];
};

/**
 * `GET /dashboard/attendance-chart?month`: for each day up to today, present
 * (including late and half days) as a share of those scheduled. Days nobody
 * was scheduled are left out.
 */
export async function attendanceChart(month: Month, clock: Clock = systemClock): Promise<MonthlyAttendanceDto> {
  const now = clock();
  const today = companyToday(() => now);
  const { first, last } = monthRange(month);
  const to = last < today ? last : today;
  const days =
    first <= to ? await loadDays({ employees: await activeEmployeesOn(to), from: first, to, now, zone: companyZone() }) : [];

  const byDate = new Map<CalendarDate, { scheduled: number; present: number }>();
  for (const day of days) {
    if (day.result.dayType !== 'working') continue;
    const tally = byDate.get(day.date) ?? { scheduled: 0, present: 0 };
    tally.scheduled += 1;
    if (PRESENT.includes(day.result.status)) tally.present += 1;
    byDate.set(day.date, tally);
  }
  const points = [...byDate]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, t]) => ({ date, percent: round1((t.present * 100) / t.scheduled) }));
  return {
    month: monthAsDate(month),
    averagePercent: points.length === 0 ? null : round1(points.reduce((sum, p) => sum + p.percent, 0) / points.length),
    days: points,
  };
}

/**
 * Active employees who had joined by [date]. Past dates use today's active
 * list, because deactivation dates aren't stored (client question T-09).
 */
function activeEmployeesOn(date: CalendarDate) {
  return db().employee.findMany({
    where: { status: 'active', joiningDate: { lte: dateToDb(date) } },
    select: dayEmployeeSelect,
  });
}

/** Overtime of every employee (any status) from the 1st of [date]'s month to [date]. */
async function overtimeThisMonth(date: CalendarDate, now: Date, zone: string) {
  const employees = await db().employee.findMany({
    where: { joiningDate: { lte: dateToDb(date) } },
    select: dayEmployeeSelect,
  });
  const days = await loadDays({ employees, from: `${date.slice(0, 7)}-01`, to: date, now, zone });
  const perEmployee = new Map<number, number>();
  for (const day of days) {
    if (day.result.overtimeMinutes > 0) {
      perEmployee.set(day.employee.id, (perEmployee.get(day.employee.id) ?? 0) + day.result.overtimeMinutes);
    }
  }
  return { minutes: [...perEmployee.values()].reduce((a, b) => a + b, 0), employees: perEmployee.size };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
