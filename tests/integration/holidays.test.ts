import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as listRoute, POST as createRoute } from '@/app/api/holidays/route';
import { DELETE as deleteRoute, GET as getRoute, PATCH as updateRoute } from '@/app/api/holidays/[id]/route';
import { apiRequest, createSignedInUser, noParams, seedTestPermissions, testDb, withParams } from './setup';

/**
 * Holidays end to end. Each run uses its own far-future year so it never
 * clashes with earlier runs (deleted holidays stay as history).
 */

const db = testDb();
const tag = `hol-${Date.now()}`;
const year = 3000 + (Date.now() % 5000);
const day = (mmdd: string) => `${year}-${mmdd}`;
const tokens = { admin: '', viewer: '' };
type Json = Record<string, unknown>;

beforeAll(async () => {
  await seedTestPermissions(db);
  tokens.admin = (
    await createSignedInUser(db, tag, 'admin', ['holiday.view', 'holiday.create', 'holiday.edit', 'holiday.delete'])
  ).token;
  tokens.viewer = (await createSignedInUser(db, tag, 'viewer', ['holiday.view'])).token;
});

afterAll(async () => {
  await db.$disconnect();
});

async function call(
  handler: (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>,
  path: string,
  init: { method?: string; body?: unknown; params?: Record<string, string>; token?: string } = {},
) {
  const response = await handler(
    apiRequest(path, init.token ?? tokens.admin, init),
    init.params ? withParams(init.params) : noParams,
  );
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as Json };
}

const add = (body: unknown, token?: string) => call(createRoute, '/holidays', { method: 'POST', body, token });
const list = (query: string) => call(listRoute, `/holidays?${query}`, { token: tokens.viewer });

describe('holidays', () => {
  let diwali = '';

  it('adds holidays and lists them by date for a year', async () => {
    const created = await add({ date: day('11-09'), name: 'Diwali', description: 'Office closed' });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ id: expect.any(String), date: day('11-09'), name: 'Diwali', description: 'Office closed' });
    diwali = created.body.id as string;

    await add({ date: day('08-15'), name: 'Independence Day', description: null });
    await add({ date: day('10-02'), name: 'Gandhi Jayanti' });

    const { status, body } = await list(`year=${year}`);
    expect(status).toBe(200);
    const rows = body as unknown as Json[];
    expect(rows.map((h) => h.name)).toEqual(['Independence Day', 'Gandhi Jayanti', 'Diwali']);
    expect(Object.keys(rows[0]!).sort()).toEqual(
      Object.keys((JSON.parse(readFileSync(new URL('../contract/fixtures/holidays.list.response.json', import.meta.url), 'utf8')) as Json[])[0]!).sort(),
    );
  });

  it('searches by name, case-insensitively', async () => {
    const rows = (await list(`year=${year}&search=GANDHI`)).body as unknown as Json[];
    expect(rows.map((h) => h.name)).toEqual(['Gandhi Jayanti']);
  });

  it('allows one holiday per date, naming the one already there', async () => {
    const { status, body } = await add({ date: day('11-09'), name: 'Something else' });
    expect(status).toBe(409);
    expect(body.errors).toEqual({ date: ['Diwali is already on this date'] });
  });

  it('edits a holiday and records the change', async () => {
    const { status, body } = await call(updateRoute, `/holidays/${diwali}`, {
      method: 'PATCH',
      params: { id: diwali },
      body: { date: day('11-10'), name: 'Diwali', description: 'Office closed' },
    });
    expect(status).toBe(200);
    expect(body.date).toBe(day('11-10'));
    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityType: 'holiday', entityId: diwali, action: 'holiday.update' },
    });
    expect(audit.changes).toEqual([{ field: 'date', label: 'Date', before: day('11-09'), after: day('11-10') }]);
  });

  it('deletes (204), hides it, and frees the date', async () => {
    const removed = await call(deleteRoute, `/holidays/${diwali}`, { method: 'DELETE', params: { id: diwali } });
    expect(removed.status).toBe(204);
    expect((await call(getRoute, `/holidays/${diwali}`, { params: { id: diwali } })).status).toBe(404);
    expect(((await list(`year=${year}`)).body as unknown as Json[]).map((h) => h.name)).not.toContain('Diwali');
    expect((await add({ date: day('11-10'), name: 'Diwali (moved)' })).status).toBe(201);

    const row = await db.companyHoliday.findUniqueOrThrow({ where: { id: Number(diwali) } });
    expect(row.deletedAt).not.toBeNull();
  });

  it('validates the body', async () => {
    const { status, body } = await add({ date: `${year}-02-30`, name: ' ' });
    expect(status).toBe(422);
    expect(body.errors).toEqual({
      date: ['Use a date in the form YYYY-MM-DD'],
      name: ['Holiday name is required'],
    });
  });

  it('checks each permission', async () => {
    expect((await add({ date: day('01-26'), name: 'Republic Day' }, tokens.viewer)).status).toBe(403);
    const someId = ((await list(`year=${year}`)).body as unknown as Json[])[0]!.id as string;
    const del = await call(deleteRoute, `/holidays/${someId}`, { method: 'DELETE', params: { id: someId }, token: tokens.viewer });
    expect(del.status).toBe(403);
    expect(del.body.message).toBe('You do not have permission to delete holidays.');
  });

  it('rejects a bad year filter', async () => {
    const { status, body } = await list('year=20');
    expect(status).toBe(422);
    expect(body.errors).toEqual({ year: ['Use a year such as 2026'] });
  });
});
