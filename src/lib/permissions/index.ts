import { ForbiddenError } from '@/lib/errors';
import type { AuthContext } from '@/modules/auth/auth.types';
import { type PermissionKey, permissionLabel } from './catalogue';

export * from './catalogue';

/**
 * Server-side permission checks (DATABASE_V2.md §4.2). The app's own
 * permission checks only shape its UI; these are the ones that count.
 */

export function can(auth: AuthContext, key: PermissionKey): boolean {
  return auth.permissions.has(key);
}

/** 403 `PERMISSION_DENIED` unless the caller has [key]. */
export function requirePermission(auth: AuthContext, key: PermissionKey): void {
  if (!can(auth, key)) throw new ForbiddenError(deniedMessage(key));
}

/** 403 unless the caller has at least one of [keys] (e.g. leave preview). */
export function requireAnyPermission(auth: AuthContext, keys: readonly PermissionKey[]): void {
  if (!keys.some((key) => can(auth, key))) throw new ForbiddenError(deniedMessage(keys[0]!));
}

/** "Edit employees" → "You do not have permission to edit employees." */
export function deniedMessage(key: PermissionKey): string {
  const label = permissionLabel(key);
  return `You do not have permission to ${label.charAt(0).toLowerCase()}${label.slice(1)}.`;
}
