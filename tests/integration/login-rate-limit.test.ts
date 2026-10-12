import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { hashPassword } from '@/lib/auth/password';
import { noParams, testDb } from './setup';

/** Sign-in throttling: 5 failed attempts per email and address per 15 minutes (proposed default). */

const db = testDb();
const tag = `rl-${Date.now()}`;
const email = `limited.${tag}@test.keshav.in`;
const PASSWORD = 'Right-password 1';

beforeAll(async () => {
  await db.user.create({ data: { name: 'Limited', email, passwordHash: await hashPassword(PASSWORD) } });
});
afterAll(async () => {
  await db.$disconnect();
});

const login = async (password: string, ip = '203.0.113.9', who = email) => {
  const response = await loginRoute(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ email: who, password }),
    }),
    noParams,
  );
  return { status: response.status, retryAfter: response.headers.get('retry-after'), body: (await response.json()) as Record<string, unknown> };
};

describe('login rate limiting', () => {
  it('pauses sign-in after 5 wrong passwords, even with the right one', async () => {
    for (let i = 0; i < 5; i += 1) expect((await login('wrong')).status).toBe(401);
    const blocked = await login(PASSWORD);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ code: 'RATE_LIMITED', message: 'Too many failed sign-ins. Try again in 15 minutes.' });
    expect(Number(blocked.retryAfter)).toBeGreaterThan(800);
  });

  it('only pauses that email from that address', async () => {
    expect((await login(PASSWORD, '198.51.100.20')).status).toBe(200);
  });

  it('clears the count after a successful sign-in', async () => {
    const ip = '192.0.2.44';
    for (let i = 0; i < 4; i += 1) await login('wrong', ip);
    expect((await login(PASSWORD, ip)).status).toBe(200);
    for (let i = 0; i < 4; i += 1) expect((await login('wrong', ip)).status).toBe(401);
  });
});
