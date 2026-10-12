import type { Prisma } from '@/generated/prisma/client';
import { dateToDb } from '@/lib/time';
import type { AuditChange, AuditEntry } from './audit.types';

/**
 * Writes one audit row. Services call it with their transaction client, so
 * the audit row and the change it records are saved together or not at all
 * (DATABASE_V2.md §5).
 *
 *   await db().$transaction(async (tx) => {
 *     const updated = await tx.employee.update(...);
 *     await writeAudit(tx, { action: 'employee.update', ... });
 *   });
 */
export async function writeAudit(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorUserId: entry.actorUserId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: String(entry.entityId),
      employeeId: entry.employeeId ?? null,
      affectedDate: entry.affectedDate ? dateToDb(entry.affectedDate) : null,
      summary: entry.summary,
      changes: entry.changes ?? [],
      reason: entry.reason ?? null,
      remarks: entry.remarks ?? null,
    },
  });
}

/** How to show one field of a record in the change history. */
export type AuditField<T> = {
  field: keyof T & string;
  label: string;
  /** Display text for a value; defaults to `String(value)`. */
  format?: (value: T[keyof T]) => string | null;
};

/**
 * The fields that differ between [before] and [after], formatted for
 * display. With no [before] (a new record), every field with a value is
 * listed with `before: null`.
 */
export function diffForAudit<T extends Record<string, unknown>>(
  before: T | null,
  after: T,
  fields: readonly AuditField<T>[],
): AuditChange[] {
  const show = (spec: AuditField<T>, value: T[keyof T] | undefined): string | null => {
    if (value === null || value === undefined) return null;
    return spec.format ? spec.format(value) : String(value);
  };

  const changes: AuditChange[] = [];
  for (const spec of fields) {
    const was = show(spec, before?.[spec.field]);
    const now = show(spec, after[spec.field]);
    if (was !== now) changes.push({ field: spec.field, label: spec.label, before: was, after: now });
  }
  return changes;
}
