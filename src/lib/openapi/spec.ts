import { z } from 'zod';
import { calendarDate, month } from '@/lib/validation';
import { addRecordBody, attendanceDayQuery, bulkPunchBody, correctionBody, punchBody } from '@/modules/attendance/attendance.validation';
import { clearDataBody } from '@/modules/admin/admin.validation';
import { auditListQuery } from '@/modules/audit/audit.service';
import { loginBody } from '@/modules/auth/auth.validation';
import {
  createEmployeeBody,
  employeeListQuery,
  employeeStatusBody,
  updateEmployeeBody,
} from '@/modules/employees/employee.validation';
import { holidayBody, holidayListQuery } from '@/modules/holidays/holiday.validation';
import { listEntryBody } from '@/modules/master-data/master-data.validation';
import {
  leaveBalancesQuery,
  leaveBody,
  leaveCalendarQuery,
  leaveListQuery,
  leavePreviewBody,
  leaveStatusBody,
} from '@/modules/leaves/leave.validation';
import { scheduleVersionBody } from '@/modules/schedules/schedule.validation';
import { createUserBody, setPermissionsBody, updateUserBody, userListQuery } from '@/modules/users/user.validation';
import { version } from '../../../package.json';
import { type Schema, components, ref } from './components';

/**
 * The OpenAPI 3.1 description of every endpoint, served at
 * `/api/openapi.json` and shown by Swagger UI at `/api/docs`.
 *
 * Request bodies and query parameters are generated from the same Zod
 * schemas the API validates with, so they can't drift. A test checks that
 * every route in src/app/api is listed here and vice versa.
 */

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

type Endpoint = {
  method: Method;
  /** Relative to the server URL (`/api`), e.g. `/employees/{id}`. */
  path: string;
  tag: string;
  summary: string;
  description?: string;
  /**
   * Required permission key(s); `null` = any signed-in user; `'public'` = no
   * sign-in; `'main-admin'` = only the main (bootstrap) admin.
   */
  permission: string | string[] | null | 'public' | 'main-admin';
  query?: z.ZodType;
  body?: z.ZodType;
  /** Success status and body: a component name, `[name]` for a list, or null for no body. */
  response: { status: number; schema: string | [string] | null; description?: string };
  /** Extra error statuses beyond the automatic ones (401/403/422/404/429). */
  errors?: { status: number; description: string }[];
};

const id = 'Record id';

/** `DELETE /admin/{path}` for the main admin. */
function adminDelete(path: string, summary: string, description: string, errors?: Endpoint['errors']): Endpoint[] {
  return [{ method: 'delete', path: `/admin/${path}`, tag: 'Admin', summary, description, permission: 'main-admin', response: { status: 200, schema: 'AdminDeleteResult' }, errors }];
}

const endpoints: Endpoint[] = [
  // --- Auth ---------------------------------------------------------------
  {
    method: 'post',
    path: '/auth/login',
    tag: 'Auth',
    summary: 'Sign in',
    description:
      'Returns an access token for `Authorization: Bearer <token>`. Wrong email or password → 401 "Invalid email or password."; 5 failed attempts per email and address pause sign-in for 15 minutes (429).',
    permission: 'public',
    body: loginBody,
    response: { status: 200, schema: 'LoginResponse' },
    errors: [{ status: 401, description: 'Wrong credentials, or the account is deactivated' }],
  },
  { method: 'get', path: '/auth/me', tag: 'Auth', summary: 'The signed-in user and their permission keys', permission: null, response: { status: 200, schema: 'AuthUser' } },
  { method: 'post', path: '/auth/logout', tag: 'Auth', summary: "End this device's session", permission: null, response: { status: 204, schema: null } },

  // --- Master data --------------------------------------------------------
  { method: 'get', path: '/departments', tag: 'Master data', summary: 'Department codes and names, with active employee counts', permission: ['employee.view', 'employee.create', 'employee.edit'], response: { status: 200, schema: ['ListEntry'] } },
  {
    method: 'post',
    path: '/departments',
    tag: 'Master data',
    summary: 'Add a department',
    description: 'Without a `code`, it is made from the name ("Store Keeper" → `store_keeper`). Entries are never edited or removed, since employees refer to them by code.',
    permission: 'permission.manage',
    body: listEntryBody,
    response: { status: 201, schema: 'ListEntry' },
    errors: [{ status: 409, description: 'The code or name is already used' }],
  },
  { method: 'get', path: '/positions', tag: 'Master data', summary: 'Position codes and names, with active employee counts', permission: ['employee.view', 'employee.create', 'employee.edit'], response: { status: 200, schema: ['ListEntry'] } },
  {
    method: 'post',
    path: '/positions',
    tag: 'Master data',
    summary: 'Add a position',
    description: 'Without a `code`, it is made from the name. Positions are independent of departments.',
    permission: 'permission.manage',
    body: listEntryBody,
    response: { status: 201, schema: 'ListEntry' },
    errors: [{ status: 409, description: 'The code or name is already used' }],
  },
  { method: 'get', path: '/leave-types', tag: 'Master data', summary: 'Casual (paid, with a balance) and Unpaid', permission: 'leave.view', response: { status: 200, schema: ['LeaveType'] } },

  // --- Dashboard ----------------------------------------------------------
  {
    method: 'get',
    path: '/dashboard/summary',
    tag: 'Dashboard',
    summary: "A day's figures, among employees scheduled to work",
    description: 'Overtime fields are null without `overtime.view`.',
    permission: 'dashboard.view',
    query: z.object({ date: calendarDate('Date') }),
    response: { status: 200, schema: 'DashboardSummary' },
  },
  {
    method: 'get',
    path: '/dashboard/attendance-chart',
    tag: 'Dashboard',
    summary: 'Present share of scheduled employees per day of a month',
    permission: 'dashboard.view',
    query: z.object({ month: month() }),
    response: { status: 200, schema: 'AttendanceChart' },
  },

  // --- Employees ----------------------------------------------------------
  { method: 'get', path: '/employees', tag: 'Employees', summary: 'List, search and filter employees', permission: 'employee.view', query: employeeListQuery, response: { status: 200, schema: 'EmployeeList' } },
  { method: 'get', path: '/employees/next-ec-number', tag: 'Employees', summary: 'Suggested next EC number', permission: 'employee.view', response: { status: 200, schema: 'NextEcNumber' } },
  {
    method: 'post',
    path: '/employees',
    tag: 'Employees',
    summary: 'Add an employee with their first working schedule',
    permission: 'employee.create',
    body: createEmployeeBody,
    response: { status: 201, schema: 'Employee' },
    errors: [{ status: 409, description: 'EC number already in use (`DUPLICATE`)' }],
  },
  { method: 'get', path: '/employees/{id}', tag: 'Employees', summary: 'One employee', permission: 'employee.view', response: { status: 200, schema: 'Employee' } },
  {
    method: 'patch',
    path: '/employees/{id}',
    tag: 'Employees',
    summary: 'Edit an employee',
    description: 'Same body as create, without `schedule`. Changing `status` here also needs `employee.deactivate`.',
    permission: 'employee.edit',
    body: updateEmployeeBody,
    response: { status: 200, schema: 'Employee' },
    errors: [{ status: 409, description: 'EC number already in use (`DUPLICATE`)' }],
  },
  { method: 'patch', path: '/employees/{id}/status', tag: 'Employees', summary: 'Deactivate or reactivate (employees are never deleted)', permission: 'employee.deactivate', body: employeeStatusBody, response: { status: 200, schema: 'Employee' } },
  { method: 'get', path: '/employees/{id}/schedules', tag: 'Working schedules', summary: 'Schedule versions, newest first', permission: 'employee.view', response: { status: 200, schema: ['WorkSchedule'] } },
  {
    method: 'post',
    path: '/employees/{id}/schedules',
    tag: 'Working schedules',
    summary: 'Change the schedule from a date',
    description: 'Adds a version from `effectiveFrom`; the previous one ends the day before. Recorded attendance from that date is recalculated.',
    permission: 'schedule.edit',
    body: scheduleVersionBody,
    response: { status: 201, schema: 'WorkSchedule' },
    errors: [{ status: 409, description: 'A schedule already starts that day (`SCHEDULE_OVERLAP`)' }],
  },
  { method: 'get', path: '/employees/{id}/attendance-log', tag: 'Attendance', summary: "An employee's days of a month, newest first", permission: 'attendance.view', query: z.object({ month: month() }), response: { status: 200, schema: ['AttendanceRecord'] } },
  {
    method: 'get',
    path: '/employees/{id}/leave-balance',
    tag: 'Leave',
    summary: "The employee's Casual balance today",
    description: '1 Casual day is earned per month and carries forward. `remaining = accrued − used − pending`; Unpaid leave never uses it.',
    permission: 'employee.view',
    response: { status: 200, schema: 'LeaveBalance' },
  },
  { method: 'get', path: '/employees/{id}/leaves', tag: 'Leave', summary: "An employee's leave history, with isPaid and balanceAfter", permission: 'employee.view', response: { status: 200, schema: ['LeaveHistoryItem'] } },
  {
    method: 'get',
    path: '/employees/{id}/overtime',
    tag: 'Overtime',
    summary: 'Overtime report for a date range',
    permission: 'overtime.view',
    query: z.object({ from: calendarDate('From'), to: calendarDate('To') }),
    response: { status: 200, schema: 'Overtime' },
  },
  { method: 'get', path: '/employees/{id}/calendar', tag: 'Employee calendar', summary: 'Every day of a month with a summary', permission: 'calendar.view', query: z.object({ month: month() }), response: { status: 200, schema: 'CalendarMonth' } },
  {
    method: 'get',
    path: '/employees/{id}/calendar/{date}',
    tag: 'Employee calendar',
    summary: 'One day with its change history',
    description: '`history` is empty without `audit.view`.',
    permission: 'calendar.view',
    response: { status: 200, schema: 'CalendarDayDetail' },
  },

  // --- Attendance ---------------------------------------------------------
  { method: 'get', path: '/attendance', tag: 'Attendance', summary: "A date's attendance with summary tiles", permission: 'attendance.view', query: attendanceDayQuery, response: { status: 200, schema: 'AttendanceDay' } },
  { method: 'get', path: '/attendance/{id}', tag: 'Attendance', summary: 'One attendance record', permission: 'attendance.view', response: { status: 200, schema: 'AttendanceRecord' } },
  {
    method: 'post',
    path: '/attendance/punch-in',
    tag: 'Attendance',
    summary: 'Punch in now (server time)',
    permission: 'attendance.punch',
    body: punchBody,
    response: { status: 200, schema: 'AttendanceRecord' },
    errors: [{ status: 409, description: 'Already punched in, on leave, inactive or not joined yet (`ATTENDANCE_STATE`)' }],
  },
  {
    method: 'post',
    path: '/attendance/punch-out',
    tag: 'Attendance',
    summary: 'Punch out now (server time)',
    permission: 'attendance.punch',
    body: punchBody,
    response: { status: 200, schema: 'AttendanceRecord' },
    errors: [{ status: 409, description: 'Not punched in, or already punched out (`ATTENDANCE_STATE`)' }],
  },
  { method: 'post', path: '/attendance/punch-in/bulk', tag: 'Attendance', summary: 'Punch in everyone still absent today', permission: 'attendance.punch', body: bulkPunchBody, response: { status: 200, schema: 'Count' } },
  { method: 'patch', path: '/attendance/{id}', tag: 'Attendance', summary: 'Correct a record (reason required)', permission: 'attendance.correct', body: correctionBody, response: { status: 200, schema: 'AttendanceRecord' } },
  {
    method: 'post',
    path: '/attendance',
    tag: 'Attendance',
    summary: 'Add a missing day (e.g. forgot to punch, holiday work)',
    permission: 'attendance.correct',
    body: addRecordBody,
    response: { status: 201, schema: 'AttendanceRecord' },
    errors: [{ status: 409, description: 'The day already has a record (`ATTENDANCE_STATE`)' }],
  },

  // --- Leave --------------------------------------------------------------
  { method: 'get', path: '/leaves', tag: 'Leave', summary: 'List leave with counts per status', permission: 'leave.view', query: leaveListQuery, response: { status: 200, schema: 'LeaveList' } },
  { method: 'get', path: '/leaves/{id}', tag: 'Leave', summary: 'One leave', permission: 'leave.view', response: { status: 200, schema: 'Leave' } },
  {
    method: 'post',
    path: '/leaves',
    tag: 'Leave',
    summary: 'Add leave',
    description:
      'Adding it as `approved` also needs `leave.approve`. Overlaps return field errors. Casual leave beyond the balance returns 422 `INSUFFICIENT_LEAVE_BALANCE` (no field errors) unless `splitExcessAsUnpaid` is true; then the covered days are saved as Casual and the latest days as a linked Unpaid leave, and the response is the Casual part (with `unpaidPartId`), or the Unpaid leave when no Casual day is free.',
    permission: 'leave.create',
    body: leaveBody,
    response: { status: 201, schema: 'Leave' },
  },
  {
    method: 'patch',
    path: '/leaves/{id}',
    tag: 'Leave',
    summary: 'Edit pending leave',
    description: 'Same body and balance rules as adding leave, including `splitExcessAsUnpaid`.',
    permission: 'leave.edit',
    body: leaveBody,
    response: { status: 200, schema: 'Leave' },
    errors: [{ status: 409, description: 'The leave is no longer pending (`LEAVE_NOT_EDITABLE`)' }],
  },
  {
    method: 'patch',
    path: '/leaves/{id}/status',
    tag: 'Leave',
    summary: 'Approve, reject or cancel',
    description: '`approved` / `rejected` (from pending) need `leave.approve`; `cancelled` (from pending or approved) needs `leave.cancel`.',
    permission: null,
    body: leaveStatusBody,
    response: { status: 200, schema: 'Leave' },
    errors: [{ status: 409, description: 'Not allowed from the current status (`INVALID_STATUS_TRANSITION`)' }],
  },
  { method: 'post', path: '/leaves/preview', tag: 'Leave', summary: 'Days, how many Casual covers, and the Casual days available, without saving', permission: ['leave.create', 'leave.edit'], body: leavePreviewBody, response: { status: 200, schema: 'LeavePreview' } },
  {
    method: 'get',
    path: '/leave-balances',
    tag: 'Leave',
    summary: "Active employees' Casual balances, sorted by name",
    description: '`summary` adds up every matching employee, not just the page.',
    permission: 'leave.view',
    query: leaveBalancesQuery,
    response: { status: 200, schema: 'LeaveBalances' },
  },
  { method: 'get', path: '/leave-calendar', tag: 'Leave', summary: "Holidays and an employee's weekly offs for the date picker", permission: 'leave.view', query: leaveCalendarQuery, response: { status: 200, schema: 'LeaveCalendar' } },

  // --- Holidays -----------------------------------------------------------
  { method: 'get', path: '/holidays', tag: 'Holidays', summary: 'Company holidays, by date', permission: 'holiday.view', query: holidayListQuery, response: { status: 200, schema: ['Holiday'] } },
  { method: 'get', path: '/holidays/{id}', tag: 'Holidays', summary: 'One holiday', permission: 'holiday.view', response: { status: 200, schema: 'Holiday' } },
  {
    method: 'post',
    path: '/holidays',
    tag: 'Holidays',
    summary: 'Add a holiday',
    permission: 'holiday.create',
    body: holidayBody,
    response: { status: 201, schema: 'Holiday' },
    errors: [{ status: 409, description: 'Another holiday is on that date (`errors.date`)' }],
  },
  { method: 'patch', path: '/holidays/{id}', tag: 'Holidays', summary: 'Edit a holiday', permission: 'holiday.edit', body: holidayBody, response: { status: 200, schema: 'Holiday' } },
  { method: 'delete', path: '/holidays/{id}', tag: 'Holidays', summary: 'Delete a holiday (soft delete)', permission: 'holiday.delete', response: { status: 204, schema: null } },

  // --- Users and permissions ----------------------------------------------
  { method: 'get', path: '/permissions', tag: 'Users & permissions', summary: 'The permission catalogue, grouped by module', permission: 'permission.manage', response: { status: 200, schema: ['PermissionModule'] } },
  { method: 'get', path: '/users', tag: 'Users & permissions', summary: 'Staff users', permission: 'permission.manage', query: userListQuery, response: { status: 200, schema: 'UserList' } },
  { method: 'get', path: '/users/{id}', tag: 'Users & permissions', summary: 'One staff user', permission: 'permission.manage', response: { status: 200, schema: 'UserAccount' } },
  {
    method: 'post',
    path: '/users',
    tag: 'Users & permissions',
    summary: 'Add a staff user (no password: staff users never sign in)',
    permission: 'permission.manage',
    body: createUserBody,
    response: { status: 201, schema: 'UserAccount' },
    errors: [{ status: 409, description: 'Email taken or employee already linked (`DUPLICATE`)' }],
  },
  {
    method: 'patch',
    path: '/users/{id}',
    tag: 'Users & permissions',
    summary: 'Edit, link/unlink employee, deactivate',
    permission: 'permission.manage',
    body: updateUserBody,
    response: { status: 200, schema: 'UserAccount' },
    errors: [{ status: 409, description: '`CANNOT_CHANGE_OWN_ACCESS`, `LAST_PERMISSION_MANAGER` or `DUPLICATE`' }],
  },
  {
    method: 'put',
    path: '/users/{id}/permissions',
    tag: 'Users & permissions',
    summary: "Replace a user's permissions",
    permission: 'permission.manage',
    body: setPermissionsBody,
    response: { status: 200, schema: 'UserAccount' },
    errors: [{ status: 409, description: '`CANNOT_CHANGE_OWN_ACCESS` or `LAST_PERMISSION_MANAGER`' }],
  },
  { method: 'get', path: '/audit-logs', tag: 'Change history', summary: 'Change history, newest first', permission: 'audit.view', query: auditListQuery, response: { status: 200, schema: 'AuditList' } },

  // --- Admin (main admin only, from Swagger; not used by the app) --------------
  ...adminDelete('employees/{id}', 'Delete an employee and everything that belongs to them',
    'Deletes the employee with their attendance, leave, leave adjustments and working schedules. A staff user linked to them is unlinked (not deleted). Their change-history entries stay, without the employee link. Cannot be undone.'),
  ...adminDelete('attendance/{id}', 'Delete one attendance record',
    'The day then counts as if nothing was recorded (absent on a working day). Use `GET /attendance` or the employee attendance log to find the record id.'),
  ...adminDelete('leaves/{id}', 'Delete a leave',
    'Removes it from the history entirely (cancelling keeps it). Deleting the Casual part of a split leave also deletes its Unpaid part. Days covered by approved leave are recalculated.'),
  ...adminDelete('holidays/{id}', 'Delete a holiday permanently',
    'Unlike `DELETE /holidays/{id}` (a soft delete), the row is removed. Works on soft-deleted holidays too. Attendance and leave on that date are recalculated.'),
  ...adminDelete('users/{id}', 'Delete a staff user',
    'Deletes the user with their sessions and permissions. Records they created or changed (employees, attendance, leave, holidays…) are credited to the main admin; their change-history entries stay, shown as "Deleted user". The main admin cannot be deleted (409).',
    [{ status: 409, description: 'This is the main admin (`CONFLICT`)' }]),
  ...adminDelete('departments/{code}', 'Delete a department',
    'Only when no employee is in it.',
    [{ status: 409, description: 'Employees are in this department (`CONFLICT`)' }]),
  ...adminDelete('positions/{code}', 'Delete a position',
    'Only when no employee has it.',
    [{ status: 409, description: 'Employees have this position (`CONFLICT`)' }]),
  {
    method: 'post',
    path: '/admin/clear-data',
    tag: 'Admin',
    summary: 'Delete ALL data except the main admin',
    description: [
      'Deletes every employee, schedule, attendance record, leave, leave adjustment, holiday, change-history entry and staff user.',
      '',
      '**Kept:** the main admin (with their permissions and sessions, so you stay signed in), the permission catalogue and the leave types. Departments and positions are kept unless `includeMasterData` is `true`.',
      '',
      'Send `"confirm": "DELETE ALL DATA"` exactly. **Cannot be undone**: export a database backup from the hosting panel first.',
    ].join('\n'),
    permission: 'main-admin',
    body: clearDataBody,
    response: { status: 200, schema: 'AdminClearDataResult' },
  },

  // --- Service ------------------------------------------------------------
  {
    method: 'get',
    path: '/health',
    tag: 'Service',
    summary: 'Health check (server and database)',
    permission: 'public',
    response: { status: 200, schema: 'Status', description: '`{"status":"ok"}`; 503 `{"status":"unavailable"}` when the database is down' },
  },
];

/** JSON Schema for a Zod schema, as the client sends it (ids as strings, etc.). */
function jsonSchema(schema: z.ZodType): Schema {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Schema;
  return rest;
}

function queryParameters(schema: z.ZodType): Schema[] {
  const json = jsonSchema(schema) as { properties?: Record<string, Schema>; required?: string[] };
  return Object.entries(json.properties ?? {}).map(([name, property]) => ({
    name,
    in: 'query',
    required: json.required?.includes(name) ?? false,
    schema: property,
  }));
}

function pathParameters(path: string): Schema[] {
  return [...path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({
    name,
    in: 'path',
    required: true,
    description: name === 'date' ? 'Calendar date, YYYY-MM-DD' : name === 'code' ? 'List code, e.g. `tailor`' : id,
    schema:
      name === 'date'
        ? { type: 'string', format: 'date' }
        : { type: 'string', examples: [name === 'code' ? 'tailor' : '7'] },
  }));
}

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: ref('Error') } },
});

function operation(endpoint: Endpoint): Schema {
  const { response } = endpoint;
  const success =
    response.schema === null
      ? { description: response.description ?? 'Done (no body)' }
      : {
          description: response.description ?? 'OK',
          content: {
            'application/json': {
              schema: Array.isArray(response.schema) ? { type: 'array', items: ref(response.schema[0]) } : ref(response.schema),
            },
          },
        };

  const responses: Record<string, unknown> = { [String(response.status)]: success };
  const isPublic = endpoint.permission === 'public';
  const mainAdminOnly = endpoint.permission === 'main-admin';
  if (!isPublic) {
    responses['401'] = errorResponse('Not signed in, session ended, or account deactivated (`UNAUTHENTICATED`)');
    responses['429'] = errorResponse('Too many requests (`RATE_LIMITED`, with `Retry-After`)');
    if (endpoint.permission !== null || endpoint.path === '/leaves/{id}/status') {
      responses['403'] = errorResponse(
        mainAdminOnly ? 'Signed in, but not the main admin (`PERMISSION_DENIED`)' : 'Missing permission (`PERMISSION_DENIED`)',
      );
    }
  }
  if (endpoint.body || endpoint.query) responses['422'] = errorResponse('Validation failed: `errors` has messages per field (`VALIDATION_ERROR`)');
  if (endpoint.body) responses['400'] = errorResponse('Body is not valid JSON (`BAD_REQUEST`)');
  if (endpoint.path.includes('{')) responses['404'] = errorResponse('Not found (`NOT_FOUND`)');
  if (endpoint.path === '/health') responses['503'] = { description: 'Database unreachable', content: { 'application/json': { schema: ref('Status') } } };
  for (const extra of endpoint.errors ?? []) responses[String(extra.status)] = errorResponse(extra.description);

  const permissions = endpoint.permission === null || isPublic || mainAdminOnly ? [] : [endpoint.permission].flat();
  const access = isPublic
    ? 'No sign-in needed.'
    : mainAdminOnly
      ? 'Only the main admin (the bootstrap admin from `BOOTSTRAP_ADMIN_EMAIL`, otherwise the first user created). Everyone else gets 403, whatever their permissions.'
    : permissions.length === 0
      ? 'Any signed-in user.'
      : `Needs permission ${permissions.map((p) => `\`${p}\``).join(' or ')}.`;

  return {
    tags: [endpoint.tag],
    summary: endpoint.summary,
    description: [endpoint.description, access].filter(Boolean).join('\n\n'),
    operationId: `${endpoint.method}${endpoint.path.replace(/[{}]/g, '').replace(/[/-](\w)/g, (_, c: string) => c.toUpperCase())}`,
    ...(isPublic ? { security: [] } : {}),
    ...(permissions.length > 0 ? { 'x-permissions': permissions } : {}),
    parameters: [...pathParameters(endpoint.path), ...(endpoint.query ? queryParameters(endpoint.query) : [])],
    ...(endpoint.body
      ? { requestBody: { required: true, content: { 'application/json': { schema: jsonSchema(endpoint.body) } } } }
      : {}),
    responses,
  };
}

let cached: Schema | undefined;

export function openApiSpec(): Schema {
  if (cached) return cached;
  const paths: Record<string, Record<string, Schema>> = {};
  for (const endpoint of endpoints) {
    (paths[endpoint.path] ??= {})[endpoint.method] = operation(endpoint);
  }
  cached = {
    openapi: '3.1.0',
    info: {
      title: 'Keshav Admin Portal API',
      version,
      description: [
        'REST API for the Keshav Admin Portal (Flutter app).',
        '',
        '- Sign in with `POST /auth/login`, then send `Authorization: Bearer <accessToken>` (use **Authorize** above).',
        '- Responses are the object or list itself (no envelope); keys are camelCase; enums snake_case.',
        '- Dates `YYYY-MM-DD`; instants ISO 8601 with offset (company time zone, `+05:30`); times of day `HH:mm`; durations in whole minutes.',
        '- Errors: `{ code?, message, errors?: { field: [message] } }`.',
        '- Lists: `page` (1-based) and `pageSize` (max 100) → `{ items, total, page, pageSize }`.',
      ].join('\n'),
    },
    servers: [{ url: '/api', description: 'This server' }],
    security: [{ bearerAuth: [] }],
    tags: [...new Set(endpoints.map((e) => e.tag))].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: components,
    },
  };
  return cached;
}

/** Every `METHOD /path` the spec describes (for the coverage test). */
export function describedRoutes(): string[] {
  return endpoints.map((e) => `${e.method.toUpperCase()} ${e.path}`);
}
