import { createAssignmentKey, getEmployeeMap, shiftForDate } from "@/lib/scheduling";
import type {
  SchedulerSnapshot,
  StoredAssignment,
  SubSchedule,
  SubScheduleAssignment,
  TimeCode,
} from "@/lib/types";

/**
 * Event-style summary codes such as `CO1` should render and report like real
 * time codes, but planners should not be able to pick them manually on the
 * main schedule unless the code is explicitly marked as dual-use.
 */
export function getManualEntryTimeCodes(timeCodes: TimeCode[]) {
  return timeCodes.filter((timeCode) => timeCode.usageMode !== "projected_only");
}

/**
 * The main schedule never stores sub-schedule summary codes as physical rows.
 * Instead, each sub-schedule assignment is projected back onto the employee's
 * home schedule as a synthetic time-code assignment for display and metrics.
 */
export function buildProjectedSubScheduleAssignments(snapshot: Pick<
  SchedulerSnapshot,
  "schedules" | "subSchedules" | "subScheduleAssignments"
>) {
  const employeeMap = getEmployeeMap(snapshot.schedules);
  const subScheduleMap = snapshot.subSchedules.reduce<Record<string, SubSchedule>>((map, subSchedule) => {
    map[subSchedule.id] = subSchedule;
    return map;
  }, {});

  return snapshot.subScheduleAssignments.flatMap<StoredAssignment>((assignment) => {
    const employee = employeeMap[assignment.employeeId];
    const subSchedule = subScheduleMap[assignment.subScheduleId];
    const homeSchedule = employee
      ? snapshot.schedules.find((schedule) => schedule.id === employee.scheduleId) ?? null
      : null;

    if (!employee || !subSchedule || !homeSchedule) {
      return [];
    }

    return [
      {
        employeeId: assignment.employeeId,
        scheduleId: employee.scheduleId,
        date: assignment.date,
        competencyId: null,
        timeCodeId: subSchedule.summaryTimeCodeId,
        notes: assignment.notes ?? null,
        shiftKind: shiftForDate(homeSchedule, assignment.date),
        companyId: assignment.companyId,
        siteId: assignment.siteId,
        businessAreaId: assignment.businessAreaId,
        sourceType: "sub-schedule",
        subScheduleId: subSchedule.id,
        subScheduleName: subSchedule.name,
        projectedCompetencyId: assignment.competencyId,
      },
    ];
  });
}

/**
 * A sub-schedule takes precedence over normal schedule work for the same
 * employee/date. This helper removes hidden schedule rows so renderers and
 * metrics do not double-count cells that have been superseded by a sub-schedule.
 */
export function filterAssignmentsShadowedBySubSchedules<T extends Pick<StoredAssignment, "employeeId" | "date">>(
  assignments: T[],
  subScheduleAssignments: Pick<SubScheduleAssignment, "employeeId" | "date">[],
) {
  const shadowedDates = new Set(
    subScheduleAssignments.map((assignment) => `${assignment.employeeId}:${assignment.date}`),
  );

  return assignments.filter((assignment) => !shadowedDates.has(`${assignment.employeeId}:${assignment.date}`));
}

/** O(1) lookup keyed the same way as normal schedule cells for projected overlays. */
export function buildProjectedAssignmentIndex(projectedAssignments: StoredAssignment[]) {
  return projectedAssignments.reduce<Record<string, StoredAssignment>>((map, assignment) => {
    map[createAssignmentKey(assignment.scheduleId, assignment.employeeId, assignment.date)] = assignment;
    return map;
  }, {});
}
