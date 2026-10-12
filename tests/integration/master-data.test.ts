import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as departmentsRoute, POST as addDepartmentRoute } from '@/app/api/departments/route';
import { GET as leaveTypesRoute } from '@/app/api/leave-types/route';
import { GET as positionsRoute, POST as addPositionRoute } from '@/app/api/positions/route';
import { apiRequest, createSignedInUser, noParams, seedTestPermissions, testDb } from './setup';

const db = testDb();
const tag = `master${Date.now()}`;
let plainToken = '';
let employeeViewerToken = '';
let adminToken = '';
let leaveViewerToken = '';

beforeAll(async () => {
  await seedTestPermissions(db);
  plainToken = (await createSignedInUser(db, tag, 'plain', [])).token;
  employeeViewerToken = (await createSignedInUser(db, tag, 'empviewer', ['employee.view'])).token;
  adminToken = (await createSignedInUser(db, tag, 'admin', ['permission.manage'])).token;
  leaveViewerToken = (await createSignedInUser(db, tag, 'leaves', ['leave.view'])).token;
});

afterAll(async () => {
  await db.department.deleteMany({ where: { code: { endsWith: tag } } });
  await db.position.deleteMany({ where: { code: { endsWith: tag } } });
  await db.user.deleteMany({ where: { email: { endsWith: `.${tag}@test.keshav.in` } } });
  await db.$disconnect();
});

type Entry = { id: string; code: string; name: string; employeeCount: number };

describe('GET /api/departments and /api/positions', () => {
  it('start with Accountant, Graphic Designer and Tailor', async () => {
    for (const route of [departmentsRoute, positionsRoute]) {
      const response = await route(apiRequest('/departments', employeeViewerToken), noParams);
      expect(response.status).toBe(200);
      const body = (await response.json()) as Entry[];
      expect(body.map((e) => e.code)).toEqual(expect.arrayContaining(['accountant', 'graphic_designer', 'tailor']));
      expect(Object.keys(body[0]!).sort()).toEqual(['code', 'employeeCount', 'id', 'name']);
    }
  });

  it('need an employee permission (403 PERMISSION_DENIED otherwise)', async () => {
    for (const route of [departmentsRoute, positionsRoute]) {
      const response = await route(apiRequest('/departments', plainToken), noParams);
      expect(response.status).toBe(403);
      expect(((await response.json()) as { code: string }).code).toBe('PERMISSION_DENIED');
    }
  });

  it('need a session', async () => {
    expect((await departmentsRoute(apiRequest('/departments', null), noParams)).status).toBe(401);
    expect((await positionsRoute(apiRequest('/positions', null), noParams)).status).toBe(401);
  });
});

describe('POST /api/departments and /api/positions', () => {
  it('need permission.manage', async () => {
    const response = await addDepartmentRoute(
      apiRequest('/departments', plainToken, { method: 'POST', body: { name: 'Sales' } }),
      noParams,
    );
    expect(response.status).toBe(403);
  });

  it('add an entry, making the code from the name', async () => {
    const response = await addDepartmentRoute(
      apiRequest('/departments', adminToken, { method: 'POST', body: { name: `Store Keeper ${tag}` } }),
      noParams,
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ code: `store_keeper_${tag}`, name: `Store Keeper ${tag}`, employeeCount: 0 });

    const position = await addPositionRoute(
      apiRequest('/positions', adminToken, { method: 'POST', body: { name: `Cutter ${tag}`, code: `cutter_${tag}` } }),
      noParams,
    );
    expect(position.status).toBe(201);
    expect(await position.json()).toMatchObject({ code: `cutter_${tag}` });
  });

  it('refuse a duplicate code with 409', async () => {
    const response = await addPositionRoute(
      apiRequest('/positions', adminToken, { method: 'POST', body: { name: `Other ${tag}`, code: `cutter_${tag}` } }),
      noParams,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ errors: { code: ['A position with this code already exists.'] } });
  });

  it('refuse a malformed code', async () => {
    const response = await addPositionRoute(
      apiRequest('/positions', adminToken, { method: 'POST', body: { name: 'X', code: 'Not A Code' } }),
      noParams,
    );
    expect(response.status).toBe(422);
  });
});

describe('GET /api/leave-types', () => {
  it('needs leave.view', async () => {
    const response = await leaveTypesRoute(apiRequest('/leave-types', plainToken), noParams);
    expect(response.status).toBe(403);
    expect(((await response.json()) as { message: string }).message).toBe(
      'You do not have permission to view leave.',
    );
  });

  it('lists only Casual and Unpaid, with hasBalance and isPaid', async () => {
    const response = await leaveTypesRoute(apiRequest('/leave-types', leaveViewerToken), noParams);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { id: 'casual', name: 'Casual', hasBalance: true, isPaid: true },
      { id: 'unpaid', name: 'Unpaid', hasBalance: false, isPaid: false },
    ]);
  });
});
