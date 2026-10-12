import { type AppError, RateLimitError } from '@/lib/errors';

/**
 * JSON responses in the shape the Flutter app expects: the object or list
 * itself, with no `{ data: ... }` envelope (API_CONTRACT.md §1).
 * API responses are never cached.
 */

const baseHeaders = { 'Cache-Control': 'no-store' } as const;

export function ok(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: baseHeaders });
}

export function created(body: unknown): Response {
  return ok(body, 201);
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: baseHeaders });
}

/** `{ code?, message, errors? }`, with `Retry-After` for rate limits. */
export function errorResponse(error: AppError): Response {
  const body: Record<string, unknown> = { message: error.message };
  if (error.code) body.code = error.code;
  if (error.fieldErrors) body.errors = error.fieldErrors;

  const headers: Record<string, string> = { ...baseHeaders };
  if (error instanceof RateLimitError && error.retryAfterSeconds !== undefined) {
    headers['Retry-After'] = String(error.retryAfterSeconds);
  }

  return Response.json(body, { status: error.status, headers });
}
