import { env } from '@/config/env';
import { verifyAgainstDummy, verifyPassword } from '@/lib/auth/password';
import { signAccessToken, verifyAccessToken } from '@/lib/auth/token';
import { UnauthenticatedError } from '@/lib/errors';
import { type Clock, systemClock } from '@/lib/time';
import * as repo from './auth.repository';
import type { AuthContext, AuthUserDto, LoginResponseDto } from './auth.types';
import type { LoginBody } from './auth.validation';

/**
 * Sign-in rules (API_CONTRACT.md "Auth", DATABASE_V2.md §4.2):
 * - Wrong email and wrong password get the same message, so the login form
 *   can't be used to find out which emails exist.
 * - "Deactivated" is only revealed after a correct password.
 * - Every request re-checks the session and the user, so logout and
 *   deactivation take effect at once.
 */

export const INVALID_CREDENTIALS = 'Invalid email or password.';
export const ACCOUNT_DEACTIVATED = 'Your account has been deactivated.';
export const SESSION_EXPIRED = 'Your session has expired. Please sign in again.';

export async function login(
  body: LoginBody,
  meta: { userAgent: string | null },
  clock: Clock = systemClock,
): Promise<LoginResponseDto> {
  const user = await repo.findUserForLogin(body.email);

  const passwordOk =
    user?.passwordHash != null
      ? await verifyPassword(user.passwordHash, body.password)
      : await verifyAgainstDummy(body.password);
  if (!user || !passwordOk) throw new UnauthenticatedError(INVALID_CREDENTIALS);
  if (!user.isActive) throw new UnauthenticatedError(ACCOUNT_DEACTIVATED);

  const now = clock();
  const expiresAt = new Date(now.getTime() + env().AUTH_SESSION_HOURS * 3_600_000);
  const session = await repo.openSession({
    userId: user.id,
    expiresAt,
    userAgent: meta.userAgent?.slice(0, 255) ?? null,
    signedInAt: now,
  });

  const accessToken = await signAccessToken({ userId: user.id, sessionId: session.id }, expiresAt);
  return {
    accessToken,
    user: toUserDto(user, await repo.permissionKeysOf(user.id)),
  };
}

/**
 * Resolves a bearer token to the caller, or throws 401 with the message the
 * app shows on the login screen.
 */
export async function authenticate(
  token: string | null,
  clock: Clock = systemClock,
): Promise<AuthContext> {
  if (!token) throw new UnauthenticatedError('Please sign in.');

  const claims = await verifyAccessToken(token);
  if (!claims) throw new UnauthenticatedError(SESSION_EXPIRED);

  const session = await repo.findSessionWithUser(claims.sessionId);
  const now = clock();
  if (
    !session ||
    session.user.id !== claims.userId ||
    session.revokedAt !== null ||
    session.expiresAt <= now
  ) {
    throw new UnauthenticatedError(SESSION_EXPIRED);
  }
  if (!session.user.isActive) throw new UnauthenticatedError(ACCOUNT_DEACTIVATED);

  return {
    userId: session.user.id,
    sessionId: session.id,
    name: session.user.name,
    email: session.user.email,
    permissions: new Set(await repo.permissionKeysOf(session.user.id)),
  };
}

export function currentUser(auth: AuthContext): AuthUserDto {
  return toUserDto({ id: auth.userId, name: auth.name, email: auth.email }, [...auth.permissions]);
}

export async function logout(auth: AuthContext, clock: Clock = systemClock): Promise<void> {
  await repo.revokeSession(auth.sessionId, clock());
}

function toUserDto(
  user: { id: number; name: string; email: string },
  permissions: string[],
): AuthUserDto {
  return { id: String(user.id), name: user.name, email: user.email, permissions };
}
