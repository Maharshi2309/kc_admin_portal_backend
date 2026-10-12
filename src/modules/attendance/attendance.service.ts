import type { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { ConflictError, type FieldErrors, NotFoundError, ValidationError } from '@/lib/errors';
import { pageOf } from '@/lib/http';
import {
  type CalendarDate,
  type Clock,
  companyDateOf,
  companyTimeOf,
  companyToday,
  companyZone,
  dateFromDb,
  monthRange,
  systemClock,
  type Month,
} from '@/lib/time';
import type { AuthContext } from '@/modules/auth/auth.types';
import type { AuditChange } from '@/modules/audit/audit.types';
import { writeAudit } from '@/modules/audit/audit.writer';
import { computeDay, type DayStatus } from '@/modules/day-engine/compute-day';
import { type DayEmployee, type LoadedDay, dayEmployeeSelect, loadDays, snapshotOf } from '@/modules/day-engine/day-context';
import { toRecordDto } from './attendance.mapper';
import * as repo from './attendance.repository';
import type { AttendanceDayDto, AttendanceRecordDto } from './attendance.types';
import type { AddRecordBody, AttendanceDayQuery, AttendanceFilter, CorrectionBody } from './attendance.validation';

/**
 * Attendance (API_CONTRACT.md "Attendance"). Statuses and minutes always come
 * from `computeDay`; this module records punches and corrections and lists days.
 *
 * Punches use the server's clock; the app never sends a time for them.
 * Punches aren't audited individually (DATABASE_V2.md §5, T-21): the row keeps
 * who punched. Corrections and added days are audited.
 */

const EMPLOYEE_NOT_FOUND = 'This employee could not be found.';
const RECORD_NOT_FOUND = 'This attendance record was not found.';

/** List order: who needs attention first (the app's design), then by name. */
const listOrder: DayStatus[] = ['absent', 'late', 'present', 'half_day', 'on_leave', 'holiday', 'weekly_off'];

function matches(filter: AttendanceFilter | undefined, status: DayStatus): boolean {
  switch (filter) {
    case undefined:
      return true;
    case 'present': // half days count as present, as in the app's tiles
      return status === 'present' || status === 'half_day';
    default:
      return status === filter;
  }
}

/** `GET /attendance`: one date, every active employee who had joined. */
export async function day(query: AttendanceDayQuery, clock: Clock = systemClock): Promise<AttendanceDayDto> {
  const now = clock();
  if (query.date > companyToday(() => now)) {
    throw ValidationError.field('date', 'Attendance is not available for future dates.');
  }
  const employees = await repo.employeesOnDate(query.date);
  const all = await loadDays({ employees, from: query.date, to: query.date, now, zone: companyZone() });

  const count = (test: (status: DayStatus) => boolean) => all.filter((d) => test(d.result.status)).length;
  const search = query.search?.toLowerCase();
  const rows = all
    .filter((d) => matches(query.status, d.result.status))
    .filter(
      (d) =>
        !search ||
        d.employee.name.toLowerCase().includes(search) ||
        d.employee.ecNumber.toLowerCase().includes(search),
    )
    .filter((d) => !query.department || d.employee.departmentCode === query.department)
    .sort(
      (a, b) =>
        listOrder.indexOf(a.result.status) - listOrder.indexOf(b.result.status) ||
        a.employee.name.localeCompare(b.employee.name),
    );

  return {
    // Tiles cover everyone on the date, whatever the search and filters.
    summary: {
      date: query.date,
      totalEmployees: all.length,
      present: count((s) => s === 'present' || s === 'half_day'),
      late: count((s) => s === 'late'),
      onLeave: count((s) => s === 'on_leave'),
      absent: count((s) => s === 'absent'),
      notPunchedIn: count((s) => s === 'absent'),
    },
    ...pageOf(rows.map(toRecordDto), query.page),
  };
}

/** `GET /attendance/{id}` */
export async function getRecord(id: number, clock: Clock = systemClock): Promise<AttendanceRecordDto> {
  const record = await repo.findRecord(id);
  if (!record) throw new NotFoundError(RECORD_NOT_FOUND);
  const employee = (await repo.findDayEmployee(record.employeeId))!;
  return toRecordDto(await loadOne(db(), employee, dateFromDb(record.date), clock()));
}

/** `GET /employees/{id}/attendance-log?month`: every day of the month up to today, newest first. */
export async function employeeLog(employeeId: number, month: Month, clock: Clock = systemClock) {
  const employee = await repo.findDayEmployee(employeeId);
  if (!employee) throw new NotFoundError(EMPLOYEE_NOT_FOUND);
  const now = clock();
  const { first, last } = monthRange(month);
  const today = companyToday(() => now);
  const days = await loadDays({
    employees: [employee],
    from: first,
    to: last < today ? last : today,
    now,
    zone: companyZone(),
  });
  return days.map(toRecordDto).reverse();
}

/** Today's status of each employee (for the employee list). Absent for those not joined yet. */
export async function todayStatuses(employeeIds: number[], clock: Clock = systemClock): Promise<Map<number, DayStatus>> {
  const now = clock();
  const today = companyToday(() => now);
  const employees = await db().employee.findMany({
    where: { id: { in: employeeIds } },
    select: dayEmployeeSelect,
  });
  const days = await loadDays({ employees, from: today, to: today, now, zone: companyZone() });
  return new Map(days.map((d) => [d.employee.id, d.result.status]));
}

/** `POST /attendance/punch-in`: today, at the server's current time. */
export async function punchIn(employeeId: number, auth: AuthContext, clock: Clock = systemClock) {
  return db().$transaction(async (tx) => {
    const now = clock();
    const { employee, today } = await punchableEmployee(tx, employeeId, now);
    const current = await loadOne(tx, employee, today, now);
    if (current.record?.punchIn) throw stateError('Already punched in today.');
    if (current.result.status === 'on_leave') throw stateError('This employee is on leave today.');
    await saveDay(tx, current, { punchIn: now, punchOut: null }, { punchedInById: auth.userId }, now);
    return toRecordDto(await loadOne(tx, employee, today, now));
  });
}

/** `POST /attendance/punch-out` */
export async function punchOut(employeeId: number, auth: AuthContext, clock: Clock = systemClock) {
  return db().$transaction(async (tx) => {
    const now = clock();
    const { employee, today } = await punchableEmployee(tx, employeeId, now);
    const current = await loadOne(tx, employee, today, now);
    if (!current.record?.punchIn) throw stateError('Punch in first.');
    if (current.record.punchOut) throw stateError('Already punched out today.');
    await saveDay(tx, current, { punchIn: current.record.punchIn, punchOut: now }, { punchedOutById: auth.userId }, now);
    return toRecordDto(await loadOne(tx, employee, today, now));
  });
}

/**
 * `POST /attendance/punch-in/bulk`: punches in, now, everyone who is due today
 * and hasn't punched in (the app's "Punch in all"; who exactly is covered is
 * client question T-08). Only for today, because the punch time is now.
 */
export async function punchInAll(date: CalendarDate, auth: AuthContext, clock: Clock = systemClock) {
  return db().$transaction(async (tx) => {
    const now = clock();
    const today = companyToday(() => now);
    if (date !== today) throw ValidationError.field('date', 'You can only punch in everyone for today.');
    const employees = await repo.employeesOnDate(today, tx);
    const days = await loadDays({ employees, from: today, to: today, now, zone: companyZone(), client: tx });
    const pending = days.filter((d) => d.result.status === 'absent' && !d.record?.punchIn);
    for (const day of pending) {
      await saveDay(tx, day, { punchIn: now, punchOut: null }, { punchedInById: auth.userId }, now);
    }
    return { count: pending.length };
  });
}

/** `PATCH /attendance/{id}`: corrects the punches of an existing record. */
export async function correct(id: number, body: CorrectionBody, auth: AuthContext, clock: Clock = systemClock) {
  return db().$transaction(async (tx) => {
    const now = clock();
    const existing = await repo.findRecord(id, tx);
    if (!existing) throw new NotFoundError(RECORD_NOT_FOUND);
    await repo.lockEmployee(tx, existing.employeeId);
    const date = dateFromDb(existing.date);
    if (body.date !== date) throw ValidationError.field('date', `This record is for ${date}.`);
    checkTimes(body, now);

    const employee = (await repo.findDayEmployee(existing.employeeId, tx))!;
    const current = await loadOne(tx, employee, date, now);
    await saveDay(tx, current, body, correctionFields(body, auth, now), now);
    await writeAudit(tx, {
      actorUserId: auth.userId,
      action: 'attendance.correct',
      entityType: 'attendance',
      entityId: id,
      employeeId: employee.id,
      affectedDate: date,
      ...describeChange(existing, body),
      reason: body.reason,
      remarks: body.remarks,
    });
    return toRecordDto(await loadOne(tx, employee, date, now));
  });
}

/** `POST /attendance`: adds a day that has no record (e.g. forgot to punch, holiday work). */
export async function addRecord(body: AddRecordBody, auth: AuthContext, clock: Clock = systemClock) {
  return db().$transaction(async (tx) => {
    const now = clock();
    if (!(await repo.lockEmployee(tx, body.employeeId))) {
      throw ValidationError.field('employeeId', 'Choose an employee');
    }
    const employee = (await repo.findDayEmployee(body.employeeId, tx))!;
    if (employee.status !== 'active') throw ValidationError.field('employeeId', 'This employee is inactive');
    const errors: FieldErrors = {};
    if (body.date > companyToday(() => now)) errors.date = ["Can't add attendance for a future date"];
    else if (body.date < dateFromDb(employee.joiningDate)) errors.date = ["This is before the employee's joining date"];
    if (Object.keys(errors).length > 0) throw new ValidationError(errors.date![0]!, errors);
    checkTimes(body, now);

    const current = await loadOne(tx, employee, body.date, now);
    if (current.record?.punchIn) throw stateError('A record already exists for this day. Correct it instead.');
    const saved = await saveDay(tx, current, body, correctionFields(body, auth, now), now);
    await writeAudit(tx, {
      actorUserId: auth.userId,
      action: 'attendance.create',
      entityType: 'attendance',
      entityId: saved.id,
      employeeId: employee.id,
      affectedDate: body.date,
      ...describeChange(null, body),
      reason: body.reason,
      remarks: body.remarks,
    });
    return toRecordDto(await loadOne(tx, employee, body.date, now));
  });
}

// --- helpers ------------------------------------------------------------------

async function loadOne(client: Prisma.TransactionClient, employee: DayEmployee, date: CalendarDate, now: Date): Promise<LoadedDay> {
  const [loaded] = await loadDays({ employees: [employee], from: date, to: date, now, zone: companyZone(), client });
  if (!loaded) throw ValidationError.field('date', "This is before the employee's joining date");
  return loaded;
}

/** Computes the day with [punches] and writes the row with its snapshots. */
async function saveDay(
  tx: Prisma.TransactionClient,
  day: LoadedDay,
  punches: { punchIn: Date; punchOut: Date | null },
  extra: Partial<repo.RecordWrite>,
  now: Date,
) {
  const result = computeDay({
    date: day.date,
    now,
    schedule: day.schedule,
    isHoliday: day.holidayName !== null,
    leave: day.leave,
    punchIn: punches.punchIn,
    punchOut: punches.punchOut,
    zone: companyZone(),
  });
  return repo.upsertRecord(tx, day.employee.id, day.date, {
    ...snapshotOf(result, day.schedule, punches.punchOut),
    punchIn: punches.punchIn,
    punchOut: punches.punchOut,
    ...extra,
  });
}

async function punchableEmployee(tx: Prisma.TransactionClient, employeeId: number, now: Date) {
  if (!(await repo.lockEmployee(tx, employeeId))) throw new NotFoundError(EMPLOYEE_NOT_FOUND);
  const employee = (await repo.findDayEmployee(employeeId, tx))!;
  // Inactive employees are left out of attendance (API_CONTRACT.md §3.11).
  if (employee.status !== 'active') throw stateError('This employee is inactive.');
  const today = companyToday(() => now);
  if (dateFromDb(employee.joiningDate) > today) throw stateError("This employee hasn't joined yet.");
  return { employee, today };
}

function correctionFields(body: { reason: string; remarks: string | null }, auth: AuthContext, now: Date) {
  return {
    correctedById: auth.userId,
    correctedAt: now,
    reason: body.reason as repo.RecordWrite['reason'],
    remarks: body.remarks,
  };
}

/** Punch times must be on the record's date (company time), in order, and not in the future. */
function checkTimes(body: { date: CalendarDate; punchIn: Date; punchOut: Date | null }, now: Date): void {
  const zone = companyZone();
  const errors: FieldErrors = {};
  if (companyDateOf(body.punchIn, zone) !== body.date) errors.punchIn = [`Must be on ${body.date}`];
  else if (body.punchIn > now) errors.punchIn = ["Can't be in the future"];
  if (body.punchOut) {
    if (companyDateOf(body.punchOut, zone) !== body.date) errors.punchOut = [`Must be on ${body.date}`];
    else if (body.punchOut <= body.punchIn) errors.punchOut = ['Must be after punch in'];
    else if (body.punchOut > now) errors.punchOut = ["Can't be in the future"];
  }
  const first = Object.values(errors)[0]?.[0];
  if (first) throw new ValidationError(first, errors);
}

/** Audit summary and changed punches, as the change history shows them ("09:40"). */
function describeChange(
  before: { punchIn: Date | null; punchOut: Date | null } | null,
  after: { punchIn: Date; punchOut: Date | null },
): { summary: string; changes: AuditChange[] } {
  const zone = companyZone();
  const time = (value: Date | null | undefined) => (value ? companyTimeOf(value, zone) : null);
  const changes: AuditChange[] = [];
  const add = (field: 'punchIn' | 'punchOut', label: string) => {
    const was = time(before?.[field]);
    const now = time(after[field]);
    if (was !== now) changes.push({ field, label, before: was, after: now });
  };
  add('punchIn', 'Punch in');
  add('punchOut', 'Punch out');

  const fields = changes.map((c) => c.field);
  const summary = !before
    ? 'Added attendance'
    : fields.length === 2
      ? 'Corrected punch in and punch out'
      : fields[0] === 'punchIn'
        ? 'Corrected punch in'
        : fields[0] === 'punchOut'
          ? 'Corrected punch out'
          : 'Updated attendance remarks';
  return { summary, changes };
}

function stateError(message: string): ConflictError {
  return new ConflictError(message, 'ATTENDANCE_STATE');
}
