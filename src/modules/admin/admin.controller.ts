import { type AuthedRouteContext, authed } from '@/lib/auth/authed';
import { NotFoundError } from '@/lib/errors';
import { ok, readJson } from '@/lib/http';
import * as service from './admin.service';
import { clearDataBody, listCodeParam, recordIdParam } from './admin.validation';

/**
 * Main-admin-only deletes (`/api/admin/...`). Not used by the app; the main
 * admin calls them from Swagger (`/api/docs`). Everyone else gets 403.
 */

type IdParams = { id: string };
type CodeParams = { code: string };

function mainAdmin<P extends Record<string, string>>(handler: (context: AuthedRouteContext<P>) => Promise<Response>) {
  return authed<P>(async (context) => {
    await service.requireMainAdmin(context.auth);
    return handler(context);
  });
}

function deleteById(what: string, remove: (id: number, context: AuthedRouteContext<IdParams>) => Promise<service.DeleteResult>) {
  return mainAdmin<IdParams>(async (context) => {
    const parsed = recordIdParam.safeParse(context.params);
    if (!parsed.success) throw new NotFoundError(`This ${what} was not found.`);
    const result = await remove(parsed.data.id, context);
    context.log.warn('Admin deleted a record', { what, id: parsed.data.id, ...result.deleted });
    return ok(result);
  });
}

function deleteByCode(what: string, remove: (code: string) => Promise<service.DeleteResult>) {
  return mainAdmin<CodeParams>(async (context) => {
    const parsed = listCodeParam.safeParse(context.params);
    if (!parsed.success) throw new NotFoundError(`This ${what} was not found.`);
    const result = await remove(parsed.data.code);
    context.log.warn('Admin deleted a record', { what, code: parsed.data.code });
    return ok(result);
  });
}

/** `DELETE /api/admin/employees/{id}` */
export const deleteEmployee = deleteById('employee', (id) => service.deleteEmployee(id));
/** `DELETE /api/admin/attendance/{id}` */
export const deleteAttendance = deleteById('attendance record', (id) => service.deleteAttendance(id));
/** `DELETE /api/admin/leaves/{id}` */
export const deleteLeave = deleteById('leave', (id) => service.deleteLeave(id));
/** `DELETE /api/admin/holidays/{id}` */
export const deleteHoliday = deleteById('holiday', (id) => service.deleteHoliday(id));
/** `DELETE /api/admin/users/{id}` */
export const deleteUser = deleteById('user', (id, { auth }) => service.deleteUser(id, auth));
/** `DELETE /api/admin/departments/{code}` */
export const deleteDepartment = deleteByCode('department', service.deleteDepartment);
/** `DELETE /api/admin/positions/{code}` */
export const deletePosition = deleteByCode('position', service.deletePosition);

/** `POST /api/admin/clear-data` */
export const clearData = mainAdmin(async ({ request, auth, log }) => {
  const body = await readJson(request, clearDataBody);
  const result = await service.clearAllData(body, auth);
  log.warn('Admin cleared all data', { ...result.deleted, auditLogsCleared: result.auditLogsCleared });
  return ok(result);
});
