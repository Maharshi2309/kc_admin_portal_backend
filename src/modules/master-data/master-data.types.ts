/** `GET /departments`. `employeeCount` counts active employees. */
export type DepartmentDto = { id: string; code: string; name: string; employeeCount: number };

/** `GET /positions`. `employeeCount` counts active employees. */
export type PositionDto = { id: string; code: string; name: string; employeeCount: number };

/** `leave-types.response.json` */
export type LeaveTypeDto = { id: string; name: string; hasBalance: boolean; isPaid: boolean };
