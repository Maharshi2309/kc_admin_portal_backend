import type { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { ConflictError, type FieldErrors, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import { toPage } from '@/lib/http';
import { can, deniedMessage } from '@/lib/permissions';
import { type Clock, companyToday, systemClock } from '@/lib/time';
import { todayStatuses } from '@/modules/attendance/attendance.service';
import type { AuthContext } from '@/modules/auth/auth.types';
import { diffForAudit, writeAudit } from '@/modules/audit/audit.writer';
import { toWorkScheduleDto } from '@/modules/schedules/schedule.mapper';
import * as schedules from '@/modules/schedules/schedule.repository';
import { insertVersion, moveFirstVersion } from '@/modules/schedules/schedule.service';
import { employeeAuditFields, toAuditView, toEmployeeDto } from './employee.mapper';
import * as repo from './employee.repository';
import type { EmployeeDto, EmployeeListDto, EmployeeStatus } from './employee.types';
import type { CreateEmployeeBody, EmployeeListQuery, UpdateEmployeeBody } from './employee.validation';

/**
 * Employees (API_CONTRACT.md "Employees"). Never deleted, only deactivated.
 * EC numbers are unique; department and position are codes from their lists;
 * every employee has a working schedule from their joining date. Employees
 * have no email (removed 2026-10-05).
 */

const NOT_FOUND = 'This employee could not be found.';

/**
 * Suggested EC number when no employee exists yet. PROPOSED DEFAULT (client
 * question T-05); the admin can change it in the form.
 */
const FIRST_EC_NUMBER = 1001n;

export async function list(query: EmployeeListQuery, auth: AuthContext, clock: Clock = systemClock): Promise<EmployeeListDto> {
  const { page, ...filters } = query;
  const { rows, total, counts } = await repo.listEmployees(filters, page);
  const ids = rows.map((r) => r.id);
  const [current, today, overtime] = await Promise.all([
    schedules.currentVersions(ids, companyToday(clock)),
    todayStatuses(ids, clock),
    overtimeThisYear(ids, auth, clock),
  ]);
  const items = rows.map((row) => {
    const schedule = current.get(row.id);
    const dto = withToday(toEmployeeDto(row, schedule ? toWorkScheduleDto(schedule) : null), today.get(row.id));
    return { ...dto, overtimeMinutesThisYear: overtime ? (overtime.get(row.id) ?? 0) : null };
  });
  return { ...toPage(items, total, page), counts };
}

export async function get(id: number, auth: AuthContext, clock: Clock = systemClock): Promise<EmployeeDto> {
  const row = await repo.findEmployee(id);
  if (!row) throw new NotFoundError(NOT_FOUND);
  const dto = await withSchedule(row, db(), clock);
  const [today, overtime] = await Promise.all([todayStatuses([id], clock), overtimeThisYear([id], auth, clock)]);
  return { ...withToday(dto, today.get(id)), overtimeMinutesThisYear: overtime ? (overtime.get(id) ?? 0) : null };
}

function withToday(dto: EmployeeDto, status: EmployeeDto['todayStatus']): EmployeeDto {
  return status ? { ...dto, todayStatus: status } : dto;
}

/**
 * Overtime from 1 January of the current year (company time) to today, per
 * employee; null without `overtime.view` (API_CONTRACT.md "Employees").
 */
async function overtimeThisYear(ids: number[], auth: AuthContext, clock: Clock): Promise<Map<number, number> | null> {
  if (!can(auth, 'overtime.view')) return null;
  const today = companyToday(clock);
  return repo.overtimeBetween(ids, `${today.slice(0, 4)}-01-01`, today);
}

/** `GET /employees/next-ec-number`: highest number + 1. Only a suggestion; saving checks uniqueness. */
export async function nextEcNumber(): Promise<{ ecNumber: string }> {
  const highest = await repo.highestEcNumber();
  return { ecNumber: `KC${highest === 0n ? FIRST_EC_NUMBER : highest + 1n}` };
}

export async function create(body: CreateEmployeeBody, auth: AuthContext, clock: Clock = systemClock): Promise<EmployeeDto> {
  const { schedule, ...data } = body;
  return db().$transaction(async (tx) => {
    await checkReferencesAndUniqueness(tx, data, null);
    const row = await repo.createEmployee(tx, data, auth.userId);
    const { effectiveFrom: _ignored, ...fields } = schedule!;
    await insertVersion(tx, { employeeId: row.id, effectiveFrom: data.joiningDate, fields, auth, isFirst: true });

    const dto = await withSchedule(row, tx, clock);
    await writeAudit(tx, {
      actorUserId: auth.userId,
      action: 'employee.create',
      entityType: 'employee',
      entityId: row.id,
      employeeId: row.id,
      affectedDate: dto.joiningDate,
      summary: 'Added employee',
      changes: diffForAudit(null, toAuditView(dto), employeeAuditFields),
    });
    return dto;
  });
}

/**
 * `PATCH /employees/{id}`. Changing `status` here also needs
 * `employee.deactivate` (architecture I-01): otherwise anyone who can edit
 * could deactivate employees. Sending the unchanged status is fine.
 */
export async function update(
  id: number,
  body: UpdateEmployeeBody,
  auth: AuthContext,
  clock: Clock = systemClock,
): Promise<EmployeeDto> {
  return db().$transaction(async (tx) => {
    if (!(await repo.lockEmployee(tx, id))) throw new NotFoundError(NOT_FOUND);
    const current = (await repo.findEmployee(id, tx))!;
    if (body.status !== current.status && !can(auth, 'employee.deactivate')) {
      throw new ForbiddenError(deniedMessage('employee.deactivate'));
    }
    await checkReferencesAndUniqueness(tx, body, id);

    const before = await withSchedule(current, tx, clock);
    if (!changesAnything(body, before)) return before;

    if (body.joiningDate !== before.joiningDate) await moveFirstVersion(tx, id, body.joiningDate);
    const row = await repo.updateEmployee(tx, id, body, auth.userId);
    const after = await withSchedule(row, tx, clock);
    await writeAudit(tx, {
      actorUserId: auth.userId,
      action: 'employee.update',
      entityType: 'employee',
      entityId: id,
      employeeId: id,
      summary: 'Edited employee',
      changes: diffForAudit(toAuditView(before), toAuditView(after), employeeAuditFields),
    });
    return after;
  });
}

/** `PATCH /employees/{id}/status`. Setting the current status again changes nothing. */
export async function setStatus(
  id: number,
  status: EmployeeStatus,
  auth: AuthContext,
  clock: Clock = systemClock,
): Promise<EmployeeDto> {
  return db().$transaction(async (tx) => {
    if (!(await repo.lockEmployee(tx, id))) throw new NotFoundError(NOT_FOUND);
    const current = (await repo.findEmployee(id, tx))!;
    if (current.status === status) return withSchedule(current, tx, clock);

    const row = await repo.updateEmployee(tx, id, { status }, auth.userId);
    await writeAudit(tx, {
      actorUserId: auth.userId,
      action: 'employee.status',
      entityType: 'employee',
      entityId: id,
      employeeId: id,
      summary: status === 'inactive' ? 'Deactivated employee' : 'Reactivated employee',
      changes: [
        {
          field: 'status',
          label: 'Status',
          before: current.status === 'active' ? 'Active' : 'Inactive',
          after: status === 'active' ? 'Active' : 'Inactive',
        },
      ],
    });
    return withSchedule(row, tx, clock);
  });
}

async function withSchedule(
  row: repo.EmployeeRow,
  client: Prisma.TransactionClient,
  clock: Clock,
): Promise<EmployeeDto> {
  const schedule = (await schedules.currentVersions([row.id], companyToday(clock), client)).get(row.id);
  return toEmployeeDto(row, schedule ? toWorkScheduleDto(schedule) : null);
}

/**
 * Department and position must be codes from their lists; the EC number must
 * be free. List problems are reported together, under their fields.
 */
async function checkReferencesAndUniqueness(
  tx: Prisma.TransactionClient,
  data: UpdateEmployeeBody,
  exceptId: number | null,
): Promise<void> {
  const errors: FieldErrors = {};
  if (!(await repo.departmentExists(data.department, tx))) errors.department = ['Choose a department'];
  if (!(await repo.positionExists(data.position, tx))) errors.position = ['Choose a position'];
  if (Object.keys(errors).length > 0) {
    throw new ValidationError(Object.values(errors)[0]![0]!, errors);
  }
  if (await repo.ecNumberTaken(data.ecNumber, exceptId, tx)) {
    throw ConflictError.duplicate('ecNumber', 'This EC number is already in use');
  }
}

/** False when [body] repeats what is already saved (nothing to write or audit). */
function changesAnything(body: UpdateEmployeeBody, current: EmployeeDto): boolean {
  return (
    body.ecNumber !== current.ecNumber ||
    body.name !== current.name ||
    body.mobile !== current.mobile ||
    body.department !== current.department ||
    body.position !== current.position ||
    body.joiningDate !== current.joiningDate ||
    body.status !== current.status
  );
}
