import { describe, expect, it } from 'vitest';
import { databaseVariableNames, resolveDatabaseUrl } from '../../database-url.js';

describe('resolveDatabaseUrl', () => {
  it('uses DATABASE_URL when set', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: ' mysql://a:b@h:3306/d ', DB_HOST: 'x' })).toBe('mysql://a:b@h:3306/d');
  });

  it('builds the URL from separate settings, encoding special characters', () => {
    expect(
      resolveDatabaseUrl({ DB_HOST: 'db.host', DB_NAME: 'kc', DB_USER: 'u@x', DB_PASSWORD: 'p@ss:w/rd#' }),
    ).toBe('mysql://u%40x:p%40ss%3Aw%2Frd%23@db.host:3306/kc');
    expect(
      resolveDatabaseUrl({ MYSQL_HOST: 'h', MYSQL_PORT: '3307', MYSQL_DATABASE: 'd', MYSQL_USER: 'u', MYSQL_PASSWORD: 'p' }),
    ).toBe('mysql://u:p@h:3307/d');
    expect(
      resolveDatabaseUrl({ DATABASE_HOST: 'h', DATABASE_NAME: 'd', DATABASE_USERNAME: 'u', DATABASE_PASSWORD: 'p', DATABASE_SSL: 'true' }),
    ).toBe('mysql://u:p@h:3306/d?ssl=true');
  });

  it('returns null without enough settings, and lists only the names it saw', () => {
    const env = { DB_HOST: 'h', DB_PASSWORD: 'secret', PATH: '/bin' };
    expect(resolveDatabaseUrl(env)).toBeNull();
    expect(databaseVariableNames(env)).toEqual(['DB_HOST', 'DB_PASSWORD']);
  });
});
