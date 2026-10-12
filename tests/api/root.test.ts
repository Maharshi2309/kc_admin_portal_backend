import { describe, expect, it } from 'vitest';
import { GET, HEAD } from '@/app/route';

describe('GET / (site root)', () => {
  it('answers 200 for hosting health checks', async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      service: 'Keshav Admin Portal API',
      version: '0.4.0',
      health: '/api/health',
      docs: '/api/swagger',
    });
    expect(HEAD().status).toBe(200);
  });
});
