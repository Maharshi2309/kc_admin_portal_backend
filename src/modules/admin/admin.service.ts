import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/errors';
import { type Clock, dateFromDb, systemClock } from '@/lib/time';
import type { AuthContext } from '@/modules/auth/auth.types';
import { recalculateRecords } from '@/modules/day-engine/recalculate';
import { recountLeaveDays } from '@/modules/leaves/leave.service';
import type { ClearDataBody } from './admin.validation';

/**
 * Hard deletes for the main admin only (`/api/admin/...`, used from Swagger,
 * not from the app). The app itself never deletes: it deactivates employees
 * and soft-deletes holidays. These remove rows for good.
 *
 * What a delete takes with it:
 * - Employee: everything that belongs to them (attendance, leave, leave
 *   adjustments, schedules); a staff user linked to them is unlinked. Their
 *   change history stays, without the employee link.
 * - User: their sessions and permissions. Records they created or changed
 *   are credited to the main admin who deletes them; their change history
 *   stays, shown as "Deleted user". The main admin can't be deleted.
 * - Leave: also its Unpaid part (or, for an Unpaid part, only that part).
 * - Department / position: refused (409) while employees use it.
 */

type Tx = Prisma.TransactionClient;
type Client = PrismaClient | Tx;

/** What a delete removed, by table. */
export type DeleteResult = { deleted: Record<string, number> };

const TX_OPTIONS = { timeout: 60_000, maxWait: 10_000 };

// --- The main admin -----------------------------------------------------------

/**
 * The main admin: the bootstrap admin (BOOTSTRAP_ADMIN_EMAIL), or, when that
 * isn't set or doesn't exist, the first user ever created (which is the
 * bootstrap admin on a normal install). Null only with no users at all.
 */
export async function mainAdminId(client: Client = db()): Promise<number | null> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  if (email) {
    const user = await client.user.findUnique({ where: { email }, select: { id: true } });
    if (user) return user.id;
  }
  const first = await client.user.findFirst({ orderBy: { id: 'asc' }, select: { id: true } });
  return first?.id ?? null;
}

/** 403 `PERMISSION_DENIED` unless the caller is the main admin. */
export async function requireMainAdmin(auth: AuthContext): Promise<void> {
  if ((await mainAdminId()) !== auth.userId) {
    throw new ForbiddenError('Only the main admin can delete records or clear data.');
  }
}

// --- One record ---------------------------------------------------------------

export async function deleteEmployee(id: number): Promise<DeleteResult> {
  return db().$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({ where: { id }, select: { id: true } });
    if (!employee) throw new NotFoundError('This employee was not found.');

    const where = { employeeId: id };
    const attendance = await tx.attendanceRecord.deleteMany({ where });
    // The Unpaid part of a split leave points at its Casual part: delete it first.
    const unpaidParts = await tx.leave.deleteMany({ where: { ...where, unpaidPartOfId: { not: null } } });
    const leaves = await tx.leave.deleteMany({ where });
    const adjustments = await tx.leaveBalanceAdjustment.deleteMany({ where });
    const schedules = await tx.employeeWorkSchedule.deleteMany({ where });
    const unlinked = await tx.user.updateMany({ where, data: { employeeId: null } });
    await tx.employee.delete({ where: { id } });

    return {
      deleted: {
        employees: 1,
        attendanceRecords: attendance.count,
        leaves: unpaidParts.count + leaves.count,
        leaveBalanceAdjustments: adjustments.count,
        workSchedules: schedules.count,
        usersUnlinked: unlinked.count,
      },
    };
  }, TX_OPTIONS);
}

export async function deleteAttendance(id: number): Promise<DeleteResult> {
  return db().$transaction(async (tx) => {
    const record = await tx.attendanceRecord.findUnique({ where: { id }, select: { id: true } });
    if (!record) throw new NotFoundError('This attendance record was not found.');
    await tx.attendanceRecord.delete({ where: { id } });
    return { deleted: { attendanceRecords: 1 } };
  }, TX_OPTIONS);
}

export async function deleteLeave(id: number, clock: Clock = systemClock): Promise<DeleteResult> {
  return db().$transaction(async (tx) => {
    const fields = { id: true, employeeId: true, status: true, startDate: true, endDate: true } as const;
    const leave = await tx.leave.findUnique({ where: { id }, select: { ...fields, unpaidPart: { select: fields } } });
    if (!leave) throw new NotFoundError('This leave was not found.');

    const removed = [leave.unpaidPart, leave].filter((row) => row !== null);
    for (const row of removed) await tx.leave.delete({ where: { id: row.id } });

    // Approved leave set the days it covered to "on leave": recalculate them.
    const approved = removed.filter((row) => row.status === 'approved');
    if (approved.length > 0) {
      const dates = approved.flatMap((row) => [dateFromDb(row.startDate), dateFromDb(row.endDate)]).sort();
      await recalculateRecords(tx, { employeeId: leave.employeeId, from: dates[0], to: dates.at(-1) }, clock());
    }
    return { deleted: { leaves: removed.length } };
  }, TX_OPTIONS);
}

export async function deleteHoliday(id: number, clock: Clock = systemClock): Promise<DeleteResult> {
  return db().$transaction(async (tx) => {
    const holiday = await tx.companyHoliday.findUnique({ where: { id }, select: { date: true, liveDate: true } });
    if (!holiday) throw new NotFoundError('This holiday was not found.');
    await tx.companyHoliday.delete({ where: { id } });
    // A holiday that was still in effect changed that day for everyone.
    if (holiday.liveDate) {
      const date = dateFromDb(holiday.date);
      await recalculateRecords(tx, { dates: [date] }, clock());
      await recountLeaveDays(tx, { dates: [date] }, clock());
    }
    return { deleted: { holidays: 1 } };
  }, TX_OPTIONS);
}

export async function deleteUser(id: number, auth: AuthContext): Promise<DeleteResult> {
  return db().$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw new NotFoundError('This user was not found.');
    if (id === auth.userId || id === (await mainAdminId(tx))) {
      throw new ConflictError("The main admin can't be deleted.");
    }

    const reassigned = await reassignUserRecords(tx, id, auth.userId);
    const sessions = await tx.session.deleteMany({ where: { userId: id } });
    const permissions = await tx.userPermission.deleteMany({ where: { userId: id } });
    await tx.user.delete({ where: { id } });
    return { deleted: { users: 1, sessions: sessions.count, userPermissions: permissions.count, recordsReassigned: reassigned } };
  }, TX_OPTIONS);
}

/** Credits everything [from] created or changed to [to]. Returns rows changed. */
async function reassignUserRecords(tx: Tx, from: number, to: number): Promise<number> {
  // One at a time: a transaction runs one query at a time anyway.
  const updates = [
    () => tx.employee.updateMany({ where: { createdById: from }, data: { createdById: to } }),
    () => tx.employee.updateMany({ where: { updatedById: from }, data: { updatedById: to } }),
    () => tx.employeeWorkSchedule.updateMany({ where: { createdById: from }, data: { createdById: to } }),
    () => tx.companyHoliday.updateMany({ where: { createdById: from }, data: { createdById: to } }),
    () => tx.companyHoliday.updateMany({ where: { updatedById: from }, data: { updatedById: to } }),
    () => tx.companyHoliday.updateMany({ where: { deletedById: from }, data: { deletedById: to } }),
    () => tx.attendanceRecord.updateMany({ where: { punchedInById: from }, data: { punchedInById: to } }),
    () => tx.attendanceRecord.updateMany({ where: { punchedOutById: from }, data: { punchedOutById: to } }),
    () => tx.attendanceRecord.updateMany({ where: { correctedById: from }, data: { correctedById: to } }),
    () => tx.leave.updateMany({ where: { createdById: from }, data: { createdById: to } }),
    () => tx.leave.updateMany({ where: { decidedById: from }, data: { decidedById: to } }),
    () => tx.leave.updateMany({ where: { cancelledById: from }, data: { cancelledById: to } }),
    () => tx.leaveBalanceAdjustment.updateMany({ where: { createdById: from }, data: { createdById: to } }),
  ];
  let changed = 0;
  for (const update of updates) changed += (await update()).count;
  return changed;
}

export async function deleteDepartment(code: string): Promise<DeleteResult> {
  return db().$transaction(async (tx) => {
    const department = await tx.department.findUnique({ where: { code }, select: { name: true } });
    if (!department) throw new NotFoundError('This department was not found.');
    const used = await tx.employee.count({ where: { departmentCode: code } });
    if (used > 0) throw new ConflictError(inUse(used, `the ${department.name} department`));
    await tx.department.delete({ where: { code } });
    return { deleted: { departments: 1 } };
  }, TX_OPTIONS);
}

export async function deletePosition(code: string): Promise<DeleteResult> {
  return db().$transaction(async (tx) => {
    const position = await tx.position.findUnique({ where: { code }, select: { name: true } });
    if (!position) throw new NotFoundError('This position was not found.');
    const used = await tx.employee.count({ where: { positionCode: code } });
    if (used > 0) throw new ConflictError(inUse(used, `the ${position.name} position`));
    await tx.position.delete({ where: { code } });
    return { deleted: { positions: 1 } };
  }, TX_OPTIONS);
}

function inUse(count: number, what: string): string {
  return `${count} ${count === 1 ? 'employee is' : 'employees are'} in ${what}. Move or delete ${count === 1 ? 'that employee' : 'them'} first.`;
}

// --- Everything -----------------------------------------------------------------

export type ClearDataResult = DeleteResult & {
  /** The main admin, kept with their permissions and sessions. */
  keptAdmin: { id: string; name: string; email: string };
  /** False only if the change history couldn't be cleared (see `note`). */
  auditLogsCleared: boolean;
  note?: string;
};

/**
 * Deletes all data except the main admin (with their permissions and
 * sessions), the permission catalogue and leave types. Departments and
 * positions are kept unless `includeMasterData` is set.
 */
export async function clearAllData(body: ClearDataBody, auth: AuthContext): Promise<ClearDataResult> {
  const adminId = auth.userId;
  const admin = await db().user.findUniqueOrThrow({ where: { id: adminId }, select: { id: true, name: true, email: true } });
  // The optional append-only triggers (database/audit-triggers.sql) block
  // DELETE on audit_logs; TRUNCATE doesn't fire them.
  const auditTriggers = await hasAuditDeleteTrigger();

  const deleted = await db().$transaction(async (tx) => {
    const counts: Record<string, number> = {};
    const add = (name: string, result: { count: number }) => {
      counts[name] = (counts[name] ?? 0) + result.count;
    };
    if (!auditTriggers) add('auditLogs', await tx.auditLog.deleteMany({}));
    add('attendanceRecords', await tx.attendanceRecord.deleteMany({}));
    add('leaves', await tx.leave.deleteMany({ where: { unpaidPartOfId: { not: null } } }));
    add('leaves', await tx.leave.deleteMany({}));
    add('leaveBalanceAdjustments', await tx.leaveBalanceAdjustment.deleteMany({}));
    add('workSchedules', await tx.employeeWorkSchedule.deleteMany({}));
    await tx.user.updateMany({ where: { employeeId: { not: null } }, data: { employeeId: null } });
    add('employees', await tx.employee.deleteMany({}));
    add('holidays', await tx.companyHoliday.deleteMany({}));
    const others = { userId: { not: adminId } };
    add('sessions', await tx.session.deleteMany({ where: others }));
    add('userPermissions', await tx.userPermission.deleteMany({ where: others }));
    add('users', await tx.user.deleteMany({ where: { id: { not: adminId } } }));
    if (body.includeMasterData) {
      add('departments', await tx.department.deleteMany({}));
      add('positions', await tx.position.deleteMany({}));
    }
    return counts;
  }, TX_OPTIONS);

  const result: ClearDataResult = {
    deleted,
    keptAdmin: { id: String(admin.id), name: admin.name, email: admin.email },
    auditLogsCleared: true,
  };
  if (auditTriggers) {
    try {
      deleted.auditLogs = await db().auditLog.count();
      await db().$executeRawUnsafe('TRUNCATE TABLE `audit_logs`');
    } catch {
      result.auditLogsCleared = false;
      result.note =
        'Everything else was deleted, but the change history could not be cleared (the database user may not be allowed to TRUNCATE). Its entries now show "Deleted user" where needed.';
      delete deleted.auditLogs;
    }
  }
  return result;
}

async function hasAuditDeleteTrigger(): Promise<boolean> {
  const rows = await db().$queryRaw<{ count: bigint | number }[]>`
    SELECT COUNT(*) AS count FROM information_schema.TRIGGERS
    WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = 'audit_logs' AND EVENT_MANIPULATION = 'DELETE'`;
  return Number(rows[0]?.count ?? 0) > 0;
}
