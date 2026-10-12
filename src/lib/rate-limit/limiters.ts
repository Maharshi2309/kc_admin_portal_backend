import { env } from '@/config/env';
import { type Limiter, createLimiter } from './index';

let login: Limiter | undefined;
let api: Limiter | undefined;

/** Failed sign-ins, keyed by email and address. */
export function loginLimiter(): Limiter {
  login ??= createLimiter({ max: env().LOGIN_MAX_ATTEMPTS, windowMs: env().LOGIN_WINDOW_MINUTES * 60_000 });
  return login;
}

/** Requests per signed-in user. */
export function apiLimiter(): Limiter {
  api ??= createLimiter({ max: env().API_REQUESTS_PER_MINUTE, windowMs: 60_000 });
  return api;
}
