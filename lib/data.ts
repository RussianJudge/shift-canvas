import "server-only";

import { demoSchedulerSnapshot } from "@/lib/demo-data";
import { getSupabaseAdminClient, getSupabaseServerClient } from "@/lib/supabase";
import type {
  Competency,
  Employee,
  ProductionUnit,
  Schedule,
  SchedulerSnapshot,
  StoredAssignment,
  TimeCode,
} from "@/lib/types";

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

function withMonth(snapshot: SchedulerSnapshot, month: string): SchedulerSnapshot {
  return {
    ...snapshot,
    month,
  };
}

export async function getSchedulerSnapshot(month: string) {
  const supabase = getSupabaseAdminClient() ?? getSupabaseServerClient();

  if (!supabase) {
    return withMonth(demoSchedulerSnapshot, month);
  }

  const [year, monthIndex] = month.split("-").map(Number);
  const monthStart = `${month}-01`;
  const monthEnd = new Date(Date.UTC(year, monthIndex, 0)).toISOString().slice(0, 10);

  const [
    unitsResult,
    competenciesResult,
    timeCodesResult,
    schedulesResult,
    employeesResult,
    employeeCompetenciesResult,
    assignmentsResult,
  ] =
    await Promise.all([
      supabase.from("production_units").select("id, name, description").order("name"),
      supabase.from("competencies").select("id, code, label, color_token, required_staff").order("code"),
      supabase.from("time_codes").select("id, code, label, color_token").order("code"),
      supabase
        .from("schedules")
        .select("id, name, start_date, day_shift_days, night_shift_days, off_days")
        .order("name"),
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
    ]);

  const results = [
    unitsResult,
    competenciesResult,
    timeCodesResult,
    schedulesResult,
    employeesResult,
    employeeCompetenciesResult,
    assignmentsResult,
  ];

  if (results.some((result) => result.error)) {
    return withMonth(demoSchedulerSnapshot, month);
  }

  const productionUnits: ProductionUnit[] = (unitsResult.data as ProductionUnitRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? "",
  }));

  const competencies: Competency[] = (competenciesResult.data as CompetencyRow[]).map((row) => ({
    id: row.id,
    code: row.code,
    label: row.label,
    colorToken: row.color_token ?? "slate",
    requiredStaff: row.required_staff ?? 1,
  }));

  const timeCodes: TimeCode[] = (timeCodesResult.data as TimeCodeRow[]).map((row) => ({
    id: row.id,
    code: row.code,
    label: row.label,
    colorToken: row.color_token ?? "slate",
  }));

  const competenciesByEmployee = (employeeCompetenciesResult.data as EmployeeCompetencyRow[]).reduce<
    Record<string, string[]>
  >((map, row) => {
    map[row.employee_id] ??= [];
    map[row.employee_id].push(row.competency_id);
    return map;
  }, {});

  const employeesBySchedule = (employeesResult.data as EmployeeRow[]).reduce<Record<string, Employee[]>>(
    (map, row) => {
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
    },
    {},
  );

  const schedules: Schedule[] = (schedulesResult.data as ScheduleRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    startDate: row.start_date,
    dayShiftDays: row.day_shift_days,
    nightShiftDays: row.night_shift_days,
    offDays: row.off_days,
    employees: employeesBySchedule[row.id] ?? [],
  }));

  const assignments: StoredAssignment[] = (assignmentsResult.data as AssignmentRow[]).map((row) => ({
    employeeId: row.employee_id,
    date: row.assignment_date,
    competencyId: row.competency_id,
    timeCodeId: row.time_code_id,
    notes: row.notes,
    shiftKind: row.shift_kind,
  }));

  return {
    month,
    schedules,
    productionUnits,
    competencies,
    timeCodes,
    assignments,
  };
}
