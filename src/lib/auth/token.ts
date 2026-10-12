import { SignJWT, jwtVerify } from 'jose';
import { env } from '@/config/env';

/**
 * Access tokens: short JWTs (HS256) that name the user and the session.
 * The session row is what really decides whether the token still works,
 * so logout and deactivation take effect immediately.
 */

const ISSUER = 'kc-admin-portal';
const AUDIENCE = 'kc-admin-portal-app';

export type TokenClaims = { userId: number; sessionId: string };

function secret(): Uint8Array {
  return new TextEncoder().encode(env().JWT_SECRET);
}

export function signAccessToken(claims: TokenClaims, expiresAt: Date): Promise<string> {
  return new SignJWT({ sid: claims.sessionId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(String(claims.userId))
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secret());
}

/** The claims of a valid token, or `null` if it's malformed, forged or expired. */
export async function verifyAccessToken(token: string): Promise<TokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    const userId = Number(payload.sub);
    const sessionId = payload['sid'];
    if (!Number.isInteger(userId) || userId < 1 || typeof sessionId !== 'string') return null;
    return { userId, sessionId };
  } catch {
    return null;
  }
}

/** The token from `Authorization: Bearer <token>`, or `null`. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}
