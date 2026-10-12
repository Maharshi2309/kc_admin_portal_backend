import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { pageRequestOf, paginationFields, toPage } from '@/lib/http';
import { dateToDb, formatInstant } from '@/lib/time';
import { calendarDate, id, oneOf, optionalQuery } from '@/lib/validation';
import { AUDIT_ENTITY_TYPES, type AuditChange } from './audit.types';

/** `GET /audit-logs` query (API_CONTRACT.md "Audit"). */
export const auditListQuery = z
  .object({
    employeeId: optionalQuery(id('employee')),
    date: optionalQuery(calendarDate('Date')),
    from: optionalQuery(calendarDate('From')),
    to: optionalQuery(calendarDate('To')),
    entityType: optionalQuery(oneOf(AUDIT_ENTITY_TYPES, `Choose one of: ${AUDIT_ENTITY_TYPES.join(', ')}`)),
    ...paginationFields(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { path: ['to'], message: 'Must be on or after the start date' })
  .transform(({ page, pageSize, ...filters }) => ({ ...filters, page: pageRequestOf({ page, pageSize }) }));

export type AuditListQuery = z.output<typeof auditListQuery>;

/** One change-history entry (`audit-logs.response.json`). */
export type AuditEntryDto = {
  id: string;
  action: string;
  summary: string;
  actor: { id: string; name: string };
  createdAt: string;
  changes: AuditChange[];
  reason: string | null;
  remarks: string | null;
};

const entrySelect = {
  id: true,
  action: true,
  summary: true,
  createdAt: true,
  changes: true,
  reason: true,
  remarks: true,
  actor: { select: { id: true, name: true } },
} satisfies Prisma.AuditLogSelect;

export function toAuditEntryDto(row: Prisma.AuditLogGetPayload<{ select: typeof entrySelect }>): AuditEntryDto {
  return {
    id: String(row.id),
    action: row.action,
    summary: row.summary,
    // The actor's user was deleted by the main admin: the entry stays.
    actor: row.actor ? { id: String(row.actor.id), name: row.actor.name } : { id: '', name: 'Deleted user' },
    createdAt: formatInstant(row.createdAt),
    changes: row.changes as AuditChange[],
    reason: row.reason,
    remarks: row.remarks,
  };
}

/**
 * Newest first. `date`, `from` and `to` filter on the date the change affects
 * (e.g. the attendance date), not when it was made.
 */
export async function list(query: AuditListQuery) {
  const where: Prisma.AuditLogWhereInput = {};
  if (query.employeeId) where.employeeId = query.employeeId;
  if (query.entityType) where.entityType = query.entityType;
  if (query.date) where.affectedDate = dateToDb(query.date);
  else if (query.from || query.to) {
    where.affectedDate = {
      ...(query.from ? { gte: dateToDb(query.from) } : {}),
      ...(query.to ? { lte: dateToDb(query.to) } : {}),
    };
  }
  const [rows, total] = await db().$transaction([
    db().auditLog.findMany({
      where,
      select: entrySelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: query.page.skip,
      take: query.page.take,
    }),
    db().auditLog.count({ where }),
  ]);
  return toPage(rows.map(toAuditEntryDto), total, query.page);
}

/** The history of one employee's date (calendar day sheet). */
export async function forEmployeeDay(employeeId: number, date: string): Promise<AuditEntryDto[]> {
  const rows = await db().auditLog.findMany({
    where: { employeeId, affectedDate: dateToDb(date) },
    select: entrySelect,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return rows.map(toAuditEntryDto);
}
