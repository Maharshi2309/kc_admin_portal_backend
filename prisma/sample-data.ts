/**
 * DEVELOPMENT ONLY: makes sure a local database has the default lists the
 * app expects: departments and positions Accountant, Graphic Designer and
 * Tailor, and the Casual and Unpaid leave types. The V3 migration adds the
 * same rows, so this only matters for a database that was emptied by hand.
 *
 *   npm run db:sample
 *
 * Refuses to run unless DATABASE_URL points at this machine. Safe to re-run:
 * it only adds what's missing.
 */
import { mysqlAdapter } from '../src/lib/db/connection';
import { PrismaClient } from '../src/generated/prisma/client';

try {
  process.loadEnvFile('.env');
} catch {
  // no .env file
}

const lists = [
  { code: 'accountant', name: 'Accountant' },
  { code: 'graphic_designer', name: 'Graphic Designer' },
  { code: 'tailor', name: 'Tailor' },
];

const leaveTypes = [
  { id: 'casual', name: 'Casual', hasBalance: true, isPaid: true, sort: 1 },
  { id: 'unpaid', name: 'Unpaid', hasBalance: false, isPaid: false, sort: 2 },
];

function assertLocal(url: string): void {
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`Refusing to load sample data into a non-local database (${host}).`);
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');
  assertLocal(url);
  const db = new PrismaClient({ adapter: mysqlAdapter(url) });
  try {
    for (const entry of lists) {
      await db.department.upsert({ where: { code: entry.code }, update: {}, create: entry });
      await db.position.upsert({ where: { code: entry.code }, update: {}, create: entry });
    }
    for (const type of leaveTypes) {
      await db.leaveType.upsert({ where: { id: type.id }, update: {}, create: type });
    }
    console.log(`Sample data: ${lists.length} departments, ${lists.length} positions, ${leaveTypes.length} leave types.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
