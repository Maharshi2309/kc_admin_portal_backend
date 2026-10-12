import type { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { type Clock, dateFromDb, systemClock } from '@/lib/time';
import type { AuthContext } from '@/modules/auth/auth.types';
import { type AuditField, diffForAudit, writeAudit } from '@/modules/audit/audit.writer';
import { recalculateRecords } from '@/modules/day-engine/recalculate';
import { recountLeaveDays } from '@/modules/leaves/leave.service';
import * as repo from './holiday.repository';
import type { HolidayDto } from './holiday.types';
import type { HolidayBody, HolidayListQuery } from './holiday.validation';

/**
 * Company holidays (API_CONTRACT.md "Company holidays", DATABASE_V2.md §2.2).
 * One per date; they apply to every employee. Deleting is a soft delete.
 *
 * Adding, moving or deleting a holiday recalculates, in the same transaction,
 * the attendance recorded on the affected dates and the days of leave
 * covering them (§3.5): a holiday inside approved leave gives the day back.
 */

const NOT_FOUND = 'This holiday was not found.';

const auditFields: readonly AuditField<HolidayDto>[] = [
  { field: 'date', label: 'Date' },
  { field: 'name', label: 'Name' },
  { field: 'description', label: 'Description' },
];

export function toHolidayDto(row: repo.HolidayRow): HolidayDto {
  return { id: String(row.id), date: dateFromDb(row.date), name: row.name, description: row.description };
}

export async function list(query: HolidayListQuery): Promise<HolidayDto[]> {
  return (await repo.listHolidays(query)).map(toHolidayDto);
}

export async function get(id: number): Promise<HolidayDto> {
  const row = await repo.findHoliday(id);
  if (!row) throw new NotFoundError(NOT_FOUND);
  return toHolidayDto(row);
}

export async function create(body: HolidayBody, auth: AuthContext, clock: Clock = systemClock): Promise<HolidayDto> {
  return db().$transaction(async (tx) => {
    await ensureDateFree(tx, body.date, null);
    const dto = toHolidayDto(await repo.createHoliday(tx, body, auth.userId));
    await writeAudit(tx, {
      actorUserId: auth.userId,
      action: 'holiday.create',
      entityType: 'holiday',
      entityId: dto.id,
      affectedDate: dto.date,
      summary: `Added holiday ${dto.name}`,
      changes: diffForAudit(null, dto, auditFields),
    });
    await recalculateRecords(tx, { dates: [dto.date] }, clock());
    await recountLeaveDays(tx, { dates: [dto.date] }, clock());
    return dto;
  });
}

export async function update(
  id: number,
  body: HolidayBody,
  auth: AuthContext,
  clock: Clock = systemClock,
): Promise<HolidayDto> {
  return db().$transaction(async (tx) => {
    const current = await repo.findHoliday(id, tx);
    if (!current) throw new NotFoundError(NOT_FOUND);
    const before = toHolidayDto(current);
    await ensureDateFree(tx, body.date, id);

    const after = toHolidayDto(await repo.updateHoliday(tx, id, body, auth.userId));
    const changes = diffForAudit(before, after, auditFields);
    if (changes.length > 0) {
      await writeAudit(tx, {
        actorUserId: auth.userId,
        action: 'holiday.update',
        entityType: 'holiday',
        entityId: id,
        affectedDate: after.date,
        summary: `Edited holiday ${after.name}`,
        changes,
      });
    }
    if (after.date !== before.date) {
      await recalculateRecords(tx, { dates: [before.date, after.date] }, clock());
      await recountLeaveDays(tx, { dates: [before.date, after.date] }, clock());
    }
    return after;
  });
}

export async function remove(id: number, auth: AuthContext, clock: Clock = systemClock): Promise<void> {
  await db().$transaction(async (tx) => {
    const current = await repo.findHoliday(id, tx);
    if (!current) throw new NotFoundError(NOT_FOUND);
    const before = toHolidayDto(current);
    await repo.softDeleteHoliday(tx, id, auth.userId, clock());
    await writeAudit(tx, {
      actorUserId: auth.userId,
      action: 'holiday.delete',
      entityType: 'holiday',
      entityId: id,
      affectedDate: before.date,
      summary: `Deleted holiday ${before.name}`,
      changes: [
        { field: 'date', label: 'Date', before: before.date, after: null },
        { field: 'name', label: 'Name', before: before.name, after: null },
      ],
    });
    await recalculateRecords(tx, { dates: [before.date] }, clock());
    await recountLeaveDays(tx, { dates: [before.date] }, clock());
  });
}

/** One holiday per date: the app shows "<name> is already on this date" under the date. */
async function ensureDateFree(tx: Prisma.TransactionClient, date: string, exceptId: number | null): Promise<void> {
  const clash = await repo.holidayOn(date, exceptId, tx);
  if (clash) {
    const message = `${clash.name} is already on this date`;
    throw new ConflictError(message, 'DUPLICATE', { date: [message] });
  }
}
