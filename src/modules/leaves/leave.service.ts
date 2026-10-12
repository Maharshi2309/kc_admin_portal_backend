import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { ConflictError, InsufficientLeaveBalanceError, NotFoundError, ValidationError } from '@/lib/errors';
import { toPage } from '@/lib/http';
import { requirePermission } from '@/lib/permissions';
import {
  type CalendarDate,
  type Clock,
  companyToday,
  companyZone,
  dateFromDb,
  dateToDb,
  eachDate,
  isoWeekday,
  monthAsDate,
  monthRange,
  systemClock,
  type Month,
} from '@/lib/time';
import { toEmployeeSummary } from '@/modules/attendance/attendance.mapper';
import { findDayEmployee } from '@/modules/attendance/attendance.repository';
import type { EmployeeSummaryDto } from '@/modules/attendance/attendance.types';
import type { AuthContext } from '@/modules/auth/auth.types';
import type { AuditChange } from '@/modules/audit/audit.types';
import { writeAudit } from '@/modules/audit/audit.writer';
import { type DayEmployee, dayEmployeeSelect, loadDays, noLeave } from '@/modules/day-engine/day-context';
import { recalculateRecords } from '@/modules/day-engine/recalculate';
import { lockEmployee } from '@/modules/employees/employee.repository';
import { weekdaysOf } from '@/modules/schedules/schedule.rules';
import {
  type BalanceDto,
  type Ledger,
  balanceAfter,
  balanceOf,
  coverage,
  dayEmployeesById,
  loadLedgers,
  workingDates,
} from './leave-balance';
import * as repo from './leave.repository';
import type { LeaveBalancesQuery, LeaveBody, LeaveListQuery, LeavePreviewBody } from './leave.validation';

/**
 * Leave (API_CONTRACT.md "Leave", V3 2026-10-05).
 *
 * - Types: only Casual (paid, with a balance) and Unpaid.
 * - Days: the employee's working days in the range (weekly offs and company
 *   holidays excluded); a half day is 0.5.
 * - Balance: Casual leave earned at 1 day a month, carried forward, never
 *   used ahead of the month that earns it (see `leave-balance.ts`). Casual
 *   leave beyond it is refused with 422 `INSUFFICIENT_LEAVE_BALANCE`, or, with
 *   `splitExcessAsUnpaid`, the extra (latest) days are saved as a linked
 *   Unpaid leave in the same transaction.
 * - Status: pending → approved / rejected; pending / approved → cancelled.
 *   Only pending leave can be edited (409 `LEAVE_NOT_EDITABLE`). Never deleted.
 *   Pending leave already holds its days, so approving it needs no new check.
 * - Approving, cancelling or editing leave recalculates the attendance it
 *   covers (§3.5).
 */

const NOT_FOUND = 'This leave could not be found.';

type Client = PrismaClient | Prisma.TransactionClient;

export type LeaveDto = {
  id: string;
  employee: EmployeeSummaryDto;
  leaveType: { id: string; name: string };
  startDate: CalendarDate;
  endDate: CalendarDate;
  days: number;
  isHalfDay: boolean;
  reason: string;
  remarks: string | null;
  status: string;
  /** Who added it (the staff user's name). */
  addedBy: string | null;
  isPaid: boolean;
  /** Casual days left after this leave; null for Unpaid, rejected and cancelled leave. */
  balanceAfter: number | null;
  /** On the Casual part of a split leave: its Unpaid part. */
  unpaidPartId: string | null;
};

/** The leave without `balanceAfter` (filled in by `withBalances`). */
function toLeaveDto(row: repo.LeaveRow): LeaveDto {
  return {
    id: String(row.id),
    employee: {
      id: String(row.employee.id),
      name: row.employee.name,
      ecNumber: row.employee.ecNumber,
      department: row.employee.departmentCode,
      position: row.employee.positionCode,
    },
    leaveType: { id: row.leaveType.id, name: row.leaveType.name },
    startDate: dateFromDb(row.startDate),
    endDate: dateFromDb(row.endDate),
    days: Number(row.days),
    isHalfDay: row.isHalfDay,
    reason: row.reason,
    remarks: row.remarks,
    status: row.status,
    addedBy: row.createdBy.name,
    isPaid: row.leaveType.isPaid,
    balanceAfter: null,
    unpaidPartId: row.unpaidPart ? String(row.unpaidPart.id) : null,
  };
}

/** Fills in `balanceAfter` for pending and approved Casual leave. */
async function withBalances(client: Client, rows: repo.LeaveRow[], now: Date): Promise<LeaveDto[]> {
  const dtos = rows.map(toLeaveDto);
  const counted = rows.filter((r) => r.leaveType.hasBalance && (r.status === 'pending' || r.status === 'approved'));
  if (counted.length === 0) return dtos;
  const ledgers = await loadLedgers(client, await dayEmployeesById(client, [...new Set(counted.map((r) => r.employeeId))]));
  for (const [index, row] of rows.entries()) {
    if (!counted.includes(row)) continue;
    dtos[index]!.balanceAfter = await balanceAfter(client, ledgers.get(row.employeeId)!, dtos[index]!, now);
  }
  return dtos;
}

async function oneWithBalance(client: Client, row: repo.LeaveRow, now: Date): Promise<LeaveDto> {
  return (await withBalances(client, [row], now))[0]!;
}

// --- reading ----------------------------------------------------------------

export async function list(query: LeaveListQuery, clock: Clock = systemClock) {
  const { rows, total, counts } = await repo.listLeaves(query);
  return { ...toPage(await withBalances(db(), rows, clock()), total, query.page), counts };
}

export async function get(id: number, clock: Clock = systemClock): Promise<LeaveDto> {
  const row = await repo.findLeave(id);
  if (!row) throw new NotFoundError(NOT_FOUND);
  return oneWithBalance(db(), row, clock());
}

/** `GET /employees/{id}/leaves`: the whole history, newest first. */
export async function employeeHistory(employeeId: number, clock: Clock = systemClock) {
  await requireEmployee(employeeId);
  const rows = await db().leave.findMany({
    where: { employeeId },
    select: repo.leaveSelect,
    orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
  });
  const dtos = await withBalances(db(), rows, clock());
  return dtos.map((leave, index) => ({
    id: leave.id,
    startDate: leave.startDate,
    endDate: leave.endDate,
    leaveType: leave.leaveType.name,
    days: leave.days,
    reason: rows[index]!.reason,
    status: leave.status,
    isPaid: leave.isPaid,
    balanceAfter: leave.balanceAfter,
  }));
}

/** `GET /employees/{id}/leave-balance`: the Casual balance today. */
export async function employeeBalance(employeeId: number, clock: Clock = systemClock): Promise<BalanceDto> {
  const employee = await requireEmployee(employeeId);
  const ledger = (await loadLedgers(db(), [employee])).get(employee.id)!;
  return balanceOf(ledger, companyToday(clock));
}

/**
 * `GET /leave-balances`: every active employee's balance (matching the
 * filters), sorted by name, with totals over all of them.
 */
export async function balances(query: LeaveBalancesQuery, clock: Clock = systemClock) {
  const employees = await db().employee.findMany({
    where: {
      status: 'active',
      ...(query.department ? { departmentCode: query.department } : {}),
      ...(query.search
        ? { OR: [{ name: { contains: query.search } }, { ecNumber: { contains: query.search } }] }
        : {}),
    },
    select: dayEmployeeSelect,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
  const today = companyToday(clock);
  const ledgers = await loadLedgers(db(), employees);
  const items = employees.map((employee) => ({
    employee: toEmployeeSummary(employee),
    balance: balanceOf(ledgers.get(employee.id)!, today),
  }));
  const total = (key: keyof Omit<BalanceDto, 'asOf'>) => items.reduce((sum, item) => sum + item.balance[key], 0);
  return {
    ...toPage(items.slice(query.page.skip, query.page.skip + query.page.take), items.length, query.page),
    summary: {
      employees: items.length,
      accrued: total('accrued'),
      used: total('used'),
      pending: total('pending'),
      remaining: total('remaining'),
      unpaidTaken: total('unpaidTaken'),
    },
  };
}

/** Sum of every active employee's Casual `remaining` on [asOf] (dashboard). */
export async function casualRemainingOfActive(asOf: CalendarDate): Promise<number> {
  const employees = await db().employee.findMany({ where: { status: 'active' }, select: dayEmployeeSelect });
  const ledgers = await loadLedgers(db(), employees);
  return [...ledgers.values()].reduce((sum, ledger) => sum + balanceOf(ledger, asOf).remaining, 0);
}

/**
 * `POST /leaves/preview`: the days the leave would take, how many Casual
 * covers, and the Casual days available for those dates.
 */
export async function preview(input: LeavePreviewBody, clock: Clock = systemClock) {
  const body = oneDayIfHalf(input);
  const now = clock();
  const employee = await requireEmployee(body.employeeId);
  const type = await repo.findLeaveType(db(), body.leaveTypeId);
  if (!type) throw ValidationError.field('leaveTypeId', 'Choose a leave type');
  const dates = await workingDates(db(), employee, body.startDate, body.endDate, body.isHalfDay, now);
  const days = sumOf(dates);
  if (!type.hasBalance) return { days, paidDays: 0, unpaidDays: days, availableCasual: null };
  const ledger = (await loadLedgers(db(), [employee])).get(employee.id)!;
  const covered = await coverage(db(), ledger, dates, now, body.leaveId);
  return { days, paidDays: covered.paidDays, unpaidDays: days - covered.paidDays, availableCasual: covered.available };
}

/**
 * `GET /leave-calendar?month&employeeId`: company holidays and that
 * employee's weekly offs, for the leave date picker.
 */
export async function leaveCalendar(month: Month, employeeId: number | undefined) {
  const { first, last } = monthRange(month);
  const holidays = await db().companyHoliday.findMany({
    where: { deletedAt: null, date: { gte: new Date(`${first}T00:00:00Z`), lte: new Date(`${last}T00:00:00Z`) } },
    select: { id: true, date: true, name: true },
    orderBy: { date: 'asc' },
  });
  let weeklyOffDays: number[] = [];
  let weekOffDates: CalendarDate[] = [];
  if (employeeId !== undefined) {
    const employee = await requireEmployee(employeeId);
    const versions = await db().employeeWorkSchedule.findMany({
      where: {
        employeeId,
        effectiveFrom: { lte: new Date(`${last}T00:00:00Z`) },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date(`${first}T00:00:00Z`) } }],
      },
      select: { effectiveFrom: true, effectiveTo: true, weeklyOffDays: true },
    });
    const versionOn = (date: CalendarDate) =>
      versions.find(
        (v) => dateFromDb(v.effectiveFrom) <= date && (v.effectiveTo === null || dateFromDb(v.effectiveTo) >= date),
      );
    weeklyOffDays = [
      ...weekdaysOf(versionOn(first)?.weeklyOffDays ?? versionOn(dateFromDb(employee.joiningDate))?.weeklyOffDays),
    ];
    weekOffDates = eachDate(first, last).filter((date) =>
      weekdaysOf(versionOn(date)?.weeklyOffDays).includes(isoWeekday(date)),
    );
  }
  return {
    month: monthAsDate(month),
    holidays: holidays.map((h) => ({ date: dateFromDb(h.date), name: h.name, id: String(h.id) })),
    weeklyOffDays,
    weekOffDates,
  };
}

// --- changing ---------------------------------------------------------------

/** One leave to write: the request, or one part of a split. */
type Part = { leaveTypeId: string; startDate: CalendarDate; endDate: CalendarDate; days: number };

/**
 * Decides what to save for [body]: the leave as asked, or, for Casual leave
 * beyond the balance with `splitExcessAsUnpaid`, a Casual part and an Unpaid
 * part (or all of it Unpaid when no Casual day is free).
 */
async function plan(
  tx: Prisma.TransactionClient,
  body: LeaveBody,
  exceptId: number | null,
  now: Date,
): Promise<{ employee: DayEmployee; main: Part; unpaid: Part | null }> {
  const { employee, type } = await validate(tx, body, exceptId);
  const dates = await workingDates(tx, employee, body.startDate, body.endDate, body.isHalfDay, now);
  if (dates.length === 0) throw ValidationError.field('startDate', 'The selected dates are all holidays or weekly offs.');
  const whole: Part = { leaveTypeId: type.id, startDate: body.startDate, endDate: body.endDate, days: sumOf(dates) };
  if (!type.hasBalance) return { employee, main: whole, unpaid: null };

  const ledger: Ledger = (await loadLedgers(tx, [employee])).get(employee.id)!;
  const covered = await coverage(tx, ledger, dates, now, exceptId);
  if (covered.paidCount === dates.length) return { employee, main: whole, unpaid: null };

  const unpaidDays = whole.days - covered.paidDays;
  if (!body.splitExcessAsUnpaid) throw new InsufficientLeaveBalanceError(shortMessage(covered.paidDays, unpaidDays));
  const unpaidType = await repo.findUnpaidType(tx);
  if (!unpaidType) throw ValidationError.field('leaveTypeId', 'Unpaid leave is not available.');
  if (covered.paidCount === 0) return { employee, main: { ...whole, leaveTypeId: unpaidType.id }, unpaid: null };
  return {
    employee,
    main: { ...whole, endDate: dates[covered.paidCount - 1]!.date, days: covered.paidDays },
    unpaid: {
      leaveTypeId: unpaidType.id,
      startDate: dates[covered.paidCount]!.date,
      endDate: body.endDate,
      days: unpaidDays,
    },
  };
}

function shortMessage(paid: number, unpaid: number): string {
  return paid === 0
    ? `No Casual leave is available for these dates. Save ${unpaid === 1 ? 'it' : 'them'} as Unpaid leave?`
    : `Only ${formatDays(paid)} of Casual leave ${paid === 1 ? 'is' : 'are'} available for these dates. ` +
        `Save the other ${formatDays(unpaid)} as Unpaid leave?`;
}

function partData(body: LeaveBody, part: Part) {
  return {
    leaveTypeId: part.leaveTypeId,
    startDate: dateToDb(part.startDate),
    endDate: dateToDb(part.endDate),
    isHalfDay: body.isHalfDay,
    days: part.days,
    reason: body.reason,
    remarks: body.remarks,
    status: body.status,
  };
}

/** Saves the Unpaid part of a split, linked to [casualId], with its audit row. */
async function addUnpaidPart(
  tx: Prisma.TransactionClient,
  body: LeaveBody,
  part: Part,
  casualId: number,
  auth: AuthContext,
  now: Date,
): Promise<void> {
  const created = await tx.leave.create({
    data: {
      ...partData(body, part),
      employeeId: body.employeeId,
      unpaidPartOfId: casualId,
      createdById: auth.userId,
      ...(body.status === 'approved' ? { decidedById: auth.userId, decidedAt: now } : {}),
    },
    select: repo.leaveSelect,
  });
  const dto = toLeaveDto(created);
  await writeAudit(tx, {
    actorUserId: auth.userId,
    action: 'leave.create',
    entityType: 'leave',
    entityId: created.id,
    employeeId: body.employeeId,
    affectedDate: dto.startDate,
    summary: `Added ${dto.leaveType.name} leave (${dto.status}), the days beyond the Casual balance`,
    changes: leaveChanges(null, dto),
    remarks: dto.remarks,
  });
  if (dto.status === 'approved') await recalcCovered(tx, dto, now);
}

/** `POST /leaves`. Adding leave as approved also needs `leave.approve` (approved fix S-5). */
export async function create(input: LeaveBody, auth: AuthContext, clock: Clock = systemClock): Promise<LeaveDto> {
  const body = oneDayIfHalf(input);
  if (body.status === 'approved') requirePermission(auth, 'leave.approve');
  return db().$transaction(async (tx) => {
    const now = clock();
    if (!(await lockEmployee(tx, body.employeeId))) throw ValidationError.field('employeeId', 'Choose an employee');
    const { employee, main, unpaid } = await plan(tx, body, null, now);
    const created = await tx.leave.create({
      data: {
        ...partData(body, main),
        employeeId: body.employeeId,
        createdById: auth.userId,
        ...(body.status === 'approved' ? { decidedById: auth.userId, decidedAt: now } : {}),
      },
      select: repo.leaveSelect,
    });
    const dto = toLeaveDto(created);
    await writeAudit(tx, {
      actorUserId: auth.userId,
      action: 'leave.create',
      entityType: 'leave',
      entityId: created.id,
      employeeId: employee.id,
      affectedDate: dto.startDate,
      summary: `Added ${dto.leaveType.name} leave (${dto.status})`,
      changes: leaveChanges(null, dto),
      remarks: dto.remarks,
    });
    if (dto.status === 'approved') await recalcCovered(tx, dto, now);
    if (unpaid) await addUnpaidPart(tx, body, unpaid, created.id, auth, now);
    return oneWithBalance(tx, (await repo.findLeave(created.id, tx))!, now);
  });
}

/** `PATCH /leaves/{id}`: pending leave only. */
export async function update(id: number, input: LeaveBody, auth: AuthContext, clock: Clock = systemClock): Promise<LeaveDto> {
  const body = oneDayIfHalf(input);
  return db().$transaction(async (tx) => {
    const now = clock();
    const found = await repo.findLeave(id, tx);
    if (!found) throw new NotFoundError(NOT_FOUND);
    // Lock both employees (old and new) in id order, then read the leave again.
    for (const employeeId of [...new Set([found.employeeId, body.employeeId])].sort((a, b) => a - b)) {
      if (!(await lockEmployee(tx, employeeId)) && employeeId === body.employeeId) {
        throw ValidationError.field('employeeId', 'Choose an employee');
      }
    }
    const current = (await repo.findLeave(id, tx))!;
    if (current.status !== 'pending') {
      throw new ConflictError(
        `Only pending leave can be edited. This leave is already ${current.status}.`,
        'LEAVE_NOT_EDITABLE',
      );
    }
    if (body.status === 'approved') requirePermission(auth, 'leave.approve');
    const { employee, main, unpaid } = await plan(tx, body, id, now);
    if (unpaid && current.unpaidPart) {
      throw ValidationError.field('endDate', 'This leave already has an Unpaid part. Change or cancel that leave first.');
    }
    const updated = await tx.leave.update({
      where: { id },
      data: {
        ...partData(body, main),
        employeeId: body.employeeId,
        ...(body.status === 'approved' ? { decidedById: auth.userId, decidedAt: now } : {}),
      },
      select: repo.leaveSelect,
    });
    const before = toLeaveDto(current);
    const after = toLeaveDto(updated);
    const changes = leaveChanges(before, after);
    if (changes.length > 0) {
      await writeAudit(tx, {
        actorUserId: auth.userId,
        action: 'leave.update',
        entityType: 'leave',
        entityId: id,
        employeeId: employee.id,
        affectedDate: after.startDate,
        summary: `Edited ${after.leaveType.name} leave`,
        changes,
        remarks: after.remarks,
      });
    }
    if (after.status === 'approved') await recalcCovered(tx, after, now);
    if (unpaid) await addUnpaidPart(tx, body, unpaid, id, auth, now);
    return oneWithBalance(tx, (await repo.findLeave(id, tx))!, now);
  });
}

const transitions: Record<string, string[]> = {
  pending: ['approved', 'rejected', 'cancelled'],
  approved: ['cancelled'],
  rejected: [],
  cancelled: [],
};

/**
 * `PATCH /leaves/{id}/status`. Approve and reject need `leave.approve`;
 * cancel needs `leave.cancel`. Approving checks the employee and overlaps
 * again; the balance was already reserved while the leave was pending.
 */
export async function setStatus(
  id: number,
  status: 'approved' | 'rejected' | 'cancelled',
  auth: AuthContext,
  clock: Clock = systemClock,
): Promise<LeaveDto> {
  requirePermission(auth, status === 'cancelled' ? 'leave.cancel' : 'leave.approve');
  return db().$transaction(async (tx) => {
    const now = clock();
    const found = await repo.findLeave(id, tx);
    if (!found) throw new NotFoundError(NOT_FOUND);
    await lockEmployee(tx, found.employeeId);
    const current = (await repo.findLeave(id, tx))!;
    if (!transitions[current.status]!.includes(status)) {
      throw new ConflictError(`A ${current.status} leave cannot be ${status}.`, 'INVALID_STATUS_TRANSITION');
    }
    const before = toLeaveDto(current);
    if (status === 'approved') {
      await validate(
        tx,
        {
          employeeId: current.employeeId,
          leaveTypeId: before.leaveType.id,
          startDate: before.startDate,
          endDate: before.endDate,
          isHalfDay: before.isHalfDay,
          reason: current.reason,
          remarks: before.remarks,
          status: 'approved',
          splitExcessAsUnpaid: false,
        },
        id,
      );
    }
    const updated = await tx.leave.update({
      where: { id },
      data: {
        status,
        ...(status === 'cancelled'
          ? { cancelledById: auth.userId, cancelledAt: now }
          : { decidedById: auth.userId, decidedAt: now }),
      },
      select: repo.leaveSelect,
    });
    const after = toLeaveDto(updated);
    await writeAudit(tx, {
      actorUserId: auth.userId,
      action: 'leave.status',
      entityType: 'leave',
      entityId: id,
      employeeId: current.employeeId,
      affectedDate: after.startDate,
      summary: `${status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Cancelled'} ${after.leaveType.name} leave`,
      changes: [{ field: 'status', label: 'Status', before: label(before.status), after: label(after.status) }],
    });
    // Approved leave changes the days it covers; so does cancelling approved leave.
    if (status === 'approved' || before.status === 'approved') await recalcCovered(tx, after, now);
    return oneWithBalance(tx, updated, now);
  });
}

/**
 * Recounts the `days` of pending and approved leave touching [dates] or an
 * employee's leave from [from] (holiday added/moved/removed, schedule change).
 */
export async function recountLeaveDays(
  tx: Prisma.TransactionClient,
  scope: { dates?: CalendarDate[]; employeeId?: number; from?: CalendarDate },
  now: Date,
): Promise<void> {
  const or = (scope.dates ?? []).map((date) => ({
    startDate: { lte: new Date(`${date}T00:00:00Z`) },
    endDate: { gte: new Date(`${date}T00:00:00Z`) },
  }));
  const leaves = await tx.leave.findMany({
    where: {
      status: { in: [...repo.ACTIVE_STATUSES] },
      ...(scope.employeeId !== undefined ? { employeeId: scope.employeeId } : {}),
      ...(scope.from ? { endDate: { gte: new Date(`${scope.from}T00:00:00Z`) } } : {}),
      ...(or.length > 0 ? { OR: or } : {}),
    },
    select: { id: true, employeeId: true, startDate: true, endDate: true, isHalfDay: true, days: true },
  });
  for (const leave of leaves) {
    const employee = (await findDayEmployee(leave.employeeId, tx))!;
    const days = await countDays(tx, employee, dateFromDb(leave.startDate), dateFromDb(leave.endDate), leave.isHalfDay, now);
    if (days !== Number(leave.days)) await tx.leave.update({ where: { id: leave.id }, data: { days } });
  }
}

// --- rules ------------------------------------------------------------------

/** The checks of §3.8 other than the balance: employee, type, dates and overlap. */
async function validate(tx: Prisma.TransactionClient, body: LeaveBody, exceptId: number | null) {
  const employee = await findDayEmployee(body.employeeId, tx);
  if (!employee) throw ValidationError.field('employeeId', 'Choose an employee');
  if (employee.status !== 'active') throw ValidationError.field('employeeId', 'This employee is inactive');
  const type = await repo.findLeaveType(tx, body.leaveTypeId);
  if (!type) throw ValidationError.field('leaveTypeId', 'Choose a leave type');
  if (body.startDate < dateFromDb(employee.joiningDate)) {
    throw ValidationError.field('startDate', "This is before the employee's joining date");
  }
  if (await repo.overlapping(tx, employee.id, body.startDate, body.endDate, exceptId)) {
    throw ValidationError.field('startDate', 'This employee already has leave on some of these dates.');
  }
  return { employee, type };
}

/** Working days of [employee] from [from] to [to]; a half day counts 0.5. */
export async function countDays(
  client: Prisma.TransactionClient,
  employee: DayEmployee,
  from: CalendarDate,
  to: CalendarDate,
  isHalfDay: boolean,
  now: Date,
): Promise<number> {
  const days = await loadDays({ employees: [employee], from, to, now, zone: companyZone(), leaveLookup: noLeave, client });
  const working = days.filter((d) => d.result.dayType === 'working').length;
  return isHalfDay ? (working > 0 ? 0.5 : 0) : working;
}

function sumOf(dates: { value: number }[]): number {
  return dates.reduce((sum, d) => sum + d.value, 0);
}

async function recalcCovered(tx: Prisma.TransactionClient, leave: LeaveDto, now: Date): Promise<void> {
  await recalculateRecords(tx, { employeeId: Number(leave.employee.id), from: leave.startDate, to: leave.endDate }, now);
}

async function requireEmployee(employeeId: number): Promise<DayEmployee> {
  const employee = await findDayEmployee(employeeId);
  if (!employee) throw new NotFoundError('This employee could not be found.');
  return employee;
}

/** A half day is one date: its end date is its start date. */
function oneDayIfHalf<T extends { startDate: CalendarDate; endDate: CalendarDate; isHalfDay: boolean }>(body: T): T {
  return body.isHalfDay ? { ...body, endDate: body.startDate } : body;
}

function formatDays(days: number): string {
  return `${days} day${days === 1 ? '' : 's'}`;
}

function label(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function leaveChanges(before: LeaveDto | null, after: LeaveDto): AuditChange[] {
  const fields: [string, string, (l: LeaveDto) => string | null][] = [
    ['leaveType', 'Leave type', (l) => l.leaveType.name],
    ['startDate', 'From', (l) => l.startDate],
    ['endDate', 'To', (l) => l.endDate],
    ['days', 'Days', (l) => String(l.days)],
    ['isHalfDay', 'Half day', (l) => (l.isHalfDay ? 'Yes' : 'No')],
    ['reason', 'Reason', (l) => l.reason],
    ['status', 'Status', (l) => label(l.status)],
  ];
  return fields.flatMap(([field, name, show]) => {
    const was = before ? show(before) : null;
    const now = show(after);
    return was === now ? [] : [{ field, label: name, before: was, after: now }];
  });
}
