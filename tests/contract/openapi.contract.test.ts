import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describedRoutes, openApiSpec } from '@/lib/openapi/spec';

/** Keeps the Swagger spec in step with the real routes. */

const apiDir = join(process.cwd(), 'src', 'app', 'api');
/** Routes that serve the docs themselves, or catch unknown paths. */
const undocumented = new Set(['/swagger', '/swagger/spec', '/swagger/init', '/docs', '/openapi.json', '/[...path]']);

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === 'route.ts' ? [full] : [];
  });
}

function actualRoutes(): string[] {
  return routeFiles(apiDir).flatMap((file) => {
    const path = `/${relative(apiDir, file).split(sep).slice(0, -1).join('/')}`.replace(/\[(\w+)\]/g, '{$1}');
    if (undocumented.has(path.replace(/\{(\.\.\.\w+)\}/, '[$1]'))) return [];
    const source = readFileSync(file, 'utf8');
    const methods = [...source.matchAll(/\bas (GET|POST|PATCH|PUT|DELETE)\b|export const (GET|POST|PATCH|PUT|DELETE)\b|export (?:async )?function (GET|POST|PATCH|PUT|DELETE)\b/g)].map(
      (m) => m[1] ?? m[2] ?? m[3],
    );
    return methods.map((method) => `${method} ${path === '/' ? '/' : path}`);
  });
}

function refsIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refsIn);
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, inner]) => (key === '$ref' ? [inner as string] : refsIn(inner)));
  }
  return [];
}

describe('OpenAPI spec', () => {
  it('describes exactly the routes that exist', () => {
    expect(describedRoutes().sort()).toEqual(actualRoutes().sort());
  });

  it('only references schemas it defines', () => {
    const spec = openApiSpec() as { components: { schemas: Record<string, unknown> } };
    const names = new Set(Object.keys(spec.components.schemas));
    const missing = refsIn(spec)
      .map((ref) => ref.replace('#/components/schemas/', ''))
      .filter((name) => !names.has(name));
    expect(missing).toEqual([]);
  });

  it('matches the exported docs/openapi.json (run `npm run openapi:export` after changes)', () => {
    const exported = JSON.parse(readFileSync(join(process.cwd(), 'docs', 'openapi.json'), 'utf8'));
    expect(exported).toEqual(JSON.parse(JSON.stringify(openApiSpec())));
  });

  it('is OpenAPI 3.1 with bearer auth and generated request schemas', () => {
    const spec = openApiSpec() as Record<string, any>;
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.components.securitySchemes.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(spec.paths['/auth/login'].post.security).toEqual([]);
    const createEmployee = spec.paths['/employees'].post.requestBody.content['application/json'].schema;
    expect(createEmployee.required).toEqual(expect.arrayContaining(['ecNumber', 'department', 'position']));
    expect(createEmployee.properties).not.toHaveProperty('email');
    expect(createEmployee.properties.ecNumber.pattern).toBe('^KC\\d+$');
    expect(spec.paths['/employees'].get.parameters.map((p: { name: string }) => p.name)).toEqual(
      expect.arrayContaining(['search', 'status', 'page', 'pageSize']),
    );
    expect(spec.paths['/employees/{id}'].patch['x-permissions']).toEqual(['employee.edit']);
  });
});
