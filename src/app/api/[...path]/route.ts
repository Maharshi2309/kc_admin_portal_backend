import { NotFoundError } from '@/lib/errors';
import { route } from '@/lib/http';

/**
 * Any `/api/...` path without its own route gets a JSON 404 in the app's
 * error shape, instead of Next.js's HTML page. Real routes always win.
 */
const notFound = route(async () => {
  throw new NotFoundError('This API endpoint does not exist.');
});

export const GET = notFound;
export const POST = notFound;
export const PATCH = notFound;
export const PUT = notFound;
export const DELETE = notFound;
