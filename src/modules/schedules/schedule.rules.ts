import { type TimeOfDay, minutesOfDay } from '@/lib/time';

/**
 * Working-schedule rules (DATABASE_V2.md §2.1, approved 2026-09-30).
 * Field keys and messages match the app's own `scheduleProblems`, so a
 * server error lands under the same form field with the same wording.
 */

export type ScheduleShape = {
  startTime: TimeOfDay;
  endTime: TimeOfDay;
  breakMinutes: number;
  breakStart: TimeOfDay | null;
  breakEnd: TimeOfDay | null;
  weeklyOffDays: number[];
};

/** Problems keyed by field (`endTime`, `breakMinutes`, `breakStart`, `weeklyOffDays`). */
export function scheduleProblems(schedule: ScheduleShape): Record<string, string> {
  const problems: Record<string, string> = {};
  const shift = minutesOfDay(schedule.endTime) - minutesOfDay(schedule.startTime);

  if (shift <= 0) {
    // Overnight shifts aren't supported (DATABASE_V2.md §1).
    problems.endTime = 'End time must be after the start time';
  } else if (schedule.breakMinutes < 0 || schedule.breakMinutes >= shift) {
    problems.breakMinutes = 'The break must be shorter than the shift';
  }

  const { breakStart, breakEnd } = schedule;
  if ((breakStart === null) !== (breakEnd === null)) {
    problems.breakStart = 'The break must end on the same day';
  } else if (breakStart !== null && breakEnd !== null) {
    const start = minutesOfDay(breakStart);
    const end = minutesOfDay(breakEnd);
    if (start < minutesOfDay(schedule.startTime) || end > minutesOfDay(schedule.endTime)) {
      problems.breakStart = 'The break must be within the working hours';
    } else if (end - start !== schedule.breakMinutes) {
      problems.breakStart = 'The break window must match the break length';
    }
  }

  const offs = schedule.weeklyOffDays;
  if (offs.some((day) => day < 1 || day > 7) || new Set(offs).size >= 7) {
    problems.weeklyOffDays = 'Leave at least one working day in the week';
  }
  return problems;
}

/** Expected working minutes of one day: end − start − break. */
export function expectedMinutesOf(schedule: Pick<ScheduleShape, 'startTime' | 'endTime' | 'breakMinutes'>): number {
  return minutesOfDay(schedule.endTime) - minutesOfDay(schedule.startTime) - schedule.breakMinutes;
}

const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** `[6, 7]` → "Sat, Sun"; empty → "None" (for the change history). */
export function weekdaysText(days: readonly number[]): string {
  if (days.length === 0) return 'None';
  return [...days].sort((a, b) => a - b).map((day) => weekdayNames[day - 1] ?? String(day)).join(', ');
}

/** The stored weekly-off JSON as sorted ISO weekdays (anything else is ignored). */
export function weekdaysOf(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((day): day is number => Number.isInteger(day) && day >= 1 && day <= 7).sort((a, b) => a - b);
}
