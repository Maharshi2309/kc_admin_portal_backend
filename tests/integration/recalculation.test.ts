import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as attendance from '@/modules/attendance/attendance.service';
import type { AuthContext } from '@/modules/auth/auth.types';
import * as employees from '@/modules/employees/employee.service';
import * as holidays from '@/modules/holidays/holiday.service';
import * as schedules from '@/modules/schedules/schedule.service';
import { createSignedInUser, seedTestPermissions, testDb } from './setup';

/**
 * Stored attendance snapshots follow the changes they depend on
 * (DATABASE_V2.md §3.5): holidays added or removed, schedule changes and
 * joining-date moves. The scenario uses March 2017 so it touches nothing else.
 */

const db = testDb();
const tag = `recalc-${Date.now()}`;
const run = String(Date.now()).slice(-7);
const MON = '2017-03-06';
const at = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);
let auth: AuthContext;
let employeeId = 0;
let holidayId: number | null = null;

const snapshot = async () =>
  db.attendanceRecord.findFirstOrThrow({
    where: { employeeId },
    select: { status: true, dayKind: true, workedMinutes: true, overtimeMinutes: true, expectedMinutes: true },
  });

beforeAll(async () => {
  await seedTestPermissions(db);
  const admin = await createSignedInUser(db, tag, 'admin', []);
  auth = { userId: admin.id, sessionId: 'test', name: 'admin', email: admin.email, permissions: new Set(['employee.deactivate']) };
  const created = await employees.create(
    {
      ecNumber: `KC7${run}`,
      name: `Recalc ${tag}`,
      mobile: '9876543210',
      department: 'tailor',
      position: 'tailor',
      joiningDate: '2017-01-02',
      status: 'active',
      schedule: {
        startTime: '09:00',
        endTime: '17:30',
        breakMinutes: 60,
        breakStart: '13:00',
        breakEnd: '14:00',
        weeklyOffDays: [7],
      },
    },
    auth,
  );
  employeeId = Number(created.id);
  await attendance.addRecord(
    { employeeId, date: MON, punchIn: at(MON, '09:00'), punchOut: at(MON, '17:30'), reason: 'forgot_to_punch', remarks: null },
    auth,
  );
});

afterAll(async () => {
  await db.employee.update({ where: { id: employeeId }, data: { status: 'inactive' } });
  if (holidayId) {
    await db.companyHoliday.updateMany({
      where: { id: holidayId, deletedAt: null },
      data: { deletedAt: new Date(), deletedById: auth.userId, liveDate: null },
    });
  }
  await db.$disconnect();
});

describe('recalculating stored attendance', () => {
  it('starts as a normal working day', async () => {
    expect(await snapshot()).toEqual({ status: 'present', dayKind: 'working', workedMinutes: 450, overtimeMinutes: 0, expectedMinutes: 450 });
  });

  it('turns the day into holiday work when a holiday is added on it', async () => {
    const holiday = await holidays.create({ date: MON, name: `Holi ${tag}`, description: null }, auth);
    holidayId = Number(holiday.id);
    // No schedule on a holiday: no break deducted, all of it overtime.
    expect(await snapshot()).toEqual({ status: 'present', dayKind: 'holiday_worked', workedMinutes: 510, overtimeMinutes: 510, expectedMinutes: 0 });
  });

  it('turns it back into a working day when the holiday is deleted', async () => {
    await holidays.remove(holidayId!, auth);
    expect(await snapshot()).toMatchObject({ dayKind: 'working', workedMinutes: 450, overtimeMinutes: 0 });
  });

  it('refuses to move the joining date after recorded attendance', async () => {
    const current = await employees.get(employeeId, auth);
    await expect(
      employees.update(
        employeeId,
        {
          ecNumber: current.ecNumber,
          name: current.name,
          mobile: current.mobile,
          department: current.department,
          position: current.position,
          joiningDate: '2017-03-10',
          status: 'active',
        },
        auth,
      ),
    ).rejects.toMatchObject({
      fieldErrors: { joiningDate: [`Attendance is already recorded on ${MON}. Choose that date or an earlier one.`] },
    });
  });
  it('applies a schedule change from a past date to recorded days', async () => {
    await schedules.addVersion(
      employeeId,
      { effectiveFrom: '2017-03-01', startTime: '10:00', endTime: '18:00', breakMinutes: 0, breakStart: null, breakEnd: null, weeklyOffDays: [7] },
      auth,
    );
    // 09:00–17:30 is 510 minutes against 480 expected, with no break.
    expect(await snapshot()).toMatchObject({ status: 'present', workedMinutes: 510, overtimeMinutes: 30, expectedMinutes: 480 });
  });

});
