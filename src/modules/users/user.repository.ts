import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import type { PageRequest } from '@/lib/http';

type Client = PrismaClient | Prisma.TransactionClient;

export const userSelect = {
  id: true,
  name: true,
  email: true,
  isActive: true,
  lastSignInAt: true,
  employee: {
    select: {
      id: true,
      name: true,
      ecNumber: true,
      departmentCode: true,
      positionCode: true,
    },
  },
  permissions: { select: { permissionKey: true }, orderBy: { permission: { sort: 'asc' } } },
} satisfies Prisma.UserSelect;

export type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

export async function listUsers(search: string | undefined, page: PageRequest) {
  const where: Prisma.UserWhereInput = search
    ? {
        OR: [
          { name: { contains: search } },
          { email: { contains: search } },
        ],
      }
    : {};
  const [rows, total] = await db().$transaction([
    db().user.findMany({ where, select: userSelect, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: page.skip, take: page.take }),
    db().user.count({ where }),
  ]);
  return { rows, total };
}

export function findUser(id: number, client: Client = db()): Promise<UserRow | null> {
  return client.user.findUnique({ where: { id }, select: userSelect });
}

/** Which of email / employee link are taken by another user. */
export async function taken(
  tx: Prisma.TransactionClient,
  input: { email: string; employeeId: number | null },
  exceptId: number | null,
) {
  const others = await tx.user.findMany({
    where: {
      OR: [{ email: input.email }, ...(input.employeeId ? [{ employeeId: input.employeeId }] : [])],
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
    select: { email: true, employeeId: true },
  });
  return {
    email: others.some((u) => u.email === input.email),
    employee: input.employeeId !== null && others.some((u) => u.employeeId === input.employeeId),
  };
}

export function employeeExists(tx: Prisma.TransactionClient, id: number): Promise<boolean> {
  return tx.employee.count({ where: { id } }).then((count) => count > 0);
}

/**
 * Serializes every change to who can manage permissions, so two admins can't
 * remove each other's access at the same moment (lock-out rules, §4.3): it
 * locks the `permission.manage` catalogue row until the transaction ends.
 */
export async function lockAccessChanges(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT \`key\` FROM permissions WHERE \`key\` = 'permission.manage' FOR UPDATE`;
}

/** Active users holding `permission.manage`, other than [exceptId]. */
export function otherActiveManagers(tx: Prisma.TransactionClient, exceptId: number): Promise<number> {
  return tx.user.count({
    where: { id: { not: exceptId }, isActive: true, permissions: { some: { permissionKey: 'permission.manage' } } },
  });
}

export async function replacePermissions(tx: Prisma.TransactionClient, userId: number, keys: string[]): Promise<void> {
  await tx.userPermission.deleteMany({ where: { userId } });
  if (keys.length > 0) {
    await tx.userPermission.createMany({ data: keys.map((permissionKey) => ({ userId, permissionKey })) });
  }
}

/** Ends the user's active sessions, optionally keeping one (the caller's own). */
export async function revokeAllSessions(
  tx: Prisma.TransactionClient,
  userId: number,
  at: Date,
  exceptSessionId?: string,
): Promise<void> {
  await tx.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { NOT: { id: exceptSessionId } } : {}) },
    data: { revokedAt: at },
  });
}
