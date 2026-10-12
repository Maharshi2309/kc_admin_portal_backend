/**
 * Runs once when the server starts. Validating the configuration here makes
 * a bad deployment fail immediately with a clear message, instead of on the
 * first request. It also loads the permission catalogue and the bootstrap
 * admin (src/lib/bootstrap.ts), so hosting without a terminal (GoDaddy) needs
 * no separate seed step. Set BOOTSTRAP_ON_START=false to skip that.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { env } = await import('@/config/env');
  const { logger } = await import('@/lib/logger');
  const { installValidationMessages } = await import('@/lib/validation');
  installValidationMessages();
  const config = env();
  logger().info('Server starting', {
    nodeEnv: config.NODE_ENV,
    companyTimezone: config.COMPANY_TIMEZONE,
    corsOrigins: config.CORS_ALLOWED_ORIGINS.length,
  });

  if (process.env.BOOTSTRAP_ON_START !== 'false') {
    const { db } = await import('@/lib/db');
    const { bootstrap } = await import('@/lib/bootstrap');
    try {
      await bootstrap(db(), process.env, (message) => logger().info(message));
    } catch (error) {
      // The API still starts; /api/health shows whether the database works.
      logger().error('Start-up data (permissions, bootstrap admin) failed', { error });
    }
  }
}
