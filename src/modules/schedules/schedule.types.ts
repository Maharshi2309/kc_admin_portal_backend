import type { CalendarDate, TimeOfDay } from '@/lib/time';

/** A schedule version as the app reads it (`employees.schedules.response.json`). */
export type WorkScheduleDto = {
  id: string;
  effectiveFrom: CalendarDate;
  effectiveTo: CalendarDate | null;
  startTime: TimeOfDay;
  endTime: TimeOfDay;
  breakMinutes: number;
  breakStart: TimeOfDay | null;
  breakEnd: TimeOfDay | null;
  weeklyOffDays: number[];
  expectedMinutes: number;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
};
