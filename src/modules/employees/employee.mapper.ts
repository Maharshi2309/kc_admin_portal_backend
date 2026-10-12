import { dateFromDb, formatInstant } from '@/lib/time';
import type { AuditField } from '@/modules/audit/audit.writer';
import type { WorkScheduleDto } from '@/modules/schedules/schedule.types';
import type { EmployeeRow } from './employee.repository';
import type { EmployeeDto } from './employee.types';

export function toEmployeeDto(row: EmployeeRow, schedule: WorkScheduleDto | null): EmployeeDto {
  return {
    id: String(row.id),
    ecNumber: row.ecNumber,
    name: row.name,
    mobile: row.mobile,
    department: row.departmentCode,
    position: row.positionCode,
    joiningDate: dateFromDb(row.joiningDate),
    status: row.status,
    schedule,
    updatedAt: formatInstant(row.updatedAt),
    updatedBy: row.updatedBy?.name ?? null,
  };
}

/** The employee as the change history shows it. */
export type EmployeeAuditView = {
  ecNumber: string;
  name: string;
  mobile: string;
  department: string;
  position: string;
  joiningDate: string;
  status: string;
};

export function toAuditView(dto: EmployeeDto): EmployeeAuditView {
  return {
    ecNumber: dto.ecNumber,
    name: dto.name,
    mobile: dto.mobile,
    department: dto.department,
    position: dto.position,
    joiningDate: dto.joiningDate,
    status: dto.status === 'active' ? 'Active' : 'Inactive',
  };
}

export const employeeAuditFields: readonly AuditField<EmployeeAuditView>[] = [
  { field: 'ecNumber', label: 'EC number' },
  { field: 'name', label: 'Name' },
  { field: 'mobile', label: 'Mobile number' },
  { field: 'department', label: 'Department' },
  { field: 'position', label: 'Position' },
  { field: 'joiningDate', label: 'Joining date' },
  { field: 'status', label: 'Status' },
];
