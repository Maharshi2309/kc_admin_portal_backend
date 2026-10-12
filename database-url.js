// Works out the MySQL connection string from the environment.
//
// Preferred: DATABASE_URL=mysql://USER:PASSWORD@HOST:PORT/DATABASE
// Also accepted, so the database details a host provides can be used as they
// are: a set of separate variables with one of these prefixes —
//   DB_      (DB_HOST, DB_PORT, DB_NAME or DB_DATABASE, DB_USER or DB_USERNAME, DB_PASSWORD)
//   MYSQL_   (MYSQL_HOST, MYSQL_PORT, MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD)
//   DATABASE_ (DATABASE_HOST, DATABASE_PORT, DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD)
// Plain CommonJS so the start script can use it before anything is built.

const PREFIXES = ['DB_', 'MYSQL_', 'DATABASE_'];

function pick(env, prefix, names) {
  for (const name of names) {
    const value = env[prefix + name];
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

/** The connection string, or null when the environment doesn't describe a database. */
function resolveDatabaseUrl(env) {
  if (env.DATABASE_URL && env.DATABASE_URL.trim() !== '') return env.DATABASE_URL.trim();
  for (const prefix of PREFIXES) {
    const host = pick(env, prefix, ['HOST', 'HOSTNAME']);
    const database = pick(env, prefix, ['NAME', 'DATABASE', 'DB']);
    const user = pick(env, prefix, ['USER', 'USERNAME']);
    if (!host || !database || !user) continue;
    const password = pick(env, prefix, ['PASSWORD', 'PASS']) ?? '';
    const port = pick(env, prefix, ['PORT']) ?? '3306';
    const ssl = pick(env, prefix, ['SSL']);
    const auth = `${encodeURIComponent(user)}:${encodeURIComponent(password)}`;
    return `mysql://${auth}@${host}:${port}/${encodeURIComponent(database)}${ssl === 'true' ? '?ssl=true' : ''}`;
  }
  return null;
}

/** Names (never values) of variables that look database-related, for error messages. */
function databaseVariableNames(env) {
  return Object.keys(env)
    .filter((name) => /(DB|DATABASE|MYSQL|SQL)/i.test(name))
    .sort();
}

module.exports = { resolveDatabaseUrl, databaseVariableNames };
