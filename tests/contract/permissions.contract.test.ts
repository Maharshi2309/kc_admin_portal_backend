import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PERMISSION_MODULES } from '@/lib/permissions/catalogue';
import { deniedMessage } from '@/lib/permissions';

/**
 * The fixtures are copies of the Flutter app's `docs/api-examples` (synced
 * from kc_admin_portal@29d11ce). If the app's catalogue changes, copy the
 * new file here; this test then shows exactly what to change in the backend.
 */
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

describe('permission catalogue contract', () => {
  it('matches the app catalogue exactly (modules, order, keys, labels)', () => {
    expect(JSON.parse(JSON.stringify(PERMISSION_MODULES))).toEqual(
      fixture('permissions.response.json'),
    );
  });

  it('matches the permissions the app expects a full-access user to have', () => {
    const allKeys = PERMISSION_MODULES.flatMap((m) => m.permissions.map((p) => p.key));
    expect(allKeys).toEqual((fixture('auth.me.response.json') as { permissions: string[] }).permissions);
  });

  it('words a 403 like the app example', () => {
    expect({ code: 'PERMISSION_DENIED', message: deniedMessage('employee.edit') }).toEqual(
      fixture('error.forbidden.response.json'),
    );
  });
});
