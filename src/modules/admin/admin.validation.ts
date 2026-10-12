import { z } from 'zod';
import { id } from '@/lib/validation';

/** The exact text `POST /admin/clear-data` needs, so it can't run by accident. */
export const CLEAR_DATA_CONFIRMATION = 'DELETE ALL DATA';

export const recordIdParam = z.object({ id: id() });
export const listCodeParam = z.object({ code: z.string().trim().min(1).max(50) });

/** `POST /admin/clear-data` body. */
export const clearDataBody = z.object({
  confirm: z
    .string({ error: `Type "${CLEAR_DATA_CONFIRMATION}" to confirm` })
    .refine((value) => value === CLEAR_DATA_CONFIRMATION, `Type "${CLEAR_DATA_CONFIRMATION}" to confirm`)
    .meta({ description: `Must be exactly "${CLEAR_DATA_CONFIRMATION}"`, examples: [CLEAR_DATA_CONFIRMATION] }),
  includeMasterData: z
    .boolean({ error: 'Use true or false' })
    .default(false)
    .meta({ description: 'Also delete departments and positions (default false: they are kept)' }),
});

export type ClearDataBody = z.output<typeof clearDataBody>;
