import { z } from 'zod';
import { pageRequestOf, paginationFields } from '@/lib/http';
import { calendarDate, id, listCode, month, oneOf, optionalQuery, optionalText, searchQuery } from '@/lib/validation';

export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export const LEAVE_REASONS = ['personal_work', 'family_function', 'medical', 'travel', 'other'] as const;

const leaveTypeId = () =>
  z.string({ error: 'Choose a leave type' }).trim().min(1, 'Choose a leave type').max(32, 'Choose a leave type');

/** `GET /leaves` query (API_CONTRACT.md "Leave"). `from`/`to` keep leave overlapping the range. */
export const leaveListQuery = z
  .object({
    status: optionalQuery(oneOf(LEAVE_STATUSES, 'Choose pending, approved, rejected or cancelled')),
    search: searchQuery(),
    from: optionalQuery(calendarDate('From')),
    to: optionalQuery(calendarDate('To')),
    leaveTypeId: optionalQuery(leaveTypeId()),
    department: optionalQuery(listCode('Choose a department')),
    ...paginationFields(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { path: ['to'], message: 'Must be on or after the start date' })
  .transform(({ page, pageSize, ...filters }) => ({ ...filters, page: pageRequestOf({ page, pageSize }) }));
export type LeaveListQuery = z.output<typeof leaveListQuery>;

/** `GET /leave-balances` query (added 2026-10-05). */
export const leaveBalancesQuery = z
  .object({
    search: searchQuery(),
    department: optionalQuery(listCode('Choose a department')),
    ...paginationFields(),
  })
  .transform(({ page, pageSize, ...filters }) => ({ ...filters, page: pageRequestOf({ page, pageSize }) }));
export type LeaveBalancesQuery = z.output<typeof leaveBalancesQuery>;

const rangeFields = {
  employeeId: id('employee'),
  leaveTypeId: leaveTypeId(),
  startDate: calendarDate('Start date'),
  endDate: calendarDate('End date'),
  isHalfDay: z.boolean({ error: 'Must be true or false' }).default(false),
};

/** A half day is one date: its end date is its start date (as in the app). */
function normaliseHalfDay<T extends { startDate: string; endDate: string; isHalfDay: boolean }>(body: T): T {
  return body.isHalfDay ? { ...body, endDate: body.startDate } : body;
}

function endAfterStart(body: { startDate: string; endDate: string }, ctx: z.RefinementCtx): void {
  if (body.endDate < body.startDate) {
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Must be on or after the start date' });
  }
}

/** `POST /leaves` and `PATCH /leaves/{id}` (`leaves.create.request.json`). */
export const leaveBody = z
  .object({
    ...rangeFields,
    reason: oneOf(LEAVE_REASONS, 'Choose a reason'),
    remarks: optionalText(500),
    /** Admins may add leave already approved (the app's default) or pending. */
    status: oneOf(['pending', 'approved'] as const, 'Choose pending or approved').default('approved'),
    /**
     * Casual leave beyond the balance: save the extra (latest) days as a
     * linked Unpaid leave instead of refusing with 422
     * `INSUFFICIENT_LEAVE_BALANCE` (2026-10-05).
     */
    splitExcessAsUnpaid: z.boolean({ error: 'Must be true or false' }).nullish().transform((v) => v ?? false),
  })
  .transform(normaliseHalfDay)
  .superRefine(endAfterStart);
export type LeaveBody = z.output<typeof leaveBody>;

/** `POST /leaves/preview` (`leaves.preview.request.json`). */
export const leavePreviewBody = z
  .object({ ...rangeFields, leaveId: id('leave').nullish().transform((v) => v ?? null) })
  .transform(normaliseHalfDay)
  .superRefine(endAfterStart);
export type LeavePreviewBody = z.output<typeof leavePreviewBody>;

/** `PATCH /leaves/{id}/status` (`leaves.status.request.json`). */
export const leaveStatusBody = z.object({
  status: oneOf(['approved', 'rejected', 'cancelled'] as const, 'Choose approved, rejected or cancelled'),
});

/** `GET /leave-calendar?month&employeeId`. */
export const leaveCalendarQuery = z.object({ month: month(), employeeId: optionalQuery(id('employee')) });

export const leaveIdParam = z.object({ id: id('leave') });
