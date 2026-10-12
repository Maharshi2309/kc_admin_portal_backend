import { z } from 'zod';
import { listCode, requiredText } from '@/lib/validation';

/** "Graphic Designer" → `graphic_designer`. */
export function codeFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
}

/**
 * `POST /departments` and `POST /positions`: `{ name, code? }`. Without a
 * code, it's made from the name ("Graphic Designer" → `graphic_designer`).
 */
export const listEntryBody = z
  .object({
    name: requiredText('Name', 100),
    code: listCode('Use lower-case letters, digits and single underscores, e.g. graphic_designer').nullish(),
  })
  .transform((body, ctx) => {
    const code = body.code ?? codeFromName(body.name);
    if (code === '') {
      ctx.addIssue({ code: 'custom', path: ['code'], message: 'Enter a code, e.g. graphic_designer' });
      return z.NEVER;
    }
    return { name: body.name, code };
  });

export type ListEntryBody = z.output<typeof listEntryBody>;
