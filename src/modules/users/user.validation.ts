import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/lib/auth/password';
import { pageRequestOf, paginationFields } from '@/lib/http';
import { isPermissionKey, type PermissionKey } from '@/lib/permissions/catalogue';
import { email, id, requiredText, searchQuery } from '@/lib/validation';

/** `GET /users?search&page&pageSize`: search matches name or email. */
export const userListQuery = z
  .object({ search: searchQuery(), ...paginationFields() })
  .transform(({ page, pageSize, ...rest }) => ({ ...rest, page: pageRequestOf({ page, pageSize }) }));
export type UserListQuery = z.output<typeof userListQuery>;

/** Permission keys from the catalogue; unknown keys → 422 (API_CONTRACT.md). */
const permissionKeys = z
  .array(z.string(), { error: 'Send the list of permissions' })
  .superRefine((keys, ctx) => {
    const unknown = keys.filter((key) => !isPermissionKey(key));
    if (unknown.length > 0) {
      ctx.addIssue({ code: 'custom', message: `Unknown permission: ${unknown.join(', ')}` });
    }
  })
  .transform((keys) => [...new Set(keys)] as PermissionKey[]);

/**
 * A password the admin sets for a staff user (T-06, decided 2026-10-10).
 * Not trimmed: spaces count. Stored only as an Argon2id hash.
 */
const password = () =>
  z
    .string({ error: `Use at least ${PASSWORD_MIN_LENGTH} characters` })
    .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
    .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`)
    .meta({ format: 'password', writeOnly: true, examples: ['Nisha@2026'] });

/** `POST /users` (`users.create.request.json`): `password` is required. */
export const createUserBody = z.object({
  name: requiredText('Name', 100),
  email: email(),
  password: password(),
  employeeId: id('employee').nullish().transform((value) => value ?? null),
  permissions: permissionKeys.default([]),
});
export type CreateUserBody = z.output<typeof createUserBody>;

/**
 * `PATCH /users/{id}`: `{ name, email, employeeId, isActive?, password? }`.
 * `employeeId: null` unlinks; `isActive` is sent only to change it;
 * `password` only to set a new one (absent or null keeps the current one).
 */
export const updateUserBody = z.object({
  name: requiredText('Name', 100),
  email: email(),
  employeeId: id('employee').nullish().transform((value) => value ?? null),
  isActive: z.boolean({ error: 'Must be true or false' }).optional(),
  password: password().nullish().transform((value) => value ?? undefined),
});
export type UpdateUserBody = z.output<typeof updateUserBody>;

/** `PUT /users/{id}/permissions` (`users.permissions.request.json`): the full list. */
export const setPermissionsBody = z.object({ permissions: permissionKeys });

export const userIdParam = z.object({ id: id('user') });
