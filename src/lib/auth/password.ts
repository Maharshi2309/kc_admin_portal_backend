import { hash, verify } from '@node-rs/argon2';

/**
 * Password hashing with Argon2id (library defaults: 19 MiB memory, 2
 * iterations, the OWASP minimum). Hashes include their own parameters, so
 * they can be strengthened later without breaking stored ones.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

/** False for a wrong password or an unreadable hash; never throws. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Spends the same time as a real check when the account doesn't exist or has
 * no password, so response times don't reveal which emails are registered.
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword('dummy-password-for-timing-only');
  await verifyPassword(await dummyHash, password);
  return false;
}
