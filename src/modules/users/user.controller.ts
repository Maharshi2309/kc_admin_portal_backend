import { authed } from '@/lib/auth/authed';
import { NotFoundError } from '@/lib/errors';
import { created, ok, readJson, readQuery } from '@/lib/http';
import * as audit from '@/modules/audit/audit.service';
import * as service from './user.service';
import { createUserBody, setPermissionsBody, updateUserBody, userIdParam, userListQuery } from './user.validation';

type IdParams = { id: string };
const MANAGE = { permission: 'permission.manage' } as const;

function userId(params: IdParams): number {
  const parsed = userIdParam.safeParse(params);
  if (!parsed.success) throw new NotFoundError('This user was not found.');
  return parsed.data.id;
}

/** `GET /api/permissions` */
export const permissions = authed(MANAGE, async () => ok(service.catalogue()));

/** `GET /api/users?search&page&pageSize` */
export const list = authed(MANAGE, async ({ request }) => ok(await service.list(readQuery(request, userListQuery))));

/** `POST /api/users` */
export const create = authed(MANAGE, async ({ request, auth }) =>
  created(await service.create(await readJson(request, createUserBody), auth)),
);

/** `GET /api/users/{id}` */
export const get = authed<IdParams>(MANAGE, async ({ params }) => ok(await service.get(userId(params))));

/** `PATCH /api/users/{id}` */
export const update = authed<IdParams>(MANAGE, async ({ request, params, auth }) => {
  const id = userId(params);
  return ok(await service.update(id, await readJson(request, updateUserBody), auth));
});

/** `PUT /api/users/{id}/permissions` */
export const setPermissions = authed<IdParams>(MANAGE, async ({ request, params, auth }) => {
  const id = userId(params);
  const { permissions: keys } = await readJson(request, setPermissionsBody);
  return ok(await service.setPermissions(id, keys, auth));
});

/** `GET /api/audit-logs` */
export const auditLogs = authed({ permission: 'audit.view' }, async ({ request }) =>
  ok(await audit.list(readQuery(request, audit.auditListQuery))),
);
