import type { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { type CalendarDate, addDays, dateFromDb, dateToDb, systemClock } from '@/lib/time';
import type { AuthContext } from '@/modules/auth/auth.types';
import { writeAudit } from '@/modules/audit/audit.writer';
import { recalculateRecords } from '@/modules/day-engine/recalculate';
import { recountLeaveDays } from '@/modules/leaves/leave.service';
import { scheduleChanges, toWorkScheduleDto } from './schedule.mapper';
import * as repo from './schedule.repository';
import type { WorkScheduleDto } from './schedule.types';
import type { ScheduleFields, ScheduleVersionBody } from './schedule.validation';

/**
 * Versioned working schedules (DATABASE_V2.md §2.1):
 * - A change adds a version from its effective date; the version before it
 *   is closed the day before. Past days keep the schedule they were worked
 *   under.
 * - Two versions can't start on the same day (409 `SCHEDULE_OVERLAP`).
 * - A version can't start before the joining date (the app's date picker
 *   starts there; the first version starts on the joining date).
 * - Attendance already recorded from the effective date is recalculated
 *   under the new schedule, in the same transaction (§3.5).
 */

export async function listForEmployee(employeeId: number): Promise<WorkScheduleDto[]> {
  await requireEmployee(employeeId);
  return (await repo.listVersions(employeeId)).map(toWorkScheduleDto);
}

/** `POST /employees/{id}/schedules`. */
export async function addVersion(
  employeeId: number,
  body: ScheduleVersionBody,
  auth: AuthContext,
): Promise<WorkScheduleDto> {
  return db().$transaction(async (tx) => {
    const employee = await lockEmployee(tx, employeeId);
    if (body.effectiveFrom < employee.joiningDate) {
      throw ValidationError.field(
        'effectiveFrom',
        `The schedule can't start before the joining date (${employee.joiningDate}).`,
      );
    }
    const { effectiveFrom, ...fields } = body;
    return insertVersion(tx, { employeeId, effectiveFrom, fields, auth, isFirst: false });
  });
}

/**
 * Adds a version inside an existing transaction (also used for an employee's
 * first schedule). The caller must hold the employee row lock.
 */
export async function insertVersion(
  tx: Prisma.TransactionClient,
  input: {
    employeeId: number;
    effectiveFrom: CalendarDate;
    fields: ScheduleFields;
    auth: AuthContext;
    isFirst: boolean;
  },
): Promise<WorkScheduleDto> {
  const { employeeId, effectiveFrom } = input;
  const versions = await repo.listVersions(employeeId, tx); // newest first
  if (versions.some((v) => dateFromDb(v.effectiveFrom) === effectiveFrom)) {
    throw new ConflictError('A schedule already starts on this date.', 'SCHEDULE_OVERLAP', {
      effectiveFrom: ['A schedule already starts on this date'],
    });
  }

  const previous = versions.find((v) => dateFromDb(v.effectiveFrom) < effectiveFrom);
  const next = [...versions].reverse().find((v) => dateFromDb(v.effectiveFrom) > effectiveFrom);

  if (previous) await repo.setEffectiveTo(tx, previous.id, addDays(effectiveFrom, -1));
  const created = await repo.createVersion(tx, {
    employeeId,
    effectiveFrom,
    effectiveTo: next ? addDays(dateFromDb(next.effectiveFrom), -1) : null,
    fields: input.fields,
    createdById: input.auth.userId,
  });

  const dto = toWorkScheduleDto(created);
  await writeAudit(tx, {
    actorUserId: input.auth.userId,
    action: 'schedule.create',
    entityType: 'schedule',
    entityId: created.id,
    employeeId,
    affectedDate: effectiveFrom,
    summary: input.isFirst ? 'Set working schedule' : `Changed schedule from ${effectiveFrom}`,
    changes: scheduleChanges(previous ? toWorkScheduleDto(previous) : null, dto),
  });
  if (!input.isFirst) {
    await recalculateRecords(tx, { employeeId, from: effectiveFrom }, systemClock());
    await recountLeaveDays(tx, { employeeId, from: effectiveFrom }, systemClock());
  }
  return dto;
}

/**
 * Keeps the first version starting on the joining date when the joining
 * date is edited. Refused if a later schedule change would come first.
 */
export async function moveFirstVersion(
  tx: Prisma.TransactionClient,
  employeeId: number,
  newJoiningDate: CalendarDate,
): Promise<void> {
  const versions = await repo.listVersions(employeeId, tx);
  const first = versions.at(-1);
  if (!first || dateFromDb(first.effectiveFrom) === newJoiningDate) return;
  const second = versions.at(-2);
  if (second && newJoiningDate >= dateFromDb(second.effectiveFrom)) {
    throw ValidationError.field(
      'joiningDate',
      `A schedule change already starts on ${dateFromDb(second.effectiveFrom)}. Choose an earlier joining date.`,
    );
  }
  const earliest = await tx.attendanceRecord.findFirst({
    where: { employeeId, date: { lt: dateToDb(newJoiningDate) } },
    orderBy: { date: 'asc' },
    select: { date: true },
  });
  if (earliest) {
    throw ValidationError.field(
      'joiningDate',
      `Attendance is already recorded on ${dateFromDb(earliest.date)}. Choose that date or an earlier one.`,
    );
  }
  await repo.setEffectiveFrom(tx, first.id, newJoiningDate);
  const old = dateFromDb(first.effectiveFrom);
  await recalculateRecords(tx, { employeeId, from: old < newJoiningDate ? old : newJoiningDate }, systemClock());
}

/** Locks the employee row so schedule changes for one employee run one at a time. */
async function lockEmployee(tx: Prisma.TransactionClient, employeeId: number) {
  const rows = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM employees WHERE id = ${employeeId} FOR UPDATE`;
  if (rows.length === 0) throw new NotFoundError('This employee could not be found.');
  const employee = await tx.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { joiningDate: true } });
  return { joiningDate: dateFromDb(employee.joiningDate) };
}

async function requireEmployee(employeeId: number): Promise<void> {
  const count = await db().employee.count({ where: { id: employeeId } });
  if (count === 0) throw new NotFoundError('This employee could not be found.');
}
