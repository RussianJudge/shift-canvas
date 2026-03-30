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
  teamId: string;
  scheduleCode: ScheduleCode;
  rotationAnchor: number;
  competencyIds: string[];
}

export interface Team {
  id: string;
  unitId: string;
  name: string;
  description: string;
  accentColor: string;
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
  teams: Team[];
  productionUnits: ProductionUnit[];
  competencies: Competency[];
  assignments: StoredAssignment[];
}

export interface SaveAssignmentsInput {
  updates: StoredAssignment[];
}
