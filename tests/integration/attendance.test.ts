import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as dayRoute } from '@/app/api/attendance/route';
import { POST as punchInRoute } from '@/app/api/attendance/punch-in/route';
import * as attendance from '@/modules/attendance/attendance.service';
import type { AuthContext } from '@/modules/auth/auth.types';
import { apiRequest, createSignedInUser, noParams, seedTestPermissions, testDb } from './setup';

/**
 * Attendance against the real database, with a fixed clock so statuses don't
 * depend on when the tests run. The scenario lives in June 2018, before any
 * other test's employees joined; its employees are deactivated afterwards so
 * later runs start from an empty day.
 */

const db = testDb();
const tag = `att-${Date.now()}`;
const run = String(Date.now()).slice(-7);
const MON = '2018-06-04';
const SUN = '2018-06-03';
const TUE = '2018-06-05';
const at = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);
const clockAt = (date: string, time: string) => () => at(date, time);

let auth: AuthContext;
let viewerToken = '';
const ids: Record<string, number> = {};
const department = `floor_${run}`;

beforeAll(async () => {
  await seedTestPermissions(db);
  const admin = await createSignedInUser(db, tag, 'admin', ['attendance.view', 'attendance.punch', 'attendance.correct']);
  auth = { userId: admin.id, sessionId: 'test', name: 'admin', email: admin.email, permissions: new Set() };
  viewerToken = (await createSignedInUser(db, tag, 'viewer', ['attendance.view'])).token;

  await db.department.create({ data: { code: department, name: `Floor ${tag}` } });
  for (const [i, name] of ['Asha', 'Bharat', 'Chetan', 'Dipti', 'Esha'].entries()) {
    const employee = await db.employee.create({
      data: {
        ecNumber: `KC8${run}${i}`,
        name: `${name} ${tag}`,
        mobile: '9876543210',
        departmentCode: department,
        positionCode: 'tailor',
        joiningDate: new Date('2018-01-01T00:00:00Z'),
        createdById: admin.id,
        updatedById: admin.id,
        schedules: {
          create: {
            effectiveFrom: new Date('2018-01-01T00:00:00Z'),
            startTime: new Date('1970-01-01T09:00:00Z'),
            endTime: new Date('1970-01-01T17:30:00Z'),
            breakMinutes: 60,
            breakStart: new Date('1970-01-01T13:00:00Z'),
            breakEnd: new Date('1970-01-01T14:00:00Z'),
            weeklyOffDays: [7],
            expectedMinutes: 450,
            createdById: admin.id,
          },
        },
      },
    });
    ids[name] = employee.id;
  }
});

afterAll(async () => {
  await db.employee.updateMany({ where: { id: { in: Object.values(ids) } }, data: { status: 'inactive' } });
  await db.companyHoliday.updateMany({
    where: { name: `Test holiday ${tag}`, deletedAt: null },
    data: { deletedAt: new Date(), deletedById: auth.userId, liveDate: null },
  });
  await db.$disconnect();
});

const day = (date: string, time: string, query: Record<string, unknown> = {}) =>
  attendance.day({ date, page: { page: 1, pageSize: 50, skip: 0, take: 50 }, ...query } as never, clockAt(date, time));
const mine = <T extends { employee: { name: string } }>(rows: T[]) => rows.filter((r) => r.employee.name.endsWith(tag));

describe('punch in and out', () => {
  it('records punches at the server time and derives the status', async () => {
    const asha = await attendance.punchIn(ids.Asha!, auth, clockAt(MON, '09:05'));
    expect(asha).toMatchObject({ status: 'present', note: null, punchIn: `${MON}T09:05:00+05:30`, punchOut: null });

    const bharat = await attendance.punchIn(ids.Bharat!, auth, clockAt(MON, '10:00'));
    expect(bharat).toMatchObject({ status: 'late', note: null, lateMinutes: 60 });
    expect(bharat.employee).toEqual({
      id: String(ids.Bharat),
      name: `Bharat ${tag}`,
      ecNumber: `KC8${run}1`,
      department,
      position: 'tailor',
    });
    // Open punch today: worked so far = 0 at the moment of punching.
    expect(bharat.workedMinutes).toBe(0);
  });

  it('refuses a second punch in and a punch out without punch in', async () => {
    await expect(attendance.punchIn(ids.Asha!, auth, clockAt(MON, '09:30'))).rejects.toMatchObject({
      status: 409,
      code: 'ATTENDANCE_STATE',
      message: 'Already punched in today.',
    });
    await expect(attendance.punchOut(ids.Chetan!, auth, clockAt(MON, '09:30'))).rejects.toMatchObject({
      message: 'Punch in first.',
    });
  });

  it('computes worked time and overtime on punch out', async () => {
    const out = await attendance.punchOut(ids.Asha!, auth, clockAt(MON, '18:00'));
    // 09:05–18:00 = 535 min, covers the 13:00–14:00 break → 475 worked, 25 overtime.
    expect(out).toMatchObject({ workedMinutes: 475, overtimeMinutes: 25, workedPercent: 100, expectedMinutes: 450 });
    await expect(attendance.punchOut(ids.Asha!, auth, clockAt(MON, '18:05'))).rejects.toMatchObject({
      message: 'Already punched out today.',
    });

    const row = await db.attendanceRecord.findFirstOrThrow({ where: { employeeId: ids.Asha! } });
    expect(row).toMatchObject({ status: 'present', workedMinutes: 475, overtimeMinutes: 25, punchedInById: auth.userId });
  });

  it("refuses inactive employees", async () => {
    await db.employee.update({ where: { id: ids.Esha! }, data: { status: 'inactive' } });
    try {
      await expect(attendance.punchIn(ids.Esha!, auth, clockAt(MON, '09:00'))).rejects.toMatchObject({
        message: 'This employee is inactive.',
      });
    } finally {
      await db.employee.update({ where: { id: ids.Esha! }, data: { status: 'active' } });
    }
  });
});

describe('GET /attendance (day list)', () => {
  it('lists everyone with a summary, those needing attention first', async () => {
    const result = await day(MON, '18:30');
    const rows = mine(result.items);
    expect(rows.map((r) => [r.employee.name.split(' ')[0], r.status])).toEqual([
      ['Chetan', 'absent'],
      ['Dipti', 'absent'],
      ['Esha', 'absent'],
      ['Bharat', 'late'],
      ['Asha', 'present'],
    ]);
    expect(result.summary).toMatchObject({ date: MON, totalEmployees: 5, present: 1, late: 1, absent: 3, notPunchedIn: 3 });
    expect(rows[0]).toMatchObject({ id: null, punchIn: null, schedule: { startTime: '09:00', endTime: '17:30', expectedMinutes: 450 } });
  });

  it('shows "Not in yet" before start + grace on the same day', async () => {
    const early = mine((await day(MON, '09:10')).items).find((r) => r.employee.name.startsWith('Chetan'))!;
    expect(early).toMatchObject({ status: 'absent', note: 'Not in yet' });
  });

  it('filters by status, search and department while the tiles keep the totals', async () => {
    const late = await day(MON, '18:30', { status: 'late' });
    expect(mine(late.items).map((r) => r.employee.name.split(' ')[0])).toEqual(['Bharat']);
    expect(late.summary.totalEmployees).toBe(5);
    const byEc = await day(MON, '18:30', { search: `kc8${run}2` });
    expect(byEc.items.map((r) => r.employee.name.split(' ')[0])).toEqual(['Chetan']);
    expect((await day(MON, '18:30', { department })).items).toHaveLength(5);
  });

  it('refuses future dates', async () => {
    await expect(attendance.day({ date: TUE, search: undefined, page: { page: 1, pageSize: 20, skip: 0, take: 20 } }, clockAt(MON, '12:00'))).rejects.toMatchObject({
      status: 422,
      fieldErrors: { date: ['Attendance is not available for future dates.'] },
    });
  });

  it('serves the app shape over HTTP with the right permission', async () => {
    const response = await dayRoute(apiRequest(`/attendance?date=${MON}&department=${department}`, viewerToken), noParams);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { summary: object; items: object[] };
    const fixture = JSON.parse(readFileSync(new URL('../contract/fixtures/attendance.day.response.json', import.meta.url), 'utf8'));
    expect(Object.keys(body).sort()).toEqual(Object.keys(fixture).sort());
    expect(Object.keys(body.summary).sort()).toEqual(Object.keys(fixture.summary).sort());
    const recordKeys = Object.keys(JSON.parse(readFileSync(new URL('../contract/fixtures/attendance.record.response.json', import.meta.url), 'utf8'))).sort();
    for (const item of body.items) expect(Object.keys(item).sort()).toEqual(recordKeys);

    const denied = await punchInRoute(apiRequest('/attendance/punch-in', viewerToken, { method: 'POST', body: { employeeId: String(ids.Asha) } }), noParams);
    expect(denied.status).toBe(403);
  });
});

describe('punch in all', () => {
  it('punches in everyone still absent today, once', async () => {
    const { count } = await attendance.punchInAll(MON, auth, clockAt(MON, '11:00'));
    expect(count).toBe(3); // Chetan, Dipti, Esha
    expect((await attendance.punchInAll(MON, auth, clockAt(MON, '11:05'))).count).toBe(0);
  });

  it('only works for today', async () => {
    await expect(attendance.punchInAll(SUN, auth, clockAt(MON, '11:00'))).rejects.toMatchObject({
      fieldErrors: { date: ['You can only punch in everyone for today.'] },
    });
  });
});

describe('corrections', () => {
  it('corrects punches, re-derives the status and records the change', async () => {
    const record = await db.attendanceRecord.findFirstOrThrow({ where: { employeeId: ids.Bharat! } });
    const corrected = await attendance.correct(
      record.id,
      { date: MON, punchIn: at(MON, '09:20'), punchOut: at(MON, '17:40'), reason: 'device_issue', remarks: 'Gate device offline' },
      auth,
      clockAt(MON, '19:00'),
    );
    expect(corrected).toMatchObject({ status: 'late', lateMinutes: 20, workedMinutes: 440, correctedBy: 'admin' });

    const audit = await db.auditLog.findFirstOrThrow({ where: { entityType: 'attendance', entityId: String(record.id) } });
    expect(audit).toMatchObject({
      action: 'attendance.correct',
      summary: 'Corrected punch in and punch out',
      reason: 'device_issue',
      remarks: 'Gate device offline',
      changes: [
        { field: 'punchIn', label: 'Punch in', before: '10:00', after: '09:20' },
        { field: 'punchOut', label: 'Punch out', before: null, after: '17:40' },
      ],
    });
  });

  it('checks the times', async () => {
    const record = await db.attendanceRecord.findFirstOrThrow({ where: { employeeId: ids.Bharat! } });
    const correct = (body: Record<string, unknown>) =>
      attendance.correct(record.id, { date: MON, punchIn: at(MON, '09:00'), punchOut: null, reason: 'other', remarks: null, ...body } as never, auth, clockAt(MON, '19:00'));
    await expect(correct({ punchOut: at(MON, '08:00') })).rejects.toMatchObject({ fieldErrors: { punchOut: ['Must be after punch in'] } });
    await expect(correct({ punchIn: at(SUN, '09:00') })).rejects.toMatchObject({ fieldErrors: { punchIn: [`Must be on ${MON}`] } });
    await expect(correct({ punchOut: at(MON, '20:00') })).rejects.toMatchObject({ fieldErrors: { punchOut: ["Can't be in the future"] } });
    await expect(correct({ date: SUN })).rejects.toMatchObject({ fieldErrors: { date: [`This record is for ${MON}.`] } });
  });
});

describe('adding a missing day', () => {
  it('records work on a weekly off as overtime', async () => {
    const added = await attendance.addRecord(
      { employeeId: ids.Asha!, date: SUN, punchIn: at(SUN, '10:00'), punchOut: at(SUN, '12:00'), reason: 'forgot_to_punch', remarks: null },
      auth,
      clockAt(MON, '19:00'),
    );
    expect(added).toMatchObject({ status: 'present', dayKind: 'week_off_worked', workedMinutes: 120, overtimeMinutes: 120, schedule: null });
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityType: 'attendance', entityId: added.id! } });
    expect(audit).toMatchObject({ action: 'attendance.create', summary: 'Added attendance' });
  });

  it('refuses a day that already has a record, a future day and a day before joining', async () => {
    const add = (date: string, time = '09:00') =>
      attendance.addRecord({ employeeId: ids.Asha!, date, punchIn: at(date, time), punchOut: null, reason: 'other', remarks: null }, auth, clockAt(MON, '19:00'));
    await expect(add(SUN)).rejects.toMatchObject({ status: 409, message: 'A record already exists for this day. Correct it instead.' });
    await expect(add(TUE)).rejects.toMatchObject({ fieldErrors: { date: ["Can't add attendance for a future date"] } });
    await expect(add('2017-12-29')).rejects.toMatchObject({ fieldErrors: { date: ["This is before the employee's joining date"] } });
  });
});

describe('holidays and the attendance log', () => {
  it('marks a holiday for everyone, and punch in all skips it', async () => {
    await db.companyHoliday.create({
      data: { date: new Date(`${TUE}T00:00:00Z`), liveDate: new Date(`${TUE}T00:00:00Z`), name: `Test holiday ${tag}`, createdById: auth.userId, updatedById: auth.userId },
    });
    const rows = mine((await day(TUE, '12:00')).items);
    expect(new Set(rows.map((r) => r.status))).toEqual(new Set(['holiday']));
    expect(rows[0]!.schedule).toBeNull();
    expect((await attendance.punchInAll(TUE, auth, clockAt(TUE, '12:00'))).count).toBe(0);
  });

  it("lists an employee's days of the month up to today, newest first", async () => {
    const log = await attendance.employeeLog(ids.Asha!, '2018-06', clockAt(TUE, '12:00'));
    expect(log.map((d) => [d.date, d.status])).toEqual([
      [TUE, 'holiday'],
      [MON, 'present'],
      [SUN, 'present'],
      ['2018-06-02', 'absent'],
      ['2018-06-01', 'absent'],
    ]);
  });
});
