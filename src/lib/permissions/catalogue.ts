/**
 * The permission catalogue (DATABASE_V2.md §4.1). There are no roles: each
 * staff user has their own list of these keys (client decision 2026-10-02).
 *
 * This file is the source of truth. `npm run db:seed` copies it into the
 * `permissions` table, `GET /permissions` serves it, and a contract test
 * fails if it drifts from the app's `permissions.response.json`.
 */

export const PERMISSION_MODULES = [
  {
    module: 'dashboard',
    label: 'Dashboard',
    permissions: [{ key: 'dashboard.view', action: 'view', label: 'View dashboard', description: null }],
  },
  {
    module: 'employee',
    label: 'Employees',
    permissions: [
      { key: 'employee.view', action: 'view', label: 'View employees', description: null },
      { key: 'employee.create', action: 'create', label: 'Add employees', description: null },
      { key: 'employee.edit', action: 'edit', label: 'Edit employees', description: null },
      { key: 'employee.deactivate', action: 'deactivate', label: 'Deactivate employees', description: null },
    ],
  },
  {
    module: 'schedule',
    label: 'Working schedules',
    permissions: [{ key: 'schedule.edit', action: 'edit', label: 'Change schedules', description: null }],
  },
  {
    module: 'attendance',
    label: 'Attendance',
    permissions: [
      { key: 'attendance.view', action: 'view', label: 'View attendance', description: null },
      { key: 'attendance.punch', action: 'punch', label: 'Punch in and out', description: null },
      { key: 'attendance.correct', action: 'correct', label: 'Correct attendance', description: null },
    ],
  },
  {
    module: 'overtime',
    label: 'Overtime',
    permissions: [{ key: 'overtime.view', action: 'view', label: 'View overtime', description: null }],
  },
  {
    module: 'leave',
    label: 'Leave',
    permissions: [
      { key: 'leave.view', action: 'view', label: 'View leave', description: null },
      { key: 'leave.create', action: 'create', label: 'Add leave', description: null },
      { key: 'leave.edit', action: 'edit', label: 'Edit pending leave', description: null },
      { key: 'leave.cancel', action: 'cancel', label: 'Cancel leave', description: null },
      { key: 'leave.approve', action: 'approve', label: 'Approve and reject', description: null },
    ],
  },
  {
    module: 'calendar',
    label: 'Employee calendar',
    permissions: [{ key: 'calendar.view', action: 'view', label: 'View calendars', description: null }],
  },
  {
    module: 'holiday',
    label: 'Holidays',
    permissions: [
      { key: 'holiday.view', action: 'view', label: 'View holidays', description: null },
      { key: 'holiday.create', action: 'create', label: 'Add holidays', description: null },
      { key: 'holiday.edit', action: 'edit', label: 'Edit holidays', description: null },
      { key: 'holiday.delete', action: 'delete', label: 'Delete holidays', description: null },
    ],
  },
  {
    module: 'permission',
    label: 'Users & permissions',
    permissions: [
      {
        key: 'permission.manage',
        action: 'manage',
        label: 'Manage users and permissions',
        description: 'Add and edit staff users, and choose what each one can do',
      },
    ],
  },
  {
    module: 'audit',
    label: 'Change history',
    permissions: [{ key: 'audit.view', action: 'view', label: 'View change history', description: null }],
  },
] as const;

type Modules = typeof PERMISSION_MODULES;
export type PermissionKey = Modules[number]['permissions'][number]['key'];

export type PermissionDefinition = {
  key: PermissionKey;
  module: string;
  action: string;
  label: string;
  description: string | null;
  sort: number;
};

/** Every permission, flat, in display order (`sort` = position). */
export const PERMISSIONS: readonly PermissionDefinition[] = PERMISSION_MODULES.flatMap((group) =>
  group.permissions.map((permission) => ({ ...permission, module: group.module })),
).map((permission, index) => ({ ...permission, sort: index + 1 }));

export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.map((p) => p.key);

const byKey = new Map<string, PermissionDefinition>(PERMISSIONS.map((p) => [p.key, p]));

export function isPermissionKey(value: string): value is PermissionKey {
  return byKey.has(value);
}

export function permissionLabel(key: PermissionKey): string {
  return byKey.get(key)!.label;
}
