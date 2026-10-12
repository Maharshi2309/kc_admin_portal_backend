import { authenticate } from '@/modules/auth/auth.service';
import type { AuthContext } from '@/modules/auth/auth.types';
import { RateLimitError } from '@/lib/errors';
import { type RouteContext, route } from '@/lib/http';
import { apiLimiter } from '@/lib/rate-limit/limiters';
import { type PermissionKey, requireAnyPermission } from '@/lib/permissions';
import { bearerToken } from './token';

/**
 * `route()` for endpoints that need a signed-in user, optionally with a
 * permission (API_CONTRACT.md "Required permissions"):
 *
 *   export const PATCH = authed({ permission: 'employee.edit' }, async ({ auth }) => ...);
 *   export const GET = authed(async ({ auth }) => ...);        // any signed-in user
 *
 * Order (DATABASE_V2.md §4.2): 401 for a bad session, 429 if the user is
 * over the request limit, then 403 for a missing
 * permission, then the handler (which validates and applies state rules).
 * Rules that depend on the request (e.g. approve vs cancel) are checked in
 * the service with `requirePermission`.
 */
export type AuthedRouteContext<P extends Record<string, string> = Record<string, string>> =
  RouteContext<P> & { auth: AuthContext };

type Handler<P extends Record<string, string>> = (context: AuthedRouteContext<P>) => Promise<Response>;

export type AuthedOptions = {
  /** Required permission; with a list, any one of them is enough. */
  permission?: PermissionKey | readonly PermissionKey[];
};

export function authed<P extends Record<string, string> = Record<string, string>>(
  handler: Handler<P>,
): ReturnType<typeof route<P>>;
export function authed<P extends Record<string, string> = Record<string, string>>(
  options: AuthedOptions,
  handler: Handler<P>,
): ReturnType<typeof route<P>>;
export function authed<P extends Record<string, string> = Record<string, string>>(
  optionsOrHandler: AuthedOptions | Handler<P>,
  maybeHandler?: Handler<P>,
) {
  const options = typeof optionsOrHandler === 'function' ? {} : optionsOrHandler;
  const handler = typeof optionsOrHandler === 'function' ? optionsOrHandler : maybeHandler!;
  const required = options.permission === undefined ? [] : [options.permission].flat();

  return route<P>(async (context) => {
    const auth = await authenticate(bearerToken(context.request));
    const wait = apiLimiter().record(`api:${auth.userId}`);
    if (wait !== null) throw new RateLimitError('Too many requests. Please wait a moment and try again.', wait);
    if (required.length > 0) requireAnyPermission(auth, required);
    return handler({ ...context, auth, log: context.log.child({ userId: auth.userId }) });
  });
}
