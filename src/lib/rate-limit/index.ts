/**
 * Fixed-window rate limiting (architecture §26).
 *
 * The counters live in this process's memory, which is right for a single
 * server. If the API is later run as several instances (hosting not chosen
 * yet), swap the store for a shared one (database or Redis) behind the same
 * `RateLimitStore` interface; nothing else changes.
 */

export type RateLimitStore = {
  /** Adds one hit to [key]'s current window and returns the count and when the window ends. */
  hit(key: string, windowMs: number, now: number): { count: number; resetAt: number };
  peek(key: string, now: number): { count: number; resetAt: number } | null;
  reset(key: string): void;
};

export function memoryStore(maxKeys = 50_000): RateLimitStore {
  const windows = new Map<string, { count: number; resetAt: number }>();
  const sweep = (now: number) => {
    if (windows.size < maxKeys) return;
    for (const [key, w] of windows) if (w.resetAt <= now) windows.delete(key);
  };
  return {
    hit(key, windowMs, now) {
      sweep(now);
      const current = windows.get(key);
      const window = current && current.resetAt > now ? current : { count: 0, resetAt: now + windowMs };
      window.count += 1;
      windows.set(key, window);
      return { ...window };
    },
    peek(key, now) {
      const window = windows.get(key);
      return window && window.resetAt > now ? { ...window } : null;
    },
    reset(key) {
      windows.delete(key);
    },
  };
}

export type Limiter = {
  /** Seconds to wait if [key] is over the limit right now, else null. */
  blockedFor(key: string, now?: number): number | null;
  /** Counts one event for [key]; returns seconds to wait if that went over the limit. */
  record(key: string, now?: number): number | null;
  clear(key: string): void;
};

export function createLimiter(options: { max: number; windowMs: number; store?: RateLimitStore }): Limiter {
  const store = options.store ?? memoryStore();
  const wait = (resetAt: number, now: number) => Math.max(1, Math.ceil((resetAt - now) / 1000));
  return {
    blockedFor(key, now = Date.now()) {
      const window = store.peek(key, now);
      return window && window.count >= options.max ? wait(window.resetAt, now) : null;
    },
    record(key, now = Date.now()) {
      const window = store.hit(key, options.windowMs, now);
      return window.count > options.max ? wait(window.resetAt, now) : null;
    },
    clear(key) {
      store.reset(key);
    },
  };
}

/** The client's address as seen by the API (first X-Forwarded-For hop when behind a proxy). */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || 'unknown';
}
