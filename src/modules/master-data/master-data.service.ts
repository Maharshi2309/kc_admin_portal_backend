import * as repo from './master-data.repository';
import type { DepartmentDto, LeaveTypeDto, PositionDto } from './master-data.types';
import type { ListEntryBody } from './master-data.validation';

/**
 * Department and position lists (API_CONTRACT.md "Department and position",
 * 2026-10-05) and leave types. Employees carry department and position as
 * codes. The lists start with accountant, graphic_designer and tailor and can
 * grow (client answer 2026-10-06); entries are never edited or removed here,
 * because employees refer to them by code.
 */

type Row = { id: number; code: string; name: string; _count: { employees: number } };

function toDto(row: Row): DepartmentDto & PositionDto {
  return { id: String(row.id), code: row.code, name: row.name, employeeCount: row._count.employees };
}

export async function departments(): Promise<DepartmentDto[]> {
  return (await repo.listDepartments()).map(toDto);
}

export async function positions(): Promise<PositionDto[]> {
  return (await repo.listPositions()).map(toDto);
}

/** `POST /departments`. A duplicate code or name is a 409 (see prisma-errors). */
export async function addDepartment(body: ListEntryBody): Promise<DepartmentDto> {
  const row = await repo.createDepartment(body);
  return { id: String(row.id), code: row.code, name: row.name, employeeCount: 0 };
}

/** `POST /positions`. */
export async function addPosition(body: ListEntryBody): Promise<PositionDto> {
  const row = await repo.createPosition(body);
  return { id: String(row.id), code: row.code, name: row.name, employeeCount: 0 };
}

export async function leaveTypes(): Promise<LeaveTypeDto[]> {
  return repo.listLeaveTypes();
}
