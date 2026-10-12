/**
 * `npm run db:seed`: loads the permission catalogue and creates the bootstrap
 * admin from BOOTSTRAP_ADMIN_NAME / _EMAIL / _PASSWORD (e.g. in .env). Safe to
 * run any number of times. The same step also runs when the server starts
 * (see src/lib/bootstrap.ts).
 */
import { PrismaClient } from '../src/generated/prisma/client';
import { bootstrap } from '../src/lib/bootstrap';
import { mysqlAdapter } from '../src/lib/db/connection';

try {
  process.loadEnvFile('.env');
} catch {
  // no .env file: use the real environment
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');
  const db = new PrismaClient({ adapter: mysqlAdapter(url) });
  try {
    if (!process.env.BOOTSTRAP_ADMIN_EMAIL) console.log('Bootstrap admin: skipped (BOOTSTRAP_ADMIN_EMAIL not set).');
    await bootstrap(db, process.env, (message) => console.log(message));
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
