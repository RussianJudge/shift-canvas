import "server-only";

import { demoSchedulerSnapshot } from "@/lib/demo-data";
import {
  buildAssignmentIndex,
  createSetRangeKey,
  getEmployeeMap,
  getExtendedMonthDays,
  getMonthDays,
  getWorkedSetDays,
  shiftForDate,
  shiftMonthKey,
} from "@/lib/scheduling";
import { getSupabaseAdminClient, getSupabaseServerClient } from "@/lib/supabase";
import type {
  CompletedSet,
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

type CompletedSetRow = {
  schedule_id: string;
  month_key: string;
  start_date: string;
  end_date: string;
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

function emptySnapshot(month: string, overrides: Partial<SchedulerSnapshot> = {}): SchedulerSnapshot {
  return {
    month,
    productionUnits: [],
    competencies: [],
    timeCodes: [],
    schedules: [],
    assignments: [],
    overtimeClaims: [],
    completedSets: [],
    ...overrides,
  };
}

function getMonthBounds(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  return {
    monthStart: `${month}-01`,
    monthEnd: new Date(Date.UTC(year, monthIndex, 0)).toISOString().slice(0, 10),
  };
}

function getExtendedMonthBounds(month: string) {
  const previousMonth = shiftMonthKey(month, -1);
  const nextMonth = shiftMonthKey(month, 1);
  const { monthStart } = getMonthBounds(previousMonth);
  const { monthEnd } = getMonthBounds(nextMonth);

  return {
    monthStart,
    monthEnd,
    windowMonths: [previousMonth, month, nextMonth],
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

function mapCompletedSets(rows: CompletedSetRow[]) {
  return rows.map<CompletedSet>((row) => ({
    scheduleId: row.schedule_id,
    month: row.month_key,
    startDate: row.start_date,
    endDate: row.end_date,
  }));
}

function monthHasOvertimePostings(snapshot: SchedulerSnapshot) {
  const assignmentIndex = buildAssignmentIndex(snapshot.assignments);
  const employeeMap = getEmployeeMap(snapshot.schedules);
  const monthDays = getMonthDays(snapshot.month);
  const extendedMonthDays = getExtendedMonthDays(snapshot.month);
  const completedSetRangeKeys = new Set(
    snapshot.completedSets.map((entry) => createSetRangeKey(entry.scheduleId, entry.startDate, entry.endDate)),
  );
  const processedKeys = new Set<string>();

  for (const schedule of snapshot.schedules) {
    for (const day of monthDays) {
      if (shiftForDate(schedule, day.date) === "OFF") {
        continue;
      }

      const setDays = getWorkedSetDays(schedule, extendedMonthDays, day.date);

      if (setDays.length === 0) {
        continue;
      }

      const setKey = createSetRangeKey(
        schedule.id,
        setDays[0].date,
        setDays[setDays.length - 1].date,
      );

      if (processedKeys.has(setKey) || !completedSetRangeKeys.has(setKey)) {
        continue;
      }

      processedKeys.add(setKey);

      const segments = setDays.reduce<Array<{ dates: string[]; shiftKind: "DAY" | "NIGHT" }>>((allSegments, setDay) => {
        const shiftKind = shiftForDate(schedule, setDay.date);

        if (shiftKind === "OFF") {
          return allSegments;
        }

        const currentSegment = allSegments[allSegments.length - 1];

        if (!currentSegment || currentSegment.shiftKind !== shiftKind) {
          allSegments.push({
            shiftKind,
            dates: [setDay.date],
          });
          return allSegments;
        }

        currentSegment.dates.push(setDay.date);
        return allSegments;
      }, []);

      for (const segment of segments) {
        if (segment.dates[0]?.slice(0, 7) !== snapshot.month) {
          continue;
        }

        for (const competency of snapshot.competencies) {
          const hasClaimedPosting = snapshot.overtimeClaims.some(
            (claim) =>
              claim.scheduleId === schedule.id &&
              claim.competencyId === competency.id &&
              segment.dates.includes(claim.date),
          );

          if (hasClaimedPosting) {
            return true;
          }

          for (const date of segment.dates) {
            let filledCount = 0;

            for (const employee of schedule.employees) {
              const selection = assignmentIndex[`${employee.id}:${date}`];

              if (selection?.competencyId === competency.id) {
                filledCount += 1;
              }
            }

            for (const claim of snapshot.overtimeClaims) {
              const claimEmployee = employeeMap[claim.employeeId];

              if (
                claim.scheduleId === schedule.id &&
                claim.competencyId === competency.id &&
                claim.date === date &&
                claimEmployee?.scheduleId !== schedule.id
              ) {
                filledCount += 1;
              }
            }

            if (filledCount < competency.requiredStaff) {
              return true;
            }
          }
        }
      }
    }
  }

  return false;
}

export async function getSchedulerSnapshot(month: string) {
  const supabase = getDataClient();

  if (!supabase) {
    return withMonth(demoSchedulerSnapshot, month);
  }

  const { monthStart, monthEnd, windowMonths } = getExtendedMonthBounds(month);

  const [
    unitsResult,
    competenciesResult,
    timeCodesResult,
    schedulesResult,
    employeesResult,
    employeeCompetenciesResult,
    assignmentsResult,
    overtimeClaimsResult,
    completedSetsResult,
  ] = await Promise.all([
    supabase.from("production_units").select("id, name, description").order("name"),
    supabase.from("competencies").select("id, code, label, color_token, required_staff").order("code"),
    supabase.from("time_codes").select("id, code, label, color_token").order("code"),
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
    supabase
      .from("completed_sets")
      .select("schedule_id, month_key, start_date, end_date")
      .in("month_key", windowMonths),
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
    completedSetsResult,
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
    completedSets: mapCompletedSets(completedSetsResult.data as CompletedSetRow[]),
  };
}

export async function getPersonnelSnapshot(month: string) {
  const supabase = getDataClient();

  if (!supabase) {
    return emptySnapshot(month);
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

  const employeesBySchedule = buildEmployeesBySchedule(
    (employeesResult.data as EmployeeRow[] | null) ?? [],
    (employeeCompetenciesResult.data as EmployeeCompetencyRow[] | null) ?? [],
  );

  return {
    month,
    productionUnits: mapProductionUnits((unitsResult.data as ProductionUnitRow[] | null) ?? []),
    competencies: mapCompetencies((competenciesResult.data as CompetencyRow[] | null) ?? []),
    timeCodes: [],
    schedules: mapSchedules((schedulesResult.data as ScheduleRow[] | null) ?? [], employeesBySchedule),
    assignments: [],
    overtimeClaims: [],
    completedSets: [],
  };
}

export async function getSchedulesSnapshot(month: string) {
  const supabase = getDataClient();

  if (!supabase) {
    return emptySnapshot(month);
  }

  const [schedulesResult, employeesResult] = await Promise.all([
    supabase.from("schedules").select("id, name, start_date, day_shift_days, night_shift_days, off_days").order("name"),
    supabase.from("employees").select("id, schedule_id, unit_id, full_name, role_title").eq("is_active", true),
  ]);

  const employeesBySchedule = buildEmployeesBySchedule(
    (employeesResult.data as EmployeeRow[] | null) ?? [],
    [],
  );

  return {
    month,
    productionUnits: [],
    competencies: [],
    timeCodes: [],
    schedules: mapSchedules((schedulesResult.data as ScheduleRow[] | null) ?? [], employeesBySchedule),
    assignments: [],
    overtimeClaims: [],
    completedSets: [],
  };
}

export async function getCompetenciesSnapshot(month: string) {
  const supabase = getDataClient();

  if (!supabase) {
    return emptySnapshot(month);
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

  const employeesBySchedule = buildEmployeesBySchedule(
    (employeesResult.data as EmployeeRow[] | null) ?? [],
    (employeeCompetenciesResult.data as EmployeeCompetencyRow[] | null) ?? [],
  );

  return {
    month,
    productionUnits: [],
    competencies: mapCompetencies((competenciesResult.data as CompetencyRow[] | null) ?? []),
    timeCodes: [],
    schedules: mapSchedules((schedulesResult.data as ScheduleRow[] | null) ?? [], employeesBySchedule),
    assignments: [],
    overtimeClaims: [],
    completedSets: [],
  };
}

export async function getTimeCodesSnapshot(month: string) {
  const supabase = getDataClient();

  if (!supabase) {
    return emptySnapshot(month);
  }

  const timeCodesResult = await supabase
    .from("time_codes")
    .select("id, code, label, color_token")
    .order("code");

  return {
    month,
    productionUnits: [],
    competencies: [],
    timeCodes: mapTimeCodes((timeCodesResult.data as TimeCodeRow[] | null) ?? []),
    schedules: [],
    assignments: [],
    overtimeClaims: [],
    completedSets: [],
  };
}

export async function getOvertimeMonths(currentMonth: string) {
  const supabase = getDataClient();

  if (!supabase) {
    return [currentMonth];
  }

  const completedSetsResult = await supabase
    .from("completed_sets")
    .select("month_key")
    .order("month_key");

  if (completedSetsResult.error) {
    return [currentMonth];
  }

  const candidateMonths = Array.from(
    new Set(
      [currentMonth, ...(completedSetsResult.data ?? []).map((row) => (row as { month_key: string }).month_key)].filter(Boolean),
    ),
  ).sort();

  const snapshots = await Promise.all(candidateMonths.map((month) => getSchedulerSnapshot(month)));
  const monthsWithPostings = candidateMonths.filter((month, index) => monthHasOvertimePostings(snapshots[index]));

  return monthsWithPostings.length > 0
    ? monthsWithPostings
    : [currentMonth];
}
