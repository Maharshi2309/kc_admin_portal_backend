import { PrismaMariaDb } from '@prisma/adapter-mariadb';

/**
 * MySQL connection settings from a `mysql://USER:PASSWORD@HOST:PORT/DATABASE`
 * URL. Supported query options: `ssl=true` (encrypt the connection) and
 * `connectionLimit=N` (default 5, kept small for shared hosting).
 *
 * The session runs in UTC (`timezone: 'Z'`), so DATETIME values are stored
 * and read as UTC, and DATE / TIME values are never shifted.
 */
export function mysqlAdapter(url: string): PrismaMariaDb {
  const parsed = new URL(url);
  if (parsed.protocol !== 'mysql:' && parsed.protocol !== 'mariadb:') {
    throw new Error('DATABASE_URL must be a mysql:// connection string');
  }
  const ssl = parsed.searchParams.get('ssl');
  return new PrismaMariaDb({
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    connectionLimit: Number(parsed.searchParams.get('connectionLimit') ?? 5),
    timezone: 'Z',
    // MySQL 8's default sign-in method needs the server key on unencrypted connections.
    allowPublicKeyRetrieval: true,
    ...(ssl === 'true' ? { ssl: true } : {}),
  });
}
