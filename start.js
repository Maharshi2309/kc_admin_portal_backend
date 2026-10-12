// Production start (`npm start`, package.json "main"):
// 1. works out the database connection from the environment,
// 2. brings the database tables up to date (`prisma migrate deploy`; it only
//    adds, never deletes data; set MIGRATE_ON_START=false to skip),
// 3. starts the API (server.js).
// If the database settings are missing it stops with a message saying what
// to set, instead of restarting in a loop with a cryptic error.
const { execFileSync } = require('node:child_process');
const { resolveDatabaseUrl, databaseVariableNames } = require('./database-url');

const url = resolveDatabaseUrl(process.env);
if (!url) {
  const seen = databaseVariableNames(process.env);
  console.error(
    [
      'Cannot start: the database settings are missing.',
      'Set DATABASE_URL=mysql://USER:PASSWORD@HOST:PORT/DATABASE in the app settings',
      '(or DB_HOST, DB_PORT, DB_NAME, DB_USER and DB_PASSWORD), then restart.',
      seen.length > 0
        ? `Database-related settings found (names only): ${seen.join(', ')}`
        : 'No database-related settings were found at all.',
    ].join('\n'),
  );
  process.exit(1);
}
process.env.DATABASE_URL = url;

if (process.env.MIGRATE_ON_START !== 'false') {
  console.log('Updating the database tables (prisma migrate deploy)...');
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: process.env,
  });
}

require('./server.js');
