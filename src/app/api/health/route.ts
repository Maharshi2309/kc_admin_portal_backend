import { env } from '@/config/env';
import { isDatabaseReachable } from '@/lib/db';

/**
 * `GET /api/health`: liveness check for hosting and deployment tools.
 * Unauthenticated, so it says only whether the server and its database work.
 */
export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };

export async function GET(): Promise<Response> {
  // Reading the configuration makes a misconfigured server fail here too.
  env();
  if (!(await isDatabaseReachable())) {
    return Response.json({ status: 'unavailable' }, { status: 503, headers: noStore });
  }
  return Response.json({ status: 'ok' }, { headers: noStore });
}
