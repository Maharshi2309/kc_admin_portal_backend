import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authed } from '@/lib/auth/authed';
import { hashPassword } from '@/lib/auth/password';
import { ok } from '@/lib/http';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { seedTestPermissions, testDb } from './setup';

/** Permission checks on real sessions (API_CONTRACT.md "Required permissions"). */

const db = testDb();
const tag = `authz-${Date.now()}`;
const emailOf = (name: string) => `${name.toLowerCase()}.${tag}@test.keshav.in`;
const PASSWORD = 'Sup3r-secret pass';
const noParams = { params: Promise.resolve({}) };

const editEmployee = authed({ permission: 'employee.edit' }, async () => ok({ done: true }));
const previewLeave = authed({ permission: ['leave.create', 'leave.edit'] }, async () => ok({ done: true }));
const anySignedIn = authed(async ({ auth }) => ok({ userId: auth.userId }));

const tokens: Record<string, string> = {};

beforeAll(async () => {
  await seedTestPermissions(db);
  const passwordHash = await hashPassword(PASSWORD);
  const users = { viewer: ['employee.view'], editor: ['employee.view', 'employee.edit'], leaveEditor: ['leave.edit'] };
  for (const [name, keys] of Object.entries(users)) {
    await db.user.create({
      data: {
        name,
        email: emailOf(name),
        passwordHash,
        permissions: { create: keys.map((permissionKey) => ({ permissionKey })) },
      },
    });
    const response = await loginRoute(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: emailOf(name), password: PASSWORD }),
      }),
      noParams,
    );
    tokens[name] = ((await response.json()) as { accessToken: string }).accessToken;
  }
});

afterAll(async () => {
  await db.user.deleteMany({ where: { email: { endsWith: `.${tag}@test.keshav.in` } } });
  await db.$disconnect();
});

const as = (user: string) =>
  new Request('http://localhost/api/x', { headers: { authorization: `Bearer ${tokens[user]}` } });

describe('authed() with permissions', () => {
  it('returns 403 PERMISSION_DENIED, worded for the permission, when it is missing', async () => {
    const response = await editEmployee(as('viewer'), noParams);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: 'PERMISSION_DENIED',
      message: 'You do not have permission to edit employees.',
    });
  });

  it('runs the handler when the permission is granted', async () => {
    const response = await editEmployee(as('editor'), noParams);
    expect(response.status).toBe(200);
  });

  it('accepts any one of several permissions', async () => {
    expect((await previewLeave(as('leaveEditor'), noParams)).status).toBe(200);
    expect((await previewLeave(as('viewer'), noParams)).status).toBe(403);
  });

  it('checks the session before the permission (401 before 403)', async () => {
    const response = await editEmployee(new Request('http://localhost/api/x'), noParams);
    expect(response.status).toBe(401);
  });

  it('lets any signed-in user through when no permission is required', async () => {
    expect((await anySignedIn(as('viewer'), noParams)).status).toBe(200);
  });

  it('applies a newly granted permission on the next request', async () => {
    const viewer = await db.user.findUniqueOrThrow({ where: { email: emailOf('viewer') } });
    await db.userPermission.create({ data: { userId: viewer.id, permissionKey: 'employee.edit' } });
    expect((await editEmployee(as('viewer'), noParams)).status).toBe(200);
  });
});
