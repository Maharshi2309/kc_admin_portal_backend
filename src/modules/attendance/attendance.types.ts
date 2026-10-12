import type { CalendarDate, TimeOfDay } from '@/lib/time';
import type { DayKind, DayStatus } from '@/modules/day-engine/compute-day';

/** `employee` inside attendance and leave rows (`EmployeeSummaryModel` in the app). */
export type EmployeeSummaryDto = {
  id: string;
  name: string;
  ecNumber: string;
  /** Codes, e.g. `tailor` (2026-10-05). */
  department: string;
  position: string;
};

/** One employee's attendance on one date (`attendance.record.response.json`). */
export type AttendanceRecordDto = {
  /** Null when nothing is recorded yet (e.g. an absence). */
  id: string | null;
  employee: EmployeeSummaryDto;
  date: CalendarDate;
  punchIn: string | null;
  punchOut: string | null;
  workedMinutes: number | null;
  workedPercent: number | null;
  status: DayStatus;
  /** Short remarks only; durations are never written into it. */
  note: string | null;
  /** How late the punch in was, in minutes; null when not late. */
  lateMinutes: number | null;
  correctedBy: string | null;
  correctedAt: string | null;
  dayKind: DayKind;
  /** The employee's schedule that day; null on holidays and weekly offs. */
  schedule: { startTime: TimeOfDay; endTime: TimeOfDay; expectedMinutes: number } | null;
  expectedMinutes: number;
  overtimeMinutes: number;
};

/** `GET /attendance` (`attendance.day.response.json`). */
export type AttendanceDayDto = {
  summary: {
    date: CalendarDate;
    totalEmployees: number;
    present: number;
    late: number;
    onLeave: number;
    absent: number;
    notPunchedIn: number;
  };
  items: AttendanceRecordDto[];
  total: number;
  page: number;
  pageSize: number;
};
