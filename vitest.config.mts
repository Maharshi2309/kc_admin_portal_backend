import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Brings the test database's schema up to date before any test runs.
    globalSetup: ['tests/integration/global-setup.ts'],
    // Integration test files share one database; run files one at a time.
    fileParallelism: false,
    // Tests never use the development database or a developer's .env.
    env: {
      DATABASE_URL: 'mysql://kc:kc_dev_password@127.0.0.1:3306/kc_admin_portal_test',
      COMPANY_TIMEZONE: 'Asia/Kolkata',
      LOG_LEVEL: 'error',
      JWT_SECRET: 'test-only-secret-not-used-anywhere-else-0123456789',
      AUTH_SESSION_HOURS: '12',
      // Tests use past years so their holidays don't collide; leave earns
      // from each test employee's joining month.
      LEAVE_ACCRUAL_START_MONTH: '2000-01',
    },
  },
});
