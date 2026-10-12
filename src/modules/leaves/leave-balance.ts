import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { env } from '@/config/env';
import {
  type CalendarDate,
  type Month,
  addDays,
  companyDateOf,
  companyZone,
  dateFromDb,
  eachMonth,
  monthOf,
  monthRange,
} from '@/lib/time';
import { type DayEmployee, dayEmployeeSelect, loadDays, noLeave } from '@/modules/day-engine/day-context';

/**
 * The Casual leave balance (DATABASE_V2.md §3.7, approved 2026-10-05; client
 * answers 2026-10-06). One calculation, used by the balance endpoints, the
 * preview, saving leave, leave lists and the dashboard. Nothing is stored.
 *
 * - Earned: 1 day for each month from the later of the policy start month
 *   (LEAVE_ACCRUAL_START_MONTH, January 2026) and the joining month (counted
 *   in full), plus adjustments. Months in which the employee was inactive for
 *   any part earn nothing (client answer 2026-10-06). Unused days carry
 *   forward with no cap and no year-end reset.
 * - Taken: approved and pending Casual leave (pending reserves its days).
 * - No future months: for every month M with Casual leave, the Casual days
 *   dated up to the end of M may not exceed what is earned by M.
 * - Unpaid leave never adds to or uses the balance.
 *
 * Opening balances are 0 (client answer 2026-10-06); corrections go in
 * `leave_balance_adjustments`.
 */

type Client = PrismaClient | Prisma.TransactionClient;

/** The leave types the rules name (DATABASE_V2.md §2.7). */
export const CASUAL = 'casual';

export type LedgerLeave = {
  id: number;
  leaveTypeId: string;
  /** Whether the type uses the Casual balance. */
  hasBalance: boolean;
  startDate: CalendarDate;
  endDate: CalendarDate;
  isHalfDay: boolean;
  days: number;
  status: 'pending' | 'approved';
};

/** Everything the balance of one employee depends on. */
export type Ledger = {
  employee: DayEmployee;
  /** First month that earns a day. */
  startMonth: Month;
  inactiveMonths: Set<Month>;
  adjustments: { month: Month; days: number }[];
  /** The employee's pending and approved leave, of every type. */
  leaves: LedgerLeave[];
};

/** One working date of a leave being saved, worth 1 (or 0.5 for a half day). */
export type LeaveDate = { date: CalendarDate; value: number };

export type BalanceDto = {
  asOf: CalendarDate;
  accrued: number;
  used: number;
  pending: number;
  remaining: number;
  unpaidTaken: number;
};

/** Loads the ledgers of [employees] in four queries. */
export async function loadLedgers(client: Client, employees: DayEmployee[]): Promise<Map<number, Ledger>> {
  const ids = employees.map((e) => e.id);
  if (ids.length === 0) return new Map();
  const [leaves, adjustments, events] = await Promise.all([
    client.leave.findMany({
      where: { employeeId: { in: ids }, status: { in: ['pending', 'approved'] } },
      select: {
        id: true,
        employeeId: true,
        leaveTypeId: true,
        startDate: true,
        endDate: true,
        isHalfDay: true,
        days: true,
        status: true,
        leaveType: { select: { hasBalance: true } },
      },
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
    }),
    client.leaveBalanceAdjustment.findMany({
      where: { employeeId: { in: ids } },
      select: { employeeId: true, effectiveMonth: true, days: true },
    }),
    client.auditLog.findMany({
      where: { employeeId: { in: ids }, action: { in: ['employee.create', 'employee.update', 'employee.status'] } },
      select: { employeeId: true, action: true, createdAt: true, changes: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  ]);

  const policyStart = env().LEAVE_ACCRUAL_START_MONTH;
  return new Map(
    employees.map((employee) => {
      const joined = monthOf(dateFromDb(employee.joiningDate));
      return [
        employee.id,
        {
          employee,
          startMonth: joined > policyStart ? joined : policyStart,
          inactiveMonths: inactiveMonthsOf(
            employee,
            events.filter((e) => e.employeeId === employee.id),
          ),
          adjustments: adjustments
            .filter((a) => a.employeeId === employee.id)
            .map((a) => ({ month: monthOf(dateFromDb(a.effectiveMonth)), days: Number(a.days) })),
          leaves: leaves
            .filter((l) => l.employeeId === employee.id)
            .map((l) => ({
              id: l.id,
              leaveTypeId: l.leaveTypeId,
              hasBalance: l.leaveType.hasBalance,
              startDate: dateFromDb(l.startDate),
              endDate: dateFromDb(l.endDate),
              isHalfDay: l.isHalfDay,
              days: Number(l.days),
              status: l.status as 'pending' | 'approved',
            })),
        },
      ];
    }),
  );
}

/**
 * Months in which the employee was inactive on at least one day, from the
 * status changes in the audit log (deactivation dates aren't stored
 * elsewhere). A month the employee is inactive in today counts too.
 */
function inactiveMonthsOf(
  employee: DayEmployee,
  events: { action: string; createdAt: Date; changes: Prisma.JsonValue }[],
): Set<Month> {
  const changes = events.flatMap((event) => {
    const status = (Array.isArray(event.changes) ? event.changes : []).find(
      (c) => typeof c === 'object' && c !== null && (c as { field?: unknown }).field === 'status',
    ) as { before?: string | null; after?: string | null } | undefined;
    if (!status) return [];
    return [{ date: companyDateOf(event.createdAt), before: status.before ?? null, after: status.after ?? null }];
  });

  const joined = dateFromDb(employee.joiningDate);
  const first = changes[0];
  // Status before the first recorded change (a create records only "after").
  let inactive = first ? first.before === 'Inactive' || (first.before === null && first.after === 'Inactive') : employee.status === 'inactive';
  let since: CalendarDate = joined;
  const periods: { from: CalendarDate; to: CalendarDate | null }[] = [];
  for (const change of first?.before === null ? changes.slice(1) : changes) {
    const nowInactive = change.after === 'Inactive';
    if (nowInactive && !inactive) since = change.date;
    if (!nowInactive && inactive) periods.push({ from: since, to: addDays(change.date, -1) });
    inactive = nowInactive;
  }
  if (inactive) periods.push({ from: since, to: null });

  const today = companyDateOf(new Date());
  const months = new Set<Month>();
  for (const period of periods) {
    const to = period.to ?? today;
    if (to < period.from) continue;
    for (const month of eachMonth(monthOf(period.from), monthOf(to))) months.add(month);
  }
  return months;
}

/** Days earned up to and including [month]. */
export function accrued(ledger: Ledger, month: Month): number {
  let days = 0;
  if (month >= ledger.startMonth) {
    for (const m of eachMonth(ledger.startMonth, month)) if (!ledger.inactiveMonths.has(m)) days += 1;
  }
  for (const adjustment of ledger.adjustments) if (adjustment.month <= month) days += adjustment.days;
  return days;
}

/** Casual leave in the ledger, other than [exceptId]. */
function casualLeaves(ledger: Ledger, exceptId: number | null = null): LedgerLeave[] {
  return ledger.leaves.filter((l) => l.hasBalance && l.id !== exceptId);
}

/** Working days of [employee] from [from] to [to] with their value (a half day is 0.5). */
export async function workingDates(
  client: Client,
  employee: DayEmployee,
  from: CalendarDate,
  to: CalendarDate,
  isHalfDay: boolean,
  now: Date,
): Promise<LeaveDate[]> {
  const days = await loadDays({ employees: [employee], from, to, now, zone: companyZone(), leaveLookup: noLeave, client });
  const dates = days.filter((d) => d.result.dayType === 'working').map((d) => d.date);
  return isHalfDay ? dates.slice(0, 1).map((date) => ({ date, value: 0.5 })) : dates.map((date) => ({ date, value: 1 }));
}

/** Casual days dated up to and including [date] (leave crossing it counts its days up to it). */
async function casualUpTo(
  client: Client,
  ledger: Ledger,
  date: CalendarDate,
  now: Date,
  exceptId: number | null,
): Promise<number> {
  let days = 0;
  for (const leave of casualLeaves(ledger, exceptId)) {
    if (leave.endDate <= date) days += leave.days;
    else if (leave.startDate <= date) {
      days += (await workingDates(client, ledger.employee, leave.startDate, date, leave.isHalfDay, now)).reduce(
        (sum, d) => sum + d.value,
        0,
      );
    }
  }
  return days;
}

/**
 * How much of [dates] (a Casual leave being saved, in date order) the
 * balance covers: the longest run from the first date that keeps every month
 * within what it has earned. [exceptId] is the leave being edited.
 */
export async function coverage(
  client: Client,
  ledger: Ledger,
  dates: LeaveDate[],
  now: Date,
  exceptId: number | null,
): Promise<{ paidCount: number; paidDays: number; available: number }> {
  if (dates.length === 0) return { paidCount: 0, paidDays: 0, available: 0 };
  const firstMonth = monthOf(dates[0]!.date);
  // Months that have Casual leave, from the first new date on.
  const months = new Set<Month>(dates.map((d) => monthOf(d.date)));
  for (const leave of casualLeaves(ledger, exceptId)) {
    for (const month of eachMonth(monthOf(leave.startDate), monthOf(leave.endDate))) {
      if (month >= firstMonth) months.add(month);
    }
  }
  const room = new Map<Month, number>();
  for (const month of months) {
    const used = await casualUpTo(client, ledger, monthRange(month).last, now, exceptId);
    room.set(month, accrued(ledger, month) - used);
  }

  const fits = (count: number) =>
    [...room].every(([month, free]) => {
      const last = monthRange(month).last;
      const added = dates.slice(0, count).reduce((sum, d) => (d.date <= last ? sum + d.value : sum), 0);
      return added <= free + 1e-9;
    });
  let paidCount = dates.length;
  while (paidCount > 0 && !fits(paidCount)) paidCount -= 1;
  const paidDays = dates.slice(0, paidCount).reduce((sum, d) => sum + d.value, 0);

  // What's free by the end date (and in every later month that has leave).
  const endMonth = monthOf(dates[dates.length - 1]!.date);
  const later = [...room].filter(([month]) => month >= endMonth).map(([, free]) => free);
  const available = Math.max(0, Math.min(...later));
  return { paidCount, paidDays, available: paidCount < dates.length ? paidDays : available };
}

/** The balance figures of `GET /employees/{id}/leave-balance` on [asOf]. */
export function balanceOf(ledger: Ledger, asOf: CalendarDate): BalanceDto {
  const casual = casualLeaves(ledger);
  const sum = (leaves: LedgerLeave[]) => leaves.reduce((total, l) => total + l.days, 0);
  const earned = accrued(ledger, monthOf(asOf));
  const used = sum(casual.filter((l) => l.status === 'approved'));
  const pending = sum(casual.filter((l) => l.status === 'pending'));
  const unpaidTaken = sum(ledger.leaves.filter((l) => !l.hasBalance && l.status === 'approved'));
  return { asOf, accrued: earned, used, pending, remaining: earned - used - pending, unpaidTaken };
}

/**
 * Casual days left after [leave] (pending or approved Casual leave): earned
 * by the month of its end date, less Casual days dated up to its end date.
 */
export async function balanceAfter(
  client: Client,
  ledger: Ledger,
  leave: { endDate: CalendarDate },
  now: Date,
): Promise<number> {
  return accrued(ledger, monthOf(leave.endDate)) - (await casualUpTo(client, ledger, leave.endDate, now, null));
}

/** Day-engine employees by id (for ledgers). */
export function dayEmployeesById(client: Client, ids: number[]): Promise<DayEmployee[]> {
  return client.employee.findMany({ where: { id: { in: ids } }, select: dayEmployeeSelect });
}
