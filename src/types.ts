import { type DateRange } from "react-day-picker";

export type ShiftType = 'DAY' | 'NIGHT';

export type EmployeeRole = 'STAFF' | 'MANAGER';

export interface Employee {
  id: string;
  name: string;
  role: EmployeeRole;
  leaveDates: string[]; // ISO strings
}

export interface Shift {
  date: string; // ISO string (YYYY-MM-DD)
  type: ShiftType;
  employeeId: string | null;
  isLocked: boolean;
  isContinuous?: boolean; // Part of a 6-day continuous night shift
}

export interface ScheduleState {
  shifts: Shift[];
  employees: Employee[];
}

export interface ConstraintViolation {
  date: string;
  type: ShiftType;
  employeeId: string;
  message: string;
}
