import "server-only";

import { demoSchedulerSnapshot } from "@/lib/demo-data";
import { getSupabaseAdminClient, getSupabaseServerClient } from "@/lib/supabase";
import type {
  Competency,
  Employee,
  OvertimeClaim,
  ProductionUnit,
  Schedule,
  SchedulerSnapshot,
  StoredAssignment,
  TimeCode,
} from "@/lib/types";

type DataClient = NonNullable<ReturnType<typeof getSupabaseAdminClient> | ReturnType<typeof getSupabaseServerClient>>;

type ScheduleRow = {
  id: string;
  name: string;
  start_date: string;
  day_shift_days: number;
  night_shift_days: number;
  off_days: number;
};

type EmployeeRow = {
  id: string;
  schedule_id: string;
  unit_id: string;
  full_name: string;
  role_title: string | null;
};

type CompetencyRow = {
  id: string;
  code: string;
  label: string;
  color_token: string | null;
  required_staff: number | null;
};

type TimeCodeRow = {
  id: string;
  code: string;
  label: string;
  color_token: string | null;
  category: string | null;
};

type EmployeeCompetencyRow = {
  employee_id: string;
  competency_id: string;
};

type AssignmentRow = {
  employee_id: string;
  assignment_date: string;
  competency_id: string | null;
  time_code_id: string | null;
  notes: string | null;
  shift_kind: StoredAssignment["shiftKind"];
};

type ProductionUnitRow = {
  id: string;
  name: string;
  description: string | null;
};

type OvertimeClaimRow = {
  id: string;
  schedule_id: string;
  employee_id: string;
  competency_id: string;
  assignment_date: string;
};

function getDataClient() {
  return getSupabaseAdminClient() ?? getSupabaseServerClient();
}

function withMonth(snapshot: SchedulerSnapshot, month: string): SchedulerSnapshot {
  return {
    ...snapshot,
    month,
  };
}

function subsetSnapshot(
  month: string,
  overrides: Partial<SchedulerSnapshot>,
): SchedulerSnapshot {
  return {
    ...withMonth(demoSchedulerSnapshot, month),
    ...overrides,
    month,
  };
}

function getMonthBounds(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  return {
    monthStart: `${month}-01`,
    monthEnd: new Date(Date.UTC(year, monthIndex, 0)).toISOString().slice(0, 10),
  };
}

function mapProductionUnits(rows: ProductionUnitRow[]) {
  return rows.map<ProductionUnit>((row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? "",
  }));
}

function mapCompetencies(rows: CompetencyRow[]) {
  return rows.map<Competency>((row) => ({
    id: row.id,
    code: row.code,
    label: row.label,
    colorToken: row.color_token ?? "slate",
    requiredStaff: Math.max(1, row.required_staff ?? 1),
  }));
}

function mapTimeCodes(rows: TimeCodeRow[]) {
  return rows.map<TimeCode>((row) => ({
    id: row.id,
    code: row.code,
    label: row.label,
    colorToken: row.color_token ?? "slate",
    category: row.category ?? "General",
  }));
}

function buildEmployeesBySchedule(
  employeeRows: EmployeeRow[],
  employeeCompetencyRows: EmployeeCompetencyRow[],
) {
  const competenciesByEmployee = employeeCompetencyRows.reduce<Record<string, string[]>>((map, row) => {
    map[row.employee_id] ??= [];
    map[row.employee_id].push(row.competency_id);
    return map;
  }, {});

  return employeeRows.reduce<Record<string, Employee[]>>((map, row) => {
    map[row.schedule_id] ??= [];
    map[row.schedule_id].push({
      id: row.id,
      name: row.full_name,
      role: row.role_title ?? "Operator",
      scheduleId: row.schedule_id,
      unitId: row.unit_id,
      competencyIds: competenciesByEmployee[row.id] ?? [],
    });
    return map;
  }, {});
}

function mapSchedules(scheduleRows: ScheduleRow[], employeesBySchedule: Record<string, Employee[]>) {
  return scheduleRows.map<Schedule>((row) => ({
    id: row.id,
    name: row.name,
    startDate: row.start_date,
    dayShiftDays: row.day_shift_days,
    nightShiftDays: row.night_shift_days,
    offDays: row.off_days,
    employees: employeesBySchedule[row.id] ?? [],
  }));
}

function mapAssignments(rows: AssignmentRow[]) {
  return rows.map<StoredAssignment>((row) => ({
    employeeId: row.employee_id,
    date: row.assignment_date,
    competencyId: row.competency_id,
    timeCodeId: row.time_code_id,
    notes: row.notes,
    shiftKind: row.shift_kind,
  }));
}

function mapOvertimeClaims(rows: OvertimeClaimRow[]) {
  return rows.map<OvertimeClaim>((row) => ({
    id: row.id,
    scheduleId: row.schedule_id,
    employeeId: row.employee_id,
    competencyId: row.competency_id,
    date: row.assignment_date,
  }));
}

export async function getSchedulerSnapshot(month: string) {
  const supabase = getDataClient();

  if (!supabase) {
    return withMonth(demoSchedulerSnapshot, month);
  }

  const { monthStart, monthEnd } = getMonthBounds(month);

  const [
    unitsResult,
    competenciesResult,
    timeCodesResult,
    schedulesResult,
    employeesResult,
    employeeCompetenciesResult,
    assignmentsResult,
    overtimeClaimsResult,
  ] = await Promise.all([
    supabase.from("production_units").select("id, name, description").order("name"),
    supabase.from("competencies").select("id, code, label, color_token, required_staff").order("code"),
    supabase.from("time_codes").select("id, code, label, color_token, category").order("category").order("code"),
    supabase.from("schedules").select("id, name, start_date, day_shift_days, night_shift_days, off_days").order("name"),
    supabase
      .from("employees")
      .select("id, schedule_id, unit_id, full_name, role_title")
      .eq("is_active", true)
      .order("full_name"),
    supabase.from("employee_competencies").select("employee_id, competency_id"),
    supabase
      .from("schedule_assignments")
      .select("employee_id, assignment_date, competency_id, time_code_id, notes, shift_kind")
      .gte("assignment_date", monthStart)
      .lte("assignment_date", monthEnd),
    supabase
      .from("overtime_claims")
      .select("id, schedule_id, employee_id, competency_id, assignment_date")
      .gte("assignment_date", monthStart)
      .lte("assignment_date", monthEnd),
  ]);

  const results = [
    unitsResult,
    competenciesResult,
    timeCodesResult,
    schedulesResult,
    employeesResult,
    employeeCompetenciesResult,
    assignmentsResult,
    overtimeClaimsResult,
  ];

  if (results.some((result) => result.error)) {
    return withMonth(demoSchedulerSnapshot, month);
  }

  const employeesBySchedule = buildEmployeesBySchedule(
    employeesResult.data as EmployeeRow[],
    employeeCompetenciesResult.data as EmployeeCompetencyRow[],
  );

  return {
    month,
    productionUnits: mapProductionUnits(unitsResult.data as ProductionUnitRow[]),
    competencies: mapCompetencies(competenciesResult.data as CompetencyRow[]),
    timeCodes: mapTimeCodes(timeCodesResult.data as TimeCodeRow[]),
    schedules: mapSchedules(schedulesResult.data as ScheduleRow[], employeesBySchedule),
    assignments: mapAssignments(assignmentsResult.data as AssignmentRow[]),
    overtimeClaims: mapOvertimeClaims(overtimeClaimsResult.data as OvertimeClaimRow[]),
  };
}

export async function getPersonnelSnapshot(month: string) {
  const supabase = getDataClient();

  if (!supabase) {
    return subsetSnapshot(month, {
      timeCodes: [],
      assignments: [],
      overtimeClaims: [],
    });
  }

  const [unitsResult, competenciesResult, schedulesResult, employeesResult, employeeCompetenciesResult] =
    await Promise.all([
      supabase.from("production_units").select("id, name, description").order("name"),
      supabase.from("competencies").select("id, code, label, color_token, required_staff").order("code"),
      supabase.from("schedules").select("id, name, start_date, day_shift_days, night_shift_days, off_days").order("name"),
      supabase
        .from("employees")
        .select("id, schedule_id, unit_id, full_name, role_title")
        .eq("is_active", true)
        .order("full_name"),
      supabase.from("employee_competencies").select("employee_id, competency_id"),
    ]);

  const results = [unitsResult, competenciesResult, schedulesResult, employeesResult, employeeCompetenciesResult];

  if (results.some((result) => result.error)) {
    return subsetSnapshot(month, {
      timeCodes: [],
      assignments: [],
      overtimeClaims: [],
    });
  }

  const employeesBySchedule = buildEmployeesBySchedule(
    employeesResult.data as EmployeeRow[],
    employeeCompetenciesResult.data as EmployeeCompetencyRow[],
  );

  return {
    month,
    productionUnits: mapProductionUnits(unitsResult.data as ProductionUnitRow[]),
    competencies: mapCompetencies(competenciesResult.data as CompetencyRow[]),
    timeCodes: [],
    schedules: mapSchedules(schedulesResult.data as ScheduleRow[], employeesBySchedule),
    assignments: [],
    overtimeClaims: [],
  };
}

export async function getSchedulesSnapshot(month: string) {
  const supabase = getDataClient();

  if (!supabase) {
    return subsetSnapshot(month, {
      competencies: [],
      timeCodes: [],
      assignments: [],
      overtimeClaims: [],
    });
  }

  const [schedulesResult, employeesResult] = await Promise.all([
    supabase.from("schedules").select("id, name, start_date, day_shift_days, night_shift_days, off_days").order("name"),
    supabase.from("employees").select("id, schedule_id, unit_id, full_name, role_title").eq("is_active", true),
  ]);

  if (schedulesResult.error || employeesResult.error) {
    return subsetSnapshot(month, {
      competencies: [],
      timeCodes: [],
      assignments: [],
      overtimeClaims: [],
    });
  }

  const employeesBySchedule = buildEmployeesBySchedule(
    employeesResult.data as EmployeeRow[],
    [],
  );

  return {
    month,
    productionUnits: [],
    competencies: [],
    timeCodes: [],
    schedules: mapSchedules(schedulesResult.data as ScheduleRow[], employeesBySchedule),
    assignments: [],
    overtimeClaims: [],
  };
}

export async function getCompetenciesSnapshot(month: string) {
  const supabase = getDataClient();

  if (!supabase) {
    return subsetSnapshot(month, {
      timeCodes: [],
      assignments: [],
      overtimeClaims: [],
    });
  }

  const [competenciesResult, schedulesResult, employeesResult, employeeCompetenciesResult] = await Promise.all([
    supabase.from("competencies").select("id, code, label, color_token, required_staff").order("code"),
    supabase.from("schedules").select("id, name, start_date, day_shift_days, night_shift_days, off_days").order("name"),
    supabase
      .from("employees")
      .select("id, schedule_id, unit_id, full_name, role_title")
      .eq("is_active", true)
      .order("full_name"),
    supabase.from("employee_competencies").select("employee_id, competency_id"),
  ]);

  const results = [competenciesResult, schedulesResult, employeesResult, employeeCompetenciesResult];

  if (results.some((result) => result.error)) {
    return subsetSnapshot(month, {
      timeCodes: [],
      assignments: [],
      overtimeClaims: [],
    });
  }

  const employeesBySchedule = buildEmployeesBySchedule(
    employeesResult.data as EmployeeRow[],
    employeeCompetenciesResult.data as EmployeeCompetencyRow[],
  );

  return {
    month,
    productionUnits: [],
    competencies: mapCompetencies(competenciesResult.data as CompetencyRow[]),
    timeCodes: [],
    schedules: mapSchedules(schedulesResult.data as ScheduleRow[], employeesBySchedule),
    assignments: [],
    overtimeClaims: [],
  };
}

export async function getTimeCodesSnapshot(month: string) {
  const supabase = getDataClient();

  if (!supabase) {
    return subsetSnapshot(month, {
      competencies: [],
      schedules: [],
      assignments: [],
      overtimeClaims: [],
    });
  }

  const timeCodesResult = await supabase
    .from("time_codes")
    .select("id, code, label, color_token, category")
    .order("category")
    .order("code");

  if (timeCodesResult.error) {
    return subsetSnapshot(month, {
      competencies: [],
      schedules: [],
      assignments: [],
      overtimeClaims: [],
    });
  }

  return {
    month,
    productionUnits: [],
    competencies: [],
    timeCodes: mapTimeCodes(timeCodesResult.data as TimeCodeRow[]),
    schedules: [],
    assignments: [],
    overtimeClaims: [],
  };
}
