import { z } from 'zod';
import { authed } from '@/lib/auth/authed';
import { NotFoundError } from '@/lib/errors';
import { ok, readQuery } from '@/lib/http';
import { calendarDate, id, month } from '@/lib/validation';
import * as overtime from '@/modules/overtime/overtime.service';
import * as service from './calendar.service';

const employeeParams = z.object({ id: id('employee') });
const dayParams = z.object({ id: id('employee'), date: calendarDate('Date') });

function employeeId(params: Record<string, string>): number {
  const parsed = employeeParams.safeParse(params);
  if (!parsed.success) throw new NotFoundError('This employee could not be found.');
  return parsed.data.id;
}

/** `GET /api/employees/{id}/calendar?month=YYYY-MM` */
export const monthView = authed<{ id: string }>({ permission: 'calendar.view' }, async ({ request, params }) => {
  const { month: m } = readQuery(request, z.object({ month: month() }));
  return ok(await service.month(employeeId(params), m));
});

/** `GET /api/employees/{id}/calendar/{date}` */
export const day = authed<{ id: string; date: string }>({ permission: 'calendar.view' }, async ({ params, auth }) => {
  const parsed = dayParams.safeParse(params);
  if (!parsed.success) throw new NotFoundError('This day was not found.');
  return ok(await service.day(parsed.data.id, parsed.data.date, auth));
});

const overtimeQuery = z.object({ from: calendarDate('From'), to: calendarDate('To') });

/** `GET /api/employees/{id}/overtime?from&to` */
export const overtimeReport = authed<{ id: string }>({ permission: 'overtime.view' }, async ({ request, params }) => {
  const { from, to } = readQuery(request, overtimeQuery);
  return ok(await overtime.report(employeeId(params), from, to));
});
