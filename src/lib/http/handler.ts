import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { AppError, fromPrismaError, fromZodError } from '@/lib/errors';
import { type Logger, logger } from '@/lib/logger';
import { errorResponse } from './response';

/**
 * Wraps every route handler: gives the request an id, turns any thrown
 * error into the app's error body, and logs it. Route files stay one line:
 *
 *   export const GET = route(async ({ request, params, log }) => ok(...));
 *
 * Errors are logged with their details internally; the client only ever
 * gets the safe `message`. Unexpected errors become a generic 500.
 */

export type RouteContext<P extends Record<string, string> = Record<string, string>> = {
  request: Request;
  params: P;
  requestId: string;
  log: Logger;
};

type NextContext = { params: Promise<Record<string, string | string[]>> };

const internalError = new AppError(500, 'Something went wrong. Please try again.', 'INTERNAL_ERROR');

export function route<P extends Record<string, string> = Record<string, string>>(
  handler: (context: RouteContext<P>) => Promise<Response>,
): (request: Request, context: NextContext) => Promise<Response> {
  return async (request, context) => {
    const requestId = request.headers.get('x-request-id') ?? randomUUID();
    const url = new URL(request.url);
    const log = logger().child({ requestId, method: request.method, path: url.pathname });
    const started = performance.now();

    let response: Response;
    try {
      const params = ((await context?.params) ?? {}) as P;
      response = await handler({ request, params, requestId, log });
    } catch (error) {
      response = errorResponse(toAppError(error, log));
    }

    log.info('request', {
      status: response.status,
      durationMs: Math.round(performance.now() - started),
    });
    response.headers.set('X-Request-Id', requestId);
    return response;
  };
}

/** Maps anything thrown to a safe AppError, logging what the client won't see. */
export function toAppError(error: unknown, log: Logger): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) return fromZodError(error);

  const fromDb = fromPrismaError(error);
  if (fromDb) {
    log.warn('Database error mapped to client error', { error, status: fromDb.status });
    return fromDb;
  }

  log.error('Unhandled error', { error });
  return internalError;
}
