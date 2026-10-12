import { dateFromDb, formatInstant, timeFromDb } from '@/lib/time';
import type { AuditChange } from '@/modules/audit/audit.types';
import type { ScheduleRow } from './schedule.repository';
import { weekdaysOf, weekdaysText } from './schedule.rules';
import type { WorkScheduleDto } from './schedule.types';

export function toWorkScheduleDto(row: ScheduleRow): WorkScheduleDto {
  return {
    id: String(row.id),
    effectiveFrom: dateFromDb(row.effectiveFrom),
    effectiveTo: row.effectiveTo ? dateFromDb(row.effectiveTo) : null,
    startTime: timeFromDb(row.startTime),
    endTime: timeFromDb(row.endTime),
    breakMinutes: row.breakMinutes,
    breakStart: row.breakStart ? timeFromDb(row.breakStart) : null,
    breakEnd: row.breakEnd ? timeFromDb(row.breakEnd) : null,
    weeklyOffDays: weekdaysOf(row.weeklyOffDays),
    expectedMinutes: row.expectedMinutes,
    createdBy: row.createdBy ? { id: String(row.createdBy.id), name: row.createdBy.name } : null,
    createdAt: formatInstant(row.createdAt),
  };
}

/** Change-history lines between two versions ([before] null for the first one). */
export function scheduleChanges(before: WorkScheduleDto | null, after: WorkScheduleDto): AuditChange[] {
  const breakText = (s: WorkScheduleDto) =>
    s.breakStart ? `${s.breakMinutes} min (${s.breakStart}–${s.breakEnd})` : `${s.breakMinutes} min`;
  const lines: [string, string, (s: WorkScheduleDto) => string][] = [
    ['effectiveFrom', 'Applies from', (s) => s.effectiveFrom],
    ['startTime', 'Start time', (s) => s.startTime],
    ['endTime', 'End time', (s) => s.endTime],
    ['break', 'Break', breakText],
    ['weeklyOffDays', 'Weekly off', (s) => weekdaysText(s.weeklyOffDays)],
  ];
  return lines.flatMap(([field, label, show]) => {
    const was = before ? show(before) : null;
    const now = show(after);
    return was === now ? [] : [{ field, label, before: was, after: now }];
  });
}
