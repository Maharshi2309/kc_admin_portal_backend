import { z } from 'zod';
import { pageRequestOf, paginationFields } from '@/lib/http';
import {
  calendarDate,
  ecNumber,
  id,
  listCode,
  mobile,
  oneOf,
  optionalQuery,
  requiredText,
  searchQuery,
} from '@/lib/validation';
import { firstScheduleFields } from '@/modules/schedules/schedule.validation';

const status = () => oneOf(['active', 'inactive'] as const, 'Choose active or inactive');

/** `GET /employees` query (API_CONTRACT.md "Employees"). */
export const employeeListQuery = z
  .object({
    search: searchQuery(),
    department: optionalQuery(listCode('Choose a department')),
    position: optionalQuery(listCode('Choose a position')),
    status: optionalQuery(status()),
    joinedFrom: optionalQuery(calendarDate('Joined from')),
    joinedTo: optionalQuery(calendarDate('Joined to')),
    ...paginationFields(),
  })
  .refine((q) => !q.joinedFrom || !q.joinedTo || q.joinedFrom <= q.joinedTo, {
    path: ['joinedTo'],
    message: 'Must be on or after the start date',
  })
  .transform(({ page, pageSize, ...filters }) => ({
    ...filters,
    page: pageRequestOf({ page, pageSize }),
  }));

export type EmployeeListQuery = z.output<typeof employeeListQuery>;

/** Fields shared by create and update (`employees.create.request.json`). */
const employeeFields = z.object({
  ecNumber: ecNumber(),
  name: requiredText('Full name', 100),
  mobile: mobile(),
  department: listCode('Choose a department'),
  position: listCode('Choose a position'),
  joiningDate: calendarDate('Joining date'),
  status: status(),
});

/**
 * `POST /employees`: the employee plus their first working schedule, which
 * starts on the joining date (that's what the app sends).
 */
export const createEmployeeBody = employeeFields
  .extend({
    schedule: firstScheduleFields.optional(),
  })
  .superRefine((body, ctx) => {
    if (!body.schedule) {
      ctx.addIssue({ code: 'custom', path: ['schedule'], message: 'Set the working schedule' });
    } else if (body.schedule.effectiveFrom && body.schedule.effectiveFrom !== body.joiningDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['schedule', 'effectiveFrom'],
        message: 'The first schedule starts on the joining date',
      });
    }
  });

export type CreateEmployeeBody = z.output<typeof createEmployeeBody>;

/**
 * `PATCH /employees/{id}`: same body as create, without `schedule` (changes
 * add a schedule version instead; a `schedule` sent here is ignored).
 */
export const updateEmployeeBody = employeeFields;
export type UpdateEmployeeBody = z.output<typeof updateEmployeeBody>;

/** `PATCH /employees/{id}/status` (`employees.status.request.json`). */
export const employeeStatusBody = z.object({ status: status() });

/** Path `{id}`. A malformed id is treated as "not found". */
export const employeeIdParam = z.object({ id: id('employee') });
