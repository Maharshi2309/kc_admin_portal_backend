import { z } from 'zod';
import { PASSWORD_MAX_LENGTH } from '@/lib/auth/password';
import { email } from '@/lib/validation';

/** `POST /auth/login` body (`auth.login.request.json`). */
export const loginBody = z.object({
  email: email(),
  // Not trimmed: spaces may be part of a password.
  password: z
    .string({ error: 'Password is required' })
    .min(1, 'Password is required')
    .max(PASSWORD_MAX_LENGTH, 'Invalid email or password.'),
});

export type LoginBody = z.output<typeof loginBody>;
