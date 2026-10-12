import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { type CalendarDate, dateToDb, timeToDb } from '@/lib/time';
import { expectedMinutesOf } from './schedule.rules';
import type { ScheduleFields } from './schedule.validation';

type Client = PrismaClient | Prisma.TransactionClient;

export const scheduleSelect = {
  id: true,
  employeeId: true,
  effectiveFrom: true,
  effectiveTo: true,
  startTime: true,
  endTime: true,
  breakMinutes: true,
  breakStart: true,
  breakEnd: true,
  weeklyOffDays: true,
  expectedMinutes: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.EmployeeWorkScheduleSelect;

export type ScheduleRow = Prisma.EmployeeWorkScheduleGetPayload<{ select: typeof scheduleSelect }>;

/** All versions of one employee, newest first. */
export function listVersions(employeeId: number, client: Client = db()): Promise<ScheduleRow[]> {
  return client.employeeWorkSchedule.findMany({
    where: { employeeId },
    select: scheduleSelect,
    orderBy: { effectiveFrom: 'desc' },
  });
}

/**
 * For each employee, the version in effect on [date], or the first one still
 * to come if none applies yet (e.g. an employee joining next week).
 */
export async function currentVersions(
  employeeIds: number[],
  date: CalendarDate,
  client: Client = db(),
): Promise<Map<number, ScheduleRow>> {
  const rows = await client.employeeWorkSchedule.findMany({
    where: {
      employeeId: { in: employeeIds },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: dateToDb(date) } }],
    },
    select: scheduleSelect,
    orderBy: { effectiveFrom: 'asc' },
  });
  const byEmployee = new Map<number, ScheduleRow>();
  for (const row of rows) if (!byEmployee.has(row.employeeId)) byEmployee.set(row.employeeId, row);
  return byEmployee;
}

export function createVersion(
  tx: Prisma.TransactionClient,
  input: {
    employeeId: number;
    effectiveFrom: CalendarDate;
    effectiveTo: CalendarDate | null;
    fields: ScheduleFields;
    createdById: number;
  },
): Promise<ScheduleRow> {
  const { fields } = input;
  return tx.employeeWorkSchedule.create({
    data: {
      employeeId: input.employeeId,
      effectiveFrom: dateToDb(input.effectiveFrom),
      effectiveTo: input.effectiveTo ? dateToDb(input.effectiveTo) : null,
      startTime: timeToDb(fields.startTime),
      endTime: timeToDb(fields.endTime),
      breakMinutes: fields.breakMinutes,
      breakStart: fields.breakStart ? timeToDb(fields.breakStart) : null,
      breakEnd: fields.breakEnd ? timeToDb(fields.breakEnd) : null,
      weeklyOffDays: fields.weeklyOffDays,
      expectedMinutes: expectedMinutesOf(fields),
      createdById: input.createdById,
    },
    select: scheduleSelect,
  });
}

export async function setEffectiveTo(
  tx: Prisma.TransactionClient,
  id: number,
  effectiveTo: CalendarDate | null,
): Promise<void> {
  await tx.employeeWorkSchedule.update({
    where: { id },
    data: { effectiveTo: effectiveTo ? dateToDb(effectiveTo) : null },
  });
}

export async function setEffectiveFrom(
  tx: Prisma.TransactionClient,
  id: number,
  effectiveFrom: CalendarDate,
): Promise<void> {
  await tx.employeeWorkSchedule.update({
    where: { id },
    data: { effectiveFrom: dateToDb(effectiveFrom) },
  });
}
