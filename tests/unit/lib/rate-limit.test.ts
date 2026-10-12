import { describe, expect, it } from 'vitest';
import { clientAddress, createLimiter } from '@/lib/rate-limit';

describe('createLimiter', () => {
  const t0 = 1_000_000;

  it('allows up to max events per window, then reports the wait', () => {
    const limiter = createLimiter({ max: 3, windowMs: 60_000 });
    expect([1, 2, 3].map(() => limiter.record('k', t0))).toEqual([null, null, null]);
    expect(limiter.blockedFor('k', t0 + 1_000)).toBe(59);
    expect(limiter.record('k', t0 + 1_000)).toBe(59);
  });

  it('starts a fresh window once the old one ends', () => {
    const limiter = createLimiter({ max: 1, windowMs: 60_000 });
    limiter.record('k', t0);
    expect(limiter.blockedFor('k', t0 + 59_999)).toBe(1);
    expect(limiter.blockedFor('k', t0 + 60_000)).toBeNull();
    expect(limiter.record('k', t0 + 60_000)).toBeNull();
  });

  it('keeps keys apart and can clear one', () => {
    const limiter = createLimiter({ max: 1, windowMs: 60_000 });
    limiter.record('a', t0);
    expect(limiter.blockedFor('a', t0)).not.toBeNull();
    expect(limiter.blockedFor('b', t0)).toBeNull();
    limiter.clear('a');
    expect(limiter.blockedFor('a', t0)).toBeNull();
  });
});

describe('clientAddress', () => {
  it('uses the first forwarded hop, then X-Real-IP', () => {
    const req = (headers: Record<string, string>) => new Request('http://x', { headers });
    expect(clientAddress(req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
    expect(clientAddress(req({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2');
    expect(clientAddress(req({}))).toBe('unknown');
  });
});
