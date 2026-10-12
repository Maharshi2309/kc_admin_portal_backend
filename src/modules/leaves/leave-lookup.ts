import { dateFromDb, dateToDb, eachDate } from '@/lib/time';
import type { DayLeave } from '@/modules/day-engine/compute-day';
import type { LeaveLookup } from '@/modules/day-engine/day-context';

/**
 * Approved leave per employee and date, for the day engine. Pending leave
 * doesn't excuse an absence (DATABASE_V2.md §3.4); rejected and cancelled
 * leave doesn't count at all.
 */
export const approvedLeaveLookup: LeaveLookup = async (employeeIds, from, to, client) => {
  const leaves = await client.leave.findMany({
    where: {
      employeeId: { in: employeeIds },
      status: 'approved',
      startDate: { lte: dateToDb(to) },
      endDate: { gte: dateToDb(from) },
    },
    select: { employeeId: true, startDate: true, endDate: true, isHalfDay: true },
  });
  const byKey = new Map<string, DayLeave>();
  for (const leave of leaves) {
    const kind: DayLeave = leave.isHalfDay ? 'half_day' : 'full_day';
    for (const date of eachDate(dateFromDb(leave.startDate), dateFromDb(leave.endDate))) {
      // Overlaps are refused when saving; if two ever meet, a full day wins.
      const key = `${leave.employeeId}|${date}`;
      if (byKey.get(key) !== 'full_day') byKey.set(key, kind);
    }
  }
  return (employeeId, date) => byKey.get(`${employeeId}|${date}`) ?? 'none';
};
