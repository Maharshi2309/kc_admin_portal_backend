import { db } from '@/lib/db';

const activeEmployees = { _count: { select: { employees: { where: { status: 'active' as const } } } } };

/** Departments with their number of active employees. */
export function listDepartments() {
  return db().department.findMany({
    select: { id: true, code: true, name: true, ...activeEmployees },
    orderBy: { name: 'asc' },
  });
}

/** Positions with their number of active employees. */
export function listPositions() {
  return db().position.findMany({
    select: { id: true, code: true, name: true, ...activeEmployees },
    orderBy: { name: 'asc' },
  });
}

export function createDepartment(data: { code: string; name: string }) {
  return db().department.create({ data, select: { id: true, code: true, name: true } });
}

export function createPosition(data: { code: string; name: string }) {
  return db().position.create({ data, select: { id: true, code: true, name: true } });
}

/** Active leave types, in display order. */
export function listLeaveTypes() {
  return db().leaveType.findMany({
    where: { isActive: true },
    select: { id: true, name: true, hasBalance: true, isPaid: true },
    orderBy: [{ sort: 'asc' }, { name: 'asc' }],
  });
}
