import "server-only";

import { demoSchedulerSnapshot } from "@/lib/demo-data";
import { getSupabaseAdminClient, getSupabaseServerClient } from "@/lib/supabase";
import type { Competency, Employee, ProductionUnit, SchedulerSnapshot, StoredAssignment, Team } from "@/lib/types";

type TeamRow = {
  id: string;
  unit_id: string;
  name: string;
};

type EmployeeRow = {
  id: string;
  team_id: string;
  full_name: string;
  role_title: string | null;
  schedule_code: Employee["scheduleCode"];
  rotation_anchor: number | null;
};

type CompetencyRow = {
  id: string;
  unit_id: string;
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

  const [unitsResult, competenciesResult, teamsResult, employeesResult, employeeCompetenciesResult, assignmentsResult] =
    await Promise.all([
      supabase.from("production_units").select("id, name, description").order("name"),
      supabase.from("competencies").select("id, unit_id, code, label, color_token").order("code"),
      supabase.from("teams").select("id, unit_id, name").order("name"),
      supabase
        .from("employees")
        .select("id, team_id, full_name, role_title, schedule_code, rotation_anchor")
        .eq("is_active", true)
        .order("full_name"),
      supabase.from("employee_competencies").select("employee_id, competency_id"),
      supabase
        .from("schedule_assignments")
        .select("employee_id, assignment_date, competency_id, notes, shift_kind")
        .gte("assignment_date", monthStart)
        .lte("assignment_date", monthEnd),
    ]);

  const results = [
    unitsResult,
    competenciesResult,
    teamsResult,
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
    unitId: row.unit_id,
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

  const employeesByTeam = (employeesResult.data as EmployeeRow[]).reduce<Record<string, Employee[]>>(
    (map, row) => {
      map[row.team_id] ??= [];
      map[row.team_id].push({
        id: row.id,
        name: row.full_name,
        role: row.role_title ?? "Operator",
        teamId: row.team_id,
        scheduleCode: row.schedule_code,
        rotationAnchor: row.rotation_anchor ?? 0,
        competencyIds: competenciesByEmployee[row.id] ?? [],
      });
      return map;
    },
    {},
  );

  const teams: Team[] = (teamsResult.data as TeamRow[]).map((row) => ({
    id: row.id,
    unitId: row.unit_id,
    name: row.name,
    employees: employeesByTeam[row.id] ?? [],
  }));

  const assignments: StoredAssignment[] = (assignmentsResult.data as AssignmentRow[]).map((row) => ({
    employeeId: row.employee_id,
    date: row.assignment_date,
    competencyId: row.competency_id,
    notes: row.notes,
    shiftKind: row.shift_kind,
  }));

  return {
    month,
    teams,
    productionUnits,
    competencies,
    assignments,
  };
}
