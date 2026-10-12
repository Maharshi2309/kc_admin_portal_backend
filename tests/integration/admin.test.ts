import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DELETE as deleteAttendanceRoute } from '@/app/api/admin/attendance/[id]/route';
import { POST as clearDataRoute } from '@/app/api/admin/clear-data/route';
import { DELETE as deleteDepartmentRoute } from '@/app/api/admin/departments/[code]/route';
import { DELETE as deleteEmployeeRoute } from '@/app/api/admin/employees/[id]/route';
import { DELETE as deleteHolidayRoute } from '@/app/api/admin/holidays/[id]/route';
import { DELETE as deleteLeaveRoute } from '@/app/api/admin/leaves/[id]/route';
import { DELETE as deletePositionRoute } from '@/app/api/admin/positions/[code]/route';
import { DELETE as deleteUserRoute } from '@/app/api/admin/users/[id]/route';
import { GET as auditRoute } from '@/app/api/audit-logs/route';
import { PERMISSION_KEYS } from '@/lib/permissions/catalogue';
import { apiRequest, createSignedInUser, noParams, seedTestPermissions, testDb, withParams } from './setup';

/**
 * Main-admin deletes (`/api/admin/...`). The main admin is the user named by
 * BOOTSTRAP_ADMIN_EMAIL, set here to this file's admin. The last test clears
 * the whole test database (keeping that admin), so it runs last.
 */

const db = testDb();
const tag = `admin-${Date.now()}`;
const year = 3000 + (Date.now() % 5000);
const day = (mmdd: string) => new Date(`${year}-${mmdd}T00:00:00Z`);
type Json = Record<string, unknown>;
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

let admin = { id: 0, token: '', email: '' };
let other = { id: 0, token: '', email: '' };
let previousAdminEmail: string | undefined;

async function call(handler: Handler, path: string, init: { method?: string; body?: unknown; params?: Record<string, string>; token?: string } = {}) {
  const response = await handler(apiRequest(path, init.token ?? admin.token, init), init.params ? withParams(init.params) : noParams);
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as Json };
}

const del = (handler: Handler, path: string, params: Record<string, string>, token?: string) =>
  call(handler, `/admin/${path}`, { method: 'DELETE', params, token });

let ecCounter = 0;
async function makeEmployee() {
  ecCounter += 1;
  return db.employee.create({
    data: {
      ecNumber: `KC${String(Date.now()).slice(-7)}${ecCounter}`,
      name: `Admin test ${ecCounter}`,
      mobile: '9876543210',
      departmentCode: 'tailor',
      positionCode: 'tailor',
      joiningDate: day('01-01'),
      createdById: admin.id,
      updatedById: admin.id,
    },
  });
}

async function makeSchedule(employeeId: number) {
  return db.employeeWorkSchedule.create({
    data: {
      employeeId,
      effectiveFrom: day('01-01'),
      startTime: new Date('1970-01-01T09:30:00Z'),
      endTime: new Date('1970-01-01T18:30:00Z'),
      breakMinutes: 60,
      weeklyOffDays: [7],
      expectedMinutes: 480,
      createdById: admin.id,
    },
  });
}

const leaveData = (employeeId: number, leaveTypeId: string, mmdd: string, extra: Record<string, unknown> = {}) => ({
  employeeId,
  leaveTypeId,
  startDate: day(mmdd),
  endDate: day(mmdd),
  days: 1,
  reason: 'personal_work' as const,
  status: 'pending' as const,
  createdById: admin.id,
  ...extra,
});

beforeAll(async () => {
  await seedTestPermissions(db);
  admin = await createSignedInUser(db, tag, 'admin', PERMISSION_KEYS);
  other = await createSignedInUser(db, tag, 'other', PERMISSION_KEYS);
  previousAdminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL;
  process.env.BOOTSTRAP_ADMIN_EMAIL = admin.email;
});

afterAll(async () => {
  if (previousAdminEmail === undefined) delete process.env.BOOTSTRAP_ADMIN_EMAIL;
  else process.env.BOOTSTRAP_ADMIN_EMAIL = previousAdminEmail;
  await db.$disconnect();
});

describe('admin deletes', () => {
  it('refuses everyone but the main admin, even with every permission', async () => {
    const employee = await makeEmployee();
    const denied = await del(deleteEmployeeRoute, `employees/${employee.id}`, { id: String(employee.id) }, other.token);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('PERMISSION_DENIED');

    const clear = await call(clearDataRoute, '/admin/clear-data', { method: 'POST', body: { confirm: 'DELETE ALL DATA' }, token: other.token });
    expect(clear.status).toBe(403);
    expect(await db.employee.count({ where: { id: employee.id } })).toBe(1);

    const anonymous = await call(clearDataRoute, '/admin/clear-data', { method: 'POST', body: {}, token: '' });
    expect(anonymous.status).toBe(401);
  });

  it('returns 404 for a record that does not exist', async () => {
    expect((await del(deleteEmployeeRoute, 'employees/999999999', { id: '999999999' })).status).toBe(404);
    expect((await del(deleteLeaveRoute, 'leaves/abc', { id: 'abc' })).status).toBe(404);
  });

  it('deletes an employee with everything that belongs to them, keeping their history unlinked', async () => {
    const employee = await makeEmployee();
    const schedule = await makeSchedule(employee.id);
    await db.attendanceRecord.create({
      data: { employeeId: employee.id, date: day('02-02'), status: 'present', scheduleId: schedule.id, punchedInById: admin.id },
    });
    const casual = await db.leave.create({ data: leaveData(employee.id, 'casual', '03-03') });
    await db.leave.create({ data: leaveData(employee.id, 'unpaid', '03-04', { unpaidPartOfId: casual.id }) });
    await db.leaveBalanceAdjustment.create({
      data: { employeeId: employee.id, days: 1, effectiveMonth: day('01-01'), reason: 'Opening', createdById: admin.id },
    });
    const audit = await db.auditLog.create({
      data: { actorUserId: admin.id, action: 'employee.create', entityType: 'employee', entityId: String(employee.id), employeeId: employee.id, summary: 'Added', changes: [] },
    });
    const linked = await db.user.create({ data: { name: 'Linked', email: `linked.${tag}@test.keshav.in`, employeeId: employee.id } });

    const { status, body } = await del(deleteEmployeeRoute, `employees/${employee.id}`, { id: String(employee.id) });
    expect(status).toBe(200);
    expect(body.deleted).toEqual({
      employees: 1,
      attendanceRecords: 1,
      leaves: 2,
      leaveBalanceAdjustments: 1,
      workSchedules: 1,
      usersUnlinked: 1,
    });
    expect(await db.employee.count({ where: { id: employee.id } })).toBe(0);
    expect((await db.user.findUniqueOrThrow({ where: { id: linked.id } })).employeeId).toBeNull();
    // The change history stays (the append-only triggers are installed in the test database).
    expect((await db.auditLog.findUniqueOrThrow({ where: { id: audit.id } })).employeeId).toBeNull();
  });

  it('deletes one attendance record', async () => {
    const employee = await makeEmployee();
    const record = await db.attendanceRecord.create({ data: { employeeId: employee.id, date: day('04-04'), status: 'present' } });
    const { status, body } = await del(deleteAttendanceRoute, `attendance/${record.id}`, { id: String(record.id) });
    expect(status).toBe(200);
    expect(body.deleted).toEqual({ attendanceRecords: 1 });
    expect(await db.attendanceRecord.count({ where: { id: record.id } })).toBe(0);
  });

  it('deletes a split leave together with its Unpaid part, or only the Unpaid part', async () => {
    const employee = await makeEmployee();
    const casual = await db.leave.create({ data: leaveData(employee.id, 'casual', '05-05') });
    const unpaid = await db.leave.create({ data: leaveData(employee.id, 'unpaid', '05-06', { unpaidPartOfId: casual.id }) });
    const both = await del(deleteLeaveRoute, `leaves/${casual.id}`, { id: String(casual.id) });
    expect(both.status).toBe(200);
    expect(both.body.deleted).toEqual({ leaves: 2 });
    expect(await db.leave.count({ where: { id: { in: [casual.id, unpaid.id] } } })).toBe(0);

    const main = await db.leave.create({ data: leaveData(employee.id, 'casual', '06-06') });
    const part = await db.leave.create({ data: leaveData(employee.id, 'unpaid', '06-07', { unpaidPartOfId: main.id }) });
    const one = await del(deleteLeaveRoute, `leaves/${part.id}`, { id: String(part.id) });
    expect(one.body.deleted).toEqual({ leaves: 1 });
    expect(await db.leave.count({ where: { id: main.id } })).toBe(1);
  });

  it('deletes a holiday permanently and recalculates attendance on that date', async () => {
    const employee = await makeEmployee();
    await makeSchedule(employee.id);
    const date = day('07-07');
    const holiday = await db.companyHoliday.create({
      data: { date, liveDate: date, name: 'Admin test day', createdById: admin.id, updatedById: admin.id },
    });
    const record = await db.attendanceRecord.create({
      data: { employeeId: employee.id, date, status: 'holiday', dayKind: 'holiday_worked', punchIn: new Date(`${year}-07-07T04:00:00Z`), punchOut: new Date(`${year}-07-07T13:00:00Z`) },
    });
    const { status } = await del(deleteHolidayRoute, `holidays/${holiday.id}`, { id: String(holiday.id) });
    expect(status).toBe(200);
    expect(await db.companyHoliday.count({ where: { id: holiday.id } })).toBe(0);
    expect((await db.attendanceRecord.findUniqueOrThrow({ where: { id: record.id } })).dayKind).not.toBe('holiday_worked');
  });

  it('deletes departments and positions only when no employee uses them', async () => {
    const used = await del(deleteDepartmentRoute, 'departments/tailor', { code: 'tailor' });
    expect(used.status).toBe(409);
    expect(used.body.message).toMatch(/in the Tailor department/);
    expect((await del(deletePositionRoute, 'positions/tailor', { code: 'tailor' })).status).toBe(409);

    await db.department.create({ data: { code: `dept_${tag}`.slice(0, 50), name: `Dept ${tag}` } });
    await db.position.create({ data: { code: `pos_${tag}`.slice(0, 50), name: `Pos ${tag}` } });
    expect((await del(deleteDepartmentRoute, `departments/dept_${tag}`, { code: `dept_${tag}`.slice(0, 50) })).status).toBe(200);
    expect((await del(deletePositionRoute, `positions/pos_${tag}`, { code: `pos_${tag}`.slice(0, 50) })).status).toBe(200);
    expect((await del(deletePositionRoute, 'positions/nope', { code: 'nope' })).status).toBe(404);
  });

  it('deletes a user, crediting their records to the main admin and keeping their history', async () => {
    const leaving = await db.user.create({ data: { name: 'Leaving', email: `leaving.${tag}@test.keshav.in` } });
    const holiday = await db.companyHoliday.create({
      data: { date: day('08-08'), liveDate: day('08-08'), name: 'By leaving user', createdById: leaving.id, updatedById: leaving.id },
    });
    const audit = await db.auditLog.create({
      data: { actorUserId: leaving.id, action: 'holiday.create', entityType: 'holiday', entityId: String(holiday.id), summary: `Added ${tag}`, changes: [] },
    });

    const { status, body } = await del(deleteUserRoute, `users/${leaving.id}`, { id: String(leaving.id) });
    expect(status).toBe(200);
    expect(body.deleted).toMatchObject({ users: 1, recordsReassigned: 2 });
    expect(await db.user.count({ where: { id: leaving.id } })).toBe(0);
    expect(await db.companyHoliday.findUniqueOrThrow({ where: { id: holiday.id } })).toMatchObject({ createdById: admin.id, updatedById: admin.id });
    expect((await db.auditLog.findUniqueOrThrow({ where: { id: audit.id } })).actorUserId).toBeNull();

    const history = await call(auditRoute, '/audit-logs?entityType=holiday&pageSize=100');
    const entry = (history.body.items as Json[]).find((item) => item.summary === `Added ${tag}`);
    expect(entry?.actor).toEqual({ id: '', name: 'Deleted user' });
  });

  it('never deletes the main admin', async () => {
    const { status } = await del(deleteUserRoute, `users/${admin.id}`, { id: String(admin.id) });
    expect(status).toBe(409);
    expect(await db.user.count({ where: { id: admin.id } })).toBe(1);
  });
});

describe('clear all data', () => {
  it('needs the exact confirmation text', async () => {
    for (const body of [{}, { confirm: 'yes' }, { confirm: 'delete all data' }]) {
      const result = await call(clearDataRoute, '/admin/clear-data', { method: 'POST', body });
      expect(result.status).toBe(422);
      expect(result.body.errors).toHaveProperty('confirm');
    }
    expect(await db.user.count({ where: { id: other.id } })).toBe(1);
  });

  it('deletes everything except the main admin, the permissions, leave types and lists', async () => {
    await makeSchedule((await makeEmployee()).id);
    const departments = await db.department.count();
    const leaveTypes = await db.leaveType.count();
    const adminPermissions = await db.userPermission.count({ where: { userId: admin.id } });

    const { status, body } = await call(clearDataRoute, '/admin/clear-data', { method: 'POST', body: { confirm: 'DELETE ALL DATA' } });
    expect(status).toBe(200);
    expect(body.keptAdmin).toEqual({ id: String(admin.id), name: 'admin', email: admin.email });
    expect(body.auditLogsCleared).toBe(true);
    expect((body.deleted as Json).employees).toBeGreaterThan(0);

    expect(await db.user.findMany({ select: { id: true } })).toEqual([{ id: admin.id }]);
    expect(await db.userPermission.count({ where: { userId: admin.id } })).toBe(adminPermissions);
    for (const count of [
      db.employee.count(),
      db.employeeWorkSchedule.count(),
      db.attendanceRecord.count(),
      db.leave.count(),
      db.leaveBalanceAdjustment.count(),
      db.companyHoliday.count(),
      db.auditLog.count(),
    ]) {
      expect(await count).toBe(0);
    }
    expect(await db.department.count()).toBe(departments);
    expect(await db.leaveType.count()).toBe(leaveTypes);
    expect(await db.permission.count()).toBe(PERMISSION_KEYS.length);

    // The admin's own session still works.
    expect((await call(auditRoute, '/audit-logs')).status).toBe(200);
  });
});
