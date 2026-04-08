export type ShiftKind = "DAY" | "NIGHT" | "OFF";
export type AppRole = "admin" | "leader" | "worker";
export type MutualStatus = "open" | "accepted" | "withdrawn" | "cancelled" | "rejected";

export type ScheduleCode = "601" | "602" | "603" | "604";

export const REQUIRED_SHIFT_CODES: ScheduleCode[] = ["601", "602", "603", "604"];

export interface OrganizationScope {
  companyId?: string;
  siteId?: string;
  businessAreaId?: string;
}

export interface OrganizationContext extends OrganizationScope {
  companyName: string;
  siteName: string;
  businessAreaName: string;
}

export interface ProductionUnit extends OrganizationScope {
  id: string;
  name: string;
  description: string;
}

export interface Competency extends OrganizationScope {
  id: string;
  code: string;
  label: string;
  colorToken: string;
  requiredStaff: number;
}

export interface TimeCode extends OrganizationScope {
  id: string;
  code: string;
  label: string;
  colorToken: string;
}

export interface Employee extends OrganizationScope {
  id: string;
  name: string;
  role: string;
  scheduleId: string;
  unitId: string;
  competencyIds: string[];
}

export interface Schedule extends OrganizationScope {
  id: string;
  name: string;
  startDate: string;
  dayShiftDays: number;
  nightShiftDays: number;
  offDays: number;
  employees: Employee[];
}

export interface StoredAssignment extends OrganizationScope {
  employeeId: string;
  date: string;
  competencyId: string | null;
  timeCodeId: string | null;
  notes?: string | null;
  shiftKind: ShiftKind;
}

export interface OvertimeClaim extends OrganizationScope {
  id: string;
  scheduleId: string;
  employeeId: string;
  competencyId: string;
  date: string;
}

export interface MutualShiftApplication extends OrganizationScope {
  id: string;
  postingId: string;
  applicantEmployeeId: string;
  applicantEmployeeName: string;
  applicantScheduleId: string;
  applicantScheduleName: string;
  status: MutualStatus;
  dates: string[];
  shiftKinds: ShiftKind[];
  createdAt: string;
}

export interface MutualShiftPosting extends OrganizationScope {
  id: string;
  ownerEmployeeId: string;
  ownerEmployeeName: string;
  ownerScheduleId: string;
  ownerScheduleName: string;
  status: MutualStatus;
  dates: string[];
  shiftKinds: ShiftKind[];
  month: string;
  createdAt: string;
  acceptedApplicationId: string | null;
  applications: MutualShiftApplication[];
}

export interface CompletedSet extends OrganizationScope {
  scheduleId: string;
  month: string;
  startDate: string;
  endDate: string;
}

export interface AppSession extends OrganizationContext {
  email: string;
  role: AppRole;
  displayName: string;
  scheduleId: string | null;
  employeeId: string | null;
  scheduleName: string | null;
}

export interface SchedulerSnapshot {
  month: string;
  schedules: Schedule[];
  productionUnits: ProductionUnit[];
  competencies: Competency[];
  timeCodes: TimeCode[];
  assignments: StoredAssignment[];
  overtimeClaims: OvertimeClaim[];
  completedSets: CompletedSet[];
}

export interface MutualsSnapshot {
  month: string;
  schedules: Schedule[];
  postings: MutualShiftPosting[];
}

export interface SaveAssignmentsInput {
  scheduleId: string;
  updates: StoredAssignment[];
}

export interface ClaimOvertimePostingInput {
  scheduleId: string;
  employeeId: string;
  competencyId: string;
  coverageCompetencyId?: string | null;
  swapEmployeeId?: string | null;
  dates: string[];
}

export interface ReleaseOvertimePostingInput {
  scheduleId: string;
  employeeId: string;
  competencyId: string;
  dates: string[];
}

export interface CreateMutualPostingInput {
  employeeId: string;
  dates: string[];
}

export interface ApplyToMutualPostingInput {
  postingId: string;
  employeeId: string;
  dates: string[];
}

export interface AcceptMutualApplicationInput {
  postingId: string;
  applicationId: string;
}

export interface WithdrawMutualPostingInput {
  postingId: string;
}

export interface WithdrawMutualApplicationInput {
  postingId: string;
  applicationId: string;
}

export interface CancelAcceptedMutualInput {
  postingId: string;
}

export interface SetScheduleCompletionInput {
  scheduleId: string;
  month: string;
  startDate: string;
  endDate: string;
  isComplete: boolean;
}

export interface PersonnelUpdate {
  employeeId: string;
  name: string;
  role: string;
  scheduleId: string;
  unitId: string;
  competencyIds: string[];
}

export interface SavePersonnelInput {
  updates: PersonnelUpdate[];
  deletedEmployeeIds: string[];
}

export interface ScheduleUpdate {
  scheduleId: string;
  name: string;
  startDate: string;
  dayShiftDays: number;
  nightShiftDays: number;
  offDays: number;
}

export interface SaveSchedulesInput {
  updates: ScheduleUpdate[];
  deletedScheduleIds: string[];
}

export interface CompetencyUpdate {
  competencyId: string;
  code: string;
  label: string;
  colorToken: string;
  requiredStaff: number;
}

export interface SaveCompetenciesInput {
  updates: CompetencyUpdate[];
  deletedCompetencyIds: string[];
}

export interface TimeCodeUpdate {
  timeCodeId: string;
  code: string;
  label: string;
  colorToken: string;
}

export interface SaveTimeCodesInput {
  updates: TimeCodeUpdate[];
  deletedTimeCodeIds: string[];
}
