import { env } from '@/config/env';
import { PrismaClient } from '@/generated/prisma/client';
import { logger } from '@/lib/logger';
import { mysqlAdapter } from './connection';

/**
 * The one Prisma client for the process. Only repositories import it;
 * route handlers and services never touch the database directly.
 *
 * In development, Next.js reloads modules on every change; keeping the
 * client on `globalThis` stops each reload from opening a new pool.
 */

const globalForDb = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  return new PrismaClient({ adapter: mysqlAdapter(env().DATABASE_URL) });
}

export function db(): PrismaClient {
  globalForDb.prisma ??= createClient();
  return globalForDb.prisma;
}

/** True when the database answers a trivial query (used by the health check). */
export async function isDatabaseReachable(): Promise<boolean> {
  try {
    await db().$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger().warn('Database health check failed', { error });
    return false;
  }
}
