import type { CalendarDate } from '@/lib/time';

/** Audited actions (DATABASE_V2.md §5). Punches are not audited (T-21). */
export const AUDIT_ACTIONS = [
  'attendance.create',
  'attendance.correct',
  'leave.create',
  'leave.update',
  'leave.status',
  'schedule.create',
  'holiday.create',
  'holiday.update',
  'holiday.delete',
  'employee.create',
  'employee.update',
  'employee.status',
  'user.create',
  'user.update',
  'user.permissions.update',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Entity types, used as the `entityType` filter of `GET /audit-logs`. */
export const AUDIT_ENTITY_TYPES = [
  'attendance',
  'leave',
  'schedule',
  'holiday',
  'employee',
  'user',
] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

/** One changed field, values already formatted for display ("09:40", "Casual"). */
export type AuditChange = {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
};

export type AuditEntry = {
  actorUserId: number;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string | number;
  employeeId?: number | null;
  affectedDate?: CalendarDate | null;
  summary: string;
  changes?: AuditChange[];
  reason?: string | null;
  remarks?: string | null;
};
