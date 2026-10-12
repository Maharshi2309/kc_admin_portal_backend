import { formatInstantOrNull } from '@/lib/time';
import type { DayEmployee, LoadedDay } from '@/modules/day-engine/day-context';
import type { AttendanceRecordDto, EmployeeSummaryDto } from './attendance.types';

export function toEmployeeSummary(employee: DayEmployee): EmployeeSummaryDto {
  return {
    id: String(employee.id),
    name: employee.name,
    ecNumber: employee.ecNumber,
    department: employee.departmentCode,
    position: employee.positionCode,
  };
}

export function toRecordDto(day: LoadedDay): AttendanceRecordDto {
  const { record, result, schedule } = day;
  return {
    id: record ? String(record.id) : null,
    employee: toEmployeeSummary(day.employee),
    date: day.date,
    punchIn: formatInstantOrNull(record?.punchIn),
    punchOut: formatInstantOrNull(record?.punchOut),
    workedMinutes: result.workedMinutes,
    workedPercent: result.workedPercent,
    status: result.status,
    note: result.note,
    lateMinutes: result.lateMinutes,
    correctedBy: record?.correctedBy?.name ?? null,
    correctedAt: formatInstantOrNull(record?.correctedAt),
    dayKind: result.dayKind,
    schedule:
      result.dayType === 'working' && schedule
        ? { startTime: schedule.startTime, endTime: schedule.endTime, expectedMinutes: schedule.expectedMinutes }
        : null,
    expectedMinutes: result.expectedMinutes,
    overtimeMinutes: result.overtimeMinutes,
  };
}
