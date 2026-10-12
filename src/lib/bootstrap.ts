import { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, hashPassword } from '@/lib/auth/password';
import { PERMISSIONS } from '@/lib/permissions/catalogue';

/**
 * Data the app can't create itself, made safe to run on every start:
 *
 * 1. The permission catalogue, copied from `src/lib/permissions/catalogue.ts`.
 *    Keys removed from the code are removed here, with their grants.
 * 2. The bootstrap admin (architecture M-01), when BOOTSTRAP_ADMIN_EMAIL is
 *    set: created if that email doesn't exist yet (password never changed
 *    afterwards), and given every permission if it has none.
 *
 * Runs from `npm run db:seed` and, on hosting without a terminal (GoDaddy),
 * when the server starts.
 */

const adminSchema = z.object({
  BOOTSTRAP_ADMIN_NAME: z.string().trim().min(1).max(100).default('Admin'),
  BOOTSTRAP_ADMIN_EMAIL: z
    .string()
    .trim()
    .pipe(z.email('BOOTSTRAP_ADMIN_EMAIL must be an email address'))
    .transform((value) => value.toLowerCase()),
  BOOTSTRAP_ADMIN_PASSWORD: z
    .string({ error: 'BOOTSTRAP_ADMIN_PASSWORD is required to create the admin' })
    .min(PASSWORD_MIN_LENGTH, `BOOTSTRAP_ADMIN_PASSWORD must be at least ${PASSWORD_MIN_LENGTH} characters`)
    .max(PASSWORD_MAX_LENGTH)
    .optional(),
});

export async function bootstrap(
  db: PrismaClient,
  source: Record<string, string | undefined>,
  log: (message: string) => void,
): Promise<void> {
  await syncPermissions(db, log);
  await ensureAdmin(db, source, log);
}

async function syncPermissions(db: PrismaClient, log: (message: string) => void): Promise<void> {
  for (const permission of PERMISSIONS) {
    const { key, ...rest } = permission;
    await db.permission.upsert({ where: { key }, update: rest, create: permission });
  }
  const removed = await db.permission.deleteMany({ where: { key: { notIn: PERMISSIONS.map((p) => p.key) } } });
  log(`Permissions: ${PERMISSIONS.length} in the catalogue${removed.count > 0 ? `, ${removed.count} no longer used removed` : ''}.`);
}

async function ensureAdmin(
  db: PrismaClient,
  source: Record<string, string | undefined>,
  log: (message: string) => void,
): Promise<void> {
  if (!source.BOOTSTRAP_ADMIN_EMAIL) return;
  const parsed = adminSchema.safeParse(source);
  if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => issue.message).join('\n'));
  const { BOOTSTRAP_ADMIN_NAME: name, BOOTSTRAP_ADMIN_EMAIL: email, BOOTSTRAP_ADMIN_PASSWORD: password } = parsed.data;

  let user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) {
    if (!password) throw new Error('BOOTSTRAP_ADMIN_PASSWORD is required to create the admin');
    user = await db.user.create({ data: { name, email, passwordHash: await hashPassword(password) }, select: { id: true } });
    log(`Bootstrap admin: created ${email}.`);
  }
  const granted = await db.userPermission.count({ where: { userId: user.id } });
  if (granted === 0) {
    await db.userPermission.createMany({ data: PERMISSIONS.map((p) => ({ userId: user.id, permissionKey: p.key })) });
    log(`Bootstrap admin: gave ${email} all ${PERMISSIONS.length} permissions.`);
  }
}
