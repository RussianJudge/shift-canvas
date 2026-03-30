export type ShiftKind = "DAY" | "NIGHT" | "OFF";

export type ScheduleCode = "601" | "602" | "603" | "604";

export interface ProductionUnit {
  id: string;
  name: string;
  description: string;
}

export interface Competency {
  id: string;
  unitId: string;
  code: string;
  label: string;
  colorToken: string;
}

export interface Employee {
  id: string;
  name: string;
  role: string;
  scheduleId: string;
  competencyIds: string[];
}

export interface Schedule {
  id: string;
  unitId: string;
  name: string;
  startDate: string;
  dayShiftDays: number;
  nightShiftDays: number;
  offDays: number;
  employees: Employee[];
}

export interface StoredAssignment {
  employeeId: string;
  date: string;
  competencyId: string | null;
  notes?: string | null;
  shiftKind: ShiftKind;
}

export interface SchedulerSnapshot {
  month: string;
  schedules: Schedule[];
  productionUnits: ProductionUnit[];
  competencies: Competency[];
  assignments: StoredAssignment[];
}

export interface SaveAssignmentsInput {
  updates: StoredAssignment[];
}

export interface PersonnelUpdate {
  employeeId: string;
  name: string;
  role: string;
  scheduleId: string;
  competencyIds: string[];
}

export interface SavePersonnelInput {
  updates: PersonnelUpdate[];
}

export interface ScheduleUpdate {
  scheduleId: string;
  name: string;
  unitId: string;
  startDate: string;
  dayShiftDays: number;
  nightShiftDays: number;
  offDays: number;
}

export interface SaveSchedulesInput {
  updates: ScheduleUpdate[];
}
