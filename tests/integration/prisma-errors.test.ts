import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fromPrismaError } from '@/lib/errors';
import { testDb } from './setup';

/** Real database errors, so a Prisma or driver upgrade can't silently break the mapping. */
const db = testDb();
const stamp = Date.now();
const name = `__test_${stamp}`;
const code = `test_${stamp}`;

beforeAll(async () => {
  await db.department.create({ data: { code, name } });
});

afterAll(async () => {
  await db.department.deleteMany({ where: { code } });
  await db.user.deleteMany({ where: { email: `fk.${stamp}@test.keshav.in` } });
  await db.$disconnect();
});

async function errorOf(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error('expected the database to reject this');
}

describe('fromPrismaError (real database)', () => {
  it('maps a known unique constraint to 409 on its field', async () => {
    const error = await errorOf(() => db.department.create({ data: { code: `${code}_other`, name } }));
    const mapped = fromPrismaError(error);
    expect(mapped?.status).toBe(409);
    expect(mapped?.code).toBe('DUPLICATE');
    expect(mapped?.fieldErrors).toEqual({
      name: ['A department with this name already exists.'],
    });
    expect(mapped?.message).not.toMatch(/constraint|duplicate key/i);
  });

  it('maps a broken foreign key to 422 on its field', async () => {
    const error = await errorOf(() =>
      db.user.create({ data: { name: 'x', email: `fk.${stamp}@test.keshav.in`, employeeId: 2_000_000_000 } }),
    );
    const mapped = fromPrismaError(error);
    expect(mapped?.status).toBe(422);
    expect(mapped?.fieldErrors).toEqual({ employeeId: ['Choose an employee'] });
  });

  it('maps a missing record to 404', async () => {
    const error = await errorOf(() =>
      db.department.update({ where: { id: 2_000_000_000 }, data: { name: 'x' } }),
    );
    expect(fromPrismaError(error)?.status).toBe(404);
  });

  it('ignores errors that are not database errors', () => {
    expect(fromPrismaError(new Error('boom'))).toBeUndefined();
  });
});
