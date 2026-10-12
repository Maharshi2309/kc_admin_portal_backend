import { describe, expect, it } from 'vitest';
import { diffForAudit } from '@/modules/audit/audit.writer';

type Record_ = { name: string; mobile: string; joiningDate: string; departmentName: string | null };

const fields = [
  { field: 'name', label: 'Name' },
  { field: 'mobile', label: 'Mobile number' },
  { field: 'departmentName', label: 'Department' },
] as const;

describe('diffForAudit', () => {
  it('lists only the fields that changed', () => {
    const before: Record_ = { name: 'Asha', mobile: '9825011234', joiningDate: '2021-01-12', departmentName: 'IT' };
    const after: Record_ = { ...before, mobile: '9876543210', departmentName: 'Sales' };
    expect(diffForAudit(before, after, fields)).toEqual([
      { field: 'mobile', label: 'Mobile number', before: '9825011234', after: '9876543210' },
      { field: 'departmentName', label: 'Department', before: 'IT', after: 'Sales' },
    ]);
  });

  it('lists every set field for a new record', () => {
    const after: Record_ = { name: 'Asha', mobile: '9825011234', joiningDate: '2021-01-12', departmentName: null };
    expect(diffForAudit(null, after, fields)).toEqual([
      { field: 'name', label: 'Name', before: null, after: 'Asha' },
      { field: 'mobile', label: 'Mobile number', before: null, after: '9825011234' },
    ]);
  });

  it('formats values for display', () => {
    const changes = diffForAudit(
      { punchIn: new Date('2026-10-03T04:35:00Z') },
      { punchIn: new Date('2026-10-03T04:10:00Z') },
      [{ field: 'punchIn', label: 'Punch in', format: (d) => (d as Date).toISOString().slice(11, 16) }],
    );
    expect(changes).toEqual([{ field: 'punchIn', label: 'Punch in', before: '04:35', after: '04:10' }]);
  });
});
