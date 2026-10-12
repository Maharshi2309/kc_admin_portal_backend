import type { ZodError } from 'zod';
import { type FieldErrors, ValidationError } from './app-error';

/**
 * Converts Zod issues into the app's field errors. Paths become dotted keys
 * matching the request body (`schedule.startTime`, `permissions.2`); the
 * first message doubles as the summary, as in the app's own mock.
 */
export function fromZodError(error: ZodError): ValidationError {
  const fieldErrors: FieldErrors = {};
  let summary: string | undefined;

  for (const issue of error.issues) {
    summary ??= issue.message;
    const key = issue.path.map(String).join('.');
    if (key.length === 0) continue;
    (fieldErrors[key] ??= []).push(issue.message);
  }

  return new ValidationError(
    summary ?? 'Please check the entered details and try again.',
    Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined,
  );
}
