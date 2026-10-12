/**
 * Errors the API reports to the app. Each one becomes the error body the
 * Flutter app reads (API_CONTRACT.md §1):
 *
 *   { "code"?: "LEAVE_NOT_EDITABLE", "message": "...", "errors"?: { "field": ["..."] } }
 *
 * `message` is shown to the admin as-is, so it must always be safe to show:
 * never a stack trace, SQL, or a value the user didn't send.
 */

/** Field name → messages. Nested fields use dots: `schedule.startTime`. */
export type FieldErrors = Record<string, string[]>;

/** Machine-readable codes. The first five are the ones the app acts on. */
export type ErrorCode =
  | 'PERMISSION_DENIED'
  | 'LEAVE_NOT_EDITABLE'
  | 'SCHEDULE_OVERLAP'
  | 'LAST_PERMISSION_MANAGER'
  | 'CANNOT_CHANGE_OWN_ACCESS'
  | 'INSUFFICIENT_LEAVE_BALANCE'
  | 'VALIDATION_ERROR'
  | 'BAD_REQUEST'
  | 'UNAUTHENTICATED'
  | 'NOT_FOUND'
  | 'DUPLICATE'
  | 'CONFLICT'
  | 'INVALID_STATUS_TRANSITION'
  | 'ATTENDANCE_STATE'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: ErrorCode,
    readonly fieldErrors?: FieldErrors,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** 400: the request itself is malformed (e.g. body isn't JSON). */
export class BadRequestError extends AppError {
  constructor(message = 'The request is not valid.') {
    super(400, message, 'BAD_REQUEST');
  }
}

/** 422: input failed validation. The app shows `fieldErrors` under each field. */
export class ValidationError extends AppError {
  constructor(message: string, fieldErrors?: FieldErrors) {
    super(422, message, 'VALIDATION_ERROR', fieldErrors);
  }

  /** One field, one message; the message doubles as the summary. */
  static field(field: string, message: string): ValidationError {
    return new ValidationError(message, { [field]: [message] });
  }
}

/**
 * 422 `INSUFFICIENT_LEAVE_BALANCE`: Casual leave beyond what is earned. No
 * field errors; the app offers to resend with `splitExcessAsUnpaid`.
 */
export class InsufficientLeaveBalanceError extends AppError {
  constructor(message: string) {
    super(422, message, 'INSUFFICIENT_LEAVE_BALANCE');
  }
}

/** 401: no valid session. The app signs out and shows `message` if given. */
export class UnauthenticatedError extends AppError {
  constructor(message = 'Your session has expired. Please sign in again.') {
    super(401, message, 'UNAUTHENTICATED');
  }
}

/** 403: signed in, but missing the endpoint's permission. */
export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to do this.') {
    super(403, message, 'PERMISSION_DENIED');
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'This record was not found.') {
    super(404, message, 'NOT_FOUND');
  }
}

/**
 * 409: the request clashes with current data: a duplicate, or a state rule
 * such as editing leave that is no longer pending.
 */
export class ConflictError extends AppError {
  constructor(message: string, code: ErrorCode = 'CONFLICT', fieldErrors?: FieldErrors) {
    super(409, message, code, fieldErrors);
  }

  static duplicate(field: string, message: string): ConflictError {
    return new ConflictError(message, 'DUPLICATE', { [field]: [message] });
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = 'The request is too large.') {
    super(413, message, 'PAYLOAD_TOO_LARGE');
  }
}

export class RateLimitError extends AppError {
  constructor(
    message = 'Too many attempts. Please wait a moment and try again.',
    readonly retryAfterSeconds?: number,
  ) {
    super(429, message, 'RATE_LIMITED');
  }
}
