import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { type CalendarDate, dateToDb } from '@/lib/time';
import { type DayEmployee, dayEmployeeSelect } from '@/modules/day-engine/day-context';

type Client = PrismaClient | Prisma.TransactionClient;

/** Active employees who had joined by [date] (the people attendance lists cover). */
export function employeesOnDate(date: CalendarDate, client: Client = db()): Promise<DayEmployee[]> {
  return client.employee.findMany({
    where: { status: 'active', joiningDate: { lte: dateToDb(date) } },
    select: dayEmployeeSelect,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
}

export function findDayEmployee(id: number, client: Client = db()): Promise<DayEmployee | null> {
  return client.employee.findUnique({ where: { id }, select: dayEmployeeSelect });
}

export function findRecord(id: number, client: Client = db()) {
  return client.attendanceRecord.findUnique({
    where: { id },
    select: { id: true, employeeId: true, date: true, punchIn: true, punchOut: true, reason: true, remarks: true },
  });
}

/** Locks the employee row: punches and corrections for one employee run one at a time. */
export async function lockEmployee(tx: Prisma.TransactionClient, employeeId: number): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM employees WHERE id = ${employeeId} FOR UPDATE`;
  return rows.length > 0;
}

export type RecordWrite = Omit<Prisma.AttendanceRecordUncheckedCreateInput, 'employeeId' | 'date'>;

export function upsertRecord(
  tx: Prisma.TransactionClient,
  employeeId: number,
  date: CalendarDate,
  data: RecordWrite,
) {
  return tx.attendanceRecord.upsert({
    where: { employeeId_date: { employeeId, date: dateToDb(date) } },
    create: { employeeId, date: dateToDb(date), ...data },
    update: data,
    select: { id: true },
  });
}
