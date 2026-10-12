import { mysqlAdapter } from '@/lib/db/connection';
import { PrismaClient } from '@/generated/prisma/client';

/**
 * Integration tests run against the separate test database
 * (`kc_admin_portal_test`, created by docker-compose), never the
 * development one. Override with TEST_DATABASE_URL.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'mysql://kc:kc_dev_password@127.0.0.1:3306/kc_admin_portal_test';

export function testDb(): PrismaClient {
  return new PrismaClient({ adapter: mysqlAdapter(TEST_DATABASE_URL) });
}

/** Copies the permission catalogue into the test database (like the seed). */
export async function seedTestPermissions(db: PrismaClient): Promise<void> {
  const { PERMISSIONS } = await import('@/lib/permissions/catalogue');
  for (const permission of PERMISSIONS) {
    const { key, ...rest } = permission;
    await db.permission.upsert({ where: { key }, update: rest, create: permission });
  }
}

export const TEST_PASSWORD = 'Sup3r-secret pass';
export const noParams = { params: Promise.resolve({}) };
export const withParams = (params: Record<string, string>) => ({ params: Promise.resolve(params) });

/**
 * Creates a staff user with [permissions] in the test database and signs them
 * in through the real login route. Emails end in `.<tag>@test.keshav.in` so
 * a test file can find its own users.
 */
export async function createSignedInUser(
  db: PrismaClient,
  tag: string,
  name: string,
  permissions: readonly string[],
): Promise<{ id: number; token: string; email: string }> {
  const { hashPassword } = await import('@/lib/auth/password');
  const { POST: login } = await import('@/app/api/auth/login/route');
  const email = `${name.toLowerCase()}.${tag}@test.keshav.in`;
  const user = await db.user.create({
    data: {
      name,
      email,
      passwordHash: await hashPassword(TEST_PASSWORD),
      permissions: { create: permissions.map((permissionKey) => ({ permissionKey })) },
    },
  });
  const response = await login(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: TEST_PASSWORD }),
    }),
    noParams,
  );
  const { accessToken } = (await response.json()) as { accessToken: string };
  return { id: user.id, token: accessToken, email };
}

/** A request to [path] from the holder of [token]. */
export function apiRequest(
  path: string,
  token: string | null,
  init: { method?: string; body?: unknown } = {},
): Request {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  return new Request(`http://localhost/api${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}
