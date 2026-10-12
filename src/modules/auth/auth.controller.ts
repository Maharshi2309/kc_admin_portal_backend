import { authed } from '@/lib/auth/authed';
import { RateLimitError, UnauthenticatedError } from '@/lib/errors';
import { noContent, ok, readJson, route } from '@/lib/http';
import { clientAddress } from '@/lib/rate-limit';
import { loginLimiter } from '@/lib/rate-limit/limiters';
import * as service from './auth.service';
import { loginBody } from './auth.validation';

/**
 * `POST /api/auth/login` → `{ accessToken, user }`. The only public endpoint.
 * Repeated wrong passwords for one email from one address pause sign-in for
 * that pair (429 with `Retry-After`); a successful sign-in clears the count.
 */
export const login = route(async ({ request, log }) => {
  const body = await readJson(request, loginBody);
  const key = `login:${body.email}|${clientAddress(request)}`;
  const limiter = loginLimiter();
  const wait = limiter.blockedFor(key);
  if (wait !== null) throw tooManyAttempts(wait);

  try {
    const result = await service.login(body, { userAgent: request.headers.get('user-agent') });
    limiter.clear(key);
    log.info('Signed in', { userId: result.user.id });
    return ok(result);
  } catch (error) {
    if (error instanceof UnauthenticatedError && error.message === service.INVALID_CREDENTIALS) {
      limiter.record(key);
      log.warn('Failed sign-in');
    }
    throw error;
  }
});

function tooManyAttempts(seconds: number): RateLimitError {
  const minutes = Math.ceil(seconds / 60);
  return new RateLimitError(
    `Too many failed sign-ins. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    seconds,
  );
}

/** `GET /api/auth/me` → the signed-in user with their permission keys. */
export const me = authed(async ({ auth }) => ok(service.currentUser(auth)));

/** `POST /api/auth/logout` → 204. Ends this device's session only. */
export const logout = authed(async ({ auth }) => {
  await service.logout(auth);
  return noContent();
});
