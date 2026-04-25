export type ShiftKind = "DAY" | "NIGHT" | "OFF";
export type AppRole = "admin" | "leader" | "worker";
export type MutualStatus = "open" | "accepted" | "withdrawn" | "cancelled" | "rejected";
export type TimeCodeUsageMode = "manual" | "projected_only" | "both";

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

export interface AdminViewScope {
  activeSiteId?: string | null;
  activeBusinessAreaId?: string | null;
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
  usageMode: TimeCodeUsageMode;
}

export interface Employee extends OrganizationScope {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  name: string;
  role: string;
  scheduleId: string;
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
  scheduleId: string;
  date: string;
  competencyId: string | null;
  timeCodeId: string | null;
  notes?: string | null;
  shiftKind: ShiftKind;
  sourceType?: "schedule" | "sub-schedule";
  subScheduleId?: string | null;
  subScheduleName?: string | null;
  projectedCompetencyId?: string | null;
}

export interface SubSchedule extends OrganizationScope {
  id: string;
  name: string;
  summaryTimeCodeId: string;
  isArchived: boolean;
}

export interface SubScheduleAssignment extends OrganizationScope {
  id: string;
  subScheduleId: string;
  employeeId: string;
  date: string;
  competencyId: string | null;
  timeCodeId: string | null;
  notes?: string | null;
}

export interface OvertimeClaim extends OrganizationScope {
  id: string;
  scheduleId: string;
  employeeId: string;
  competencyId: string;
  date: string;
  manualPostingId?: string | null;
}

export interface ManualOvertimePosting extends OrganizationScope {
  id: string;
  scheduleId: string;
  competencyId: string;
  month: string;
  shiftKind: Exclude<ShiftKind, "OFF">;
  dates: string[];
  createdAt: string;
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

export interface AppSession extends OrganizationContext, AdminViewScope {
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
  projectedAssignments: StoredAssignment[];
  overtimeClaims: OvertimeClaim[];
  manualOvertimePostings: ManualOvertimePosting[];
  completedSets: CompletedSet[];
  subSchedules: SubSchedule[];
  subScheduleAssignments: SubScheduleAssignment[];
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
  manualPostingId?: string | null;
  dates: string[];
}

export interface ReleaseOvertimePostingInput {
  scheduleId: string;
  employeeId: string;
  competencyId: string;
  dates: string[];
}

export interface CreateManualOvertimePostingInput {
  scheduleId: string;
  competencyId: string;
  dates: string[];
}

export interface DeleteManualOvertimePostingInput {
  postingId: string;
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
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  scheduleId: string;
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
  usageMode: TimeCodeUsageMode;
}

export interface SaveTimeCodesInput {
  updates: TimeCodeUpdate[];
  deletedTimeCodeIds: string[];
}

export interface SubScheduleUpdate {
  subScheduleId: string;
  name: string;
  summaryTimeCodeId: string;
  isArchived: boolean;
}

export interface SaveSubSchedulesInput {
  updates: SubScheduleUpdate[];
}

export interface SubScheduleAssignmentUpdate {
  subScheduleAssignmentId: string;
  employeeId: string;
  date: string;
  competencyId: string | null;
  timeCodeId: string | null;
  notes?: string | null;
}

export interface SaveSubScheduleAssignmentsInput {
  subScheduleId: string;
  updates: SubScheduleAssignmentUpdate[];
}
