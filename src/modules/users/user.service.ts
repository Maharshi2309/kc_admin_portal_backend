import type { Prisma } from '@/generated/prisma/client';
import { hashPassword } from '@/lib/auth/password';
import { db } from '@/lib/db';
import { ConflictError, type FieldErrors, NotFoundError, ValidationError } from '@/lib/errors';
import { toPage } from '@/lib/http';
import { PERMISSION_MODULES, permissionLabel, type PermissionKey } from '@/lib/permissions/catalogue';
import { type Clock, formatInstantOrNull, systemClock } from '@/lib/time';
import type { EmployeeSummaryDto } from '@/modules/attendance/attendance.types';
import type { AuthContext } from '@/modules/auth/auth.types';
import type { AuditChange } from '@/modules/audit/audit.types';
import { diffForAudit, writeAudit } from '@/modules/audit/audit.writer';
import * as repo from './user.repository';
import type { CreateUserBody, UpdateUserBody, UserListQuery } from './user.validation';

/**
 * Staff users and their permissions (API_CONTRACT.md "Users and permissions",
 * DATABASE_V2.md §4). No roles: each user has their own permission keys.
 *
 * Lock-out protection (§4.3): there is always at least one active user with
 * `permission.manage` (409 `LAST_PERMISSION_MANAGER`), and nobody can
 * deactivate themselves or remove their own `permission.manage`
 * (409 `CANNOT_CHANGE_OWN_ACCESS`).
 *
 * Passwords (T-06, decided 2026-10-10): the admin sets one when adding a user
 * and may set a new one when editing. Only an Argon2id hash is stored; the
 * password never appears in a response, log line or audit entry. Setting a
 * new password signs the user out everywhere (except the admin's own current
 * session when they reset their own password).
 */

const NOT_FOUND = 'This user was not found.';
const MANAGE: PermissionKey = 'permission.manage';

export type UserAccountDto = {
  id: string;
  name: string;
  email: string;
  permissions: string[];
  employee: EmployeeSummaryDto | null;
  isActive: boolean;
  lastSignInAt: string | null;
};

function toDto(row: repo.UserRow): UserAccountDto {
  return {
    id: String(row.id),
    name: row.name,
    email: row.email,
    permissions: row.permissions.map((p) => p.permissionKey),
    employee: row.employee
      ? {
          id: String(row.employee.id),
          name: row.employee.name,
          ecNumber: row.employee.ecNumber,
          department: row.employee.departmentCode,
          position: row.employee.positionCode,
        }
      : null,
    isActive: row.isActive,
    lastSignInAt: formatInstantOrNull(row.lastSignInAt),
  };
}

/** `GET /permissions`: the catalogue grouped by module (`permissions.response.json`). */
export function catalogue() {
  return PERMISSION_MODULES;
}

export async function list(query: UserListQuery) {
  const { rows, total } = await repo.listUsers(query.search, query.page);
  return toPage(rows.map(toDto), total, query.page);
}

export async function get(id: number): Promise<UserAccountDto> {
  const row = await repo.findUser(id);
  if (!row) throw new NotFoundError(NOT_FOUND);
  return toDto(row);
}

export async function create(body: CreateUserBody, auth: AuthContext): Promise<UserAccountDto> {
  // Hash before the transaction so Argon2 doesn't hold it open.
  const passwordHash = await hashPassword(body.password);
  return db().$transaction(async (tx) => {
    await checkEmailAndEmployee(tx, body, null);
    const created = await tx.user.create({
      data: {
        name: body.name,
        email: body.email,
        employeeId: body.employeeId,
        passwordHash,
        permissions: { create: body.permissions.map((permissionKey) => ({ permissionKey })) },
      },
      select: repo.userSelect,
    });
    const dto = toDto(created);
    await writeAudit(tx, {
      actorUserId: auth.userId,
      action: 'user.create',
      entityType: 'user',
      entityId: created.id,
      employeeId: body.employeeId,
      summary: `Added user ${dto.name}`,
      changes: [
        ...diffForAudit(null, auditView(dto), auditFields),
        { field: 'password', label: 'Password', before: null, after: 'Set' },
        ...permissionChanges([], dto.permissions),
      ],
    });
    return dto;
  });
}

export async function update(
  id: number,
  body: UpdateUserBody,
  auth: AuthContext,
  clock: Clock = systemClock,
): Promise<UserAccountDto> {
  const passwordHash = body.password === undefined ? undefined : await hashPassword(body.password);
  return db().$transaction(async (tx) => {
    await repo.lockAccessChanges(tx);
    const current = await repo.findUser(id, tx);
    if (!current) throw new NotFoundError(NOT_FOUND);
    const deactivating = body.isActive === false && current.isActive;
    if (deactivating) {
      if (id === auth.userId) {
        throw new ConflictError("You can't deactivate your own account.", 'CANNOT_CHANGE_OWN_ACCESS');
      }
      const isManager = current.permissions.some((p) => p.permissionKey === MANAGE);
      if (isManager && (await repo.otherActiveManagers(tx, id)) === 0) {
        throw lastManagerError();
      }
    }
    await checkEmailAndEmployee(tx, body, id);

    const updated = await tx.user.update({
      where: { id },
      data: {
        name: body.name,
        email: body.email,
        employeeId: body.employeeId,
        ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
        ...(passwordHash === undefined ? {} : { passwordHash }),
      },
      select: repo.userSelect,
    });
    if (deactivating) await repo.revokeAllSessions(tx, id, clock());
    else if (passwordHash !== undefined) {
      await repo.revokeAllSessions(tx, id, clock(), id === auth.userId ? auth.sessionId : undefined);
    }

    const before = toDto(current);
    const after = toDto(updated);
    const changes = [
      ...diffForAudit(auditView(before), auditView(after), auditFields),
      ...(passwordHash === undefined ? [] : [{ field: 'password', label: 'Password', before: null, after: 'Changed' }]),
    ];
    if (changes.length > 0) {
      await writeAudit(tx, {
        actorUserId: auth.userId,
        action: 'user.update',
        entityType: 'user',
        entityId: id,
        employeeId: updated.employee?.id ?? null,
        summary: deactivating ? `Deactivated user ${after.name}` : `Edited user ${after.name}`,
        changes,
      });
    }
    return after;
  });
}

/** `PUT /users/{id}/permissions`: replaces the whole list. */
export async function setPermissions(id: number, keys: PermissionKey[], auth: AuthContext): Promise<UserAccountDto> {
  return db().$transaction(async (tx) => {
    await repo.lockAccessChanges(tx);
    const current = await repo.findUser(id, tx);
    if (!current) throw new NotFoundError(NOT_FOUND);
    const had = current.permissions.map((p) => p.permissionKey);
    const losesManage = had.includes(MANAGE) && !keys.includes(MANAGE);
    if (losesManage && id === auth.userId) {
      throw new ConflictError(
        "You can't remove your own permission to manage users and permissions.",
        'CANNOT_CHANGE_OWN_ACCESS',
      );
    }
    if (losesManage && current.isActive && (await repo.otherActiveManagers(tx, id)) === 0) {
      throw lastManagerError();
    }

    await repo.replacePermissions(tx, id, keys);
    const after = toDto((await repo.findUser(id, tx))!);
    const changes = permissionChanges(had, after.permissions);
    if (changes.length > 0) {
      await writeAudit(tx, {
        actorUserId: auth.userId,
        action: 'user.permissions.update',
        entityType: 'user',
        entityId: id,
        employeeId: current.employee?.id ?? null,
        summary: `Changed permissions of ${after.name}`,
        changes,
      });
    }
    return after;
  });
}

// --- helpers ------------------------------------------------------------------

async function checkEmailAndEmployee(
  tx: Prisma.TransactionClient,
  body: { email: string; employeeId: number | null },
  exceptId: number | null,
): Promise<void> {
  if (body.employeeId !== null && !(await repo.employeeExists(tx, body.employeeId))) {
    throw ValidationError.field('employeeId', 'Choose an employee');
  }
  const taken = await repo.taken(tx, body, exceptId);
  const errors: FieldErrors = {};
  if (taken.email) errors.email = ['A user with this email already exists.'];
  if (taken.employee) errors.employeeId = ['This employee already has a user account.'];
  if (Object.keys(errors).length > 0) {
    throw new ConflictError(Object.values(errors)[0]![0]!, 'DUPLICATE', errors);
  }
}

function lastManagerError(): ConflictError {
  return new ConflictError(
    'At least one active user must be able to manage users and permissions.',
    'LAST_PERMISSION_MANAGER',
  );
}

type UserAuditView = { name: string; email: string; employee: string | null; status: string };

const auditFields = [
  { field: 'name', label: 'Name' },
  { field: 'email', label: 'Email' },
  { field: 'employee', label: 'Linked employee' },
  { field: 'status', label: 'Status' },
] as const;

function auditView(dto: UserAccountDto): UserAuditView {
  return {
    name: dto.name,
    email: dto.email,
    employee: dto.employee ? `${dto.employee.name} (${dto.employee.ecNumber})` : null,
    status: dto.isActive ? 'Active' : 'Inactive',
  };
}

/** One history line per permission granted or removed. */
function permissionChanges(before: readonly string[], after: readonly string[]): AuditChange[] {
  const label = (key: string) => permissionLabel(key as PermissionKey);
  return [
    ...after.filter((k) => !before.includes(k)).map((k) => ({ field: k, label: label(k), before: null, after: 'Granted' })),
    ...before.filter((k) => !after.includes(k)).map((k) => ({ field: k, label: label(k), before: 'Granted', after: null })),
  ];
}
