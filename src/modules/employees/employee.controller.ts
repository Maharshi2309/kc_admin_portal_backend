import { authed } from '@/lib/auth/authed';
import { NotFoundError } from '@/lib/errors';
import { created, ok, readJson, readQuery } from '@/lib/http';
import { scheduleVersionBody } from '@/modules/schedules/schedule.validation';
import * as schedules from '@/modules/schedules/schedule.service';
import * as service from './employee.service';
import {
  createEmployeeBody,
  employeeIdParam,
  employeeListQuery,
  employeeStatusBody,
  updateEmployeeBody,
} from './employee.validation';

type IdParams = { id: string };

/** A malformed id in the path is an employee that doesn't exist. */
function employeeId(params: IdParams): number {
  const parsed = employeeIdParam.safeParse(params);
  if (!parsed.success) throw new NotFoundError('This employee could not be found.');
  return parsed.data.id;
}

/** `GET /api/employees` */
export const list = authed({ permission: 'employee.view' }, async ({ request, auth }) =>
  ok(await service.list(readQuery(request, employeeListQuery), auth)),
);

/** `GET /api/employees/next-ec-number` */
export const nextEcNumber = authed({ permission: 'employee.view' }, async () => ok(await service.nextEcNumber()));

/** `POST /api/employees` (with the first working schedule) */
export const create = authed({ permission: 'employee.create' }, async ({ request, auth }) =>
  created(await service.create(await readJson(request, createEmployeeBody), auth)),
);

/** `GET /api/employees/{id}` */
export const get = authed<IdParams>({ permission: 'employee.view' }, async ({ params, auth }) =>
  ok(await service.get(employeeId(params), auth)),
);

/** `PATCH /api/employees/{id}` */
export const update = authed<IdParams>({ permission: 'employee.edit' }, async ({ request, params, auth }) => {
  const id = employeeId(params);
  return ok(await service.update(id, await readJson(request, updateEmployeeBody), auth));
});

/** `PATCH /api/employees/{id}/status` */
export const setStatus = authed<IdParams>(
  { permission: 'employee.deactivate' },
  async ({ request, params, auth }) => {
    const id = employeeId(params);
    const { status } = await readJson(request, employeeStatusBody);
    return ok(await service.setStatus(id, status, auth));
  },
);

/** `GET /api/employees/{id}/schedules`: versions, newest first */
export const listSchedules = authed<IdParams>({ permission: 'employee.view' }, async ({ params }) =>
  ok(await schedules.listForEmployee(employeeId(params))),
);

/** `POST /api/employees/{id}/schedules`: a new version from its effective date */
export const addSchedule = authed<IdParams>({ permission: 'schedule.edit' }, async ({ request, params, auth }) => {
  const id = employeeId(params);
  return created(await schedules.addVersion(id, await readJson(request, scheduleVersionBody), auth));
});
