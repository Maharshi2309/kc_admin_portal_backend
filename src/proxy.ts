import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/config/env';
import { DOCS_CONTENT_SECURITY_POLICY, SECURITY_HEADERS, corsHeaders, preflightResponse } from '@/lib/http/cors';

/**
 * Runs before every `/api/*` request (Next.js 16 "proxy", formerly
 * middleware): answers CORS preflights and adds CORS and security headers.
 * Authentication is NOT done here; each route checks it itself.
 */
export function proxy(request: NextRequest): Response {
  const origin = request.headers.get('origin');
  const allowed = env().CORS_ALLOWED_ORIGINS;

  const isPreflight =
    request.method === 'OPTIONS' && request.headers.has('access-control-request-method');
  const response = isPreflight ? preflightResponse(origin, allowed) : NextResponse.next();

  corsHeaders(origin, allowed).forEach((value, key) => response.headers.set(key, value));
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(key, value);
  if (request.nextUrl.pathname === '/api/swagger' || request.nextUrl.pathname === '/api/docs') {
    response.headers.set('Content-Security-Policy', DOCS_CONTENT_SECURITY_POLICY);
  }
  return response;
}

export const config = {
  matcher: '/api/:path*',
};
