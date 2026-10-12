import { z } from 'zod';
import { authed } from '@/lib/auth/authed';
import { NotFoundError } from '@/lib/errors';
import { created, ok, readJson, readQuery } from '@/lib/http';
import { id, month } from '@/lib/validation';
import * as service from './attendance.service';
import {
  addRecordBody,
  attendanceDayQuery,
  bulkPunchBody,
  correctionBody,
  punchBody,
  recordIdParam,
} from './attendance.validation';

type IdParams = { id: string };

function recordId(params: IdParams): number {
  const parsed = recordIdParam.safeParse(params);
  if (!parsed.success) throw new NotFoundError('This attendance record was not found.');
  return parsed.data.id;
}

/** `GET /api/attendance?date&status&search&department&page&pageSize` */
export const day = authed({ permission: 'attendance.view' }, async ({ request }) =>
  ok(await service.day(readQuery(request, attendanceDayQuery))),
);

/** `GET /api/attendance/{id}` */
export const getRecord = authed<IdParams>({ permission: 'attendance.view' }, async ({ params }) =>
  ok(await service.getRecord(recordId(params))),
);

/** `POST /api/attendance/punch-in` */
export const punchIn = authed({ permission: 'attendance.punch' }, async ({ request, auth }) => {
  const { employeeId } = await readJson(request, punchBody);
  return ok(await service.punchIn(employeeId, auth));
});

/** `POST /api/attendance/punch-out` */
export const punchOut = authed({ permission: 'attendance.punch' }, async ({ request, auth }) => {
  const { employeeId } = await readJson(request, punchBody);
  return ok(await service.punchOut(employeeId, auth));
});

/** `POST /api/attendance/punch-in/bulk` → `{ count }` */
export const punchInAll = authed({ permission: 'attendance.punch' }, async ({ request, auth }) => {
  const { date } = await readJson(request, bulkPunchBody);
  return ok(await service.punchInAll(date, auth));
});

/** `PATCH /api/attendance/{id}`: correction */
export const correct = authed<IdParams>({ permission: 'attendance.correct' }, async ({ request, params, auth }) => {
  const id = recordId(params);
  return ok(await service.correct(id, await readJson(request, correctionBody), auth));
});

/** `POST /api/attendance`: add a missing day */
export const addRecord = authed({ permission: 'attendance.correct' }, async ({ request, auth }) =>
  created(await service.addRecord(await readJson(request, addRecordBody), auth)),
);

const logParams = z.object({ id: id('employee') });
const logQuery = z.object({ month: month() });

/** `GET /api/employees/{id}/attendance-log?month=YYYY-MM` */
export const employeeLog = authed<IdParams>({ permission: 'attendance.view' }, async ({ request, params }) => {
  const parsed = logParams.safeParse(params);
  if (!parsed.success) throw new NotFoundError('This employee could not be found.');
  const { month: m } = readQuery(request, logQuery);
  return ok(await service.employeeLog(parsed.data.id, m));
});
