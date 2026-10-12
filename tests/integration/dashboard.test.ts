import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as summaryRoute } from '@/app/api/dashboard/summary/route';
import * as attendance from '@/modules/attendance/attendance.service';
import type { AuthContext } from '@/modules/auth/auth.types';
import * as dashboard from '@/modules/dashboard/dashboard.service';
import { apiRequest, createSignedInUser, noParams, seedTestPermissions, testDb } from './setup';

/**
 * Dashboard figures from real records, with a fixed clock, in June 2015
 * (before any other test's active employees joined). Four employees work
 * 09:00–17:30 with a 13:00–14:00 break, Sunday off. Tue 2 June is a holiday.
 */

const db = testDb();
const tag = `dash-${Date.now()}`;
const run = String(Date.now()).slice(-7);
const MON = '2015-06-01';
const TUE = '2015-06-02';
const at = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);
const clockAt = (date: string, time: string) => () => at(date, time);
const ids: Record<string, number> = {};
let auth: AuthContext;
let withOvertime: AuthContext;

beforeAll(async () => {
  await seedTestPermissions(db);
  const admin = await createSignedInUser(db, tag, 'admin', []);
  auth = { userId: admin.id, sessionId: 'test', name: 'admin', email: admin.email, permissions: new Set(['dashboard.view']) };
  withOvertime = { ...auth, permissions: new Set(['dashboard.view', 'overtime.view']) };
  for (const [i, name] of ['Anil', 'Bina', 'Chirag', 'Deepa'].entries()) {
    ids[name] = (
      await db.employee.create({
        data: {
          ecNumber: `KC4${run}${i}`,
          name: `${name} ${tag}`,
          mobile: '9876543210',
          departmentCode: 'accountant',
          positionCode: 'accountant',
          joiningDate: new Date('2015-01-05T00:00:00Z'),
          createdById: admin.id,
          updatedById: admin.id,
          schedules: {
            create: {
              effectiveFrom: new Date('2015-01-05T00:00:00Z'),
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
      })
    ).id;
  }
  await attendance.punchIn(ids.Anil!, auth, clockAt(MON, '09:00'));
  await attendance.punchOut(ids.Anil!, auth, clockAt(MON, '19:00')); // 540 worked, 90 overtime
  await attendance.punchIn(ids.Bina!, auth, clockAt(MON, '10:00')); // late
  await db.companyHoliday.create({
    data: { date: new Date(`${TUE}T00:00:00Z`), liveDate: new Date(`${TUE}T00:00:00Z`), name: `Holiday ${tag}`, createdById: admin.id, updatedById: admin.id },
  });
});

afterAll(async () => {
  // Overtime this month counts every employee, so leave no punches behind for later runs.
  await db.attendanceRecord.deleteMany({ where: { employeeId: { in: Object.values(ids) } } });
  await db.employee.updateMany({ where: { id: { in: Object.values(ids) } }, data: { status: 'inactive' } });
  await db.companyHoliday.updateMany({
    where: { name: `Holiday ${tag}`, deletedAt: null },
    data: { deletedAt: new Date(), deletedById: auth.userId, liveDate: null },
  });
  await db.$disconnect();
});

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../contract/fixtures/${name}`, import.meta.url), 'utf8')) as Record<string, unknown>;

describe('dashboard summary', () => {
  it("counts today's attendance among scheduled employees", async () => {
    const s = await dashboard.summary(MON, withOvertime, clockAt(MON, '20:00'));
    expect(s).toMatchObject({
      date: MON,
      totalEmployees: 4,
      scheduledToday: 4,
      presentToday: 2, // present and late
      onLeaveToday: 0,
      absentToday: 2,
      presentPercent: 50,
      onLeavePercent: 0,
      absentPercent: 50,
      holiday: null,
      weekOffToday: 0,
      // Anil 09:00–19:00 (90), and Bina's open punch from 10:00 counted up to 20:00 (90).
      overtimeMinutesThisMonth: 180,
      overtimeEmployeesThisMonth: 2,
      notPunchedInTotal: 2,
      onLeave: [],
    });
    // pending_leave counts the whole (shared test) database, so only check ours.
    expect(s.attention.filter((a) => a.kind !== 'pending_leave')).toEqual([
      { kind: 'not_punched_in', count: 2 },
      { kind: 'late_arrival', count: 1 },
    ]);
    expect(s.notPunchedIn.map((e) => e.name.split(' ')[0])).toEqual(['Chirag', 'Deepa']);
    expect(Object.keys(s).sort()).toEqual(Object.keys(fixture('dashboard.summary.response.json')).sort());
    expect(Object.keys(s.leaveUsage).sort()).toEqual(
      Object.keys(fixture('dashboard.summary.response.json').leaveUsage as object).sort(),
    );
    expect(s.leaveUsage.year).toBe(2015);
  });

  it("doesn't count anyone absent before start + 15 minutes", async () => {
    // Chirag and Deepa haven't punched in, but at 09:10 they aren't due yet.
    const early = await dashboard.summary(MON, auth, clockAt(MON, '09:10'));
    expect(early).toMatchObject({ absentToday: 0, notPunchedInTotal: 2 });
  });

  it('hides overtime without overtime.view', async () => {
    const s = await dashboard.summary(MON, auth, clockAt(MON, '20:00'));
    expect(s).toMatchObject({ overtimeMinutesThisMonth: null, overtimeEmployeesThisMonth: null });
  });

  it('shows the holiday with nobody scheduled', async () => {
    const s = await dashboard.summary(TUE, auth, clockAt(TUE, '12:00'));
    expect(s).toMatchObject({
      scheduledToday: 0,
      presentToday: 0,
      absentToday: 0,
      presentPercent: null,
      absentPercent: null,
      holiday: { date: TUE, name: `Holiday ${tag}`, description: null },
      notPunchedIn: [],
    });
    expect(s.attention.filter((a) => a.kind !== 'pending_leave')).toEqual([]);
  });

  it('refuses future dates and needs dashboard.view', async () => {
    await expect(dashboard.summary(TUE, auth, clockAt(MON, '12:00'))).rejects.toMatchObject({ status: 422 });
    const viewer = await createSignedInUser(db, tag, 'nodash', ['employee.view']);
    expect((await summaryRoute(apiRequest(`/dashboard/summary?date=${MON}`, viewer.token), noParams)).status).toBe(403);
  });
});

describe('monthly attendance chart', () => {
  it('gives present as a share of scheduled for each day up to today, skipping holidays', async () => {
    const chart = await dashboard.attendanceChart('2015-06', clockAt(TUE, '12:00'));
    expect(chart).toEqual({ month: '2015-06-01', averagePercent: 50, days: [{ date: MON, percent: 50 }] });
    expect(Object.keys(chart).sort()).toEqual(Object.keys(fixture('dashboard.attendance-chart.response.json')).sort());
  });
});
