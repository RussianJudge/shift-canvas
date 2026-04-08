import "server-only";

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
  AppSession,
  CompletedSet,
  Competency,
  Employee,
  MutualShiftApplication,
  MutualShiftPosting,
  MutualsSnapshot,
  OvertimeClaim,
  ProductionUnit,
  Schedule,
  SchedulerSnapshot,
  StoredAssignment,
  TimeCode,
} from "@/lib/types";

/**
 * Server-only data loaders for the scheduling workspace.
 *
 * These helpers pull a month snapshot from Supabase and shape it into the
 * in-memory structure used by the rest of the app. The central goal is to keep
 * the UI mostly unaware of table layouts and row naming conventions.
 */
type DataClient = NonNullable<ReturnType<typeof getSupabaseAdminClient> | ReturnType<typeof getSupabaseServerClient>>;

type ScheduleRow = {
  id: string;
  name: string;
  start_date: string;
  day_shift_days: number;
  night_shift_days: number;
  off_days: number;
  company_id: string;
  site_id: string;
  business_area_id: string;
};

type EmployeeRow = {
  id: string;
  schedule_id: string;
  unit_id: string;
  full_name: string;
  role_title: string | null;
  company_id: string;
  site_id: string;
  business_area_id: string;
};

type CompetencyRow = {
  id: string;
  code: string;
  label: string;
  color_token: string | null;
  required_staff: number | null;
  company_id: string;
  site_id: string;
  business_area_id: string;
};

type TimeCodeRow = {
  id: string;
  code: string;
  label: string;
  color_token: string | null;
  company_id: string;
  site_id: string;
  business_area_id: string;
};

type EmployeeCompetencyRow = {
  employee_id: string;
  competency_id: string;
  company_id: string;
  site_id: string;
  business_area_id: string;
};

type AssignmentRow = {
  employee_id: string;
  assignment_date: string;
  competency_id: string | null;
  time_code_id: string | null;
  notes: string | null;
  shift_kind: StoredAssignment["shiftKind"];
  company_id: string;
  site_id: string;
  business_area_id: string;
};

type ProductionUnitRow = {
  id: string;
  name: string;
  description: string | null;
  company_id: string;
  site_id: string;
  business_area_id: string;
};

type OvertimeClaimRow = {
  id: string;
  schedule_id: string;
  employee_id: string;
  competency_id: string;
  assignment_date: string;
  company_id: string;
  site_id: string;
  business_area_id: string;
};

type CompletedSetRow = {
  schedule_id: string;
  month_key: string;
  start_date: string;
  end_date: string;
  company_id: string;
  site_id: string;
  business_area_id: string;
};

type ProfileRow = {
  id: string;
  company_id?: string;
  site_id?: string;
  business_area_id?: string;
};

type UserSchedulePinRow = {
  schedule_id: string;
  employee_id: string;
  sort_order: number;
  company_id: string;
  site_id: string;
  business_area_id: string;
};

type MutualShiftPostingRow = {
  id: string;
  owner_employee_id: string;
  owner_schedule_id: string;
  status: MutualShiftPosting["status"];
  month_key: string;
  accepted_application_id: string | null;
  created_at: string;
  company_id: string;
  site_id: string;
  business_area_id: string;
};

type MutualShiftPostingDateRow = {
  posting_id: string;
  swap_date: string;
  shift_kind: Exclude<StoredAssignment["shiftKind"], "OFF">;
  company_id: string;
  site_id: string;
  business_area_id: string;
};

type MutualShiftApplicationRow = {
  id: string;
  posting_id: string;
  applicant_employee_id: string;
  applicant_schedule_id: string;
  status: MutualShiftApplication["status"];
  created_at: string;
  company_id: string;
  site_id: string;
  business_area_id: string;
};

type MutualShiftApplicationDateRow = {
  application_id: string;
  swap_date: string;
  shift_kind: Exclude<StoredAssignment["shiftKind"], "OFF">;
  company_id: string;
  site_id: string;
  business_area_id: string;
};

/** Prefers the admin client, but can fall back to a server-scoped client. */
function getDataClient() {
  return getSupabaseAdminClient() ?? getSupabaseServerClient();
}

/**
 * Applies the current user's organization boundary to a Supabase query.
 *
 * Admins can see the whole company. Leaders and workers are narrowed to a
 * single business area inside that company/site hierarchy.
 */
function applySessionScope(query: any, session?: AppSession | null) {
  if (!session?.companyId) {
    return query;
  }

  const companyScoped = query.eq("company_id", session.companyId);

  if (session.role === "admin") {
    if (session.activeSiteId && session.activeBusinessAreaId) {
      return companyScoped
        .eq("site_id", session.activeSiteId)
        .eq("business_area_id", session.activeBusinessAreaId);
    }

    if (session.activeSiteId) {
      return companyScoped.eq("site_id", session.activeSiteId);
    }

    return companyScoped;
  }

  return companyScoped
    .eq("site_id", session.siteId)
    .eq("business_area_id", session.businessAreaId);
}

export async function getAdminScopeOptions(session: AppSession) {
  const supabase = getDataClient();

  if (!supabase || session.role !== "admin") {
    return {
      sites: [] as Array<{ id: string; name: string }>,
      businessAreas: [] as Array<{ id: string; siteId: string; name: string }>,
    };
  }

  const sitesResult = await supabase
    .from("sites")
    .select("id, name")
    .eq("company_id", session.companyId)
    .order("name");

  const sites = ((sitesResult.data as Array<{ id: string; name: string }> | null) ?? []);
  const siteIds = sites.map((site) => site.id);

  const businessAreasResult =
    siteIds.length > 0
      ? await supabase
          .from("business_areas")
          .select("id, site_id, name")
          .in("site_id", siteIds)
          .order("name")
      : { data: [], error: null };

  return {
    sites,
    businessAreas: ((businessAreasResult.data as Array<{ id: string; site_id: string; name: string }> | null) ?? []).map(
      (row) => ({
        id: row.id,
        siteId: row.site_id,
        name: row.name,
      }),
    ),
  };
}

/** Empty snapshot shape used when data is unavailable or a page is unconfigured. */
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

function getYearStart(dateKey: string) {
  return `${dateKey.slice(0, 4)}-01-01`;
}

/** Expands a month into the previous/current/next query window for cross-month sets. */
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
    companyId: row.company_id,
    siteId: row.site_id,
    businessAreaId: row.business_area_id,
  }));
}

/** Maps competency rows and enforces safe defaults for UI rendering. */
function mapCompetencies(rows: CompetencyRow[]) {
  return rows.map<Competency>((row) => ({
    id: row.id,
    code: row.code,
    label: row.label,
    colorToken: row.color_token ?? "slate",
    requiredStaff: Math.max(1, row.required_staff ?? 1),
    companyId: row.company_id,
    siteId: row.site_id,
    businessAreaId: row.business_area_id,
  }));
}

function mapTimeCodes(rows: TimeCodeRow[]) {
  return rows.map<TimeCode>((row) => ({
    id: row.id,
    code: row.code,
    label: row.label,
    colorToken: row.color_token ?? "slate",
    companyId: row.company_id,
    siteId: row.site_id,
    businessAreaId: row.business_area_id,
  }));
}

/** Joins employees with their competency links and groups them by shift/schedule. */
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
      companyId: row.company_id,
      siteId: row.site_id,
      businessAreaId: row.business_area_id,
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
    companyId: row.company_id,
    siteId: row.site_id,
    businessAreaId: row.business_area_id,
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
    companyId: row.company_id,
    siteId: row.site_id,
    businessAreaId: row.business_area_id,
  }));
}

function mapOvertimeClaims(rows: OvertimeClaimRow[]) {
  return rows.map<OvertimeClaim>((row) => ({
    id: row.id,
    scheduleId: row.schedule_id,
    employeeId: row.employee_id,
    competencyId: row.competency_id,
    date: row.assignment_date,
    companyId: row.company_id,
    siteId: row.site_id,
    businessAreaId: row.business_area_id,
  }));
}

function mapCompletedSets(rows: CompletedSetRow[]) {
  return rows.map<CompletedSet>((row) => ({
    scheduleId: row.schedule_id,
    month: row.month_key,
    startDate: row.start_date,
    endDate: row.end_date,
    companyId: row.company_id,
    siteId: row.site_id,
    businessAreaId: row.business_area_id,
  }));
}

/**
 * Determines whether a month should appear in the overtime month filter.
 *
 * A month is considered relevant when it still has a staffing shortfall or when
 * claims already exist for that month's overtime postings.
 */
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

/**
 * Loads the full scheduler snapshot for a month.
 *
 * The schedule screen and several downstream pages rely on one consistent shape
 * that includes:
 * - reference data (competencies/time codes/units)
 * - schedules with employees attached
 * - assignments for the extended month window
 * - overtime claims
 * - completed-set state
 */
export async function getSchedulerSnapshot(month: string, session?: AppSession | null) {
  const supabase = getDataClient();

  if (!supabase) {
    return emptySnapshot(month);
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
    applySessionScope(
      supabase.from("production_units").select("id, name, description, company_id, site_id, business_area_id"),
      session,
    ).order("name"),
    applySessionScope(
      supabase.from("competencies").select("id, code, label, color_token, required_staff, company_id, site_id, business_area_id"),
      session,
    ).order("code"),
    applySessionScope(
      supabase.from("time_codes").select("id, code, label, color_token, company_id, site_id, business_area_id"),
      session,
    ).order("code"),
    applySessionScope(
      supabase.from("schedules").select("id, name, start_date, day_shift_days, night_shift_days, off_days, company_id, site_id, business_area_id"),
      session,
    ).order("name"),
    applySessionScope(
      supabase
      .from("employees")
      .select("id, schedule_id, unit_id, full_name, role_title, company_id, site_id, business_area_id"),
      session,
    )
      .eq("is_active", true)
      .order("full_name"),
    applySessionScope(
      supabase.from("employee_competencies").select("employee_id, competency_id, company_id, site_id, business_area_id"),
      session,
    ),
    applySessionScope(
      supabase
      .from("schedule_assignments")
      .select("employee_id, assignment_date, competency_id, time_code_id, notes, shift_kind, company_id, site_id, business_area_id"),
      session,
    )
      .gte("assignment_date", monthStart)
      .lte("assignment_date", monthEnd),
    applySessionScope(
      supabase
      .from("overtime_claims")
      .select("id, schedule_id, employee_id, competency_id, assignment_date, company_id, site_id, business_area_id"),
      session,
    )
      .gte("assignment_date", monthStart)
      .lte("assignment_date", monthEnd),
    applySessionScope(
      supabase
      .from("completed_sets")
      .select("schedule_id, month_key, start_date, end_date, company_id, site_id, business_area_id"),
      session,
    )
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
    return emptySnapshot(month);
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

export async function getPersonnelSnapshot(month: string, session?: AppSession | null) {
  const supabase = getDataClient();

  if (!supabase) {
    return emptySnapshot(month);
  }

  const [unitsResult, competenciesResult, schedulesResult, employeesResult, employeeCompetenciesResult] =
    await Promise.all([
      applySessionScope(
        supabase.from("production_units").select("id, name, description, company_id, site_id, business_area_id"),
        session,
      ).order("name"),
      applySessionScope(
        supabase.from("competencies").select("id, code, label, color_token, required_staff, company_id, site_id, business_area_id"),
        session,
      ).order("code"),
      applySessionScope(
        supabase.from("schedules").select("id, name, start_date, day_shift_days, night_shift_days, off_days, company_id, site_id, business_area_id"),
        session,
      ).order("name"),
      applySessionScope(
        supabase
        .from("employees")
        .select("id, schedule_id, unit_id, full_name, role_title, company_id, site_id, business_area_id"),
        session,
      )
        .eq("is_active", true)
        .order("full_name"),
      applySessionScope(
        supabase.from("employee_competencies").select("employee_id, competency_id, company_id, site_id, business_area_id"),
        session,
      ),
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

export async function getMetricsOvertimeHistory(today: string, session?: AppSession | null) {
  const supabase = getDataClient();

  if (!supabase) {
    return [];
  }

  const result = await applySessionScope(
    supabase
    .from("overtime_claims")
    .select("id, schedule_id, employee_id, competency_id, assignment_date, company_id, site_id, business_area_id"),
    session,
  )
    .gte("assignment_date", getYearStart(today))
    .lte("assignment_date", today);

  if (result.error) {
    return [];
  }

  return mapOvertimeClaims((result.data as OvertimeClaimRow[] | null) ?? []);
}

export async function getMetricsAssignmentHistory(today: string, session?: AppSession | null) {
  const supabase = getDataClient();

  if (!supabase) {
    return [];
  }

  const result = await applySessionScope(
    supabase
    .from("schedule_assignments")
    .select("employee_id, assignment_date, competency_id, time_code_id, notes, shift_kind, company_id, site_id, business_area_id"),
    session,
  )
    .gte("assignment_date", getYearStart(today))
    .lte("assignment_date", today);

  if (result.error) {
    return [];
  }

  return mapAssignments((result.data as AssignmentRow[] | null) ?? []);
}

export async function getSchedulesSnapshot(month: string, session?: AppSession | null) {
  const supabase = getDataClient();

  if (!supabase) {
    return emptySnapshot(month);
  }

  const [schedulesResult, employeesResult] = await Promise.all([
    applySessionScope(
      supabase.from("schedules").select("id, name, start_date, day_shift_days, night_shift_days, off_days, company_id, site_id, business_area_id"),
      session,
    ).order("name"),
    applySessionScope(
      supabase.from("employees").select("id, schedule_id, unit_id, full_name, role_title, company_id, site_id, business_area_id"),
      session,
    ).eq("is_active", true),
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

export async function getCompetenciesSnapshot(month: string, session?: AppSession | null) {
  const supabase = getDataClient();

  if (!supabase) {
    return emptySnapshot(month);
  }

  const [competenciesResult, schedulesResult, employeesResult, employeeCompetenciesResult] = await Promise.all([
    applySessionScope(
      supabase.from("competencies").select("id, code, label, color_token, required_staff, company_id, site_id, business_area_id"),
      session,
    ).order("code"),
    applySessionScope(
      supabase.from("schedules").select("id, name, start_date, day_shift_days, night_shift_days, off_days, company_id, site_id, business_area_id"),
      session,
    ).order("name"),
    applySessionScope(
      supabase
      .from("employees")
      .select("id, schedule_id, unit_id, full_name, role_title, company_id, site_id, business_area_id"),
      session,
    )
      .eq("is_active", true)
      .order("full_name"),
    applySessionScope(
      supabase.from("employee_competencies").select("employee_id, competency_id, company_id, site_id, business_area_id"),
      session,
    ),
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

export async function getTimeCodesSnapshot(month: string, session?: AppSession | null) {
  const supabase = getDataClient();

  if (!supabase) {
    return emptySnapshot(month);
  }

  const timeCodesResult = await applySessionScope(
    supabase
    .from("time_codes")
    .select("id, code, label, color_token, company_id, site_id, business_area_id"),
    session,
  )
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

export async function getOvertimeMonths(currentMonth: string, session?: AppSession | null) {
  const supabase = getDataClient();

  if (!supabase) {
    return [currentMonth];
  }

  const completedSetsResult = await applySessionScope(
    supabase
    .from("completed_sets")
    .select("month_key")
    ,
    session,
  )
    .order("month_key");

  if (completedSetsResult.error) {
    return [currentMonth];
  }

  const candidateMonths = Array.from(
    new Set(
      [
        currentMonth,
        ...(((completedSetsResult.data as Array<{ month_key: string }> | null) ?? []).map((row) => row.month_key)),
      ].filter(Boolean),
    ),
  ).sort();

  const snapshots = await Promise.all(candidateMonths.map((month) => getSchedulerSnapshot(month, session)));
  const monthsWithPostings = candidateMonths.filter((month, index) => monthHasOvertimePostings(snapshots[index]));

  return monthsWithPostings.length > 0
    ? monthsWithPostings
    : [currentMonth];
}

export async function getUserSchedulePins(email: string) {
  const supabase = getSupabaseAdminClient();

  if (!supabase || !email) {
    return {};
  }

  const profileResult = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (profileResult.error || !(profileResult.data as ProfileRow | null)?.id) {
    return {};
  }

  const pinsResult = await supabase
    .from("user_schedule_pins")
    .select("schedule_id, employee_id, sort_order")
    .eq("user_id", (profileResult.data as ProfileRow).id)
    .order("schedule_id")
    .order("sort_order");

  if (pinsResult.error) {
    return {};
  }

  return ((pinsResult.data as UserSchedulePinRow[] | null) ?? []).reduce<Record<string, string[]>>(
    (map, row) => {
      map[row.schedule_id] ??= [];
      map[row.schedule_id].push(row.employee_id);
      return map;
    },
    {},
  );
}

export async function getMutualsSnapshot(month: string, session?: AppSession | null): Promise<MutualsSnapshot> {
  const schedulerSnapshot = await getSchedulerSnapshot(month, session);
  const supabase = getDataClient();

  if (!supabase) {
    return {
      month,
      schedules: schedulerSnapshot.schedules,
      postings: [],
    };
  }

  const { monthStart, monthEnd } = getMonthBounds(month);
  const postingIdsForMonthResult = await applySessionScope(
    supabase
    .from("mutual_shift_posting_dates")
    .select("posting_id, swap_date, shift_kind, company_id, site_id, business_area_id"),
    session,
  )
    .gte("swap_date", monthStart)
    .lte("swap_date", monthEnd)
    .order("swap_date");

  const postingIds = Array.from(
    new Set(
      ((postingIdsForMonthResult.data as MutualShiftPostingDateRow[] | null) ?? []).map((row) => row.posting_id),
    ),
  );

  if (postingIds.length === 0) {
    return {
      month,
      schedules: schedulerSnapshot.schedules,
      postings: [],
    };
  }

  const [postingsResult, applicationsResult] = await Promise.all([
    supabase
      .from("mutual_shift_postings")
      .select("id, owner_employee_id, owner_schedule_id, status, month_key, accepted_application_id, created_at, company_id, site_id, business_area_id")
      .in("id", postingIds)
      .order("created_at"),
    supabase
      .from("mutual_shift_applications")
      .select("id, posting_id, applicant_employee_id, applicant_schedule_id, status, created_at, company_id, site_id, business_area_id")
      .in("posting_id", postingIds)
      .order("created_at"),
  ]);
  const applicationIds = ((applicationsResult.data as MutualShiftApplicationRow[] | null) ?? []).map((row) => row.id);

  const [postingDatesResult, applicationDatesResult] = await Promise.all([
    postingIds.length > 0
      ? supabase
          .from("mutual_shift_posting_dates")
          .select("posting_id, swap_date, shift_kind, company_id, site_id, business_area_id")
          .in("posting_id", postingIds)
          .order("swap_date")
      : Promise.resolve({ data: [], error: null }),
    applicationIds.length > 0
      ? supabase
          .from("mutual_shift_application_dates")
          .select("application_id, swap_date, shift_kind, company_id, site_id, business_area_id")
          .in("application_id", applicationIds)
          .order("swap_date")
      : Promise.resolve({ data: [], error: null }),
  ]);

  const employeeMap = getEmployeeMap(schedulerSnapshot.schedules);
  const scheduleMap = Object.fromEntries(
    schedulerSnapshot.schedules.map((schedule) => [schedule.id, schedule]),
  );

  const postingDatesById = ((postingDatesResult.data as MutualShiftPostingDateRow[] | null) ?? []).reduce<
    Record<string, MutualShiftPostingDateRow[]>
  >((map, row) => {
    map[row.posting_id] ??= [];
    map[row.posting_id].push(row);
    return map;
  }, {});

  const applicationDatesById = ((applicationDatesResult.data as MutualShiftApplicationDateRow[] | null) ?? []).reduce<
    Record<string, MutualShiftApplicationDateRow[]>
  >((map, row) => {
    map[row.application_id] ??= [];
    map[row.application_id].push(row);
    return map;
  }, {});

  const applicationsByPostingId = ((applicationsResult.data as MutualShiftApplicationRow[] | null) ?? []).reduce<
    Record<string, MutualShiftApplication[]>
  >((map, row) => {
    const applicant = employeeMap[row.applicant_employee_id];
    const applicantSchedule = scheduleMap[row.applicant_schedule_id];

    map[row.posting_id] ??= [];
    map[row.posting_id].push({
      id: row.id,
      postingId: row.posting_id,
      applicantEmployeeId: row.applicant_employee_id,
      applicantEmployeeName: applicant?.name ?? "Unknown worker",
      applicantScheduleId: row.applicant_schedule_id,
      applicantScheduleName: applicantSchedule?.name ?? "Unknown shift",
      status: row.status,
      dates: (applicationDatesById[row.id] ?? []).map((entry) => entry.swap_date),
      shiftKinds: (applicationDatesById[row.id] ?? []).map((entry) => entry.shift_kind),
      createdAt: row.created_at,
      companyId: row.company_id,
      siteId: row.site_id,
      businessAreaId: row.business_area_id,
    });
    return map;
  }, {});

  const postings = ((postingsResult.data as MutualShiftPostingRow[] | null) ?? []).map<MutualShiftPosting>((row) => {
    const owner = employeeMap[row.owner_employee_id];
    const ownerSchedule = scheduleMap[row.owner_schedule_id];

    return {
      id: row.id,
      ownerEmployeeId: row.owner_employee_id,
      ownerEmployeeName: owner?.name ?? "Unknown worker",
      ownerScheduleId: row.owner_schedule_id,
      ownerScheduleName: ownerSchedule?.name ?? "Unknown shift",
      status: row.status,
      dates: (postingDatesById[row.id] ?? []).map((entry) => entry.swap_date),
      shiftKinds: (postingDatesById[row.id] ?? []).map((entry) => entry.shift_kind),
      month: row.month_key,
      createdAt: row.created_at,
      acceptedApplicationId: row.accepted_application_id,
      applications: (applicationsByPostingId[row.id] ?? []).sort(
        (left, right) => left.createdAt.localeCompare(right.createdAt),
      ),
      companyId: row.company_id,
      siteId: row.site_id,
      businessAreaId: row.business_area_id,
    };
  });

  return {
    month,
    schedules: schedulerSnapshot.schedules,
    postings,
  };
}
