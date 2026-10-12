import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as auditRoute } from '@/app/api/audit-logs/route';
import { GET as permissionsRoute } from '@/app/api/permissions/route';
import { GET as listRoute, POST as createRoute } from '@/app/api/users/route';
import { GET as getRoute, PATCH as updateRoute } from '@/app/api/users/[id]/route';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { GET as employeesRoute } from '@/app/api/employees/route';
import { GET as leavesRoute } from '@/app/api/leaves/route';
import { PUT as setPermissionsRoute } from '@/app/api/users/[id]/permissions/route';
import { GET as meRoute } from '@/app/api/auth/me/route';
import { apiRequest, createSignedInUser, noParams, seedTestPermissions, testDb, withParams } from './setup';

/**
 * Staff users, permissions and lock-out rules (DATABASE_V2.md §4). Users can't
 * be deleted (audit rows point at them), so each run uses its own emails.
 *
 * The lock-out tests need to know who else can manage permissions in the
 * shared test database, so they first take `permission.manage` away from
 * every other test user and give it back afterwards.
 */

const db = testDb();
const tag = `users-${Date.now()}`;
const emailOf = (name: string) => `${name}.${tag}@test.keshav.in`;
type Json = Record<string, unknown>;
let manager = { id: 0, token: '' };
let viewerToken = '';
let employeeId = 0;
const parked: { userId: number }[] = [];

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../contract/fixtures/${name}`, import.meta.url), 'utf8')) as Json;

async function call(
  handler: (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>,
  path: string,
  init: { method?: string; body?: unknown; params?: Record<string, string>; token?: string } = {},
) {
  const response = await handler(apiRequest(path, init.token ?? manager.token, init), init.params ? withParams(init.params) : noParams);
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as Json };
}

const createUser = (body: unknown) => call(createRoute, '/users', { method: 'POST', body });
const update = (id: string, body: unknown, token?: string) =>
  call(updateRoute, `/users/${id}`, { method: 'PATCH', body, params: { id }, token });
const setPermissions = (id: string, permissions: string[], token?: string) =>
  call(setPermissionsRoute, `/users/${id}/permissions`, { method: 'PUT', body: { permissions }, params: { id }, token });

beforeAll(async () => {
  await seedTestPermissions(db);
  // Park everyone else's permission.manage so this file controls who has it.
  const others = await db.userPermission.findMany({ where: { permissionKey: 'permission.manage' }, select: { userId: true } });
  parked.push(...others);
  await db.userPermission.deleteMany({ where: { permissionKey: 'permission.manage' } });

  manager = await createSignedInUser(db, tag, 'manager', ['permission.manage']);
  viewerToken = (await createSignedInUser(db, tag, 'viewer', ['employee.view'])).token;
  const admin = await db.user.findFirstOrThrow({ where: { id: manager.id } });
  employeeId = (
    await db.employee.create({
      data: {
        ecNumber: `KC5${String(Date.now()).slice(-7)}`,
        name: `Nisha ${tag}`,
        mobile: '9876543210',
        departmentCode: 'accountant',
        positionCode: 'accountant',
        joiningDate: new Date('2020-01-01T00:00:00Z'),
        status: 'inactive',
        createdById: admin.id,
        updatedById: admin.id,
      },
    })
  ).id;
});

afterAll(async () => {
  await db.userPermission.deleteMany({ where: { permissionKey: 'permission.manage', user: { email: { endsWith: `.${tag}@test.keshav.in` } } } });
  await db.userPermission.createMany({
    data: parked.map(({ userId }) => ({ userId, permissionKey: 'permission.manage' })),
    skipDuplicates: true,
  });
  await db.$disconnect();
});

describe('GET /api/permissions', () => {
  it('returns the catalogue for permission.manage only', async () => {
    const { status, body } = await call(permissionsRoute, '/permissions');
    expect(status).toBe(200);
    expect(body).toEqual(fixture('permissions.response.json'));
    expect((await call(permissionsRoute, '/permissions', { token: viewerToken })).status).toBe(403);
  });
});

describe('staff users', () => {
  let nisha = '';

  it('adds a user linked to an employee, with permissions', async () => {
    const { status, body } = await createUser({
      name: 'Nisha Solanki',
      email: emailOf('NISHA'),
      password: 'Nisha@2026',
      employeeId: String(employeeId),
      permissions: ['leave.view', 'dashboard.view', 'leave.view'],
    });
    expect(status).toBe(201);
    expect(body).toMatchObject({
      name: 'Nisha Solanki',
      email: emailOf('nisha'),
      permissions: ['dashboard.view', 'leave.view'], // catalogue order, no duplicates
      employee: { id: String(employeeId), name: `Nisha ${tag}`, department: 'accountant', position: 'accountant' },
      isActive: true,
      lastSignInAt: null,
    });
    expect(Object.keys(body).sort()).toEqual(Object.keys(fixture('users.get.response.json')).sort());
    nisha = body.id as string;
  });

  it('refuses a taken email or employee, and unknown permissions', async () => {
    const dup = await createUser({ name: 'X', email: emailOf('nisha'), password: 'Nisha@2026', employeeId: String(employeeId) });
    expect(dup.status).toBe(409);
    expect(dup.body.errors).toEqual({
      email: ['A user with this email already exists.'],
      employeeId: ['This employee already has a user account.'],
    });
    const unknown = await createUser({ name: 'X', email: emailOf('x'), password: 'Nisha@2026', permissions: ['salary.view'] });
    expect(unknown.status).toBe(422);
    expect(unknown.body.errors).toEqual({ permissions: ['Unknown permission: salary.view'] });
  });

  it('lists and searches by name or email', async () => {
    const { body } = await call(listRoute, `/users?search=${encodeURIComponent('solanki')}`);
    expect((body.items as Json[]).map((u) => u.email)).toContain(emailOf('nisha'));
    expect(Object.keys(body).sort()).toEqual(Object.keys(fixture('users.list.response.json')).sort());
  });

  it('edits, unlinks the employee and records the change', async () => {
    const { status, body } = await update(nisha, { name: 'Nisha S.', email: emailOf('nisha'), employeeId: null });
    expect(status).toBe(200);
    expect(body).toMatchObject({ name: 'Nisha S.', employee: null });
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityType: 'user', entityId: nisha, action: 'user.update' } });
    expect(audit.changes).toEqual([
      { field: 'name', label: 'Name', before: 'Nisha Solanki', after: 'Nisha S.' },
      { field: 'employee', label: 'Linked employee', before: expect.stringContaining('Nisha'), after: null },
    ]);
  });

  it('replaces permissions and records grants and removals', async () => {
    const { body } = await setPermissions(nisha, ['dashboard.view', 'attendance.view']);
    expect(body.permissions).toEqual(['dashboard.view', 'attendance.view']);
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: nisha, action: 'user.permissions.update' } });
    expect(audit.changes).toEqual([
      { field: 'attendance.view', label: 'View attendance', before: null, after: 'Granted' },
      { field: 'leave.view', label: 'View leave', before: 'Granted', after: null },
    ]);
  });

  it('needs permission.manage', async () => {
    expect((await call(getRoute, `/users/${nisha}`, { params: { id: nisha }, token: viewerToken })).status).toBe(403);
  });
});

const login = async (email: string, password: string) => {
  const response = await loginRoute(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
    noParams,
  );
  return { status: response.status, body: (await response.json()) as Json };
};

describe('admin-set passwords (T-06)', () => {
  const email = emailOf('pwuser');
  let userId = '';

  it('requires a password of 8 to 200 characters on create', async () => {
    const base = { name: 'Pw User', email };
    for (const body of [base, { ...base, password: 'short12' }, { ...base, password: null }]) {
      const { status, body: res } = await createUser(body);
      expect(status).toBe(422);
      expect((res.errors as Record<string, string[]>).password).toEqual(['Use at least 8 characters']);
    }
    expect((await createUser({ ...base, password: 'x'.repeat(201) })).status).toBe(422);
    expect(await db.user.count({ where: { email } })).toBe(0);
  });

  it('stores only an Argon2 hash, never returns it, and signs in with the user own permissions', async () => {
    const created = await createUser({ name: 'Pw User', email, password: 'Secret pass 1', permissions: ['leave.view'] });
    expect(created.status).toBe(201);
    userId = created.body.id as string;
    expect(JSON.stringify(created.body)).not.toMatch(/Secret pass 1|passwordHash|argon2/i);
    const row = await db.user.findUniqueOrThrow({ where: { email } });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.passwordHash).not.toContain('Secret pass 1');

    const ok = await login(email, 'Secret pass 1');
    expect(ok.status).toBe(200);
    expect((ok.body.user as Json).permissions).toEqual(['leave.view']);
    expect(JSON.stringify(ok.body)).not.toMatch(/passwordHash|argon2/i);
    const me = await meRoute(apiRequest('/auth/me', ok.body.accessToken as string), noParams);
    expect(((await me.json()) as Json).permissions).toEqual(['leave.view']);

    expect((await login(email, 'Secret pass 2')).status).toBe(401);
    expect((await login(email, 'secret pass 1')).status).toBe(401);
  });

  it('writes "Set" to the history, without the password or hash', async () => {
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityType: 'user', entityId: userId, action: 'user.create' } });
    expect(audit.changes).toContainEqual({ field: 'password', label: 'Password', before: null, after: 'Set' });
    expect(JSON.stringify(audit.changes)).not.toMatch(/Secret pass 1|argon2/i);
  });

  it('keeps the password when PATCH omits it, and rejects a short one', async () => {
    const edit = { name: 'Pw User', email, employeeId: null };
    expect((await update(userId, edit)).status).toBe(200);
    expect((await update(userId, { ...edit, password: null })).status).toBe(200);
    expect((await login(email, 'Secret pass 1')).status).toBe(200);
    const short = await update(userId, { ...edit, password: 'short' });
    expect(short.status).toBe(422);
    expect((short.body.errors as Json).password).toEqual(['Use at least 8 characters']);
  });

  it('changes the password on PATCH, signs the user out everywhere and records "Changed"', async () => {
    const token = (await login(email, 'Secret pass 1')).body.accessToken as string;
    const { status, body } = await update(userId, { name: 'Pw User', email, employeeId: null, password: 'New secret 22' });
    expect(status).toBe(200);
    expect(JSON.stringify(body)).not.toMatch(/New secret 22|passwordHash|argon2/i);
    expect((await meRoute(apiRequest('/auth/me', token), noParams)).status).toBe(401);
    expect((await login(email, 'Secret pass 1')).status).toBe(401);
    expect((await login(email, 'New secret 22')).status).toBe(200);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityType: 'user', entityId: userId, action: 'user.update' },
      orderBy: { id: 'desc' },
    });
    expect(audit.changes).toEqual([{ field: 'password', label: 'Password', before: null, after: 'Changed' }]);
    expect(JSON.stringify(audit.changes)).not.toMatch(/New secret 22|argon2/i);
  });

  it('keeps the admin own session when they reset their own password', async () => {
    const own = await createSignedInUser(db, tag, 'selfreset', ['permission.manage']);
    const { status } = await update(
      String(own.id),
      { name: 'selfreset', email: own.email, employeeId: null, password: 'Brand new 33' },
      own.token,
    );
    expect(status).toBe(200);
    expect((await meRoute(apiRequest('/auth/me', own.token), noParams)).status).toBe(200);
    expect((await login(own.email, 'Brand new 33')).status).toBe(200);
    // Don't leave another manager behind for the lock-out tests.
    await db.userPermission.deleteMany({ where: { userId: own.id } });
  });

  it('refuses a deactivated user even with the right password', async () => {
    await update(userId, { name: 'Pw User', email, employeeId: null, isActive: false });
    const refused = await login(email, 'New secret 22');
    expect(refused.status).toBe(401);
    expect(refused.body.message).toBe('Your account has been deactivated.');
  });

  it('lets a leave.view-only user read leaves but not employees or users', async () => {
    const viewer = await createSignedInUser(db, tag, 'leaveonly', ['leave.view']);
    const get = (handler: typeof employeesRoute, path: string) => handler(apiRequest(path, viewer.token), noParams);
    expect((await get(leavesRoute, '/leaves')).status).toBe(200);
    for (const [handler, path] of [[employeesRoute, '/employees'], [listRoute, '/users']] as const) {
      const response = await get(handler, path);
      expect(response.status).toBe(403);
      expect(((await response.json()) as Json).code).toBe('PERMISSION_DENIED');
    }
  });
});

describe('lock-out protection', () => {
  const me = () => String(manager.id);
  const managerBody = (isActive: boolean) => ({ name: 'manager', email: emailOf('manager'), employeeId: null, isActive });

  it("won't let you deactivate yourself or drop your own permission.manage", async () => {
    const self = await update(me(), managerBody(false));
    expect(self.status).toBe(409);
    expect(self.body).toEqual({ code: 'CANNOT_CHANGE_OWN_ACCESS', message: "You can't deactivate your own account." });
    const drop = await setPermissions(me(), ['dashboard.view']);
    expect(drop.status).toBe(409);
    expect(drop.body.code).toBe('CANNOT_CHANGE_OWN_ACCESS');
  });

  it("lets a manager remove another manager's access while one remains", async () => {
    const second = (await createUser({ name: 'Second', email: emailOf('second'), password: 'Second@2026', permissions: ['permission.manage'] })).body.id as string;
    expect((await setPermissions(second, [])).status).toBe(200);
    expect((await update(second, { name: 'Second', email: emailOf('second'), employeeId: null, isActive: false })).status).toBe(200);
  });

  it('never leaves nobody able to manage permissions (409 LAST_PERMISSION_MANAGER)', async () => {
    // Through the API the caller is always a manager, so this guards against
    // stale or concurrent changes: simulate a caller whose access was just removed.
    const { setPermissions: setPerms, update: updateUser } = await import('@/modules/users/user.service');
    const ghost = { userId: -1, sessionId: 'x', name: 'ghost', email: 'ghost@test', permissions: new Set<string>() };
    await expect(setPerms(manager.id, [], ghost)).rejects.toMatchObject({ status: 409, code: 'LAST_PERMISSION_MANAGER' });
    await expect(updateUser(manager.id, { ...managerBody(false), password: undefined }, ghost)).rejects.toMatchObject({
      code: 'LAST_PERMISSION_MANAGER',
    });
  });

  it('ends the sessions of a deactivated user at once', async () => {
    const victim = await createSignedInUser(db, tag, 'victim', ['employee.view']);
    expect((await meRoute(apiRequest('/auth/me', victim.token), noParams)).status).toBe(200);
    await update(String(victim.id), { name: 'victim', email: victim.email, employeeId: null, isActive: false });
    expect((await meRoute(apiRequest('/auth/me', victim.token), noParams)).status).toBe(401);
    const sessions = await db.session.findMany({ where: { userId: victim.id } });
    expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);
  });
});

describe('GET /api/audit-logs', () => {
  it('lists change history newest first, filtered by entity type', async () => {
    const auditor = await createSignedInUser(db, tag, 'auditor', ['audit.view']);
    const { status, body } = await call(auditRoute, '/audit-logs?entityType=user&pageSize=5', { token: auditor.token });
    expect(status).toBe(200);
    const items = body.items as Json[];
    expect(items.length).toBeGreaterThan(0);
    expect(new Set(items.map((i) => (i.action as string).split('.')[0]))).toEqual(new Set(['user']));
    const times = items.map((i) => i.createdAt as string);
    expect([...times].sort().reverse()).toEqual(times);
    expect(Object.keys(items[0]!).sort()).toEqual(Object.keys((fixture('audit-logs.response.json').items as Json[])[0]!).sort());
    expect((await call(auditRoute, '/audit-logs?entityType=salary', { token: auditor.token })).status).toBe(422);
    expect((await call(auditRoute, '/audit-logs', { token: viewerToken })).status).toBe(403);
  });
});
