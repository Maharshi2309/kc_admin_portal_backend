import { z } from 'zod';
import { authed } from '@/lib/auth/authed';
import { NotFoundError } from '@/lib/errors';
import { created, ok, readJson, readQuery } from '@/lib/http';
import { id } from '@/lib/validation';
import * as service from './leave.service';
import {
  leaveBalancesQuery,
  leaveBody,
  leaveCalendarQuery,
  leaveIdParam,
  leaveListQuery,
  leavePreviewBody,
  leaveStatusBody,
} from './leave.validation';

type IdParams = { id: string };

function leaveId(params: IdParams): number {
  const parsed = leaveIdParam.safeParse(params);
  if (!parsed.success) throw new NotFoundError('This leave could not be found.');
  return parsed.data.id;
}

function employeeId(params: IdParams): number {
  const parsed = z.object({ id: id('employee') }).safeParse(params);
  if (!parsed.success) throw new NotFoundError('This employee could not be found.');
  return parsed.data.id;
}

/** `GET /api/leaves` */
export const list = authed({ permission: 'leave.view' }, async ({ request }) =>
  ok(await service.list(readQuery(request, leaveListQuery))),
);

/** `GET /api/leaves/{id}` */
export const get = authed<IdParams>({ permission: 'leave.view' }, async ({ params }) => ok(await service.get(leaveId(params))));

/** `POST /api/leaves` (adding it approved also needs `leave.approve`) */
export const create = authed({ permission: 'leave.create' }, async ({ request, auth }) =>
  created(await service.create(await readJson(request, leaveBody), auth)),
);

/** `PATCH /api/leaves/{id}`: pending leave only */
export const update = authed<IdParams>({ permission: 'leave.edit' }, async ({ request, params, auth }) => {
  const leave = leaveId(params);
  return ok(await service.update(leave, await readJson(request, leaveBody), auth));
});

/** `PATCH /api/leaves/{id}/status`: approve/reject (`leave.approve`) or cancel (`leave.cancel`) */
export const setStatus = authed<IdParams>(async ({ request, params, auth }) => {
  const leave = leaveId(params);
  const { status } = await readJson(request, leaveStatusBody);
  return ok(await service.setStatus(leave, status, auth));
});

/** `POST /api/leaves/preview` */
export const preview = authed({ permission: ['leave.create', 'leave.edit'] }, async ({ request }) =>
  ok(await service.preview(await readJson(request, leavePreviewBody))),
);

/** `GET /api/leave-calendar?month&employeeId` */
export const leaveCalendar = authed({ permission: 'leave.view' }, async ({ request }) => {
  const { month, employeeId: who } = readQuery(request, leaveCalendarQuery);
  return ok(await service.leaveCalendar(month, who));
});

/** `GET /api/leave-balances?search&department&page&pageSize`: active employees' Casual balances */
export const balances = authed({ permission: 'leave.view' }, async ({ request }) =>
  ok(await service.balances(readQuery(request, leaveBalancesQuery))),
);

/** `GET /api/employees/{id}/leave-balance` */
export const employeeBalance = authed<IdParams>({ permission: 'employee.view' }, async ({ params }) =>
  ok(await service.employeeBalance(employeeId(params))),
);

/** `GET /api/employees/{id}/leaves` */
export const employeeLeaves = authed<IdParams>({ permission: 'employee.view' }, async ({ params }) =>
  ok(await service.employeeHistory(employeeId(params))),
);
