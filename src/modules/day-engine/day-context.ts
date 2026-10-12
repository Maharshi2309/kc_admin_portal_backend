import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { type CalendarDate, dateFromDb, dateToDb, eachDate, timeFromDb } from '@/lib/time';
import { approvedLeaveLookup } from '@/modules/leaves/leave-lookup';
import { weekdaysOf } from '@/modules/schedules/schedule.rules';
import { type DayLeave, type DayResult, type DaySchedule, computeDay } from './compute-day';

/**
 * Loads everything `computeDay` needs for a set of employees over a date
 * range in four queries (schedules, holidays, attendance, leave) and
 * computes each day. Every screen that shows days (attendance list, log,
 * calendar, overtime, dashboard) goes through here, so they all agree.
 */

type Client = PrismaClient | Prisma.TransactionClient;

export const dayEmployeeSelect = {
  id: true,
  name: true,
  ecNumber: true,
  joiningDate: true,
  status: true,
  departmentCode: true,
  positionCode: true,
} satisfies Prisma.EmployeeSelect;

export type DayEmployee = Prisma.EmployeeGetPayload<{ select: typeof dayEmployeeSelect }>;

const recordSelect = {
  id: true,
  employeeId: true,
  date: true,
  punchIn: true,
  punchOut: true,
  correctedAt: true,
  reason: true,
  remarks: true,
  correctedBy: { select: { name: true } },
} satisfies Prisma.AttendanceRecordSelect;

export type DayRecord = Prisma.AttendanceRecordGetPayload<{ select: typeof recordSelect }>;

export type DayScheduleRow = DaySchedule & { id: number };

export type LoadedDay = {
  employee: DayEmployee;
  date: CalendarDate;
  /** The version in effect on the date (null only before joining, which is never loaded). */
  schedule: DayScheduleRow | null;
  holidayName: string | null;
  leave: DayLeave;
  record: DayRecord | null;
  result: DayResult;
};

/** Approved leave per employee and date (see `approvedLeaveLookup`). */
export type LeaveLookup = (employeeIds: number[], from: CalendarDate, to: CalendarDate, client: Client) => Promise<
  (employeeId: number, date: CalendarDate) => DayLeave
>;

/** For when leave makes no difference, e.g. counting the days a leave covers. */
export const noLeave: LeaveLookup = async () => () => 'none';

export async function loadDays(input: {
  employees: DayEmployee[];
  from: CalendarDate;
  to: CalendarDate;
  now: Date;
  zone: string;
  leaveLookup?: LeaveLookup;
  client?: Client;
}): Promise<LoadedDay[]> {
  const { employees, from, to, now, zone } = input;
  const client = input.client ?? db();
  if (employees.length === 0 || to < from) return [];
  const ids = employees.map((e) => e.id);

  const [scheduleRows, holidayRows, recordRows, leaveOf] = await Promise.all([
    client.employeeWorkSchedule.findMany({
      where: {
        employeeId: { in: ids },
        effectiveFrom: { lte: dateToDb(to) },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: dateToDb(from) } }],
      },
      orderBy: { effectiveFrom: 'asc' },
    }),
    client.companyHoliday.findMany({
      where: { deletedAt: null, date: { gte: dateToDb(from), lte: dateToDb(to) } },
      select: { date: true, name: true },
    }),
    client.attendanceRecord.findMany({
      where: { employeeId: { in: ids }, date: { gte: dateToDb(from), lte: dateToDb(to) } },
      select: recordSelect,
    }),
    (input.leaveLookup ?? approvedLeaveLookup)(ids, from, to, client),
  ]);

  const holidays = new Map(holidayRows.map((h) => [dateFromDb(h.date), h.name]));
  const records = new Map(recordRows.map((r) => [`${r.employeeId}|${dateFromDb(r.date)}`, r]));
  const versions = new Map<number, (DayScheduleRow & { from: CalendarDate; to: CalendarDate | null })[]>();
  for (const row of scheduleRows) {
    const list = versions.get(row.employeeId) ?? [];
    list.push({
      id: row.id,
      from: dateFromDb(row.effectiveFrom),
      to: row.effectiveTo ? dateFromDb(row.effectiveTo) : null,
      startTime: timeFromDb(row.startTime),
      endTime: timeFromDb(row.endTime),
      breakMinutes: row.breakMinutes,
      breakStart: row.breakStart ? timeFromDb(row.breakStart) : null,
      breakEnd: row.breakEnd ? timeFromDb(row.breakEnd) : null,
      weeklyOffDays: weekdaysOf(row.weeklyOffDays),
      expectedMinutes: row.expectedMinutes,
    });
    versions.set(row.employeeId, list);
  }

  const days: LoadedDay[] = [];
  for (const employee of employees) {
    const joined = dateFromDb(employee.joiningDate);
    const own = versions.get(employee.id) ?? [];
    for (const date of eachDate(from > joined ? from : joined, to)) {
      const version = own.find((v) => v.from <= date && (v.to === null || v.to >= date)) ?? null;
      const schedule: DayScheduleRow | null = version
        ? {
            id: version.id,
            startTime: version.startTime,
            endTime: version.endTime,
            breakMinutes: version.breakMinutes,
            breakStart: version.breakStart,
            breakEnd: version.breakEnd,
            weeklyOffDays: version.weeklyOffDays,
            expectedMinutes: version.expectedMinutes,
          }
        : null;
      const record = records.get(`${employee.id}|${date}`) ?? null;
      const leave = leaveOf(employee.id, date);
      const holidayName = holidays.get(date) ?? null;
      days.push({
        employee,
        date,
        schedule,
        holidayName,
        leave,
        record,
        result: computeDay({
          date,
          now,
          schedule,
          isHoliday: holidayName !== null,
          leave,
          punchIn: record?.punchIn ?? null,
          punchOut: record?.punchOut ?? null,
          zone,
        }),
      });
    }
  }
  return days;
}

/**
 * The snapshot columns of an attendance row (DATABASE_V2.md §2.3), from the
 * day computed with the row's punches.
 */
export function snapshotOf(
  result: DayResult,
  schedule: DayScheduleRow | null,
  punchOut: Date | null,
) {
  return {
    status: result.status,
    note: result.note,
    dayKind: result.dayKind,
    scheduleId: result.dayType === 'working' ? (schedule?.id ?? null) : null,
    expectedMinutes: result.expectedMinutes,
    // An open punch is stored without worked time; the API computes it live.
    workedMinutes: punchOut ? result.workedMinutes : null,
    overtimeMinutes: punchOut ? result.overtimeMinutes : 0,
  };
}
