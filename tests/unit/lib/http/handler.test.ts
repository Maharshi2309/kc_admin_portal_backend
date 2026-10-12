import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/lib/logger', () => {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => log };
  return { logger: () => log };
});

const { route, ok, readJson, readQuery, paginationQuery } = await import('@/lib/http');
const { ConflictError, ForbiddenError, RateLimitError, ValidationError } = await import(
  '@/lib/errors'
);

const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
const get = (url = 'http://localhost/api/x') => new Request(url);
const post = (body: string, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/x', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', ...headers },
  });

async function call(handler: Parameters<typeof route>[0], request = get()) {
  const response = await route(handler)(request, ctx({ id: '7' }));
  const text = await response.text();
  return { response, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

describe('route()', () => {
  it('passes params and returns the handler response with a request id', async () => {
    const { response, body } = await call(async ({ params }) => ok({ id: params.id }));
    expect(response.status).toBe(200);
    expect(body).toEqual({ id: '7' });
    expect(response.headers.get('x-request-id')).toMatch(/[0-9a-f-]{36}/);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('keeps a request id sent by a proxy', async () => {
    const request = new Request('http://localhost/api/x', { headers: { 'x-request-id': 'abc' } });
    const { response } = await call(async () => ok({}), request);
    expect(response.headers.get('x-request-id')).toBe('abc');
  });

  it('turns a validation error into 422 with field errors', async () => {
    const { response, body } = await call(async () => {
      throw ValidationError.field('ecNumber', 'Use KC followed by numbers, e.g. KC1001');
    });
    expect(response.status).toBe(422);
    expect(body).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Use KC followed by numbers, e.g. KC1001',
      errors: { ecNumber: ['Use KC followed by numbers, e.g. KC1001'] },
    });
  });

  it('keeps the codes the app acts on', async () => {
    const forbidden = await call(async () => {
      throw new ForbiddenError('You do not have permission to edit employees.');
    });
    expect(forbidden.response.status).toBe(403);
    expect(forbidden.body).toEqual({
      code: 'PERMISSION_DENIED',
      message: 'You do not have permission to edit employees.',
    });

    const conflict = await call(async () => {
      throw new ConflictError('Only pending leave can be edited.', 'LEAVE_NOT_EDITABLE');
    });
    expect(conflict.response.status).toBe(409);
    expect(conflict.body).toEqual({
      code: 'LEAVE_NOT_EDITABLE',
      message: 'Only pending leave can be edited.',
    });
  });

  it('adds Retry-After to rate-limit errors', async () => {
    const { response } = await call(async () => {
      throw new RateLimitError(undefined, 60);
    });
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
  });

  it('hides unexpected errors behind a generic 500', async () => {
    const { response, body } = await call(async () => {
      throw new Error('relation "employees" does not exist at /srv/app/db.ts:12');
    });
    expect(response.status).toBe(500);
    expect(body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
    });
  });
});

describe('readJson()', () => {
  const schema = z.object({
    name: z.string().min(1, 'Enter a name'),
    schedule: z.object({ startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:mm') }),
  });

  it('returns the parsed body', async () => {
    const { body } = await call(
      async ({ request }) => ok(await readJson(request, schema)),
      post('{"name":"Asha","schedule":{"startTime":"09:30"}}'),
    );
    expect(body).toEqual({ name: 'Asha', schedule: { startTime: '09:30' } });
  });

  it('rejects malformed JSON with 400', async () => {
    const { response, body } = await call(
      async ({ request }) => ok(await readJson(request, schema)),
      post('{"name":'),
    );
    expect(response.status).toBe(400);
    expect(body?.message).toBe('The request body is not valid JSON.');
  });

  it('reports nested field errors with dotted keys', async () => {
    const { response, body } = await call(
      async ({ request }) => ok(await readJson(request, schema)),
      post('{"name":"","schedule":{"startTime":"9"}}'),
    );
    expect(response.status).toBe(422);
    expect(body?.errors).toEqual({
      name: ['Enter a name'],
      'schedule.startTime': ['Use HH:mm'],
    });
    expect(body?.message).toBe('Enter a name');
  });

  it('rejects bodies over the size limit with 413', async () => {
    const big = JSON.stringify({ name: 'x'.repeat(200 * 1024) });
    const { response } = await call(
      async ({ request }) => ok(await readJson(request, schema)),
      post(big),
    );
    expect(response.status).toBe(413);
  });
});

describe('readQuery() with paginationQuery()', () => {
  const handler = async ({ request }: { request: Request }) =>
    ok(readQuery(request, paginationQuery()));

  it('defaults to page 1 of 10', async () => {
    const { body } = await call(handler, get());
    expect(body).toEqual({ page: 1, pageSize: 10, skip: 0, take: 10 });
  });

  it('computes skip from page and pageSize', async () => {
    const { body } = await call(handler, get('http://localhost/api/x?page=3&pageSize=20'));
    expect(body).toEqual({ page: 3, pageSize: 20, skip: 40, take: 20 });
  });

  it('rejects a page size above the maximum and a page below 1', async () => {
    const { response, body } = await call(handler, get('http://localhost/api/x?page=0&pageSize=500'));
    expect(response.status).toBe(422);
    expect(body?.errors).toEqual({ page: ['Must be 1 or more'], pageSize: ['Must be at most 100'] });
  });
});
