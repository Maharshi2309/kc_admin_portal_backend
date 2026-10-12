import { Prisma } from '@/generated/prisma/client';
import { AppError, ConflictError, type ErrorCode, NotFoundError, ValidationError } from './app-error';

/**
 * Turns database errors into safe API errors, so a raw message such as
 * `duplicate key value violates unique constraint "users_email_key"` never
 * reaches the app.
 *
 * Through the MySQL driver adapter, Prisma reports the violated constraint by
 * its index name (foreign keys: inside MySQL's message), so each constraint the API can hit is listed
 * here with the request field it belongs to and a message for the admin.
 * Add an entry when a migration adds a unique index or foreign key that
 * user input can violate.
 */

type FieldMessage = { field: string; message: string; code?: ErrorCode };

const uniqueConstraints: Record<string, FieldMessage> = {
  users_email_key: { field: 'email', message: 'A user with this email already exists.' },
  users_employee_id_key: { field: 'employeeId', message: 'This employee already has a user account.' },
  departments_name_key: { field: 'name', message: 'A department with this name already exists.' },
  departments_code_key: { field: 'code', message: 'A department with this code already exists.' },
  positions_name_key: { field: 'name', message: 'A position with this name already exists.' },
  positions_code_key: { field: 'code', message: 'A position with this code already exists.' },
  employees_ec_number_key: { field: 'ecNumber', message: 'This EC number is already in use' },
  company_holidays_live_date_key: { field: 'date', message: 'There is already a holiday on this date.' },
  employee_work_schedules_employee_id_effective_from_key: {
    field: 'effectiveFrom',
    message: 'A schedule already starts on this date.',
    code: 'SCHEDULE_OVERLAP',
  },
};

const foreignKeys: Record<string, FieldMessage> = {
  users_employee_id_fkey: { field: 'employeeId', message: 'Choose an employee' },
  employees_department_fkey: { field: 'department', message: 'Choose a department' },
  employees_position_fkey: { field: 'position', message: 'Choose a position' },
};

/** The AppError for [error], or `undefined` if it isn't a known database error. */
export function fromPrismaError(error: unknown): AppError | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return undefined;

  switch (error.code) {
    case 'P2002': {
      const known = uniqueConstraints[constraintName(error) ?? ''];
      return known
        ? new ConflictError(known.message, known.code ?? 'DUPLICATE', { [known.field]: [known.message] })
        : new ConflictError('This record already exists.', 'DUPLICATE');
    }
    case 'P2003': {
      const known = foreignKeys[constraintName(error) ?? ''];
      return known
        ? ValidationError.field(known.field, known.message)
        : new ValidationError('A related record was not found.');
    }
    case 'P2025':
      return new NotFoundError();
    default:
      return undefined;
  }
}

/** The violated constraint's name, from either error format Prisma uses. */
export function constraintName(error: Prisma.PrismaClientKnownRequestError): string | undefined {
  const meta = error.meta as
    | {
        target?: unknown;
        constraint?: unknown;
        driverAdapterError?: { cause?: { constraint?: { index?: unknown }; originalMessage?: unknown } };
      }
    | undefined;
  const cause = meta?.driverAdapterError?.cause;
  if (typeof cause?.constraint?.index === 'string') return cause.constraint.index;
  // MySQL reports foreign keys by column; the constraint name is in its message.
  const named = typeof cause?.originalMessage === 'string' ? cause.originalMessage.match(/CONSTRAINT `([^`]+)`/) : null;
  if (named?.[1]) return named[1];
  if (typeof meta?.constraint === 'string') return meta.constraint;
  if (typeof meta?.target === 'string') return meta.target;
  return undefined;
}
