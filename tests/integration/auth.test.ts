import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '@/lib/auth/password';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { POST as logoutRoute } from '@/app/api/auth/logout/route';
import { GET as meRoute } from '@/app/api/auth/me/route';
import { testDb } from './setup';

/** The auth endpoints end to end, against the test database. */

const db = testDb();
const tag = `auth-${Date.now()}`;
const emailOf = (name: string) => `${name}.${tag}@test.keshav.in`;
const PASSWORD = 'Sup3r-secret pass';
const noParams = { params: Promise.resolve({}) };

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  await db.permission.upsert({
    where: { key: 'dashboard.view' },
    update: {},
    create: { key: 'dashboard.view', module: 'dashboard', action: 'view', label: 'View dashboard', sort: 1 },
  });
  await db.user.create({
    data: {
      name: 'Active Admin',
      email: emailOf('active'),
      passwordHash,
      permissions: { create: [{ permissionKey: 'dashboard.view' }] },
    },
  });
  await db.user.create({
    data: { name: 'Gone', email: emailOf('inactive'), passwordHash, isActive: false },
  });
  await db.user.create({ data: { name: 'Invited', email: emailOf('nopassword') } });
});

afterAll(async () => {
  await db.user.deleteMany({ where: { email: { endsWith: `.${tag}@test.keshav.in` } } });
  await db.$disconnect();
});

async function login(email: string, password: string) {
  const response = await loginRoute(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
      body: JSON.stringify({ email, password }),
    }),
    noParams,
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function withToken(token: string | null, method = 'GET') {
  return new Request('http://localhost/api/auth/me', {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe('POST /api/auth/login', () => {
  it('signs in and returns the token and user with permissions', async () => {
    const { status, body } = await login(emailOf('active').toUpperCase(), PASSWORD);
    expect(status).toBe(200);
    expect(typeof body.accessToken).toBe('string');
    expect(body.user).toMatchObject({
      name: 'Active Admin',
      email: emailOf('active'),
      permissions: ['dashboard.view'],
    });
    expect(typeof (body.user as { id: unknown }).id).toBe('string');
    expect(JSON.stringify(body)).not.toMatch(/argon2|passwordHash/);

    const user = await db.user.findUnique({ where: { email: emailOf('active') } });
    expect(user?.lastSignInAt).not.toBeNull();
  });

  it('gives the same 401 for a wrong password, an unknown email and a user without a password', async () => {
    const wrong = await login(emailOf('active'), 'nope-nope');
    const unknown = await login(emailOf('nobody'), PASSWORD);
    const invited = await login(emailOf('nopassword'), PASSWORD);
    for (const result of [wrong, unknown, invited]) {
      expect(result.status).toBe(401);
      expect(result.body).toEqual({ code: 'UNAUTHENTICATED', message: 'Invalid email or password.' });
    }
  });

  it('says the account is deactivated only after a correct password', async () => {
    expect((await login(emailOf('inactive'), 'wrong-password')).body.message).toBe(
      'Invalid email or password.',
    );
    const { status, body } = await login(emailOf('inactive'), PASSWORD);
    expect(status).toBe(401);
    expect(body.message).toBe('Your account has been deactivated.');
  });

  it('validates the body', async () => {
    const { status, body } = await login('not-an-email', '');
    expect(status).toBe(422);
    expect(body.errors).toEqual({
      email: ['Enter a valid email address'],
      password: ['Password is required'],
    });
  });
});

describe('GET /api/auth/me and POST /api/auth/logout', () => {
  it('returns the user for a valid token, then 401 after logout', async () => {
    const token = (await login(emailOf('active'), PASSWORD)).body.accessToken as string;

    const me = await meRoute(withToken(token), noParams);
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ email: emailOf('active'), permissions: ['dashboard.view'] });

    const out = await logoutRoute(withToken(token, 'POST'), noParams);
    expect(out.status).toBe(204);

    const after = await meRoute(withToken(token), noParams);
    expect(after.status).toBe(401);
    expect(await after.json()).toMatchObject({ message: 'Your session has expired. Please sign in again.' });
  });

  it('logs out only the device that asked', async () => {
    const phone = (await login(emailOf('active'), PASSWORD)).body.accessToken as string;
    const laptop = (await login(emailOf('active'), PASSWORD)).body.accessToken as string;
    await logoutRoute(withToken(phone, 'POST'), noParams);
    expect((await meRoute(withToken(laptop), noParams)).status).toBe(200);
  });

  it('ends existing sessions as soon as the user is deactivated', async () => {
    const token = (await login(emailOf('active'), PASSWORD)).body.accessToken as string;
    await db.user.update({ where: { email: emailOf('active') }, data: { isActive: false } });
    try {
      const response = await meRoute(withToken(token), noParams);
      expect(response.status).toBe(401);
      expect(((await response.json()) as { message: string }).message).toBe('Your account has been deactivated.');
    } finally {
      await db.user.update({ where: { email: emailOf('active') }, data: { isActive: true } });
    }
  });

  it('applies permission changes on the next request', async () => {
    const token = (await login(emailOf('active'), PASSWORD)).body.accessToken as string;
    const user = await db.user.findUniqueOrThrow({ where: { email: emailOf('active') } });
    await db.userPermission.deleteMany({ where: { userId: user.id } });
    try {
      expect(((await (await meRoute(withToken(token), noParams)).json()) as { permissions: string[] }).permissions).toEqual([]);
    } finally {
      await db.userPermission.create({ data: { userId: user.id, permissionKey: 'dashboard.view' } });
    }
  });

  it('rejects missing and forged tokens', async () => {
    expect((await meRoute(withToken(null), noParams)).status).toBe(401);
    expect((await meRoute(withToken('a.b.c'), noParams)).status).toBe(401);
  });
});
