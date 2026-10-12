import { beforeEach, describe, expect, it, vi } from 'vitest';

const reachable = vi.fn<() => Promise<boolean>>();
vi.mock('@/lib/db', () => ({ isDatabaseReachable: () => reachable() }));
vi.mock('@/config/env', () => ({ env: () => ({}) }));

const { GET } = await import('@/app/api/health/route');

describe('GET /api/health', () => {
  beforeEach(() => reachable.mockReset());

  it('returns 200 ok, uncached, when the database answers', async () => {
    reachable.mockResolvedValue(true);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('returns 503 without details when the database is down', async () => {
    reachable.mockResolvedValue(false);
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable' });
  });
});
