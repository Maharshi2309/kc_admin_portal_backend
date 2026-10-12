import { db } from '@/lib/db';

/** Database access for sign-in and sessions. Only the auth service calls this. */

export function findUserForLogin(email: string) {
  return db().user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, passwordHash: true, isActive: true },
  });
}

/** Opens a session and records the sign-in, together. */
export async function openSession(input: {
  userId: number;
  expiresAt: Date;
  userAgent: string | null;
  signedInAt: Date;
}) {
  const [session] = await db().$transaction([
    db().session.create({
      data: { userId: input.userId, expiresAt: input.expiresAt, userAgent: input.userAgent },
      select: { id: true },
    }),
    db().user.update({ where: { id: input.userId }, data: { lastSignInAt: input.signedInAt } }),
  ]);
  return session;
}

export function findSessionWithUser(sessionId: string) {
  return db().session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      user: { select: { id: true, name: true, email: true, isActive: true } },
    },
  });
}

/** The user's permission keys, in catalogue order. */
export async function permissionKeysOf(userId: number): Promise<string[]> {
  const rows = await db().userPermission.findMany({
    where: { userId },
    select: { permissionKey: true },
    orderBy: { permission: { sort: 'asc' } },
  });
  return rows.map((row) => row.permissionKey);
}

/** Idempotent: revoking an already revoked session changes nothing. */
export async function revokeSession(sessionId: string, at: Date): Promise<void> {
  await db().session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: at },
  });
}
