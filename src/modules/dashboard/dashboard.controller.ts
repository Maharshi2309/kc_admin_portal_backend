import { z } from 'zod';
import { authed } from '@/lib/auth/authed';
import { ok, readQuery } from '@/lib/http';
import { calendarDate, month } from '@/lib/validation';
import * as service from './dashboard.service';

/** `GET /api/dashboard/summary?date=YYYY-MM-DD` */
export const summary = authed({ permission: 'dashboard.view' }, async ({ request, auth }) => {
  const { date } = readQuery(request, z.object({ date: calendarDate('Date') }));
  return ok(await service.summary(date, auth));
});

/** `GET /api/dashboard/attendance-chart?month=YYYY-MM` */
export const attendanceChart = authed({ permission: 'dashboard.view' }, async ({ request }) => {
  const { month: m } = readQuery(request, z.object({ month: month() }));
  return ok(await service.attendanceChart(m));
});
