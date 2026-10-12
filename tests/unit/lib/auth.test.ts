import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '@/lib/auth/password';
import { bearerToken, signAccessToken, verifyAccessToken } from '@/lib/auth/token';

const inOneHour = () => new Date(Date.now() + 3_600_000);

describe('passwords', () => {
  it('hashes with Argon2id and verifies', async () => {
    const hash = await hashPassword('correct horse');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, 'correct horse')).toBe(true);
    expect(await verifyPassword(hash, 'Correct horse')).toBe(false);
  });

  it('never throws on a corrupt hash', async () => {
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });

  it('always fails the dummy check', async () => {
    expect(await verifyAgainstDummy('anything')).toBe(false);
  });
});

describe('access tokens', () => {
  it('round-trips user and session ids', async () => {
    const token = await signAccessToken({ userId: 7, sessionId: 's-1' }, inOneHour());
    expect(await verifyAccessToken(token)).toEqual({ userId: 7, sessionId: 's-1' });
  });

  it('rejects expired, tampered and foreign tokens', async () => {
    const expired = await signAccessToken({ userId: 7, sessionId: 's-1' }, new Date(Date.now() - 1000));
    expect(await verifyAccessToken(expired)).toBeNull();

    const token = await signAccessToken({ userId: 7, sessionId: 's-1' }, inOneHour());
    const [header, payload, signature] = token.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), sub: '1' }),
    ).toString('base64url');
    expect(await verifyAccessToken(`${header}.${forgedPayload}.${signature}`)).toBeNull();

    const otherSecret = await new SignJWT({ sid: 's-1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('7')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('another-secret-another-secret-another-secret'));
    expect(await verifyAccessToken(otherSecret)).toBeNull();

    expect(await verifyAccessToken('garbage')).toBeNull();
  });

  it('reads the bearer header', () => {
    const request = (value?: string) =>
      new Request('http://localhost', { headers: value ? { authorization: value } : {} });
    expect(bearerToken(request('Bearer abc.def.ghi'))).toBe('abc.def.ghi');
    expect(bearerToken(request('bearer abc'))).toBe('abc');
    expect(bearerToken(request('Basic abc'))).toBeNull();
    expect(bearerToken(request())).toBeNull();
  });
});
