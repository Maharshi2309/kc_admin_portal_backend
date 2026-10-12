import { authed } from '@/lib/auth/authed';
import { NotFoundError } from '@/lib/errors';
import { created, noContent, ok, readJson, readQuery } from '@/lib/http';
import * as service from './holiday.service';
import { holidayBody, holidayIdParam, holidayListQuery } from './holiday.validation';

type IdParams = { id: string };

function holidayId(params: IdParams): number {
  const parsed = holidayIdParam.safeParse(params);
  if (!parsed.success) throw new NotFoundError('This holiday was not found.');
  return parsed.data.id;
}

/** `GET /api/holidays?year&search`: a plain list, by date. */
export const list = authed({ permission: 'holiday.view' }, async ({ request }) =>
  ok(await service.list(readQuery(request, holidayListQuery))),
);

/** `GET /api/holidays/{id}` */
export const get = authed<IdParams>({ permission: 'holiday.view' }, async ({ params }) =>
  ok(await service.get(holidayId(params))),
);

/** `POST /api/holidays` */
export const create = authed({ permission: 'holiday.create' }, async ({ request, auth }) =>
  created(await service.create(await readJson(request, holidayBody), auth)),
);

/** `PATCH /api/holidays/{id}` */
export const update = authed<IdParams>({ permission: 'holiday.edit' }, async ({ request, params, auth }) => {
  const id = holidayId(params);
  return ok(await service.update(id, await readJson(request, holidayBody), auth));
});

/** `DELETE /api/holidays/{id}` → 204 (soft delete). */
export const remove = authed<IdParams>({ permission: 'holiday.delete' }, async ({ params, auth }) => {
  await service.remove(holidayId(params), auth);
  return noContent();
});
