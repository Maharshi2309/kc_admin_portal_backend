import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as calendarRoute } from '@/app/api/employees/[id]/calendar/route';
import { GET as overtimeRoute } from '@/app/api/employees/[id]/overtime/route';
import * as attendance from '@/modules/attendance/attendance.service';
import type { AuthContext } from '@/modules/auth/auth.types';
import * as calendar from '@/modules/calendar/calendar.service';
import * as employees from '@/modules/employees/employee.service';
import * as holidays from '@/modules/holidays/holiday.service';
import * as overtime from '@/modules/overtime/overtime.service';
import * as schedules from '@/modules/schedules/schedule.service';
import { apiRequest, createSignedInUser, seedTestPermissions, testDb, withParams } from './setup';

/**
 * Overtime report and employee calendar from real records, with a fixed clock
 * (Tue 20 Sep 2016, 12:00). The employee joined Mon 1 Aug 2016: 09:00–17:30,
 * 13:00–14:00 break (450 min), Sunday off; from 19 Sep, 10:00–18:00 with no
 * break (480 min).
 */

const db = testDb();
const tag = `cal-${Date.now()}`;
const run = String(Date.now()).slice(-7);
const at = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);
const clock = () => at('2016-09-20', '12:00');
let auth: AuthContext;
let tokens = { viewer: '', auditor: '' };
let employeeId = 0;
let holidayId = 0;

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../contract/fixtures/${name}`, import.meta.url), 'utf8')) as Record<string, unknown>;
const keys = (value: object) => Object.keys(value).sort();

beforeAll(async () => {
  await seedTestPermissions(db);
  const admin = await createSignedInUser(db, tag, 'admin', []);
  auth = { userId: admin.id, sessionId: 'test', name: 'admin', email: admin.email, permissions: new Set() };
  tokens = {
    viewer: (await createSignedInUser(db, tag, 'viewer', ['calendar.view', 'overtime.view'])).token,
    auditor: (await createSignedInUser(db, tag, 'auditor', ['calendar.view', 'audit.view'])).token,
  };
 
  employeeId = Number(
    (
      await employees.create(
        {
          ecNumber: `KC6${run}`,
          name: `Calendar ${tag}`,
          mobile: '9876543210',
          department: 'tailor',
          position: 'tailor',
          joiningDate: '2016-08-01',
          status: 'active',
          schedule: { startTime: '09:00', endTime: '17:30', breakMinutes: 60, breakStart: '13:00', breakEnd: '14:00', weeklyOffDays: [7] },
        },
        auth,
      )
    ).id,
  );
 
  holidayId = Number((await holidays.create({ date: '2016-09-14', name: `Holiday ${tag}`, description: null }, auth)).id);
 
  const add = (date: string, from: string, to: string) =>
    attendance.addRecord({ employeeId, date, punchIn: at(date, from), punchOut: at(date, to), reason: 'forgot_to_punch', remarks: null }, auth, clock);
  await add('2016-09-05', '08:58', '19:00'); // worked 542, overtime 92 (the spec's example)
  await add('2016-09-11', '10:00', '15:00'); // Sunday: 300 overtime
  await add('2016-09-12', '09:40', '17:35'); // late, 415 worked
  await add('2016-09-14', '10:00', '15:00'); // holiday: 300 overtime
 
  await schedules.addVersion(
    employeeId,
    { effectiveFrom: '2016-09-19', startTime: '10:00', endTime: '18:00', breakMinutes: 0, breakStart: null, breakEnd: null, weeklyOffDays: [7] },
    auth,
  );
});

afterAll(async () => {
  await db.employee.update({ where: { id: employeeId }, data: { status: 'inactive' } });
  await db.companyHoliday.updateMany({ where: { id: holidayId, deletedAt: null }, data: { deletedAt: new Date(), deletedById: auth.userId, liveDate: null } });
  await db.$disconnect();
});

describe('overtime report', () => {
  it('adds up overtime, expected and worked minutes up to today', async () => {
    const report = await overtime.report(employeeId, '2016-08-01', '2016-09-30', clock);
    expect(report).toMatchObject({
      from: '2016-08-01',
      to: '2016-09-30',
      totalMinutes: 692,
      workedMinutes: 1557,
      // Aug: 27 working days × 450. Sep 1–20: 14 × 450 + 2 × 480 (Sundays and the holiday excluded).
      expectedMinutes: 27 * 450 + 14 * 450 + 2 * 480,
      dayBasisMinutes: 480,
      scheduleChanged: true,
    });
    expect(report.months).toEqual([
      { month: '2016-08-01', minutes: 0, expectedMinutes: 12150, workedMinutes: 0 },
      { month: '2016-09-01', minutes: 692, expectedMinutes: 7260, workedMinutes: 1557 },
    ]);
    expect(report.days.map((d) => [d.date, d.dayKind, d.overtimeMinutes, d.dayBasisMinutes])).toEqual([
      ['2016-09-14', 'holiday_worked', 300, 450],
      ['2016-09-11', 'week_off_worked', 300, 450],
      ['2016-09-05', 'working', 92, 450],
    ]);
    expect(keys(report)).toEqual(keys(fixture('employees.overtime.response.json')));
  });

  it('rejects an end before the start, and needs overtime.view', async () => {
    await expect(overtime.report(employeeId, '2016-09-30', '2016-09-01', clock)).rejects.toMatchObject({
      fieldErrors: { to: ['Must be on or after the start date'] },
    });
    const denied = await overtimeRoute(
      apiRequest(`/employees/${employeeId}/overtime?from=2016-09-01&to=2016-09-30`, tokens.auditor),
      withParams({ id: String(employeeId) }),
    );
    expect(denied.status).toBe(403);
  });
});

describe('employee calendar', () => {
  it('builds every day of the month with a summary up to today', async () => {
    const result = await calendar.month(employeeId, '2016-09', clock);
    expect(result.month).toBe('2016-09-01');
    expect(result.days).toHaveLength(30);
    const on = (date: string) => result.days.find((d) => d.date === date)!;

    expect(on('2016-09-05')).toMatchObject({ dayType: 'working', overtimeMinutes: 92, attendance: { status: 'present', corrected: true, workedMinutes: 542 } });
    expect(on('2016-09-14')).toMatchObject({ dayType: 'holiday', holidayName: `Holiday ${tag}`, schedule: null, attendance: { dayKind: 'holiday_worked' } });
    expect(on('2016-09-18')).toMatchObject({ dayType: 'week_off', attendance: null, schedule: null });
    expect(on('2016-09-13')).toMatchObject({ attendance: { id: null, status: 'absent' } });
    expect(on('2016-09-26')).toMatchObject({ attendance: null, schedule: { startTime: '10:00', endTime: '18:00', expectedMinutes: 480 } });

    expect(result.summary).toEqual({
      workingDays: 16,
      present: 2,
      absent: 14,
      leaveDays: 0,
      holidays: 1,
      weekOffs: 4,
      holidayWorked: 1,
      weekOffWorked: 1,
      expectedMinutes: 7260,
      workedMinutes: 1557,
      overtimeMinutes: 692,
    });
    const example = fixture('employees.calendar.response.json') as { days: object[]; summary: object };
    expect(keys(result)).toEqual(keys(example));
    expect(keys(result.summary)).toEqual(keys(example.summary));
    expect(keys(on('2016-09-05'))).toEqual(keys(example.days[0]!));
  });

  it('shows days before joining as empty working days', async () => {
    const july = await calendar.month(employeeId, '2016-07', clock);
    expect(new Set(july.days.map((d) => [d.dayType, d.attendance].join()))).toEqual(new Set(['working,']));
    expect(july.summary.workingDays).toBe(0);
  });

  it('includes the change history only for audit.view', async () => {
    const withAudit = await calendar.day(employeeId, '2016-09-12', { ...auth, permissions: new Set(['audit.view']) }, clock);
    expect(withAudit.history.map((h) => [h.action, h.summary, h.actor.name, h.reason])).toEqual([
      ['attendance.create', 'Added attendance', 'admin', 'forgot_to_punch'],
    ]);
    expect(keys(withAudit.history[0]!)).toEqual(keys((fixture('employees.calendar-day.response.json').history as object[])[0]!));
    expect((await calendar.day(employeeId, '2016-09-12', auth, clock)).history).toEqual([]);
  });

  it('serves the route with calendar.view', async () => {
    const response = await calendarRoute(
      apiRequest(`/employees/${employeeId}/calendar?month=2016-09`, tokens.viewer),
      withParams({ id: String(employeeId) }),
    );
    expect(response.status).toBe(200);
    const bad = await calendarRoute(apiRequest(`/employees/${employeeId}/calendar?month=Sept`, tokens.viewer), withParams({ id: String(employeeId) }));
    expect(bad.status).toBe(422);
  });
});
