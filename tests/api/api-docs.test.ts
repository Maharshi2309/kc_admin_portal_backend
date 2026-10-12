import { afterEach, describe, expect, it } from 'vitest';
import { GET as pageRoute } from '@/app/api/swagger/route';
import { GET as specRoute } from '@/app/api/swagger/spec/route';
import { GET as initRoute } from '@/app/api/swagger/init/route';
import { GET as docsAlias } from '@/app/api/docs/route';

const ctx = { params: Promise.resolve({}) };
const req = (path: string) => new Request(`http://localhost${path}`);

describe('Swagger routes', () => {
  afterEach(() => {
    delete process.env.API_DOCS;
  });

  it('serves the page, its script and the spec', async () => {
    const page = await pageRoute(req('/api/swagger'), ctx);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('/api/swagger/init');
    expect(await (await initRoute(req('/api/swagger/init'), ctx)).text()).toContain("url: '/api/swagger/spec'");
    const spec = (await (await specRoute(req('/api/swagger/spec'), ctx)).json()) as { openapi: string };
    expect(spec.openapi).toBe('3.1.0');
    expect((await docsAlias(req('/api/docs'), ctx)).status).toBe(200);
  });

  it('says clearly when the docs are turned off', async () => {
    process.env.API_DOCS = 'false';
    const response = await pageRoute(req('/api/swagger'), ctx);
    expect(response.status).toBe(404);
    expect(((await response.json()) as { message: string }).message).toBe(
      'API documentation is turned off on this server (API_DOCS=false).',
    );
  });
});
