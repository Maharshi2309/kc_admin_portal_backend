import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as listRoute, POST as createRoute } from '@/app/api/employees/route';
import { GET as nextEcRoute } from '@/app/api/employees/next-ec-number/route';
import { GET as getRoute, PATCH as updateRoute } from '@/app/api/employees/[id]/route';
import { PATCH as statusRoute } from '@/app/api/employees/[id]/status/route';
import { GET as schedulesRoute, POST as addScheduleRoute } from '@/app/api/employees/[id]/schedules/route';
import { apiRequest, createSignedInUser, noParams, seedTestPermissions, testDb, withParams } from './setup';

/**
 * Employees and schedules end to end, against the test database. Employees
 * can't be deleted (their audit history must survive), so each run uses its
 * own department and EC numbers and leaves its rows behind.
 */

const db = testDb();
const tag = `emp-${Date.now()}`;
const run = String(Date.now()).slice(-7);
const ec = (n: number) => `KC9${run}${String(n).padStart(2, '0')}`;
const tokens = { admin: '', viewer: '', editor: '' };
// Department and position codes of this run.
const deptA = `stitching_${run}`;
const deptB = `sales_${run}`;
const tailor = 'tailor';
const cutter = `cutter_${run}`;
const salesman = `salesman_${run}`;

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../contract/fixtures/${name}`, import.meta.url), 'utf8')) as Record<
    string,
    unknown
  >;

const schedule = {
  startTime: '09:00',
  endTime: '17:30',
  breakMinutes: 60,
  breakStart: '13:00',
  breakEnd: '14:00',
  weeklyOffDays: [7],
};

const newEmployee = (n: number, overrides: Record<string, unknown> = {}) => ({
  ecNumber: ec(n),
  name: `Test Person ${n} ${tag}`,
  mobile: '9876543210',
  department: deptA,
  position: tailor,
  joiningDate: '2020-01-06',
  status: 'active',
  schedule: { effectiveFrom: '2020-01-06', ...schedule },
  ...overrides,
});

type Json = Record<string, unknown>;

async function call(
  handler: (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>,
  token: string,
  path: string,
  init: { method?: string; body?: unknown; params?: Record<string, string> } = {},
) {
  const response = await handler(apiRequest(path, token, init), init.params ? withParams(init.params) : noParams);
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as Json };
}

const create = (body: unknown, token = tokens.admin) => call(createRoute, token, '/employees', { method: 'POST', body });

beforeAll(async () => {
  await seedTestPermissions(db);
  tokens.admin = (
    await createSignedInUser(db, tag, 'admin', [
      'employee.view',
      'employee.create',
      'employee.edit',
      'employee.deactivate',
      'schedule.edit',
    ])
  ).token;
  tokens.viewer = (await createSignedInUser(db, tag, 'viewer', ['employee.view'])).token;
  tokens.editor = (await createSignedInUser(db, tag, 'editor', ['employee.view', 'employee.edit'])).token;

  await db.department.createMany({
    data: [
      { code: deptA, name: `Stitching ${tag}` },
      { code: deptB, name: `Sales ${tag}` },
    ],
  });
  await db.position.createMany({
    data: [
      { code: cutter, name: `Cutter ${tag}` },
      { code: salesman, name: `Salesman ${tag}` },
    ],
  });
});

afterAll(async () => {
  await db.$disconnect();
});

describe('POST /api/employees', () => {
  it('creates the employee with a first schedule from the joining date', async () => {
    const { status, body } = await create(newEmployee(1));
    expect(status).toBe(201);
    expect(body).toMatchObject({
      ecNumber: ec(1),
      department: deptA,
      position: 'tailor',
      joiningDate: '2020-01-06',
      status: 'active',
      updatedBy: 'admin',
      schedule: {
        effectiveFrom: '2020-01-06',
        effectiveTo: null,
        startTime: '09:00',
        endTime: '17:30',
        breakMinutes: 60,
        breakStart: '13:00',
        breakEnd: '14:00',
        weeklyOffDays: [7],
        expectedMinutes: 450,
        createdBy: { name: 'admin' },
      },
    });
    expect(body.updatedAt).toMatch(/\+05:30$/);
    expect(body).not.toHaveProperty('email');

    // Same keys as the app's example (todayStatus arrives with attendance;
    // overtimeMinutesThisYear comes with GET).
    const expected = Object.keys(fixture('employees.get.response.json')).filter(
      (k) => k !== 'todayStatus' && k !== 'overtimeMinutesThisYear',
    );
    expect(Object.keys(body).sort()).toEqual(expected.sort());

    const audit = await db.auditLog.findMany({ where: { employeeId: Number(body.id) }, orderBy: { id: 'asc' } });
    expect(audit.map((a) => a.action)).toEqual(['schedule.create', 'employee.create']);
  });

  it('accepts the app example request as-is (shape check)', async () => {
    const example = fixture('employees.create.request.json');
    const { status, body } = await create({ ...example, ecNumber: ec(2) });
    expect(status).toBe(201);
    expect(body).toMatchObject({ department: 'graphic_designer', position: 'graphic_designer' });
  });

  it('ignores an email sent by an older app', async () => {
    const { status, body } = await create(newEmployee(4, { email: `old.app.${tag}@test.keshav.in` }));
    expect(status).toBe(201);
    expect(body).not.toHaveProperty('email');
  });

  it('requires a schedule and reports its problems with schedule.* keys', async () => {
    const { schedule: _omit, ...withoutSchedule } = newEmployee(3);
    const missing = await create(withoutSchedule);
    expect(missing.status).toBe(422);
    expect(missing.body.errors).toEqual({ schedule: ['Set the working schedule'] });

    const bad = await create(
      newEmployee(3, {
        schedule: { ...schedule, effectiveFrom: '2020-01-06', endTime: '08:00', breakStart: '13:00', breakEnd: null },
      }),
    );
    expect(bad.status).toBe(422);
    expect(bad.body.errors).toMatchObject({
      'schedule.endTime': ['End time must be after the start time'],
      'schedule.breakStart': ['The break must end on the same day'],
    });

    const wrongStart = await create(newEmployee(3, { schedule: { ...schedule, effectiveFrom: '2020-02-01' } }));
    expect(wrongStart.body.errors).toEqual({
      'schedule.effectiveFrom': ['The first schedule starts on the joining date'],
    });
  });

  it('validates fields like the app', async () => {
    const { status, body } = await create(
      newEmployee(3, { ecNumber: 'kc12', mobile: '+91 98765', name: ' ', department: 'Graphic Designer' }),
    );
    expect(status).toBe(422);
    expect(body.errors).toMatchObject({
      ecNumber: ['Use KC followed by numbers, e.g. KC1001'],
      mobile: ['Enter a 10-digit mobile number'],
      name: ['Full name is required'],
      department: ['Choose a department'],
    });
  });

  it('rejects a department or position that is not on the lists', async () => {
    const { status, body } = await create(newEmployee(3, { department: 'astronaut', position: 'pilot' }));
    expect(status).toBe(422);
    expect(body.errors).toEqual({ department: ['Choose a department'], position: ['Choose a position'] });
  });

  it('reports a taken EC number (409)', async () => {
    const { status, body } = await create(newEmployee(3, { ecNumber: ec(1) }));
    expect(status).toBe(409);
    expect(body).toMatchObject({ code: 'DUPLICATE', errors: { ecNumber: ['This EC number is already in use'] } });
  });

  it('needs employee.create', async () => {
    const { status, body } = await create(newEmployee(3), tokens.viewer);
    expect(status).toBe(403);
    expect(body.message).toBe('You do not have permission to add employees.');
  });
});

describe('GET /api/employees', () => {
  beforeAll(async () => {
    await create(newEmployee(10, { name: `Aarav ${tag}`, joiningDate: '2021-03-01', schedule: { ...schedule, effectiveFrom: '2021-03-01' } }));
    await create(
      newEmployee(11, {
        name: `Bhavna ${tag}`,
        department: deptB,
        position: salesman,
        joiningDate: '2022-07-15',
        schedule: { ...schedule, effectiveFrom: '2022-07-15' },
      }),
    );
    await create(
      newEmployee(12, {
        name: `Chirag ${tag}`,
        status: 'inactive',
        position: cutter,
        joiningDate: '2023-01-10',
        schedule: { ...schedule, effectiveFrom: '2023-01-10' },
      }),
    );
  });

  const list = (query: string) => call(listRoute, tokens.viewer, `/employees?${query}`);
  const names = (body: Json) => (body.items as { name: string }[]).map((e) => e.name);

  it('searches name or EC number, case-insensitively, sorted by name', async () => {
    const byName = await list(`search=${encodeURIComponent(tag.toUpperCase())}&pageSize=100`);
    expect(byName.status).toBe(200);
    expect(names(byName.body).slice(0, 2)).toEqual([`Aarav ${tag}`, `Bhavna ${tag}`]);

    const byEc = await list(`search=${ec(11).toLowerCase()}`);
    expect(names(byEc.body)).toEqual([`Bhavna ${tag}`]);
  });

  it('filters by department, position, status and joining range', async () => {
    const q = `search=${tag}&pageSize=100`;
    expect(names((await list(`${q}&department=${deptB}`)).body)).toEqual([`Bhavna ${tag}`]);
    expect(names((await list(`${q}&position=${cutter}&status=inactive`)).body)).toEqual([`Chirag ${tag}`]);
    expect(names((await list(`${q}&joinedFrom=2021-01-01&joinedTo=2022-12-31`)).body)).toEqual([
      `Aarav ${tag}`,
      `Bhavna ${tag}`,
    ]);
  });

  it('returns counts that ignore the status filter', async () => {
    const { body } = await list(`search=${tag}&status=inactive`);
    expect(body.total).toBe(1);
    // Persons 1 and 4, Aarav and Bhavna are active; Chirag is inactive. (Person 2 is named Rahul Sharma.)
    expect(body.counts).toEqual({ active: 4, inactive: 1 });
  });

  it('pages results and returns the app list shape', async () => {
    const { body } = await list(`search=${tag}&page=2&pageSize=2`);
    expect(body).toMatchObject({ page: 2, pageSize: 2, total: 5 });
    expect(body.items).toHaveLength(2);
    expect(Object.keys(body).sort()).toEqual(Object.keys(fixture('employees.list.response.json')).sort());
  });

  it("sends this year's overtime only to callers with overtime.view", async () => {
    const { body } = await list(`search=${tag}&pageSize=1`);
    expect((body.items as Json[])[0]!.overtimeMinutesThisYear).toBeNull();
    const withOvertime = (await createSignedInUser(db, tag, 'overtime', ['employee.view', 'overtime.view'])).token;
    const { body: seen } = await call(listRoute, withOvertime, `/employees?search=${tag}&pageSize=1`);
    expect((seen.items as Json[])[0]!.overtimeMinutesThisYear).toBe(0);
  });

  it('rejects bad filters with field errors', async () => {
    const { status, body } = await list('joinedFrom=2023-01-01&joinedTo=2022-01-01&status=gone');
    expect(status).toBe(422);
    expect(body.errors).toMatchObject({
      status: ['Choose active or inactive'],
    });
    const range = await list('joinedFrom=2023-01-01&joinedTo=2022-01-01');
    expect(range.body.errors).toEqual({ joinedTo: ['Must be on or after the start date'] });
  });
});

describe('GET /api/employees/next-ec-number', () => {
  it('suggests the highest number + 1', async () => {
    const rows = await db.$queryRaw<{ highest: bigint | number | string }[]>`
      SELECT MAX(CAST(SUBSTRING(ec_number, 3) AS UNSIGNED)) AS highest FROM employees`;
    const { status, body } = await call(nextEcRoute, tokens.viewer, '/employees/next-ec-number');
    expect(status).toBe(200);
    expect(body).toEqual({ ecNumber: `KC${BigInt(rows[0]!.highest) + 1n}` });
  });
});

describe('GET / PATCH /api/employees/{id}', () => {
  let id = '';
  beforeAll(async () => {
    id = String((await create(newEmployee(20, { name: `Editable ${tag}` }))).body.id);
  });

  const update = (body: unknown, token = tokens.admin) =>
    call(updateRoute, token, `/employees/${id}`, { method: 'PATCH', body, params: { id } });
  const current = async () => (await call(getRoute, tokens.viewer, `/employees/${id}`, { params: { id } })).body;
  const formOf = (e: Json) => ({
    ecNumber: e.ecNumber,
    name: e.name,
    mobile: e.mobile,
    department: e.department,
    position: e.position,
    joiningDate: e.joiningDate,
    status: e.status,
  });

  it('returns 404 for unknown and malformed ids', async () => {
    for (const bad of ['2000000000', 'abc']) {
      const { status, body } = await call(getRoute, tokens.viewer, `/employees/${bad}`, { params: { id: bad } });
      expect(status).toBe(404);
      expect(body.message).toBe('This employee could not be found.');
    }
  });

  it('saves edits and records what changed', async () => {
    const before = await current();
    const { status, body } = await update({ ...formOf(before), mobile: '9000000001', position: cutter });
    expect(status).toBe(200);
    expect(body).toMatchObject({ mobile: '9000000001', position: cutter });

    const audit = await db.auditLog.findFirstOrThrow({
      where: { employeeId: Number(id), action: 'employee.update' },
      orderBy: { id: 'desc' },
    });
    expect(audit.changes).toEqual([
      { field: 'mobile', label: 'Mobile number', before: '9876543210', after: '9000000001' },
      { field: 'position', label: 'Position', before: 'tailor', after: cutter },
    ]);
  });

  it('writes nothing when nothing changed', async () => {
    const before = await current();
    const count = await db.auditLog.count({ where: { employeeId: Number(id) } });
    expect((await update(formOf(before))).status).toBe(200);
    expect(await db.auditLog.count({ where: { employeeId: Number(id) } })).toBe(count);
  });

  it('needs employee.deactivate to change status through the edit form (I-01)', async () => {
    const before = await current();
    const denied = await update({ ...formOf(before), status: 'inactive' }, tokens.editor);
    expect(denied.status).toBe(403);
    expect(denied.body.message).toBe('You do not have permission to deactivate employees.');

    // Same status is fine for an editor.
    expect((await update({ ...formOf(before), name: `Edited ${tag}` }, tokens.editor)).status).toBe(200);
  });

  it('moves the first schedule with the joining date', async () => {
    const before = await current();
    const { body } = await update({ ...formOf(before), joiningDate: '2019-11-04' });
    expect(body.joiningDate).toBe('2019-11-04');
    expect((body.schedule as Json).effectiveFrom).toBe('2019-11-04');
  });

  it('rejects an EC number used by someone else', async () => {
    const before = await current();
    const { status, body } = await update({ ...formOf(before), ecNumber: ec(1) });
    expect(status).toBe(409);
    expect(body.errors).toEqual({ ecNumber: ['This EC number is already in use'] });
  });
});

describe('PATCH /api/employees/{id}/status', () => {
  let id = '';
  beforeAll(async () => {
    id = String((await create(newEmployee(30))).body.id);
  });
  const setStatus = (status: string, token = tokens.admin) =>
    call(statusRoute, token, `/employees/${id}/status`, { method: 'PATCH', body: { status }, params: { id } });

  it('deactivates and reactivates, recording each change once', async () => {
    expect((await setStatus('inactive')).body.status).toBe('inactive');
    expect((await setStatus('inactive')).status).toBe(200); // no-op
    expect((await setStatus('active')).body.status).toBe('active');
    const audit = await db.auditLog.findMany({
      where: { employeeId: Number(id), action: 'employee.status' },
      orderBy: { id: 'asc' },
    });
    expect(audit.map((a) => a.summary)).toEqual(['Deactivated employee', 'Reactivated employee']);
  });

  it('needs employee.deactivate and a valid status', async () => {
    expect((await setStatus('inactive', tokens.editor)).status).toBe(403);
    const bad = await setStatus('deleted');
    expect(bad.status).toBe(422);
    expect(bad.body.errors).toEqual({ status: ['Choose active or inactive'] });
  });
});

describe('/api/employees/{id}/schedules', () => {
  let id = '';
  beforeAll(async () => {
    id = String((await create(newEmployee(40, { joiningDate: '2024-01-01', schedule: { ...schedule, effectiveFrom: '2024-01-01' } }))).body.id);
  });
  const add = (body: unknown, token = tokens.admin) =>
    call(addScheduleRoute, token, `/employees/${id}/schedules`, { method: 'POST', body, params: { id } });
  const versions = async () =>
    (await call(schedulesRoute, tokens.viewer, `/employees/${id}/schedules`, { params: { id } })).body as unknown as Json[];

  it('adds a version and closes the previous one the day before', async () => {
    const { status, body } = await add({ ...schedule, effectiveFrom: '2025-04-01', startTime: '10:00', endTime: '18:30' });
    expect(status).toBe(201);
    expect(body).toMatchObject({ effectiveFrom: '2025-04-01', effectiveTo: null, expectedMinutes: 450 });

    const list = await versions();
    expect(list.map((v) => [v.effectiveFrom, v.effectiveTo])).toEqual([
      ['2025-04-01', null],
      ['2024-01-01', '2025-03-31'],
    ]);
    expect(Object.keys(list[0]!).sort()).toEqual(
      Object.keys((fixture('employees.schedules.response.json') as unknown as Json[])[0]!).sort(),
    );
  });

  it('fits a version between two others', async () => {
    await add({ ...schedule, effectiveFrom: '2024-09-01', breakMinutes: 30, breakStart: null, breakEnd: null });
    expect((await versions()).map((v) => [v.effectiveFrom, v.effectiveTo, v.expectedMinutes])).toEqual([
      ['2025-04-01', null, 450],
      ['2024-09-01', '2025-03-31', 480],
      ['2024-01-01', '2024-08-31', 450],
    ]);
  });

  it('refuses a second version on the same day (409 SCHEDULE_OVERLAP)', async () => {
    const { status, body } = await add({ ...schedule, effectiveFrom: '2025-04-01' });
    expect(status).toBe(409);
    expect(body).toEqual({
      code: 'SCHEDULE_OVERLAP',
      message: 'A schedule already starts on this date.',
      errors: { effectiveFrom: ['A schedule already starts on this date'] },
    });
  });

  it('refuses a start before the joining date', async () => {
    const { status, body } = await add({ ...schedule, effectiveFrom: '2023-12-31' });
    expect(status).toBe(422);
    expect(body.errors).toEqual({
      effectiveFrom: ["The schedule can't start before the joining date (2024-01-01)."],
    });
  });

  it('reports schedule problems without a prefix', async () => {
    const { status, body } = await add({
      ...schedule,
      effectiveFrom: '2026-01-01',
      breakStart: '12:00',
      breakEnd: '12:30',
      weeklyOffDays: [1, 2, 3, 4, 5, 6, 7],
    });
    expect(status).toBe(422);
    expect(body.errors).toEqual({
      breakStart: ['The break window must match the break length'],
      weeklyOffDays: ['Leave at least one working day in the week'],
    });
  });

  it('needs schedule.edit', async () => {
    const { status, body } = await add({ ...schedule, effectiveFrom: '2026-01-01' }, tokens.editor);
    expect(status).toBe(403);
    expect(body.message).toBe('You do not have permission to change schedules.');
  });

  it("shows today's version on the employee", async () => {
    await add({ ...schedule, effectiveFrom: '2099-01-01', startTime: '11:00', endTime: '19:00' });
    const { body } = await call(getRoute, tokens.viewer, `/employees/${id}`, { params: { id } });
    expect((body.schedule as Json).effectiveFrom).toBe('2025-04-01');
  });
});
