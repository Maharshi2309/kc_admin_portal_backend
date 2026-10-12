import { authed } from '@/lib/auth/authed';
import { created, ok, readJson } from '@/lib/http';
import * as service from './master-data.service';
import { listEntryBody } from './master-data.validation';

/** The lists feed the employee forms and filters, so they need an employee permission. */
const LISTS = { permission: ['employee.view', 'employee.create', 'employee.edit'] } as const;

/** `GET /api/departments` */
export const listDepartments = authed(LISTS, async () => ok(await service.departments()));

/** `GET /api/positions` */
export const listPositions = authed(LISTS, async () => ok(await service.positions()));

/**
 * `POST /api/departments`: adds a department. Needs `permission.manage` (the
 * administrator's key), since the app's permission list has no key for it.
 */
export const addDepartment = authed({ permission: 'permission.manage' }, async ({ request }) =>
  created(await service.addDepartment(await readJson(request, listEntryBody))),
);

/** `POST /api/positions`: adds a position. Needs `permission.manage`. */
export const addPosition = authed({ permission: 'permission.manage' }, async ({ request }) =>
  created(await service.addPosition(await readJson(request, listEntryBody))),
);

/** `GET /api/leave-types`: needs `leave.view`. */
export const listLeaveTypes = authed({ permission: 'leave.view' }, async () =>
  ok(await service.leaveTypes()),
);
