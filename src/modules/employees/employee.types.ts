import type { CalendarDate } from '@/lib/time';
import type { DayStatus } from '@/modules/day-engine/compute-day';
import type { WorkScheduleDto } from '@/modules/schedules/schedule.types';

export type EmployeeStatus = 'active' | 'inactive';

/** An employee as the app reads it (`employees.get.response.json`). */
export type EmployeeDto = {
  id: string;
  ecNumber: string;
  name: string;
  mobile: string;
  /** Codes, e.g. `graphic_designer` (2026-10-05). */
  department: string;
  position: string;
  joiningDate: CalendarDate;
  status: EmployeeStatus;
  /** The schedule in effect today (or the first one to come for a future joiner). */
  schedule: WorkScheduleDto | null;
  updatedAt: string;
  /** Name of the staff user who last changed the record. */
  updatedBy: string | null;
  /** Today's attendance status; left out before the joining date. */
  todayStatus?: DayStatus;
  /** Overtime from 1 January of this year to today; null without `overtime.view`. */
  overtimeMinutesThisYear?: number | null;
};

/** `GET /employees` (`employees.list.response.json`). */
export type EmployeeListDto = {
  items: EmployeeDto[];
  total: number;
  page: number;
  pageSize: number;
  /** Ignores the status filter, so the Active/Inactive switch doesn't change it. */
  counts: { active: number; inactive: number };
};
