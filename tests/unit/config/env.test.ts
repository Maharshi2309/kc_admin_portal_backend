import { describe, expect, it } from 'vitest';
import { parseEnv } from '@/config/env';

const required = {
  DATABASE_URL: 'mysql://kc:secret@localhost:3306/kc_admin_portal',
  JWT_SECRET: 'x'.repeat(32),
};

describe('parseEnv', () => {
  it('applies defaults when optional keys are missing', () => {
    const env = parseEnv(required);
    expect(env.NODE_ENV).toBe('development');
    expect(env.COMPANY_TIMEZONE).toBe('Asia/Kolkata');
    expect(env.CORS_ALLOWED_ORIGINS).toEqual([]);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.AUTH_SESSION_HOURS).toBe(12);
  });

  it('requires a JWT secret of at least 32 characters', () => {
    expect(() => parseEnv({ ...required, JWT_SECRET: undefined })).toThrow(/JWT_SECRET: is required/);
    expect(() => parseEnv({ ...required, JWT_SECRET: 'short' })).toThrow(
      /JWT_SECRET: must be at least 32 characters/,
    );
  });

  it('reads the session length in hours', () => {
    expect(parseEnv({ ...required, AUTH_SESSION_HOURS: '168' }).AUTH_SESSION_HOURS).toBe(168);
    expect(() => parseEnv({ ...required, AUTH_SESSION_HOURS: '0' })).toThrow(/AUTH_SESSION_HOURS/);
  });

  it("builds DATABASE_URL from GoDaddy's DB_* settings", () => {
    const env = parseEnv({
      JWT_SECRET: required.JWT_SECRET,
      DB_HOST: 'mysql.internal',
      DB_PORT: '3306',
      DB_NAME: 'kc_admin',
      DB_USER: 'kc',
      DB_PASSWORD: 'p@ss/word',
    });
    expect(env.DATABASE_URL).toBe('mysql://kc:p%40ss%2Fword@mysql.internal:3306/kc_admin');
  });

  it('requires DATABASE_URL', () => {
    expect(() => parseEnv({ JWT_SECRET: required.JWT_SECRET })).toThrow(/DATABASE_URL: is required/);
  });

  it('rejects a DATABASE_URL that is not MySQL, without echoing it', () => {
    expect(() => parseEnv({ DATABASE_URL: 'postgresql://root:hunter2@db/app' })).toThrow(
      /DATABASE_URL: must be a mysql:\/\/ connection string/,
    );
    expect(() => parseEnv({ DATABASE_URL: 'postgresql://root:hunter2@db/app' })).not.toThrow(
      /hunter2/,
    );
  });

  it('splits and trims the CORS origin list', () => {
    const env = parseEnv({
      ...required,
      CORS_ALLOWED_ORIGINS: ' http://localhost:8080 , https://admin.example.com ,',
    });
    expect(env.CORS_ALLOWED_ORIGINS).toEqual([
      'http://localhost:8080',
      'https://admin.example.com',
    ]);
  });

  it('rejects an unknown time zone', () => {
    expect(() => parseEnv({ ...required, COMPANY_TIMEZONE: 'Mars/Olympus' })).toThrow(
      /COMPANY_TIMEZONE/,
    );
  });

  it('rejects an origin that is not a URL', () => {
    expect(() => parseEnv({ ...required, CORS_ALLOWED_ORIGINS: 'not a url' })).toThrow(
      /CORS_ALLOWED_ORIGINS/,
    );
  });

  it('lists every invalid key in one error without echoing values', () => {
    let message = '';
    try {
      parseEnv({ ...required, LOG_LEVEL: 'loud', NODE_ENV: 'staging-secret-value' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/LOG_LEVEL/);
    expect(message).toMatch(/NODE_ENV/);
    expect(message).not.toMatch(/staging-secret-value/);
  });
});
