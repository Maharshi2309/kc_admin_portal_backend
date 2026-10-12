import { NotFoundError } from '@/lib/errors';
import { ok, route } from '@/lib/http';
import { openApiSpec } from '@/lib/openapi/spec';

/**
 * Swagger UI and the OpenAPI spec (public; set API_DOCS=false to hide them).
 *
 *   /api/swagger        Swagger UI   (also at /api/docs)
 *   /api/swagger/spec   the spec     (also at /api/openapi.json)
 *   /api/swagger/init   the script that starts Swagger UI
 *
 * The main paths avoid "docs" folders and dotted names, which some hosting
 * build steps skip. Swagger UI itself loads from the jsDelivr CDN.
 */

const SWAGGER_UI = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.33.1';

const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Keshav Admin Portal API</title>
  <link rel="stylesheet" href="${SWAGGER_UI}/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${SWAGGER_UI}/swagger-ui-bundle.js" crossorigin="anonymous"></script>
  <script src="/api/swagger/init"></script>
</body>
</html>`;

const script = `window.ui = SwaggerUIBundle({
  url: '/api/swagger/spec',
  dom_id: '#swagger-ui',
  deepLinking: true,
  persistAuthorization: true,
  tryItOutEnabled: true,
});`;

const noStore = { 'Cache-Control': 'no-store' };

/** Says clearly that the docs are switched off, so it isn't mistaken for a missing upload. */
function ensureEnabled(): void {
  if (process.env.API_DOCS === 'false') {
    throw new NotFoundError('API documentation is turned off on this server (API_DOCS=false).');
  }
}

export const swaggerPage = route(async () => {
  ensureEnabled();
  return new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...noStore } });
});

export const swaggerInit = route(async () => {
  ensureEnabled();
  return new Response(script, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', ...noStore } });
});

export const spec = route(async () => {
  ensureEnabled();
  return ok(openApiSpec());
});
