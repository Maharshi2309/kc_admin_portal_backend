import { describe, expect, it } from 'vitest';
import { corsHeaders, preflightResponse } from '@/lib/http/cors';

const allowed = ['http://localhost:8080', 'https://admin.example.com'];

describe('CORS', () => {
  it('echoes an allowed origin and always varies on Origin', () => {
    const headers = corsHeaders('https://admin.example.com', allowed);
    expect(headers.get('access-control-allow-origin')).toBe('https://admin.example.com');
    expect(headers.get('access-control-expose-headers')).toContain('X-Request-Id');
    expect(headers.get('vary')).toBe('Origin');
  });

  it('adds nothing for other origins or requests without an Origin', () => {
    expect(corsHeaders('https://evil.example', allowed).has('access-control-allow-origin')).toBe(
      false,
    );
    expect(corsHeaders(null, allowed).has('access-control-allow-origin')).toBe(false);
  });

  it('answers an allowed preflight with the methods and headers the app uses', () => {
    const response = preflightResponse('http://localhost:8080', allowed);
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-methods')).toBe(
      'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    );
    expect(response.headers.get('access-control-allow-headers')).toBe(
      'Authorization, Content-Type',
    );
    expect(response.headers.has('access-control-allow-credentials')).toBe(false);
  });

  it('gives a disallowed preflight no CORS headers', () => {
    const response = preflightResponse('https://evil.example', allowed);
    expect(response.status).toBe(204);
    expect(response.headers.has('access-control-allow-origin')).toBe(false);
    expect(response.headers.has('access-control-allow-methods')).toBe(false);
  });
});
