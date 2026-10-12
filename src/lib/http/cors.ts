/**
 * CORS and security headers for `/api/*` (API_CONTRACT.md §1, "CORS (web)").
 *
 * Only the Flutter web build needs CORS; the mobile apps don't send an
 * Origin. Allowed origins come from `CORS_ALLOWED_ORIGINS`. Auth uses a
 * bearer header, not cookies, so credentials are never allowed.
 */

export const CORS_ALLOWED_METHODS = 'GET, POST, PATCH, PUT, DELETE, OPTIONS';
export const CORS_ALLOWED_HEADERS = 'Authorization, Content-Type';
/** Headers the web app may read from responses. */
export const CORS_EXPOSED_HEADERS = 'X-Request-Id, Retry-After';
/** How long a browser may cache a preflight answer, in seconds. */
export const CORS_MAX_AGE_SECONDS = 600;

/** Origin-specific headers; empty when [origin] isn't allowed. */
export function corsHeaders(origin: string | null, allowedOrigins: readonly string[]): Headers {
  const headers = new Headers({ Vary: 'Origin' });
  if (origin !== null && allowedOrigins.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Expose-Headers', CORS_EXPOSED_HEADERS);
  }
  return headers;
}

/**
 * Answer to a preflight (`OPTIONS` with `Access-Control-Request-Method`).
 * A disallowed origin gets no CORS headers, so the browser blocks the call.
 */
export function preflightResponse(origin: string | null, allowedOrigins: readonly string[]): Response {
  const headers = corsHeaders(origin, allowedOrigins);
  if (headers.has('Access-Control-Allow-Origin')) {
    headers.set('Access-Control-Allow-Methods', CORS_ALLOWED_METHODS);
    headers.set('Access-Control-Allow-Headers', CORS_ALLOWED_HEADERS);
    headers.set('Access-Control-Max-Age', String(CORS_MAX_AGE_SECONDS));
  }
  return new Response(null, { status: 204, headers });
}

/** Headers added to every API response. The API serves JSON only, never pages. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
};

/** The Swagger UI page (/api/swagger, /api/docs) loads its script and styles from jsDelivr. */
export const DOCS_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "img-src 'self' data: https://cdn.jsdelivr.net",
  "connect-src 'self'",
  "frame-ancestors 'none'",
].join('; ');
