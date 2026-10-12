import { z } from 'zod';
import { calendarDate, timeOfDay } from '@/lib/validation';
import { scheduleProblems } from './schedule.rules';

/**
 * Schedule fields as the app sends them (`employees.schedules.create.request.json`).
 * Used without a prefix on `POST /employees/{id}/schedules`, and nested as
 * `schedule` in `POST /employees`, which makes the error keys
 * `schedule.startTime` etc. automatically (API_CONTRACT.md "Working schedules").
 */
const optionalTime = (label: string) =>
  z.preprocess((value) => (value === '' ? null : value), timeOfDay(label).nullish()).transform(
    (value) => value ?? null,
  );

const scheduleShape = z.object({
  startTime: timeOfDay('Start time'),
  endTime: timeOfDay('End time'),
  breakMinutes: z
    .number({ error: 'Break length is required' })
    .int('Use whole minutes')
    .min(0, 'The break can’t be negative')
    .max(24 * 60, 'The break must be shorter than the shift'),
  breakStart: optionalTime('Break start'),
  breakEnd: optionalTime('Break end'),
  weeklyOffDays: z
    .array(
      z.number().int().min(1, 'Use weekdays 1 (Monday) to 7 (Sunday)').max(7, 'Use weekdays 1 (Monday) to 7 (Sunday)'),
      { error: 'Weekly offs are required (an empty list means none)' },
    )
    .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
});

/** Adds the cross-field rules (end after start, break window, weekly offs). */
function checkRules(schedule: z.output<typeof scheduleShape>, ctx: z.RefinementCtx): void {
  for (const [field, message] of Object.entries(scheduleProblems(schedule))) {
    ctx.addIssue({ code: 'custom', path: [field], message });
  }
}

export const scheduleFields = scheduleShape.superRefine(checkRules);

export type ScheduleFields = z.output<typeof scheduleFields>;

/** `POST /employees/{id}/schedules` body. */
export const scheduleVersionBody = scheduleShape
  .extend({ effectiveFrom: calendarDate('Applies from') })
  .superRefine(checkRules);

export type ScheduleVersionBody = z.output<typeof scheduleVersionBody>;

/**
 * The `schedule` inside `POST /employees`. Its start date is the joining
 * date; the app sends it, but it may be left out.
 */
export const firstScheduleFields = scheduleShape
  .extend({ effectiveFrom: calendarDate('Applies from').optional() })
  .superRefine(checkRules);
