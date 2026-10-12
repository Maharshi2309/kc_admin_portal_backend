import { z } from 'zod';

/**
 * Default messages for Zod issues a schema doesn't word itself. Zod's own
 * defaults ("Invalid input: expected string, received undefined") would be
 * shown to admins as-is, so they're replaced with plain English.
 * Field-specific wording still belongs in each schema.
 */
export function installValidationMessages(): void {
  z.config({
    customError: (issue) => {
      if (issue.input === undefined || issue.input === null) {
        return issue.code === 'invalid_type' ? 'This field is required' : undefined;
      }
      switch (issue.code) {
        case 'invalid_type':
          return `Must be ${article(issue.expected)}`;
        case 'invalid_value':
          return 'This value is not allowed';
        case 'too_small':
          return issue.origin === 'string' && issue.minimum === 1
            ? 'This field is required'
            : undefined;
        case 'unrecognized_keys':
          return 'Contains unknown fields';
        default:
          return undefined;
      }
    },
  });
}

function article(expected: string): string {
  const names: Record<string, string> = {
    string: 'text',
    number: 'a number',
    int: 'a whole number',
    boolean: 'true or false',
    array: 'a list',
    object: 'an object',
  };
  return names[expected] ?? `a valid ${expected}`;
}
