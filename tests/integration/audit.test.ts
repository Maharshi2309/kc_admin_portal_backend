import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeAudit } from '@/modules/audit/audit.writer';
import { testDb } from './setup';

/**
 * The audit writer against the real table. Audit rows can't be deleted (by
 * design), so this test's actor and rows stay in the test database.
 */
const db = testDb();
const tag = `audit-${Date.now()}`;
let actorUserId = 0;

beforeAll(async () => {
  const actor = await db.user.create({ data: { name: 'Audit actor', email: `${tag}@test.keshav.in` } });
  actorUserId = actor.id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe('audit log', () => {
  it('saves the entry together with the change in one transaction', async () => {
    await db.$transaction(async (tx) => {
      await tx.department.create({ data: { code: `audit_${tag.slice(6)}`, name: `${tag}-dept` } });
      await writeAudit(tx, {
        actorUserId,
        action: 'attendance.correct',
        entityType: 'attendance',
        entityId: tag,
        affectedDate: '2026-10-03',
        summary: 'Corrected punch in',
        changes: [{ field: 'punchIn', label: 'Punch in', before: '10:05', after: '09:40' }],
        reason: 'device_issue',
        remarks: 'Biometric device at gate was offline till 10:00.',
      });
    });

    const row = await db.auditLog.findFirstOrThrow({ where: { entityId: tag } });
    expect(row).toMatchObject({
      actorUserId,
      action: 'attendance.correct',
      entityType: 'attendance',
      summary: 'Corrected punch in',
      reason: 'device_issue',
      changes: [{ field: 'punchIn', label: 'Punch in', before: '10:05', after: '09:40' }],
    });
    expect(row.affectedDate?.toISOString().slice(0, 10)).toBe('2026-10-03');
    await db.department.deleteMany({ where: { name: `${tag}-dept` } });
  });

  it('writes nothing when the change fails', async () => {
    const entityId = `${tag}-rolled-back`;
    await expect(
      db.$transaction(async (tx) => {
        await writeAudit(tx, {
          actorUserId,
          action: 'holiday.create',
          entityType: 'holiday',
          entityId,
          summary: 'Added holiday',
        });
        throw new Error('the change itself failed');
      }),
    ).rejects.toThrow('the change itself failed');
    expect(await db.auditLog.count({ where: { entityId } })).toBe(0);
  });

  it('refuses to edit or delete history', async () => {
    const row = await db.auditLog.findFirstOrThrow({ where: { entityId: tag } });
    await expect(
      db.auditLog.update({ where: { id: row.id }, data: { summary: 'rewritten' } }),
    ).rejects.toThrow(/append-only/);
    await expect(db.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });
});
