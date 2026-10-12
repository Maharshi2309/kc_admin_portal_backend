import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createConnection } from 'mariadb';
import { TEST_DATABASE_URL } from './setup';

/**
 * Brings the test database up to date (never resets it): applies pending
 * migrations, then the optional audit-log triggers so their test runs too.
 */
export default async function setup(): Promise<void> {
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });

  const url = new URL(TEST_DATABASE_URL);
  const connection = await createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    allowPublicKeyRetrieval: true,
  });
  try {
    const [{ count }] = await connection.query(
      "SELECT COUNT(*) AS count FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = 'audit_logs'",
    );
    if (Number(count) === 0) {
      const sql = readFileSync(new URL('../../database/audit-triggers.sql', import.meta.url), 'utf8');
      for (const statement of sql.split(/;\s*$/m).map((s) => s.replace(/^--.*$/gm, '').trim()).filter(Boolean)) {
        await connection.query(statement);
      }
    }
  } finally {
    await connection.end();
  }
}
