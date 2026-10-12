import { z } from 'zod';
import { pageRequestOf, paginationFields } from '@/lib/http';
import { calendarDate, id, instant, listCode, oneOf, optionalQuery, optionalText, searchQuery } from '@/lib/validation';

/** Attendance list filter values (the app's status tiles). */
export const ATTENDANCE_FILTERS = ['present', 'late', 'on_leave', 'absent'] as const;
export type AttendanceFilter = (typeof ATTENDANCE_FILTERS)[number];

/** `GET /attendance` query. The app pages attendance 20 at a time. */
export const attendanceDayQuery = z
  .object({
    date: calendarDate('Date'),
    status: optionalQuery(oneOf(ATTENDANCE_FILTERS, 'Choose present, late, on_leave or absent')),
    search: searchQuery(),
    department: optionalQuery(listCode('Choose a department')),
    ...paginationFields(20),
  })
  .transform(({ page, pageSize, ...filters }) => ({ ...filters, page: pageRequestOf({ page, pageSize }) }));

export type AttendanceDayQuery = z.output<typeof attendanceDayQuery>;

/** `POST /attendance/punch-in` and `/punch-out` (`attendance.punch.request.json`). */
export const punchBody = z.object({ employeeId: id('employee') });

/** `POST /attendance/punch-in/bulk` (`attendance.punch-in-bulk.request.json`). */
export const bulkPunchBody = z.object({ date: calendarDate('Date') });

export const CORRECTION_REASONS = [
  'forgot_to_punch',
  'device_issue',
  'on_field_duty',
  'wrong_time_recorded',
  'other',
] as const;

/**
 * `PATCH /attendance/{id}` (correction) and `POST /attendance` (adding a
 * missing day), `attendance.correct.request.json`. The reason is required.
 */
const correctionFields = {
  date: calendarDate('Date'),
  punchIn: instant('Punch in'),
  punchOut: instant('Punch out').nullish().transform((value) => value ?? null),
  reason: oneOf(CORRECTION_REASONS, 'Choose a reason'),
  remarks: optionalText(500),
};

export const correctionBody = z.object({ ...correctionFields, employeeId: z.unknown().optional() });
export type CorrectionBody = z.output<typeof correctionBody>;

export const addRecordBody = z.object({ ...correctionFields, employeeId: id('employee') });
export type AddRecordBody = z.output<typeof addRecordBody>;

export const recordIdParam = z.object({ id: id('attendance record') });
