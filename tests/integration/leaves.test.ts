import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as balancesRoute } from '@/app/api/leave-balances/route';
import { GET as listRoute, POST as createRoute } from '@/app/api/leaves/route';
import { PATCH as statusRoute } from '@/app/api/leaves/[id]/status/route';
import * as attendance from '@/modules/attendance/attendance.service';
import type { AuthContext } from '@/modules/auth/auth.types';
import * as calendar from '@/modules/calendar/calendar.service';
import * as dashboard from '@/modules/dashboard/dashboard.service';
import * as holidays from '@/modules/holidays/holiday.service';
import * as leaves from '@/modules/leaves/leave.service';
import { apiRequest, createSignedInUser, noParams, seedTestPermissions, testDb, withParams } from './setup';

/**
 * Leave end to end, in 2014. The employee joined on 6 January and works
 * Mon–Sat 09:00–17:30; Sunday off. Wed 12 March is a company holiday.
 * Casual leave is earned at 1 day a month from the joining month (the tests
 * set the policy start month to 2000-01), so 3 days by March and 4 by April.
 * Unpaid leave has no balance.
 */

const db = testDb();
const tag = `leave-${Date.now()}`;
const run = String(Date.now()).slice(-7);
const clock = () => new Date('2014-03-01T12:00:00+05:30');
const at = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);
let admin: AuthContext;
let tokens = { creator: '', viewer: '' };
let employeeId = 0;
let otherEmployeeId = 0;
const holidayIds: number[] = [];

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../contract/fixtures/${name}`, import.meta.url), 'utf8')) as Record<string, unknown>;
const keys = (value: object) => Object.keys(value).sort();

const body = (overrides: Record<string, unknown> = {}) => ({
  employeeId,
  leaveTypeId: 'casual',
  startDate: '2014-03-10',
  endDate: '2014-03-12',
  isHalfDay: false,
  reason: 'family_function' as const,
  remarks: null,
  status: 'approved' as const,
  splitExcessAsUnpaid: false,
  ...overrides,
});

beforeAll(async () => {
  await seedTestPermissions(db);
  const user = await createSignedInUser(db, tag, 'admin', []);
  admin = {
    userId: user.id,
    sessionId: 'test',
    name: 'admin',
    email: user.email,
    permissions: new Set(['leave.view', 'leave.create', 'leave.edit', 'leave.approve', 'leave.cancel', 'audit.view']),
  };
  tokens = {
    creator: (await createSignedInUser(db, tag, 'creator', ['leave.view', 'leave.create'])).token,
    viewer: (await createSignedInUser(db, tag, 'viewer', ['leave.view'])).token,
  };
  for (const [i, name] of ['Kavya', 'Mehul'].entries()) {
    const e = await db.employee.create({
      data: {
        ecNumber: `KC3${run}${i}`,
        name: `${name} ${tag}`,
        mobile: '9876543210',
        departmentCode: 'tailor',
        positionCode: 'tailor',
        joiningDate: new Date('2014-01-06T00:00:00Z'),
        status: i === 0 ? 'active' : 'inactive',
        createdById: user.id,
        updatedById: user.id,
        schedules: {
          create: {
            effectiveFrom: new Date('2014-01-06T00:00:00Z'),
            startTime: new Date('1970-01-01T09:00:00Z'),
            endTime: new Date('1970-01-01T17:30:00Z'),
            breakMinutes: 60,
            breakStart: new Date('1970-01-01T13:00:00Z'),
            breakEnd: new Date('1970-01-01T14:00:00Z'),
            weeklyOffDays: [7],
            expectedMinutes: 450,
            createdById: user.id,
          },
        },
      },
    });
    if (i === 0) employeeId = e.id;
    else otherEmployeeId = e.id;
  }
  holidayIds.push(Number((await holidays.create({ date: '2014-03-12', name: `Holi ${tag}`, description: null }, admin)).id));
});

afterAll(async () => {
  await db.leave.updateMany({ where: { employeeId }, data: { unpaidPartOfId: null } });
  await db.leave.deleteMany({ where: { employeeId } });
  await db.attendanceRecord.deleteMany({ where: { employeeId } });
  await db.employee.update({ where: { id: employeeId }, data: { status: 'inactive' } });
  await db.companyHoliday.updateMany({
    where: { id: { in: holidayIds }, deletedAt: null },
    data: { deletedAt: new Date(), deletedById: admin.userId, liveDate: null },
  });
  await db.$disconnect();
});

let approvedId = '';
let halfDayId = '';

describe('the Casual balance', () => {
  it('previews days (holidays excluded) and how many Casual covers', async () => {
    const preview = await leaves.preview({ ...body({ endDate: '2014-03-14' }), leaveId: null }, clock);
    expect(preview).toEqual({ days: 4, paidDays: 3, unpaidDays: 1, availableCasual: 3 });
    expect(keys(preview)).toEqual(keys(fixture('leaves.preview.response.json')));
  });

  it("doesn't use a future month's day", async () => {
    // In January only January's day is earned: 2 days there are 1 paid, 1 unpaid.
    const preview = await leaves.preview({ ...body({ startDate: '2014-01-07', endDate: '2014-01-08' }), leaveId: null }, clock);
    expect(preview).toMatchObject({ days: 2, paidDays: 1, unpaidDays: 1 });
  });

  it('previews Unpaid leave as all unpaid, with no Casual figure', async () => {
    const preview = await leaves.preview({ ...body({ leaveTypeId: 'unpaid' }), leaveId: null }, clock);
    expect(preview).toEqual({ days: 2, paidDays: 0, unpaidDays: 2, availableCasual: null });
  });

  it('refuses Casual leave beyond the balance with INSUFFICIENT_LEAVE_BALANCE', async () => {
    await expect(leaves.create(body({ endDate: '2014-03-14' }), admin, clock)).rejects.toMatchObject({
      status: 422,
      code: 'INSUFFICIENT_LEAVE_BALANCE',
      message: 'Only 3 days of Casual leave are available for these dates. Save the other 1 day as Unpaid leave?',
    });
  });
});

describe('adding leave', () => {
  it('adds approved leave, counting only working days', async () => {
    const leave = await leaves.create(body(), admin, clock);
    expect(leave).toMatchObject({
      days: 2,
      status: 'approved',
      addedBy: 'admin',
      startDate: '2014-03-10',
      endDate: '2014-03-12',
      employee: { department: 'tailor', position: 'tailor' },
      isPaid: true,
      balanceAfter: 1,
      unpaidPartId: null,
    });
    expect(keys(leave)).toEqual(keys(fixture('leaves.get.response.json')));
    approvedId = leave.id;
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityType: 'leave', entityId: leave.id } });
    expect(audit).toMatchObject({ action: 'leave.create', summary: 'Added Casual leave (approved)' });
  });

  it('marks the covered working days on leave in attendance', async () => {
    const log = await attendance.employeeLog(employeeId, '2014-03', () => at('2014-03-14', '20:00'));
    const status = (date: string) => log.find((d) => d.date === date)!.status;
    expect([status('2014-03-10'), status('2014-03-11'), status('2014-03-12'), status('2014-03-13')]).toEqual([
      'on_leave',
      'on_leave',
      'holiday',
      'absent',
    ]);
  });

  it('refuses overlapping leave, dates that are all off, and inactive employees', async () => {
    await expect(leaves.create(body({ startDate: '2014-03-11', endDate: '2014-03-11', status: 'pending' }), admin, clock)).rejects.toMatchObject({
      fieldErrors: { startDate: ['This employee already has leave on some of these dates.'] },
    });
    await expect(leaves.create(body({ startDate: '2014-03-16', endDate: '2014-03-16' }), admin, clock)).rejects.toMatchObject({
      fieldErrors: { startDate: ['The selected dates are all holidays or weekly offs.'] },
    });
    await expect(leaves.create(body({ employeeId: otherEmployeeId }), admin, clock)).rejects.toMatchObject({
      fieldErrors: { employeeId: ['This employee is inactive'] },
    });
  });

  it('counts a half day as 0.5 on one date, and pending leave reserves the balance', async () => {
    const half = await leaves.create(
      body({ startDate: '2014-03-17', endDate: '2014-03-20', isHalfDay: true, status: 'pending' }),
      admin,
      clock,
    );
    expect(half).toMatchObject({ days: 0.5, endDate: '2014-03-17', status: 'pending', balanceAfter: 0.5 });
    halfDayId = half.id;
    const balance = await leaves.employeeBalance(employeeId, clock);
    expect(balance).toEqual({ asOf: '2014-03-01', accrued: 3, used: 2, pending: 0.5, remaining: 0.5, unpaidTaken: 0 });
    expect(keys(balance)).toEqual(keys(fixture('employees.leave-balance.response.json')));
  });

  it('lets unpaid leave go past any balance', async () => {
    const unpaid = await leaves.create(body({ leaveTypeId: 'unpaid', startDate: '2014-03-24', endDate: '2014-03-29' }), admin, clock);
    expect(unpaid).toMatchObject({ days: 6, isPaid: false, balanceAfter: null });
    expect((await leaves.employeeBalance(employeeId, clock)).unpaidTaken).toBe(6);
  });

  it('needs leave.approve to add leave already approved', async () => {
    const response = await createRoute(apiRequest('/leaves', tokens.creator, { method: 'POST', body: { ...body(), employeeId: String(employeeId), startDate: '2014-04-01', endDate: '2014-04-01' } }), noParams);
    expect(response.status).toBe(403);
    expect(((await response.json()) as { message: string }).message).toBe('You do not have permission to approve and reject.');
  });
});

describe('editing and status changes', () => {
  it('edits only pending leave', async () => {
    await expect(leaves.update(Number(approvedId), body(), admin, clock)).rejects.toMatchObject({
      status: 409,
      code: 'LEAVE_NOT_EDITABLE',
    });
    const moved = await leaves.update(
      Number(halfDayId),
      body({ startDate: '2014-03-18', endDate: '2014-03-18', isHalfDay: true, status: 'pending' }),
      admin,
      clock,
    );
    expect(moved).toMatchObject({ startDate: '2014-03-18', days: 0.5, status: 'pending' });
  });

  it('approves pending leave once; other transitions are refused', async () => {
    expect((await leaves.setStatus(Number(halfDayId), 'approved', admin, clock)).status).toBe('approved');
    await expect(leaves.setStatus(Number(halfDayId), 'rejected', admin, clock)).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_STATUS_TRANSITION',
      message: 'A approved leave cannot be rejected.',
    });
  });

  it('checks approve and cancel permissions separately', async () => {
    const response = await statusRoute(
      apiRequest(`/leaves/${halfDayId}/status`, tokens.viewer, { method: 'PATCH', body: { status: 'cancelled' } }),
      withParams({ id: halfDayId }),
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as { message: string }).message).toBe('You do not have permission to cancel leave.');
  });

  it('cancelling approved leave gives the days back', async () => {
    const cancelled = await leaves.setStatus(Number(halfDayId), 'cancelled', admin, clock);
    expect(cancelled.balanceAfter).toBeNull();
    expect(await leaves.employeeBalance(employeeId, clock)).toMatchObject({ used: 2, pending: 0, remaining: 1 });
  });
});

describe('holidays inside leave', () => {
  it('gives a day back when a holiday is added inside approved leave', async () => {
    holidayIds.push(Number((await holidays.create({ date: '2014-03-11', name: `Extra ${tag}`, description: null }, admin)).id));
    expect((await leaves.get(Number(approvedId))).days).toBe(1);
    expect(await leaves.employeeBalance(employeeId, clock)).toMatchObject({ used: 1, remaining: 2 });
  });
});

describe('lists, history and calendars', () => {
  it('lists leave with status counts that ignore the status tab', async () => {
    const response = await listRoute(apiRequest(`/leaves?search=${encodeURIComponent(`kavya ${tag}`)}&status=approved`, tokens.viewer), noParams);
    const page = (await response.json()) as { items: { status: string }[]; total: number; counts: Record<string, number> };
    expect(page.items.map((l) => l.status)).toEqual(['approved', 'approved']);
    expect(page.counts).toEqual({ all: 3, pending: 0, approved: 2, rejected: 0, cancelled: 1 });
    expect(keys(page)).toEqual(keys(fixture('leaves.list.response.json')));
    expect(keys(page.items[0]!)).toEqual(keys((fixture('leaves.list.response.json').items as object[])[0]!));
  });

  it("gives the employee's leave history, newest first, with isPaid and balanceAfter", async () => {
    const history = await leaves.employeeHistory(employeeId, clock);
    expect(history.map((h) => [h.startDate, h.status, h.isPaid, h.balanceAfter])).toEqual([
      ['2014-03-24', 'approved', false, null],
      ['2014-03-18', 'cancelled', true, null],
      ['2014-03-10', 'approved', true, 2],
    ]);
    expect(keys(history[0]!)).toEqual(keys((fixture('employees.leaves.response.json') as unknown as object[])[0]!));
  });

  it("gives the leave date picker the month's holidays and the employee's weekly offs", async () => {
    const month = await leaves.leaveCalendar('2014-03', employeeId);
    expect(month).toMatchObject({
      month: '2014-03-01',
      weeklyOffDays: [7],
      weekOffDates: ['2014-03-02', '2014-03-09', '2014-03-16', '2014-03-23', '2014-03-30'],
    });
    expect(month.holidays.map((h) => h.date)).toEqual(expect.arrayContaining(['2014-03-11', '2014-03-12']));
    expect(keys(month)).toEqual(keys(fixture('leave-calendar.response.json')));
  });

  it('shows leave on the employee calendar and the dashboard', async () => {
    const cal = await calendar.month(employeeId, '2014-03', () => at('2014-03-31', '20:00'));
    const day = (date: string) => cal.days.find((d) => d.date === date)!;
    expect(day('2014-03-10').leaves).toEqual([{ id: approvedId, leaveType: { id: 'casual', name: 'Casual' }, status: 'approved', isHalfDay: false }]);
    expect(day('2014-03-18').leaves).toEqual([]); // cancelled leave is left out
    expect(cal.summary.leaveDays).toBe(1 + 6); // 10 March, plus 24–29 March unpaid (six working days)

    const summary = await dashboard.summary('2014-03-10', admin, () => at('2014-03-10', '12:00'));
    expect(summary.onLeave.map((l) => [l.employee.name, l.leaveType, l.endDate, l.days])).toEqual([
      [`Kavya ${tag}`, 'Casual', '2014-03-12', 1],
    ]);
  });
});

describe('splitting leave beyond the balance', () => {
  // April earns the 4th day; 1 is used in March, so 3 are free for April.
  const april = () => body({ startDate: '2014-04-01', endDate: '2014-04-08' });

  it('refuses without splitExcessAsUnpaid', async () => {
    await expect(leaves.create(april(), admin, clock)).rejects.toMatchObject({
      code: 'INSUFFICIENT_LEAVE_BALANCE',
      message: 'Only 3 days of Casual leave are available for these dates. Save the other 4 days as Unpaid leave?',
    });
  });

  it('saves the covered days as Casual and the latest days as linked Unpaid leave', async () => {
    const casual = await leaves.create({ ...april(), splitExcessAsUnpaid: true }, admin, clock);
    expect(casual).toMatchObject({
      leaveType: { id: 'casual' },
      startDate: '2014-04-01',
      endDate: '2014-04-03',
      days: 3,
      balanceAfter: 0,
    });
    expect(casual.unpaidPartId).not.toBeNull();
    const unpaid = await leaves.get(Number(casual.unpaidPartId));
    expect(unpaid).toMatchObject({
      leaveType: { id: 'unpaid' },
      startDate: '2014-04-04',
      endDate: '2014-04-08',
      days: 4,
      status: 'approved',
      reason: 'family_function',
      isPaid: false,
      unpaidPartId: null,
    });
    expect(await db.leave.findUniqueOrThrow({ where: { id: Number(unpaid.id) } })).toMatchObject({
      unpaidPartOfId: Number(casual.id),
    });
  });

  it('saves all of it as Unpaid when no Casual day is free', async () => {
    const leave = await leaves.create(
      { ...body({ startDate: '2014-04-09', endDate: '2014-04-10' }), splitExcessAsUnpaid: true },
      admin,
      clock,
    );
    expect(leave).toMatchObject({ leaveType: { id: 'unpaid' }, days: 2, unpaidPartId: null });
  });

  it('lists active employees with their balances and totals', async () => {
    const response = await balancesRoute(
      apiRequest(`/leave-balances?search=${encodeURIComponent(tag)}&department=tailor`, tokens.viewer),
      noParams,
    );
    expect(response.status).toBe(200);
    const page = (await response.json()) as { items: { employee: { name: string }; balance: object }[]; summary: object };
    // Mehul is inactive, so only Kavya is listed.
    expect(page.items.map((i) => i.employee.name)).toEqual([`Kavya ${tag}`]);
    expect(keys(page)).toEqual(keys(fixture('leave-balances.response.json')));
    expect(page.summary).toMatchObject({ employees: 1, used: 4, unpaidTaken: 6 + 4 + 2 });
  });
});
