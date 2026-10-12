/**
 * Response shapes for the OpenAPI spec (JSON Schema 2020-12, as OpenAPI 3.1
 * uses). They mirror the DTO types in src/modules/*\/*.types.ts and the app's
 * docs/api-examples. Request shapes are generated from the Zod schemas.
 */

export type Schema = Record<string, unknown>;

const str = (extra: Schema = {}): Schema => ({ type: 'string', ...extra });
const int = (extra: Schema = {}): Schema => ({ type: 'integer', ...extra });
const num = (extra: Schema = {}): Schema => ({ type: 'number', ...extra });
const bool = (): Schema => ({ type: 'boolean' });
const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: 'null' }] });
const arr = (items: Schema): Schema => ({ type: 'array', items });
export const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const obj = (properties: Record<string, Schema>, optional: string[] = []): Schema => ({
  type: 'object',
  properties,
  required: Object.keys(properties).filter((key) => !optional.includes(key)),
});

const id = str({ examples: ['7'] });
const date = str({ format: 'date', examples: ['2026-09-28'] });
const instant = str({ format: 'date-time', examples: ['2026-09-28T09:35:00+05:30'] });
const time = str({ examples: ['09:30'] });
const minutes = int({ minimum: 0, description: 'Whole minutes' });
const page = (item: string, extra: Record<string, Schema> = {}): Schema =>
  obj({ items: arr(ref(item)), total: int(), page: int(), pageSize: int(), ...extra });

const dayStatus = str({ enum: ['present', 'late', 'half_day', 'on_leave', 'absent', 'weekly_off', 'holiday'] });
const dayKind = str({ enum: ['working', 'holiday_worked', 'week_off_worked'] });
const leaveStatus = str({ enum: ['pending', 'approved', 'rejected', 'cancelled'] });
const listCode = str({
  description: 'A department or position code: accountant, graphic_designer, tailor, or one added later',
  examples: ['graphic_designer'],
});
const days = num({ description: 'Days; a half day is 0.5' });
const balance = obj({
  asOf: date,
  accrued: days,
  used: days,
  pending: days,
  remaining: days,
  unpaidTaken: days,
});

export const components: Record<string, Schema> = {
  Error: obj(
    {
      code: str({
        description: 'Machine-readable code',
        examples: ['VALIDATION_ERROR', 'PERMISSION_DENIED', 'INSUFFICIENT_LEAVE_BALANCE', 'LEAVE_NOT_EDITABLE', 'SCHEDULE_OVERLAP'],
      }),
      message: str({ description: 'Safe to show to the admin as-is' }),
      errors: {
        type: 'object',
        description: 'Field errors keyed by request field (nested fields use dots, e.g. schedule.startTime)',
        additionalProperties: arr(str()),
      },
    },
    ['code', 'errors'],
  ),
  Status: obj({ status: str({ enum: ['ok', 'unavailable'] }) }),
  NamedRef: obj({ id, name: str() }),
  EmployeeSummary: obj({
    id,
    name: str(),
    ecNumber: str({ examples: ['KC1001'] }),
    department: listCode,
    position: listCode,
  }),

  AuthUser: obj({ id, name: str(), email: str({ format: 'email' }), permissions: arr(str({ examples: ['employee.view'] })) }),
  LoginResponse: obj({ accessToken: str({ description: 'Send as Authorization: Bearer <token>' }), user: ref('AuthUser') }),

  ListEntry: obj({ id, code: listCode, name: str({ examples: ['Graphic Designer'] }), employeeCount: int({ description: 'Active employees' }) }),
  LeaveType: obj({ id: str({ enum: ['casual', 'unpaid'] }), name: str(), hasBalance: bool(), isPaid: bool() }),

  ScheduleSnapshot: obj({ startTime: time, endTime: time, expectedMinutes: minutes }),
  WorkSchedule: obj({
    id,
    effectiveFrom: date,
    effectiveTo: nullable(date),
    startTime: time,
    endTime: time,
    breakMinutes: minutes,
    breakStart: nullable(time),
    breakEnd: nullable(time),
    weeklyOffDays: arr(int({ minimum: 1, maximum: 7, description: 'ISO weekday, 1 = Monday … 7 = Sunday' })),
    expectedMinutes: minutes,
    createdBy: nullable(ref('NamedRef')),
    createdAt: instant,
  }),
  Employee: obj(
    {
      id,
      ecNumber: str({ examples: ['KC1001'] }),
      name: str(),
      mobile: str({ examples: ['9825011234'] }),
      department: listCode,
      position: listCode,
      joiningDate: date,
      status: str({ enum: ['active', 'inactive'] }),
      todayStatus: dayStatus,
      schedule: nullable(ref('WorkSchedule')),
      updatedAt: instant,
      updatedBy: nullable(str()),
      overtimeMinutesThisYear: nullable(
        int({ minimum: 0, description: 'Overtime since 1 January (list and GET); null without overtime.view' }),
      ),
    },
    ['todayStatus', 'overtimeMinutesThisYear'],
  ),
  EmployeeList: page('Employee', { counts: obj({ active: int(), inactive: int() }) }),
  NextEcNumber: obj({ ecNumber: str({ examples: ['KC1129'] }) }),

  AttendanceRecord: obj({
    id: nullable(id),
    employee: ref('EmployeeSummary'),
    date,
    punchIn: nullable(instant),
    punchOut: nullable(instant),
    workedMinutes: nullable(minutes),
    workedPercent: nullable(num({ minimum: 0, maximum: 100 })),
    status: dayStatus,
    note: nullable(str({ description: 'Short remark, never a duration', examples: ['Not in yet'] })),
    lateMinutes: nullable(int({ minimum: 1, description: 'How late the punch in was; null when not late', examples: [38] })),
    correctedBy: nullable(str()),
    correctedAt: nullable(instant),
    dayKind,
    schedule: nullable(ref('ScheduleSnapshot')),
    expectedMinutes: minutes,
    overtimeMinutes: minutes,
  }),
  AttendanceDay: obj({
    summary: obj({
      date,
      totalEmployees: int(),
      present: int(),
      late: int(),
      onLeave: int(),
      absent: int(),
      notPunchedIn: int(),
    }),
    items: arr(ref('AttendanceRecord')),
    total: int(),
    page: int(),
    pageSize: int(),
  }),
  Count: obj({ count: int() }),

  Holiday: obj({ id, date, name: str(), description: nullable(str()) }),

  Leave: obj({
    id,
    employee: ref('EmployeeSummary'),
    leaveType: ref('NamedRef'),
    startDate: date,
    endDate: date,
    days: num({ description: 'Working days; a half day is 0.5' }),
    isHalfDay: bool(),
    reason: str({ enum: ['personal_work', 'family_function', 'medical', 'travel', 'other'] }),
    remarks: nullable(str()),
    status: leaveStatus,
    addedBy: nullable(str()),
    isPaid: bool(),
    balanceAfter: nullable(num({ description: 'Casual days left after this leave; null for Unpaid, rejected and cancelled leave' })),
    unpaidPartId: nullable(str({ description: 'On the Casual part of a split leave: the id of its Unpaid part' })),
  }),
  LeaveList: page('Leave', {
    counts: obj({ all: int(), pending: int(), approved: int(), rejected: int(), cancelled: int() }),
  }),
  LeavePreview: obj({
    days,
    paidDays: num({ description: 'Days Casual covers (0 for Unpaid leave)' }),
    unpaidDays: num({ description: 'The rest (all of it for Unpaid leave)' }),
    availableCasual: nullable(num({ description: 'Casual days available for these dates; null for Unpaid leave' })),
  }),
  LeaveBalance: balance,
  LeaveBalances: page('LeaveBalanceRow', {
    summary: obj({ employees: int(), accrued: days, used: days, pending: days, remaining: days, unpaidTaken: days }),
  }),
  LeaveBalanceRow: obj({ employee: ref('EmployeeSummary'), balance: ref('LeaveBalance') }),
  LeaveHistoryItem: obj({
    id,
    startDate: date,
    endDate: date,
    leaveType: str(),
    days: num(),
    reason: str(),
    status: leaveStatus,
    isPaid: bool(),
    balanceAfter: nullable(num()),
  }),
  LeaveCalendar: obj({
    month: date,
    holidays: arr(obj({ date, name: str(), id })),
    weeklyOffDays: arr(int({ minimum: 1, maximum: 7 })),
    weekOffDates: arr(date),
  }),

  Overtime: obj({
    from: date,
    to: date,
    totalMinutes: minutes,
    expectedMinutes: minutes,
    workedMinutes: minutes,
    dayBasisMinutes: minutes,
    scheduleChanged: bool(),
    months: arr(obj({ month: date, minutes, expectedMinutes: minutes, workedMinutes: minutes })),
    days: arr(
      obj({ date, dayKind, expectedMinutes: minutes, workedMinutes: minutes, overtimeMinutes: minutes, dayBasisMinutes: minutes }),
    ),
  }),
  CalendarDay: obj({
    date,
    dayType: str({ enum: ['working', 'week_off', 'holiday'] }),
    holidayName: nullable(str()),
    schedule: nullable(ref('ScheduleSnapshot')),
    attendance: nullable(
      obj({
        id: nullable(id),
        status: dayStatus,
        dayKind,
        punchIn: nullable(instant),
        punchOut: nullable(instant),
        workedMinutes: nullable(minutes),
        corrected: bool(),
      }),
    ),
    leaves: arr(obj({ id, leaveType: ref('NamedRef'), status: leaveStatus, isHalfDay: bool() })),
    overtimeMinutes: minutes,
  }),
  CalendarMonth: obj({
    month: date,
    days: arr(ref('CalendarDay')),
    summary: obj({
      workingDays: int(),
      present: int(),
      absent: int(),
      leaveDays: num(),
      holidays: int(),
      weekOffs: int(),
      holidayWorked: int(),
      weekOffWorked: int(),
      expectedMinutes: minutes,
      workedMinutes: minutes,
      overtimeMinutes: minutes,
    }),
  }),
  CalendarDayDetail: obj({ day: ref('CalendarDay'), history: arr(ref('AuditEntry')) }),

  AuditEntry: obj({
    id,
    action: str({ examples: ['attendance.correct'] }),
    summary: str(),
    actor: ref('NamedRef'),
    createdAt: instant,
    changes: arr(obj({ field: str(), label: str(), before: nullable(str()), after: nullable(str()) })),
    reason: nullable(str()),
    remarks: nullable(str()),
  }),
  AuditList: page('AuditEntry'),

  DashboardSummary: obj({
    date,
    totalEmployees: int(),
    scheduledToday: int(),
    presentToday: int(),
    onLeaveToday: int(),
    absentToday: int(),
    presentPercent: nullable(num()),
    onLeavePercent: nullable(num()),
    absentPercent: nullable(num()),
    holiday: nullable(ref('Holiday')),
    weekOffToday: int(),
    holidayWorkedToday: int(),
    weekOffWorkedToday: int(),
    overtimeMinutesThisMonth: nullable(minutes),
    overtimeEmployeesThisMonth: nullable(int()),
    attention: arr(obj({ kind: str({ enum: ['not_punched_in', 'pending_leave', 'late_arrival'] }), count: int() })),
    notPunchedIn: arr(ref('EmployeeSummary')),
    notPunchedInTotal: int(),
    onLeave: arr(
      obj({ employee: ref('EmployeeSummary'), leaveType: str(), endDate: date, days: num(), isHalfDay: bool() }),
    ),
    leaveUsage: obj({
      year: int(),
      casualRemainingDays: num({ description: "Sum of every active employee's Casual remaining today" }),
      casualTakenDays: num({ description: 'Approved Casual days dated in the year' }),
      unpaidTakenDays: num({ description: 'Approved Unpaid days dated in the year' }),
      approvedThisMonth: int(),
      pendingThisMonth: int(),
      rejectedThisMonth: int(),
    }),
  }),
  AttendanceChart: obj({
    month: date,
    averagePercent: nullable(num()),
    days: arr(obj({ date, percent: num() })),
  }),

  PermissionModule: obj({
    module: str({ examples: ['employee'] }),
    label: str(),
    permissions: arr(obj({ key: str({ examples: ['employee.edit'] }), action: str(), label: str(), description: nullable(str()) })),
  }),
  UserAccount: obj({
    id,
    name: str(),
    email: str({ format: 'email' }),
    permissions: arr(str()),
    employee: nullable(ref('EmployeeSummary')),
    isActive: bool(),
    lastSignInAt: nullable(instant),
  }),
  UserList: page('UserAccount'),

  AdminDeleteResult: obj({
    deleted: {
      type: 'object',
      description: 'Rows removed (or changed) per table',
      additionalProperties: int(),
      examples: [{ employees: 1, attendanceRecords: 120, leaves: 4, leaveBalanceAdjustments: 0, workSchedules: 2, usersUnlinked: 0 }],
    },
  }),
  AdminClearDataResult: obj(
    {
      deleted: { type: 'object', description: 'Rows removed per table', additionalProperties: int() },
      keptAdmin: obj({ id, name: str(), email: str({ format: 'email' }) }),
      auditLogsCleared: bool(),
      note: str({ description: 'Present when something could not be cleared' }),
    },
    ['note'],
  ),
};
