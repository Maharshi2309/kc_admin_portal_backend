import { defineConfig } from 'prisma/config';
import { resolveDatabaseUrl } from './database-url';

// The Prisma CLI doesn't read .env by itself. Node 22 can, so no extra
// dependency is needed. A missing file is fine: hosts set real env vars.
try {
  process.loadEnvFile('.env');
} catch {
  // no .env file
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // DATABASE_URL, or GoDaddy's DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD.
    url: resolveDatabaseUrl(process.env) ?? undefined,
  },
});
