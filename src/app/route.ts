import { version } from '../../package.json';

/**
 * `GET /`: the site root. The API itself lives under `/api`, but hosting
 * health checks (e.g. GoDaddy's) call the root and expect a 200. Says only
 * that the service is up and which version is running (to tell uploads
 * apart); `/api/health` also checks the database.
 */
export const dynamic = 'force-dynamic';

const body = { status: 'ok', service: 'Keshav Admin Portal API', version, health: '/api/health', docs: '/api/swagger' };
const headers = { 'Cache-Control': 'no-store' };

export function GET(): Response {
  return Response.json(body, { headers });
}

export function HEAD(): Response {
  return new Response(null, { headers });
}
