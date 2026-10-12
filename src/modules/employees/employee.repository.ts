import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import type { PageRequest } from '@/lib/http';
import { type CalendarDate, dateToDb } from '@/lib/time';
import type { EmployeeListQuery, UpdateEmployeeBody } from './employee.validation';

type Client = PrismaClient | Prisma.TransactionClient;

export const employeeSelect = {
  id: true,
  ecNumber: true,
  name: true,
  mobile: true,
  departmentCode: true,
  positionCode: true,
  joiningDate: true,
  status: true,
  updatedAt: true,
  updatedBy: { select: { name: true } },
} satisfies Prisma.EmployeeSelect;

export type EmployeeRow = Prisma.EmployeeGetPayload<{ select: typeof employeeSelect }>;

type Filters = Omit<EmployeeListQuery, 'page'>;

/** The list filters, without `status` (used for the Active/Inactive counts). */
function whereIgnoringStatus(filters: Filters): Prisma.EmployeeWhereInput {
  const where: Prisma.EmployeeWhereInput = {};
  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search } },
      { ecNumber: { contains: filters.search } },
    ];
  }
  if (filters.department) where.departmentCode = filters.department;
  if (filters.position) where.positionCode = filters.position;
  if (filters.joinedFrom || filters.joinedTo) {
    where.joiningDate = {
      ...(filters.joinedFrom ? { gte: dateToDb(filters.joinedFrom) } : {}),
      ...(filters.joinedTo ? { lte: dateToDb(filters.joinedTo) } : {}),
    };
  }
  return where;
}

export async function listEmployees(filters: Filters, page: PageRequest) {
  const base = whereIgnoringStatus(filters);
  const where: Prisma.EmployeeWhereInput = filters.status ? { ...base, status: filters.status } : base;
  const [rows, total, byStatus] = await db().$transaction([
    db().employee.findMany({
      where,
      select: employeeSelect,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: page.skip,
      take: page.take,
    }),
    db().employee.count({ where }),
    db().employee.groupBy({ by: ['status'], where: base, _count: { _all: true }, orderBy: { status: 'asc' } }),
  ]);
  const countOf = (status: 'active' | 'inactive') =>
    byStatus.find((group) => group.status === status)?._count?._all ?? 0;
  return { rows, total, counts: { active: countOf('active'), inactive: countOf('inactive') } };
}

export function findEmployee(id: number, client: Client = db()): Promise<EmployeeRow | null> {
  return client.employee.findUnique({ where: { id }, select: employeeSelect });
}

/** Whether [ecNumber] is already used by another employee. */
export async function ecNumberTaken(ecNumber: string, exceptId: number | null, client: Client = db()): Promise<boolean> {
  const other = await client.employee.findFirst({
    where: { ecNumber, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true },
  });
  return other !== null;
}

export function departmentExists(code: string, client: Client = db()): Promise<boolean> {
  return client.department.count({ where: { code } }).then((count) => count > 0);
}

export function positionExists(code: string, client: Client = db()): Promise<boolean> {
  return client.position.count({ where: { code } }).then((count) => count > 0);
}

/** Overtime minutes per employee from [from] to [to], summed from the attendance snapshots. */
export async function overtimeBetween(
  employeeIds: number[],
  from: CalendarDate,
  to: CalendarDate,
  client: Client = db(),
): Promise<Map<number, number>> {
  if (employeeIds.length === 0) return new Map();
  const rows = await client.attendanceRecord.groupBy({
    by: ['employeeId'],
    where: { employeeId: { in: employeeIds }, date: { gte: dateToDb(from), lte: dateToDb(to) } },
    _sum: { overtimeMinutes: true },
    orderBy: { employeeId: 'asc' },
  });
  return new Map(rows.map((row) => [row.employeeId, row._sum?.overtimeMinutes ?? 0]));
}

/** Highest number after "KC" across all employees, or 0 when there are none. */
export async function highestEcNumber(): Promise<bigint> {
  const rows = await db().$queryRaw<{ highest: bigint | number | string | null }[]>`
    SELECT MAX(CAST(SUBSTRING(ec_number, 3) AS UNSIGNED)) AS highest FROM employees`;
  const highest = rows[0]?.highest;
  return highest === null || highest === undefined ? 0n : BigInt(highest);
}

type EmployeeData = UpdateEmployeeBody;

/** The API's `department` and `position` are stored in the code columns. */
function columnsOf(data: Partial<EmployeeData>) {
  const { department, position, joiningDate, ...rest } = data;
  return {
    ...rest,
    ...(department !== undefined ? { departmentCode: department } : {}),
    ...(position !== undefined ? { positionCode: position } : {}),
    ...(joiningDate !== undefined ? { joiningDate: dateToDb(joiningDate) } : {}),
  };
}

export function createEmployee(tx: Prisma.TransactionClient, data: EmployeeData, actorId: number): Promise<EmployeeRow> {
  return tx.employee.create({
    data: {
      ecNumber: data.ecNumber,
      name: data.name,
      mobile: data.mobile,
      departmentCode: data.department,
      positionCode: data.position,
      joiningDate: dateToDb(data.joiningDate),
      status: data.status,
      createdById: actorId,
      updatedById: actorId,
    },
    select: employeeSelect,
  });
}

export function updateEmployee(
  tx: Prisma.TransactionClient,
  id: number,
  data: Partial<EmployeeData>,
  actorId: number,
) {
  return tx.employee.update({
    where: { id },
    data: { ...columnsOf(data), updatedById: actorId },
    select: employeeSelect,
  });
}

/** Locks the row so concurrent changes for one employee run one at a time. */
export async function lockEmployee(tx: Prisma.TransactionClient, id: number): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM employees WHERE id = ${id} FOR UPDATE`;
  return rows.length > 0;
}
