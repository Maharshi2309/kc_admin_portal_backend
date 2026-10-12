import type { Prisma } from '@/generated/prisma/client';
import { type CalendarDate, companyZone, dateFromDb, dateToDb } from '@/lib/time';
import { dayEmployeeSelect, loadDays, snapshotOf } from './day-context';

/**
 * Re-writes the stored snapshots (status, minutes, day kind…) of existing
 * attendance rows after something they depend on changed (DATABASE_V2.md
 * §3.5). Runs inside the caller's transaction, so the change and the
 * recalculation are saved together.
 *
 * | Change                          | Call with                              |
 * |---------------------------------|----------------------------------------|
 * | New schedule version from D     | `{ employeeId, from: D }`              |
 * | Holiday added / moved / deleted | `{ dates: [old date, new date] }`      |
 * | Leave approved / cancelled / …  | `{ employeeId, from, to }` (step 12)   |
 *
 * Returns how many rows were recalculated.
 */
export async function recalculateRecords(
  tx: Prisma.TransactionClient,
  scope: { employeeId?: number; from?: CalendarDate; to?: CalendarDate; dates?: CalendarDate[] },
  now: Date,
): Promise<number> {
  const where: Prisma.AttendanceRecordWhereInput = {};
  if (scope.employeeId !== undefined) where.employeeId = scope.employeeId;
  if (scope.dates) where.date = { in: scope.dates.map(dateToDb) };
  else if (scope.from || scope.to) {
    where.date = {
      ...(scope.from ? { gte: dateToDb(scope.from) } : {}),
      ...(scope.to ? { lte: dateToDb(scope.to) } : {}),
    };
  }

  const records = await tx.attendanceRecord.findMany({
    where,
    select: { id: true, employeeId: true, date: true, punchOut: true },
  });
  if (records.length === 0) return 0;

  // Load per date span actually touched: one span per distinct date list, or
  // the records' own range.
  const dates = records.map((r) => dateFromDb(r.date)).sort();
  const spans: [CalendarDate, CalendarDate][] = scope.dates
    ? [...new Set(dates)].map((d) => [d, d])
    : [[dates[0]!, dates.at(-1)!]];

  const employees = await tx.employee.findMany({
    where: { id: { in: [...new Set(records.map((r) => r.employeeId))] } },
    select: dayEmployeeSelect,
  });
  const days = new Map<string, Awaited<ReturnType<typeof loadDays>>[number]>();
  for (const [from, to] of spans) {
    for (const day of await loadDays({ employees, from, to, now, zone: companyZone(), client: tx })) {
      days.set(`${day.employee.id}|${day.date}`, day);
    }
  }

  let updated = 0;
  for (const record of records) {
    const day = days.get(`${record.employeeId}|${dateFromDb(record.date)}`);
    if (!day) continue; // before the joining date: nothing to compute
    await tx.attendanceRecord.update({
      where: { id: record.id },
      data: snapshotOf(day.result, day.schedule, record.punchOut),
    });
    updated += 1;
  }
  return updated;
}
