import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LeaveTypeDto } from '@/modules/master-data/master-data.types';

/**
 * The response types must carry exactly the keys of the app's examples
 * (kc_admin_portal@678a5ee docs/api-examples). Values come from the database.
 * The app has no department or position endpoints any more (2026-10-05).
 */
const fixture = <T>(name: string): T[] =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as T[];
const keysOf = (rows: object[]) => [...new Set(rows.flatMap((row) => Object.keys(row)))].sort();

describe('master data contract', () => {
  it('leave types: id, name, hasBalance and isPaid', () => {
    const sample: LeaveTypeDto = { id: 'casual', name: 'Casual', hasBalance: true, isPaid: true };
    expect(keysOf([sample])).toEqual(keysOf(fixture('leave-types.response.json')));
  });

  it('only Casual and Unpaid leave types', () => {
    expect(fixture<LeaveTypeDto>('leave-types.response.json').map((t) => t.id)).toEqual(['casual', 'unpaid']);
  });
});
