import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { type CalendarDate, dateToDb } from '@/lib/time';
import type { LeaveListQuery } from './leave.validation';

type Client = PrismaClient | Prisma.TransactionClient;

export const leaveSelect = {
  id: true,
  employeeId: true,
  startDate: true,
  endDate: true,
  isHalfDay: true,
  days: true,
  reason: true,
  remarks: true,
  status: true,
  unpaidPartOfId: true,
  unpaidPart: { select: { id: true } },
  leaveType: { select: { id: true, name: true, hasBalance: true, isPaid: true } },
  createdBy: { select: { name: true } },
  employee: {
    select: {
      id: true,
      name: true,
      ecNumber: true,
      departmentCode: true,
      positionCode: true,
    },
  },
} satisfies Prisma.LeaveSelect;

export type LeaveRow = Prisma.LeaveGetPayload<{ select: typeof leaveSelect }>;

/** Leave that holds days: pending (reserved) and approved. */
export const ACTIVE_STATUSES = ['pending', 'approved'] as const;

function whereOf(filters: Omit<LeaveListQuery, 'page' | 'status'>): Prisma.LeaveWhereInput {
  const where: Prisma.LeaveWhereInput = {};
  const employee: Prisma.EmployeeWhereInput = {};
  if (filters.search) {
    employee.OR = [{ name: { contains: filters.search } }, { ecNumber: { contains: filters.search } }];
  }
  if (filters.department) employee.departmentCode = filters.department;
  if (Object.keys(employee).length > 0) where.employee = employee;
  if (filters.leaveTypeId) where.leaveTypeId = filters.leaveTypeId;
  if (filters.from) where.endDate = { gte: dateToDb(filters.from) };
  if (filters.to) where.startDate = { lte: dateToDb(filters.to) };
  return where;
}

export async function listLeaves(query: LeaveListQuery) {
  const { page, status, ...filters } = query;
  const base = whereOf(filters);
  const where = status ? { ...base, status } : base;
  const [rows, total, byStatus] = await db().$transaction([
    db().leave.findMany({
      where,
      select: leaveSelect,
      orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
      skip: page.skip,
      take: page.take,
    }),
    db().leave.count({ where }),
    db().leave.groupBy({ by: ['status'], where: base, _count: { _all: true }, orderBy: { status: 'asc' } }),
  ]);
  const countOf = (s: string) => byStatus.find((g) => g.status === s)?._count?._all ?? 0;
  const counts = {
    all: byStatus.reduce((sum, g) => sum + (g._count?._all ?? 0), 0),
    pending: countOf('pending'),
    approved: countOf('approved'),
    rejected: countOf('rejected'),
    cancelled: countOf('cancelled'),
  };
  return { rows, total, counts };
}

export function findLeave(id: number, client: Client = db()): Promise<LeaveRow | null> {
  return client.leave.findUnique({ where: { id }, select: leaveSelect });
}

/** Pending or approved leave of [employeeId] touching [from]–[to], other than [exceptId]. */
export function overlapping(
  client: Client,
  employeeId: number,
  from: CalendarDate,
  to: CalendarDate,
  exceptId: number | null,
) {
  return client.leave.findFirst({
    where: {
      employeeId,
      status: { in: [...ACTIVE_STATUSES] },
      startDate: { lte: dateToDb(to) },
      endDate: { gte: dateToDb(from) },
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
    select: { id: true },
  });
}

const typeSelect = { id: true, name: true, hasBalance: true, isPaid: true } as const;

export function findLeaveType(client: Client, id: string) {
  return client.leaveType.findFirst({ where: { id, isActive: true }, select: typeSelect });
}

/** The active leave type that is not paid (`unpaid`), for the excess of a split leave. */
export function findUnpaidType(client: Client) {
  return client.leaveType.findFirst({
    where: { isActive: true, isPaid: false, hasBalance: false },
    select: typeSelect,
    orderBy: [{ sort: 'asc' }, { id: 'asc' }],
  });
}
