import { parseMutualAssignmentNote } from "@/lib/mutuals";
import { getScheduleById, shiftForDate } from "@/lib/scheduling";
import type { Employee, SchedulerSnapshot } from "@/lib/types";

/**
 * The part of a posting these rules read. Narrow on purpose: the overtime board
 * builds a much wider posting shape of its own, and a manual posting row has a
 * different one again, but both answer these two questions.
 */
export type OvertimePostingTarget = {
  competencyId: string | null;
  dates: string[];
};

/**
 * Why an employee cannot work a posting, or `null` when nothing stands in the
 * way.
 *
 * These are the rules that describe the employee: qualification, and whether
 * the dates are already spoken for. They are deliberately separate from the
 * state of the posting itself — whether it is full, whether this person has
 * already claimed it, whether anyone is even selected — because those answer a
 * different question. The claim form needs both; deciding who to tell about a
 * new posting needs only these.
 *
 * Pure and server-safe: the browser's view of eligibility is never trusted, so
 * the same function runs on both sides and the server's answer is the one that
 * counts.
 */
export type OvertimeBlocker =
  | "not-qualified"
  | "mutual-on-date"
  | "assigned-on-date"
  | "sub-schedule-on-date"
  | "regular-shift";

const BLOCKER_REASONS: Record<OvertimeBlocker, string> = {
  "not-qualified": "Employee is not qualified for this post.",
  "mutual-on-date": "Employee has a mutual scheduled on one or more posting dates.",
  "assigned-on-date": "Employee already has an assignment on one or more posting dates.",
  "sub-schedule-on-date": "Employee already has a sub-schedule assignment on one or more posting dates.",
  "regular-shift": "Posting falls on this employee's regular shift.",
};

export function describeOvertimeBlocker(blocker: OvertimeBlocker) {
  return BLOCKER_REASONS[blocker];
}

function hasMutualAssignmentOnDate(snapshot: SchedulerSnapshot, employeeId: string, date: string) {
  return snapshot.assignments.some(
    (assignment) =>
      assignment.employeeId === employeeId &&
      assignment.date === date &&
      Boolean(parseMutualAssignmentNote(assignment.notes).postingId),
  );
}

export function findOvertimeBlocker(
  employee: Employee,
  posting: OvertimePostingTarget,
  snapshot: SchedulerSnapshot,
): OvertimeBlocker | null {
  if (posting.competencyId && !employee.competencyIds.includes(posting.competencyId)) {
    return "not-qualified";
  }

  const employeeSchedule = getScheduleById(snapshot, employee.scheduleId);

  for (const date of posting.dates) {
    if (hasMutualAssignmentOnDate(snapshot, employee.id, date)) {
      return "mutual-on-date";
    }

    const hasExistingAssignment = snapshot.assignments.some(
      (assignment) =>
        assignment.employeeId === employee.id &&
        assignment.date === date &&
        Boolean(assignment.competencyId || assignment.timeCodeId),
    );

    if (hasExistingAssignment) {
      return "assigned-on-date";
    }

    const hasExistingSubScheduleAssignment = snapshot.subScheduleAssignments.some(
      (assignment) =>
        assignment.employeeId === employee.id &&
        assignment.date === date &&
        Boolean(assignment.competencyId || assignment.timeCodeId),
    );

    if (hasExistingSubScheduleAssignment) {
      return "sub-schedule-on-date";
    }

    if (shiftForDate(employeeSchedule, date) !== "OFF") {
      return "regular-shift";
    }
  }

  return null;
}

/**
 * Whether it is worth telling this employee that a posting exists.
 *
 * Only the blocking rules apply. A posting nobody has claimed yet is not full,
 * and an employee cannot have claimed it a moment after it was created, so the
 * posting-state cases never arise here — and none of them describe a reason
 * this person could not work it.
 */
export function canBeNotifiedAboutPosting(
  employee: Employee,
  posting: OvertimePostingTarget,
  snapshot: SchedulerSnapshot,
) {
  return findOvertimeBlocker(employee, posting, snapshot) === null;
}
