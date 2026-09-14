import { createAssignmentKey, shiftForDate } from "@/lib/scheduling";
import type { Schedule, ShiftKind, StoredAssignment, TimeCode } from "@/lib/types";

/**
 * Helpers for encoding overtime-specific schedule rows.
 *
 * Overtime writes are stored in the same `schedule_assignments` table as normal
 * coverage, so the `notes` field carries extra metadata that explains how a
 * claim should be interpreted, restored, or released later on.
 */
export type OvertimeAssignmentRow = {
  employee_id: string;
  schedule_id?: string | null;
  assignment_date: string;
  competency_id: string | null;
  time_code_id: string | null;
  notes: string | null;
  shift_kind: ShiftKind;
  company_id?: string;
  site_id?: string;
  business_area_id?: string;
};

export type ParsedOvertimeNote = {
  claimantEmployeeId: string | null;
  claimedCompetencyId: string | null;
  coverageCompetencyId: string | null;
  swapEmployeeId: string | null;
  originalCompetencyId: string | null;
};

/** Builds a compact metadata note for overtime-created assignment rows. */
export function buildOvertimeAssignmentNote({
  claimantEmployeeId,
  claimedCompetencyId,
  coverageCompetencyId,
  swapEmployeeId,
  originalCompetencyId,
}: {
  claimantEmployeeId: string;
  claimedCompetencyId: string;
  coverageCompetencyId?: string | null;
  swapEmployeeId?: string | null;
  originalCompetencyId?: string | null;
}) {
  const parts = [
    "OT",
    `claimant:${claimantEmployeeId}`,
    `claim:${claimedCompetencyId}`,
  ];

  if (coverageCompetencyId) {
    parts.push(`coverage:${coverageCompetencyId}`);
  }

  if (swapEmployeeId) {
    parts.push(`swap:${swapEmployeeId}`);
  }

  if (originalCompetencyId) {
    parts.push(`orig:${originalCompetencyId}`);
  }

  return parts.join("|");
}

/** Parses an overtime note back into structured metadata for cleanup/restore. */
export function parseOvertimeAssignmentNote(note: string | null | undefined): ParsedOvertimeNote {
  if (!note?.startsWith("OT|")) {
    return {
      claimantEmployeeId: null,
      claimedCompetencyId: null,
      coverageCompetencyId: null,
      swapEmployeeId: null,
      originalCompetencyId: null,
    };
  }

  const values = new Map(
    note
      .split("|")
      .slice(1)
      .map((part) => {
        const [key, value] = part.split(":");
        return [key, value ?? ""];
      }),
  );

  return {
    claimantEmployeeId: values.get("claimant") || null,
    claimedCompetencyId: values.get("claim") || null,
    coverageCompetencyId: values.get("coverage") || null,
    swapEmployeeId: values.get("swap") || null,
    originalCompetencyId: values.get("orig") || null,
  };
}

/**
 * Creates the companion assignment rows for the "swap" half of an overtime
 * claim, moving an on-team employee from their current post onto the originally
 * missing coverage post for the same dates.
 */
export function buildSwapOvertimeAssignmentRows({
  claimantEmployeeId,
  claimedCompetencyId,
  coverageCompetencyId,
  swapEmployeeId,
  dates,
  targetScheduleId,
  shiftKindForDate,
}: {
  claimantEmployeeId: string;
  claimedCompetencyId: string;
  coverageCompetencyId: string;
  swapEmployeeId: string;
  dates: string[];
  targetScheduleId: string;
  shiftKindForDate: (date: string) => ShiftKind;
}) {
  return dates.map<OvertimeAssignmentRow>((date) => ({
    employee_id: swapEmployeeId,
    schedule_id: targetScheduleId,
    assignment_date: date,
    competency_id: coverageCompetencyId,
    time_code_id: null,
    notes: buildOvertimeAssignmentNote({
      claimantEmployeeId,
      claimedCompetencyId,
      coverageCompetencyId,
      swapEmployeeId,
      originalCompetencyId: claimedCompetencyId,
    }),
    shift_kind: shiftKindForDate(date),
  }));
}

/**
 * Overtime is stored once, on the schedule that needed the coverage, so the
 * claimant's own schedule has nothing on that date and falls back to their
 * rotation — reading as OFF while they are actually at work. This synthesises
 * the away day back onto their home schedule for display, the same way
 * `buildProjectedSubScheduleAssignments` projects sub-schedule work.
 *
 * Mutual and loan rows are skipped because those workflows already write their
 * own home-schedule row, and a real home assignment always wins: the projection
 * only fills dates the home schedule left empty.
 *
 * The competency and time code travel in the `projected*` fields and the stored
 * ones stay null. Coverage counting, set completion and autofill all read the
 * stored fields, so an employee who is away can never be counted as filling a
 * post on the crew they are away from.
 */
export function buildAwayOvertimeAssignments({
  schedule,
  awayAssignments,
  homeAssignments,
  scheduleNames,
  timeCodes,
}: {
  schedule: Schedule;
  awayAssignments: StoredAssignment[];
  homeAssignments: StoredAssignment[];
  scheduleNames: Record<string, string>;
  timeCodes: Pick<TimeCode, "id" | "workStatus">[];
}) {
  const nonWorkingTimeCodeIds = new Set(
    timeCodes.filter((timeCode) => timeCode.workStatus === "off").map((timeCode) => timeCode.id),
  );
  const employeeIds = new Set(schedule.employees.map((employee) => employee.id));
  const occupiedHomeKeys = new Set(
    homeAssignments
      .filter((assignment) => assignment.scheduleId === schedule.id)
      .map((assignment) => createAssignmentKey(schedule.id, assignment.employeeId, assignment.date)),
  );
  const projected = new Map<string, StoredAssignment>();

  for (const assignment of awayAssignments) {
    if (assignment.scheduleId === schedule.id || !employeeIds.has(assignment.employeeId)) {
      continue;
    }

    if (assignment.notes?.startsWith("MUT|") || assignment.notes?.startsWith("LOAN|")) {
      continue;
    }

    // Planners keep marking a mover's old grid with days off and leave for
    // weeks after they land on the new crew, and those rows say the opposite of
    // overtime. Work status is what separates them. Guessing the transfer date
    // instead would drop a real overtime day that falls at the very start of
    // the loaded window, before the worker's first row on this crew.
    if (!assignment.competencyId && (!assignment.timeCodeId || nonWorkingTimeCodeIds.has(assignment.timeCodeId))) {
      continue;
    }

    const key = createAssignmentKey(schedule.id, assignment.employeeId, assignment.date);

    if (occupiedHomeKeys.has(key) || projected.has(key)) {
      continue;
    }

    projected.set(key, {
      employeeId: assignment.employeeId,
      scheduleId: schedule.id,
      date: assignment.date,
      competencyId: null,
      timeCodeId: null,
      notes: null,
      shiftKind: shiftForDate(schedule, assignment.date),
      companyId: assignment.companyId,
      siteId: assignment.siteId,
      businessAreaId: assignment.businessAreaId,
      sourceType: "away-overtime",
      projectedCompetencyId: assignment.competencyId,
      projectedTimeCodeId: assignment.timeCodeId,
      awayScheduleId: assignment.scheduleId,
      awayScheduleName: scheduleNames[assignment.scheduleId] ?? null,
    });
  }

  return Array.from(projected.values());
}

/**
 * Who the viewer is acting as on the overtime board.
 *
 * Admins and leaders act as themselves. They can still claim on someone else's
 * behalf, but only by choosing that person, so the board never opens pointed at
 * an unrelated worker who happens to sort first alphabetically. A viewer with
 * no employee record of their own keeps that fallback, since there is nobody
 * else to default to.
 */
export function resolveDefaultClaimingEmployeeId(
  viewer: { role: string; employeeId: string | null },
  employees: Array<{ id: string }>,
): string {
  if (viewer.role === "worker") {
    return viewer.employeeId ?? "";
  }

  if (viewer.employeeId && employees.some((employee) => employee.id === viewer.employeeId)) {
    return viewer.employeeId;
  }

  return employees[0]?.id ?? "";
}
