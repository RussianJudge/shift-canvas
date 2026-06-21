"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

import {
  claimOvertimePosting,
  createManualOvertimePosting,
  deleteManualOvertimePosting,
  releaseOvertimePosting,
} from "@/app/actions";
import { AppDateSelector } from "@/components/app-date-selector";
import { parseMutualAssignmentNote } from "@/lib/mutuals";
import { parseOvertimeAssignmentNote } from "@/lib/overtime";
import {
  buildAssignmentIndex,
  createAssignmentKey,
  createSetRangeKey,
  createSetRangeKeyFromEntry,
  formatMonthLabel,
  getCurrentMonthKey,
  getEmployeeMap,
  getExtendedMonthDays,
  getMonthDays,
  getScheduleById,
  getWorkedSetDays,
  needsNightBeforeFirstDayShiftConfirmation,
  shiftMonthKey,
  shiftForDate,
} from "@/lib/scheduling";
import type { AppSession, Employee, OvertimeClaim, SchedulerSnapshot, ShiftKind } from "@/lib/types";

type OvertimeTargetMode = "main" | "sub";
type OvertimeTargetKey = "all" | "main" | `sub:${string}`;
type OvertimeAvailabilityFilter = "all" | "available";
type ClaimActionState = Record<string, "claim" | "release">;
type OptimisticClaimOverride = {
  action: "claim" | "release";
  employeeId: string;
  employeeName: string;
};

const CLAIM_ACTION_TIMEOUT_MS = 25000;

function CreatePostingIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
      <path d="M6.5 4.5h11A2.5 2.5 0 0 1 20 7v10a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17V7a2.5 2.5 0 0 1 2.5-2.5Z" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 12a4 4 0 1 0 0-8a4 4 0 0 0 0 8Z" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3.5v3M17 3.5v3" />
      <path d="M4.5 8.5h15" />
      <path d="M6.5 5h11A2.5 2.5 0 0 1 20 7.5v10A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5v-10A2.5 2.5 0 0 1 6.5 5Z" />
      <path d="M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01" />
    </svg>
  );
}

/**
 * Overtime board for packaging claimable work into one operational queue.
 *
 * Postings come from two sources:
 * - auto-derived shortages on completed sets
 * - leader/admin-authored manual postings
 *
 * Each posting can either represent:
 * - a direct claim for the missing competency, or
 * - a swap path where the claimant takes one post and an on-team worker slides
 *   into the originally missing post.
 */
type OvertimePosting = {
  id: string;
  source: "auto" | "manual";
  targetMode: OvertimeTargetMode;
  scheduleId: string | null;
  subScheduleId: string | null;
  scheduleName: string;
  shiftKind: Exclude<ShiftKind, "OFF">;
  competencyId: string | null;
  timeCodeId: string | null;
  assignmentKey: string;
  slotCount: number;
  competencyCode: string;
  competencyLabel: string;
  coverageCompetencyId: string | null;
  coverageCompetencyCode: string;
  coverageCompetencyLabel: string;
  colorToken: string;
  dates: string[];
  staffedPeople: number;
  requiredStaff: number;
  openShifts: number;
  manualPostingId: string | null;
  claimedEmployeeId: string | null;
  claimedByName: string | null;
  claimedEmployeeIds: string[];
  claimedByNames: string[];
  swapEmployeeId: string | null;
  swapEmployeeName: string | null;
};

type AssignmentMeta = {
  claimantEmployeeId: string | null;
  claimedCompetencyId: string | null;
  coverageCompetencyId: string | null;
  swapEmployeeId: string | null;
  originalCompetencyId: string | null;
};

/** Parses overtime note metadata off assignment rows for claimed postings. */
function parseAssignmentMeta(note: string | null | undefined): AssignmentMeta {
  return parseOvertimeAssignmentNote(note);
}

function safePostingText(value: string, fallback: string) {
  return value.startsWith("OT|") ? fallback : value;
}

async function withClaimTimeout<T>(promise: Promise<T>) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error("The overtime request is taking longer than expected."));
        }, CLAIM_ACTION_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function sanitizePostingLabels(
  posting: OvertimePosting,
  competencyMap: Record<string, { code: string; label: string }>,
  timeCodeMap: Record<string, { code: string; label: string }>,
): OvertimePosting {
  const claimedAssignment = posting.competencyId
    ? competencyMap[posting.competencyId]
    : posting.timeCodeId
      ? timeCodeMap[posting.timeCodeId]
      : null;
  const coverageAssignment = posting.coverageCompetencyId
    ? competencyMap[posting.coverageCompetencyId]
    : posting.timeCodeId
      ? timeCodeMap[posting.timeCodeId]
      : null;

  return {
    ...posting,
    competencyCode: safePostingText(posting.competencyCode, claimedAssignment?.code ?? "Overtime"),
    competencyLabel: safePostingText(posting.competencyLabel, claimedAssignment?.label ?? "Overtime"),
    coverageCompetencyCode: safePostingText(
      posting.coverageCompetencyCode,
      coverageAssignment?.code ?? claimedAssignment?.code ?? "Overtime",
    ),
    coverageCompetencyLabel: safePostingText(
      posting.coverageCompetencyLabel,
      coverageAssignment?.label ?? claimedAssignment?.label ?? "Overtime",
    ),
  };
}

function applyOptimisticClaimOverride(
  posting: OvertimePosting,
  override: OptimisticClaimOverride | undefined,
): OvertimePosting {
  if (!override) {
    return posting;
  }

  const claimShiftCount = posting.dates.length;

  if (override.action === "claim") {
    if (posting.claimedEmployeeIds.includes(override.employeeId)) {
      return posting;
    }

    const claimedEmployeeIds = [...posting.claimedEmployeeIds, override.employeeId];
    const claimedByNames = [...posting.claimedByNames, override.employeeName];

    return {
      ...posting,
      openShifts: Math.max(0, posting.openShifts - claimShiftCount),
      claimedEmployeeId: posting.claimedEmployeeId ?? override.employeeId,
      claimedByName: posting.claimedByName ?? override.employeeName,
      claimedEmployeeIds,
      claimedByNames,
    };
  }

  if (!posting.claimedEmployeeIds.includes(override.employeeId)) {
    return posting;
  }

  const retainedClaims = posting.claimedEmployeeIds.reduce<Array<{ employeeId: string; name: string }>>(
    (claims, employeeId, index) => {
      if (employeeId !== override.employeeId) {
        claims.push({
          employeeId,
          name: posting.claimedByNames[index] ?? "Unknown worker",
        });
      }

      return claims;
    },
    [],
  );
  const claimedEmployeeIds = retainedClaims.map((claim) => claim.employeeId);
  const claimedByNames = retainedClaims.map((claim) => claim.name);

  return {
    ...posting,
    openShifts: posting.openShifts + claimShiftCount,
    claimedEmployeeId: claimedEmployeeIds[0] ?? null,
    claimedByName: claimedByNames[0] ?? null,
    claimedEmployeeIds,
    claimedByNames,
  };
}

function formatShortDate(isoDate: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

function formatStaffCount(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function getShiftLabel(shiftKind: Exclude<ShiftKind, "OFF">, count: number) {
  return `${count} ${shiftKind === "DAY" ? "day" : "night"} shift${count === 1 ? "" : "s"}`;
}

function getShiftBadgeLabel(shiftKind: Exclude<ShiftKind, "OFF">) {
  return shiftKind === "DAY" ? "D" : "N";
}

function buildOvertimeAssignmentKey(competencyId: string | null, timeCodeId: string | null) {
  if (competencyId) {
    return `comp:${competencyId}`;
  }

  if (timeCodeId) {
    return `time:${timeCodeId}`;
  }

  return "";
}

/** Groups a schedule's month into worked sets and their day/night segments. */
function getWorkedSets(
  schedule: SchedulerSnapshot["schedules"][number],
  monthDays: Array<{ date: string }>,
  extendedMonthDays: Array<{ date: string }>,
) {
  const sets: Array<{
    dates: string[];
    segments: Array<{ shiftKind: Exclude<ShiftKind, "OFF">; dates: string[] }>;
  }> = [];
  const processedKeys = new Set<string>();

  for (const day of monthDays) {
    if (shiftForDate(schedule, day.date) === "OFF") {
      continue;
    }

    const setDays = getWorkedSetDays(schedule, extendedMonthDays, day.date);

    if (setDays.length === 0) {
      continue;
    }

    const setKey = `${setDays[0].date}:${setDays[setDays.length - 1].date}`;

    if (processedKeys.has(setKey)) {
      continue;
    }

    processedKeys.add(setKey);

    const segments = setDays.reduce<Array<{ shiftKind: Exclude<ShiftKind, "OFF">; dates: string[] }>>(
      (currentSegments, setDay) => {
        const shiftKind = shiftForDate(schedule, setDay.date);

        if (shiftKind === "OFF") {
          return currentSegments;
        }

        const currentSegment = currentSegments[currentSegments.length - 1];

        if (!currentSegment || currentSegment.shiftKind !== shiftKind) {
          currentSegments.push({
            shiftKind,
            dates: [setDay.date],
          });
          return currentSegments;
        }

        currentSegment.dates.push(setDay.date);
        return currentSegments;
      },
      [],
    );

    sets.push({
      dates: setDays.map((setDay) => setDay.date),
      segments,
    });
  }

  return sets;
}

function getCellSelection(
  employee: Employee,
  scheduleId: string,
  date: string,
  assignments: Record<string, { competencyId: string | null; timeCodeId: string | null }>,
) {
  return assignments[createAssignmentKey(scheduleId, employee.id, date)] ?? {
    competencyId: null,
    timeCodeId: null,
  };
}

function hasMutualAssignmentOnDate(snapshot: SchedulerSnapshot, employeeId: string, date: string) {
  return snapshot.assignments.some(
    (assignment) =>
      assignment.employeeId === employeeId &&
      assignment.date === date &&
      Boolean(parseMutualAssignmentNote(assignment.notes).postingId),
  );
}

function countScheduleAssignmentsForTarget({
  assignments,
  scheduleId,
  date,
  competencyId,
  timeCodeId = null,
}: {
  assignments: SchedulerSnapshot["assignments"];
  scheduleId: string;
  date: string;
  competencyId: string | null;
  timeCodeId?: string | null;
}) {
  return assignments.reduce(
    (count, assignment) =>
      count +
      Number(
        assignment.scheduleId === scheduleId &&
          assignment.date === date &&
          ((competencyId && assignment.competencyId === competencyId) ||
            (timeCodeId && assignment.timeCodeId === timeCodeId)),
      ),
    0,
  );
}

function buildInitialTargetKey(snapshot: SchedulerSnapshot): OvertimeTargetKey | "" {
  if (snapshot.schedules.length > 0 || snapshot.subSchedules.length > 0) {
    return "all";
  }

  if (snapshot.schedules.length > 0) {
    return "main";
  }

  return "";
}

function getClaimStatus(
  employee: Employee | null,
  posting: OvertimePosting,
  snapshot: SchedulerSnapshot,
  assignments: Record<string, { competencyId: string | null; timeCodeId: string | null }>,
) {
  // Workers can only claim OT that sits on their scheduled days off and does not
  // conflict with any existing assignment already on the calendar.
  if (!employee) {
    return { canClaim: false, reason: "Select an employee first." };
  }

  if (posting.claimedEmployeeIds.includes(employee.id)) {
    return { canClaim: true, reason: "You already claimed this posting." };
  }

  if (posting.openShifts === 0) {
    return { canClaim: false, reason: "This posting is fully claimed." };
  }

  if (posting.competencyId && !employee.competencyIds.includes(posting.competencyId)) {
    return { canClaim: false, reason: "Employee is not qualified for this post." };
  }

  const employeeSchedule = getScheduleById(snapshot, employee.scheduleId);

  for (const date of posting.dates) {
    if (hasMutualAssignmentOnDate(snapshot, employee.id, date)) {
      return { canClaim: false, reason: "Employee has a mutual scheduled on one or more posting dates." };
    }

    const hasExistingAssignment = snapshot.assignments.some(
      (assignment) =>
        assignment.employeeId === employee.id &&
        assignment.date === date &&
        Boolean(assignment.competencyId || assignment.timeCodeId),
    );

    if (hasExistingAssignment) {
      return { canClaim: false, reason: "Employee already has an assignment on one or more posting dates." };
    }

    const hasExistingSubScheduleAssignment = snapshot.subScheduleAssignments.some(
      (assignment) =>
        assignment.employeeId === employee.id &&
        assignment.date === date &&
        Boolean(assignment.competencyId || assignment.timeCodeId),
    );

    if (hasExistingSubScheduleAssignment) {
      return { canClaim: false, reason: "Employee already has a sub-schedule assignment on one or more posting dates." };
    }

    if (shiftForDate(employeeSchedule, date) !== "OFF") {
      return { canClaim: false, reason: "Posting falls on this employee's regular shift." };
    }
  }

  return { canClaim: true, reason: "Available to claim." };
}

function needsTurnaroundConfirmation(employee: Employee | null, posting: OvertimePosting, snapshot: SchedulerSnapshot) {
  if (!employee) {
    return false;
  }

  return needsNightBeforeFirstDayShiftConfirmation(
    employee,
    getScheduleById(snapshot, employee.scheduleId),
    snapshot,
    posting.dates,
    posting.shiftKind,
  );
}

function isDirectOvertimeOption(posting: OvertimePosting) {
  return (
    !posting.competencyId ||
    !posting.coverageCompetencyId ||
    posting.competencyId === posting.coverageCompetencyId
  );
}

function getVisiblePostingsForEmployee(postings: OvertimePosting[], employee: Employee | null) {
  if (!employee) {
    return postings;
  }

  const hasDirectCompetencyMatch = postings.some(
    (posting) =>
      isDirectOvertimeOption(posting) &&
      posting.competencyId &&
      employee.competencyIds.includes(posting.competencyId),
  );

  return hasDirectCompetencyMatch ? postings.filter(isDirectOvertimeOption) : postings;
}

function OvertimeEligibilityReportModal({
  posting,
  eligibleEmployees,
  onClose,
}: {
  posting: OvertimePosting;
  eligibleEmployees: Array<{ id: string; name: string; scheduleName: string }>;
  onClose: () => void;
}) {
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="assignment-modal-backdrop" onClick={onClose}>
      <section className="assignment-modal overtime-eligibility-modal" onClick={(event) => event.stopPropagation()}>
        <div className="assignment-modal__header">
          <div>
            <h2 className="assignment-modal__title">Eligible employees</h2>
            <p className="assignment-modal__context">
              Employees currently eligible to claim this overtime posting.
            </p>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="overtime-eligibility-modal__summary">
          <div className="overtime-eligibility-modal__summary-row">
            <span className="assignment-modal__label">Schedule</span>
            <strong>
              {posting.targetMode === "main" ? `Main schedule · Shift ${posting.scheduleName}` : posting.scheduleName}
            </strong>
          </div>
          <div className="overtime-eligibility-modal__summary-row">
            <span className="assignment-modal__label">Assignment</span>
            <strong>
              {posting.competencyCode} · {posting.competencyLabel}
            </strong>
          </div>
          <div className="overtime-eligibility-modal__summary-row">
            <span className="assignment-modal__label">Dates</span>
            <strong>
              {formatShortDate(posting.dates[0])} - {formatShortDate(posting.dates[posting.dates.length - 1])}
            </strong>
          </div>
          <div className="overtime-eligibility-modal__summary-row">
            <span className="assignment-modal__label">Shift count</span>
            <strong>{getShiftLabel(posting.shiftKind, posting.dates.length)}</strong>
          </div>
          <div className="overtime-eligibility-modal__summary-row">
            <span className="assignment-modal__label">Open slots</span>
            <strong>
              {posting.openShifts} open shift{posting.openShifts === 1 ? "" : "s"}
            </strong>
          </div>
        </div>

        {eligibleEmployees.length > 0 ? (
          <div className="overtime-eligibility-modal__list">
            {eligibleEmployees.map((employee) => (
              <div key={employee.id} className="overtime-eligibility-modal__row">
                <strong>{employee.name}</strong>
                <span>Shift {employee.scheduleName}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <strong>No eligible employees.</strong>
            <span>No employees currently meet the claim requirements for this posting.</span>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}

function NightShiftTurnaroundModal({
  employeeName,
  posting,
  onCancel,
  onConfirm,
  isSubmitting,
}: {
  employeeName: string;
  posting: OvertimePosting;
  onCancel: () => void;
  onConfirm: () => void;
  isSubmitting: boolean;
}) {
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="assignment-modal-backdrop" onClick={onCancel}>
      <section className="assignment-modal mutual-modal" onClick={(event) => event.stopPropagation()}>
        <div className="assignment-modal__header">
          <div>
            <h2 className="assignment-modal__title">Confirm modified schedule</h2>
            <p className="assignment-modal__context">
              {employeeName} is assigned to a night shift immediately before the first overtime day shift on{" "}
              {formatShortDate(posting.dates[0])}.
            </p>
          </div>
        </div>

        <div className="empty-state">
          <strong>Confirm before claiming</strong>
          <span>
            They must be on a modified schedule and able to work this first overtime shift before the claim is saved.
          </span>
        </div>

        <div className="assignment-modal__footer">
          <button type="button" className="ghost-button" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={onConfirm} disabled={isSubmitting}>
            {isSubmitting ? "Claiming..." : "Confirm and claim"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function DeleteOvertimePostingModal({
  posting,
  onCancel,
  onConfirm,
  isSubmitting,
}: {
  posting: OvertimePosting;
  onCancel: () => void;
  onConfirm: () => void;
  isSubmitting: boolean;
}) {
  if (typeof document === "undefined") {
    return null;
  }

  const claimCount = posting.claimedEmployeeIds.length;

  return createPortal(
    <div className="assignment-modal-backdrop" onClick={onCancel}>
      <section className="assignment-modal mutual-modal" onClick={(event) => event.stopPropagation()}>
        <div className="assignment-modal__header">
          <div>
            <h2 className="assignment-modal__title">Delete overtime posting?</h2>
            <p className="assignment-modal__context">
              {claimCount > 0
                ? `Delete this posting and release ${claimCount} claim${claimCount === 1 ? "" : "s"}? This will remove the posting and clear the related overtime assignments.`
                : "Delete this posting? This will remove it from the overtime board."}
            </p>
          </div>
          <button type="button" className="ghost-button" onClick={onCancel} disabled={isSubmitting}>
            Close
          </button>
        </div>

        <div className="overtime-eligibility-modal__summary">
          <div className="overtime-eligibility-modal__summary-row">
            <span className="assignment-modal__label">Schedule</span>
            <strong>
              {posting.targetMode === "main" ? `Main schedule · Shift ${posting.scheduleName}` : posting.scheduleName}
            </strong>
          </div>
          <div className="overtime-eligibility-modal__summary-row">
            <span className="assignment-modal__label">Assignment</span>
            <strong>
              {posting.competencyCode} · {posting.competencyLabel}
            </strong>
          </div>
          <div className="overtime-eligibility-modal__summary-row">
            <span className="assignment-modal__label">Dates</span>
            <strong>
              {formatShortDate(posting.dates[0])} - {formatShortDate(posting.dates[posting.dates.length - 1])}
            </strong>
          </div>
          <div className="overtime-eligibility-modal__summary-row">
            <span className="assignment-modal__label">Claims</span>
            <strong>
              {claimCount > 0 ? posting.claimedByNames.join(", ") : "No claims"}
            </strong>
          </div>
        </div>

        <div className="assignment-modal__footer">
          <button type="button" className="ghost-button" onClick={onCancel} disabled={isSubmitting}>
            Keep posting
          </button>
          <button type="button" className="primary-button" onClick={onConfirm} disabled={isSubmitting}>
            {isSubmitting ? "Deleting..." : "Delete posting"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

type MyOvertimeClaimRow = {
  id: string;
  scheduleId: string | null;
  subScheduleId: string | null;
  employeeId: string;
  competencyId: string | null;
  timeCodeId: string | null;
  date: string;
  targetLabel: string;
  assignmentLabel: string;
};

type OvertimeCalendarPosting = {
  id: string;
  source: OvertimePosting["source"];
  targetMode: OvertimePosting["targetMode"];
  scheduleName: string;
  shiftKind: OvertimePosting["shiftKind"];
  competencyCode: string;
  colorToken: string;
  dates: string[];
  openShifts: number;
};

function MyOvertimeClaimsModal({
  claims,
  employeeName,
  onClose,
  onRelease,
  releasingClaimId,
}: {
  claims: MyOvertimeClaimRow[];
  employeeName: string;
  onClose: () => void;
  onRelease: (claim: MyOvertimeClaimRow) => void;
  releasingClaimId: string | null;
}) {
  return createPortal(
    <div className="assignment-modal-backdrop" onClick={onClose}>
      <section
        className="assignment-modal overtime-my-claims-modal"
        aria-label="My overtime claims"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="assignment-modal__header">
          <div>
            <span className="assignment-modal__eyebrow">Overtime</span>
            <h2 className="assignment-modal__title">My claims</h2>
            <p className="assignment-modal__context">Future overtime claims for {employeeName} after today.</p>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
        </div>

        {claims.length > 0 ? (
          <div className="overtime-my-claims-modal__list">
            {claims.map((claim) => (
              <div key={claim.id} className="overtime-my-claims-modal__row">
                <div>
                  <strong>{formatShortDate(claim.date)}</strong>
                  <span>{claim.targetLabel}</span>
                </div>
                <div className="overtime-my-claims-modal__actions">
                  <span className="legend-pill legend-pill--slate">{claim.assignmentLabel}</span>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => onRelease(claim)}
                    disabled={releasingClaimId === claim.id}
                  >
                    {releasingClaimId === claim.id ? "Releasing..." : "Release"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <strong>No future claims.</strong>
            <span>You do not have any overtime claims after today.</span>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}

function OvertimeCalendarModal({
  monthLabel,
  monthDays,
  postings,
  onClose,
}: {
  monthLabel: string;
  monthDays: ReturnType<typeof getMonthDays>;
  postings: OvertimeCalendarPosting[];
  onClose: () => void;
}) {
  if (typeof document === "undefined") {
    return null;
  }

  const postingsByDate = new Map<string, OvertimeCalendarPosting[]>();

  for (const posting of postings) {
    for (const date of posting.dates) {
      if (!postingsByDate.has(date)) {
        postingsByDate.set(date, []);
      }

      postingsByDate.get(date)!.push(posting);
    }
  }

  for (const datePostings of postingsByDate.values()) {
    datePostings.sort(
      (left, right) =>
        left.scheduleName.localeCompare(right.scheduleName) ||
        left.shiftKind.localeCompare(right.shiftKind) ||
        left.competencyCode.localeCompare(right.competencyCode),
    );
  }

  const firstWeekday = monthDays[0]
    ? new Date(`${monthDays[0].date}T00:00:00Z`).getUTCDay()
    : 0;
  const calendarCells: Array<(typeof monthDays)[number] | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...monthDays,
  ];

  while (calendarCells.length % 7 !== 0) {
    calendarCells.push(null);
  }

  return createPortal(
    <div className="assignment-modal-backdrop" onClick={onClose}>
      <section
        className="assignment-modal overtime-calendar-modal"
        aria-label="Overtime calendar"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="assignment-modal__header">
          <div>
            <span className="assignment-modal__eyebrow">Overtime</span>
            <h2 className="assignment-modal__title">Calendar</h2>
            <p className="assignment-modal__context">
              {monthLabel} postings using the current filters.
            </p>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="overtime-calendar-modal__scroll">
          <div className="overtime-calendar-grid">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((weekday) => (
              <div key={weekday} className="overtime-calendar-weekday">
                {weekday}
              </div>
            ))}
            {calendarCells.map((day, index) => {
              const dayPostings = day ? postingsByDate.get(day.date) ?? [] : [];

              return (
                <div
                  key={day?.date ?? `blank-${index}`}
                  className={`overtime-calendar-day ${day ? "" : "overtime-calendar-day--empty"}`}
                >
                  {day ? (
                    <>
                      <div className="overtime-calendar-day__number">{day.dayNumber}</div>
                      <div className="overtime-calendar-day__postings">
                        {dayPostings.map((posting) => (
                          <div
                            key={`${posting.id}:${day.date}`}
                            className={`overtime-calendar-shift-pill legend-pill legend-pill--${posting.colorToken.toLowerCase()}`}
                            title={`${posting.scheduleName} · ${getShiftBadgeLabel(posting.shiftKind)} · ${posting.competencyCode} · ${posting.openShifts} open`}
                          >
                            <span>{posting.competencyCode}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {postings.length === 0 ? (
          <div className="empty-state">
            <strong>No postings to show.</strong>
            <span>Try changing the overtime filters or showing all postings.</span>
          </div>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}

function getTodayDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Edmonton",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Modal used by leaders/admins to author a manual overtime posting. */
function ManualOvertimePostingModal({
  snapshot,
  availableMonths,
  selectedMonth,
  selectedTargetKey,
  selectedMainScheduleId,
  selectedAssignmentKey,
  selectedSlotCount,
  selectedDates,
  onMonthChange,
  onTargetChange,
  onMainScheduleChange,
  onAssignmentChange,
  onSlotCountChange,
  onToggleDate,
  onClose,
  onSubmit,
  isSubmitting,
}: {
  snapshot: SchedulerSnapshot;
  availableMonths: string[];
  selectedMonth: string;
  selectedTargetKey: OvertimeTargetKey | "";
  selectedMainScheduleId: string;
  selectedAssignmentKey: string;
  selectedSlotCount: number;
  selectedDates: string[];
  onMonthChange: (month: string) => void;
  onTargetChange: (targetKey: OvertimeTargetKey) => void;
  onMainScheduleChange: (scheduleId: string) => void;
  onAssignmentChange: (assignmentKey: string) => void;
  onSlotCountChange: (slotCount: number) => void;
  onToggleDate: (date: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}) {
  if (typeof document === "undefined") {
    return null;
  }

  const selectedSchedule =
    selectedTargetKey === "main"
      ? snapshot.schedules.find((schedule) => schedule.id === selectedMainScheduleId) ?? snapshot.schedules[0] ?? null
      : null;
  const selectedSubSchedule =
    selectedTargetKey.startsWith("sub:")
      ? snapshot.subSchedules.find((subSchedule) => subSchedule.id === selectedTargetKey.slice("sub:".length)) ?? null
      : null;
  const targetMode: OvertimeTargetMode = selectedSubSchedule ? "sub" : "main";
  const availableSubSchedules = snapshot.subSchedules.filter((subSchedule) => !subSchedule.isArchived);
  const availableAssignments =
    targetMode === "main"
      ? [
          ...snapshot.competencies
            .filter((competency) => selectedSchedule?.competencyIds.includes(competency.id))
            .map((competency) => ({
              key: buildOvertimeAssignmentKey(competency.id, null),
              code: competency.code,
              label: competency.label,
            })),
          ...snapshot.timeCodes
            .filter((timeCode) => timeCode.usageMode !== "projected_only")
            .map((timeCode) => ({
              key: buildOvertimeAssignmentKey(null, timeCode.id),
              code: timeCode.code,
              label: timeCode.label,
            })),
        ]
      : [
          ...snapshot.competencies
            .filter((competency) => selectedSubSchedule?.competencyIds.includes(competency.id))
            .map((competency) => ({
              key: buildOvertimeAssignmentKey(competency.id, null),
              code: competency.code,
              label: competency.label,
            })),
          ...snapshot.timeCodes
            .filter((timeCode) => timeCode.usageMode !== "projected_only")
            .map((timeCode) => ({
              key: buildOvertimeAssignmentKey(null, timeCode.id),
              code: timeCode.code,
              label: timeCode.label,
            })),
        ];
  const todayKey = useMemo(() => getTodayDateKey(), []);
  const availableDates = selectedSchedule
    ? getMonthDays(selectedMonth)
        .map((day) => ({
          date: day.date,
          shiftKind: shiftForDate(selectedSchedule, day.date),
        }))
        .filter(
          (entry): entry is { date: string; shiftKind: Exclude<ShiftKind, "OFF"> } => entry.shiftKind !== "OFF",
        )
        .filter((entry) => entry.date >= todayKey)
    : [];

  return createPortal(
    <div className="assignment-modal-backdrop" onClick={onClose}>
      <section className="assignment-modal mutual-modal" onClick={(event) => event.stopPropagation()}>
        <div className="assignment-modal__header">
          <div>
            <h2 className="assignment-modal__title">Create Manual Overtime Posting</h2>
            <p className="assignment-modal__context">
              {targetMode === "main"
                ? "Pick one team, one competency, and dates from the same shift segment. The posting will stay on the board until it is claimed or deleted."
                : "Pick one sub-schedule, one allowed competency, and dates. The posting will stay on the board until it is claimed or deleted."}
            </p>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="metrics-transfer-grid">
          <label className="field">
            <span>Month</span>
            <select value={selectedMonth} onChange={(event) => onMonthChange(event.target.value)}>
              {availableMonths.map((month) => (
                <option key={month} value={month}>
                  {formatMonthLabel(month)}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Schedule</span>
            <select value={selectedTargetKey} onChange={(event) => onTargetChange(event.target.value as OvertimeTargetKey)}>
              {snapshot.schedules.length > 0 ? <option value="main">Main schedule</option> : null}
              <optgroup label="Sub-schedules">
                {availableSubSchedules.map((subSchedule) => (
                  <option key={`sub:${subSchedule.id}`} value={`sub:${subSchedule.id}`}>
                    {subSchedule.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>

          {targetMode === "main" ? (
            <label className="field">
              <span>Team</span>
              <select value={selectedMainScheduleId} onChange={(event) => onMainScheduleChange(event.target.value)}>
                {snapshot.schedules.map((schedule) => (
                  <option key={schedule.id} value={schedule.id}>
                    Shift {schedule.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="field">
            <span>Assignment</span>
            <select value={selectedAssignmentKey} onChange={(event) => onAssignmentChange(event.target.value)}>
              {availableAssignments.map((assignment) => (
                <option key={assignment.key} value={assignment.key}>
                  {assignment.code} · {assignment.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Openings</span>
            <input
              type="number"
              min={1}
              step={1}
              value={selectedSlotCount}
              onChange={(event) => onSlotCountChange(Math.max(1, Number(event.target.value || 1)))}
            />
          </label>
        </div>

        <div className="mutual-picker">
          <div className="mutual-picker__header">
            <strong>Posting dates</strong>
            <span>{selectedDates.length} selected</span>
          </div>
          {targetMode === "main" ? (
            <div className="mutual-picker__grid">
              {availableDates.map((entry) => {
                const isSelected = selectedDates.includes(entry.date);

                return (
                  <button
                    key={entry.date}
                    type="button"
                    className={`mutual-date-pill ${isSelected ? "mutual-date-pill--selected" : ""}`}
                    onClick={() => onToggleDate(entry.date)}
                  >
                    <strong>{formatShortDate(entry.date)}</strong>
                    <span>{getShiftBadgeLabel(entry.shiftKind)}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mutual-picker__grid">
              {getMonthDays(selectedMonth)
                .filter((entry) => entry.date >= todayKey)
                .map((entry) => {
                const isSelected = selectedDates.includes(entry.date);

                return (
                  <button
                    key={entry.date}
                    type="button"
                    className={`mutual-date-pill ${isSelected ? "mutual-date-pill--selected" : ""}`}
                    onClick={() => onToggleDate(entry.date)}
                  >
                    <strong>{formatShortDate(entry.date)}</strong>
                    <span>SUB</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="metrics-transfer-actions">
          <button type="button" className="primary-button" onClick={onSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create posting"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export function OvertimePanel({
  snapshot,
  availableMonths,
  viewer,
  futureOvertimeClaims,
}: {
  snapshot: SchedulerSnapshot;
  availableMonths: string[];
  viewer: AppSession;
  futureOvertimeClaims: OvertimeClaim[];
}) {
  // The board is built from snapshot state only; claiming/releasing triggers a
  // server refresh instead of trying to locally simulate every OT side effect.
  const router = useRouter();
  const [claimingEmployeeId, setClaimingEmployeeId] = useState(
    viewer.role === "worker"
      ? viewer.employeeId ?? ""
      : snapshot.schedules.flatMap((schedule) => schedule.employees).sort((left, right) => left.name.localeCompare(right.name))[0]?.id ?? "",
  );
  const [selectedTargetKey, setSelectedTargetKey] = useState<OvertimeTargetKey | "">(buildInitialTargetKey(snapshot));
  const [selectedAssignmentFilter, setSelectedAssignmentFilter] = useState("all");
  const [availabilityFilter, setAvailabilityFilter] = useState<OvertimeAvailabilityFilter>("available");
  const [selectedPostingByGroup, setSelectedPostingByGroup] = useState<Record<string, string>>({});
  const [statusMessage, setStatusMessage] = useState("");
  const [claimActionState, setClaimActionState] = useState<ClaimActionState>({});
  const [optimisticClaimOverrides, setOptimisticClaimOverrides] = useState<Record<string, OptimisticClaimOverride>>({});
  const [releasingClaimId, setReleasingClaimId] = useState<string | null>(null);
  const [optimisticallyReleasedClaimIds, setOptimisticallyReleasedClaimIds] = useState<string[]>([]);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [isMyClaimsModalOpen, setIsMyClaimsModalOpen] = useState(false);
  const [isCalendarModalOpen, setIsCalendarModalOpen] = useState(false);
  const [eligibilityReportPostingId, setEligibilityReportPostingId] = useState<string | null>(null);
  const [turnaroundConfirmationPostingId, setTurnaroundConfirmationPostingId] = useState<string | null>(null);
  const [deletePostingId, setDeletePostingId] = useState<string | null>(null);
  const currentPostingMonth = useMemo(() => getCurrentMonthKey("America/Edmonton"), []);
  const manualAvailableMonths = useMemo(
    () => Array.from({ length: 13 }, (_, index) => shiftMonthKey(currentPostingMonth, index)),
    [currentPostingMonth],
  );
  const [manualTargetKey, setManualTargetKey] = useState<OvertimeTargetKey | "">(
    snapshot.schedules.length > 0
      ? "main"
      : snapshot.subSchedules.find((subSchedule) => !subSchedule.isArchived)?.id
        ? (`sub:${snapshot.subSchedules.find((subSchedule) => !subSchedule.isArchived)!.id}` as const)
        : snapshot.subSchedules[0]?.id
          ? (`sub:${snapshot.subSchedules[0].id}` as const)
          : "",
  );
  const [manualPostingMonth, setManualPostingMonth] = useState(
    manualAvailableMonths.includes(snapshot.month) ? snapshot.month : manualAvailableMonths[0] ?? snapshot.month,
  );
  const [manualMainScheduleId, setManualMainScheduleId] = useState(snapshot.schedules[0]?.id ?? "");
  const [manualAssignmentKey, setManualAssignmentKey] = useState(
    buildOvertimeAssignmentKey(snapshot.competencies[0]?.id ?? null, null),
  );
  const [manualSlotCount, setManualSlotCount] = useState(1);
  const [manualPostingDates, setManualPostingDates] = useState<string[]>([]);
  const [isManagingManual, startManualTransition] = useTransition();
  const [, startRouteRefreshTransition] = useTransition();
  const canManageManualPostings = viewer.role !== "worker";

  const employeeMap = useMemo(() => getEmployeeMap(snapshot.schedules), [snapshot.schedules]);
  const assignmentIndex = useMemo(() => buildAssignmentIndex(snapshot.assignments), [snapshot.assignments]);
  const assignmentMetaIndex = useMemo(
    () =>
      snapshot.assignments.reduce<Record<string, AssignmentMeta>>((map, assignment) => {
        map[createAssignmentKey(assignment.scheduleId, assignment.employeeId, assignment.date)] = parseAssignmentMeta(
          assignment.notes,
        );
        return map;
      }, {}),
    [snapshot.assignments],
  );
  const monthDays = useMemo(() => getMonthDays(snapshot.month), [snapshot.month]);
  const extendedMonthDays = useMemo(() => getExtendedMonthDays(snapshot.month), [snapshot.month]);
  const completedSetRangeKeys = useMemo(
    () => new Set(snapshot.completedSets.map(createSetRangeKeyFromEntry)),
    [snapshot.completedSets],
  );
  const allEmployees = useMemo(
    () =>
      snapshot.schedules
        .flatMap((schedule) => schedule.employees)
        .sort((left, right) => left.name.localeCompare(right.name)),
    [snapshot.schedules],
  );
  const scheduleMap = useMemo(
    () => Object.fromEntries(snapshot.schedules.map((schedule) => [schedule.id, schedule])),
    [snapshot.schedules],
  );
  const subScheduleMap = useMemo(
    () => Object.fromEntries(snapshot.subSchedules.map((subSchedule) => [subSchedule.id, subSchedule])),
    [snapshot.subSchedules],
  );
  const competencyMap = useMemo(
    () => Object.fromEntries(snapshot.competencies.map((competency) => [competency.id, competency])),
    [snapshot.competencies],
  );
  const timeCodeMap = useMemo(
    () => Object.fromEntries(snapshot.timeCodes.map((timeCode) => [timeCode.id, timeCode])),
    [snapshot.timeCodes],
  );
  useEffect(() => {
    setOptimisticClaimOverrides({});
    setOptimisticallyReleasedClaimIds([]);
  }, [snapshot.assignments, snapshot.manualOvertimePostings, snapshot.overtimeClaims]);
  const futureClaimRows = useMemo<MyOvertimeClaimRow[]>(
    () =>
      futureOvertimeClaims
        .filter((claim) => claim.employeeId === claimingEmployeeId)
        .filter((claim) => !optimisticallyReleasedClaimIds.includes(claim.id))
        .map((claim) => {
          const schedule = claim.scheduleId ? scheduleMap[claim.scheduleId] : null;
          const subSchedule = claim.subScheduleId ? subScheduleMap[claim.subScheduleId] : null;
          const competency = claim.competencyId ? competencyMap[claim.competencyId] : null;
          const timeCode = claim.timeCodeId ? timeCodeMap[claim.timeCodeId] : null;

          return {
            id: claim.id,
            scheduleId: claim.scheduleId,
            subScheduleId: claim.subScheduleId ?? null,
            employeeId: claim.employeeId,
            competencyId: claim.competencyId,
            timeCodeId: claim.timeCodeId ?? null,
            date: claim.date,
            targetLabel: subSchedule?.name ?? (schedule ? `Shift ${schedule.name}` : "Overtime"),
            assignmentLabel: competency?.code ?? timeCode?.code ?? "Overtime",
          };
        })
        .sort((left, right) => left.date.localeCompare(right.date) || left.assignmentLabel.localeCompare(right.assignmentLabel)),
    [
      claimingEmployeeId,
      competencyMap,
      futureOvertimeClaims,
      optimisticallyReleasedClaimIds,
      scheduleMap,
      subScheduleMap,
      timeCodeMap,
    ],
  );
  const availableSubSchedules = useMemo(
    () => snapshot.subSchedules.filter((subSchedule) => !subSchedule.isArchived),
    [snapshot.subSchedules],
  );
  const selectedTargetMode: OvertimeTargetMode | "all" =
    selectedTargetKey === "all" ? "all" : selectedTargetKey.startsWith("sub:") ? "sub" : "main";
  const selectedSubScheduleFilter =
    selectedTargetKey.startsWith("sub:") ? selectedTargetKey.slice("sub:".length) : "";
  const manualTargetMode: OvertimeTargetMode = manualTargetKey.startsWith("sub:") ? "sub" : "main";
  const manualSubScheduleId =
    manualTargetKey.startsWith("sub:") ? manualTargetKey.slice("sub:".length) : "";
  const selectedManualSubSchedule =
    snapshot.subSchedules.find((subSchedule) => subSchedule.id === manualSubScheduleId) ?? null;
  const selectedManualSchedule =
    snapshot.schedules.find((schedule) => schedule.id === manualMainScheduleId) ?? snapshot.schedules[0] ?? null;
  const availableManualAssignments = useMemo(
    () =>
      manualTargetMode === "main"
        ? [
            ...snapshot.competencies
              .filter((competency) => selectedManualSchedule?.competencyIds.includes(competency.id))
              .map((competency) => buildOvertimeAssignmentKey(competency.id, null)),
            ...snapshot.timeCodes
              .filter((timeCode) => timeCode.usageMode !== "projected_only")
              .map((timeCode) => buildOvertimeAssignmentKey(null, timeCode.id)),
          ]
        : [
            ...snapshot.competencies
              .filter((competency) => selectedManualSubSchedule?.competencyIds.includes(competency.id))
              .map((competency) => buildOvertimeAssignmentKey(competency.id, null)),
            ...snapshot.timeCodes
              .filter((timeCode) => timeCode.usageMode !== "projected_only")
              .map((timeCode) => buildOvertimeAssignmentKey(null, timeCode.id)),
          ],
    [manualTargetMode, selectedManualSchedule, selectedManualSubSchedule, snapshot.competencies, snapshot.timeCodes],
  );

  useEffect(() => {
    setClaimingEmployeeId((current) => {
      if (viewer.role === "worker") {
        return viewer.employeeId ?? "";
      }

      return allEmployees.some((employee) => employee.id === current) ? current : allEmployees[0]?.id ?? "";
    });
    setSelectedTargetKey((current) =>
      current &&
      ((current === "all" && (snapshot.schedules.length > 0 || snapshot.subSchedules.length > 0)) ||
        (current === "main" && snapshot.schedules.length > 0) ||
        snapshot.subSchedules.some((subSchedule) => `sub:${subSchedule.id}` === current))
        ? current
        : buildInitialTargetKey(snapshot),
    );
    setSelectedAssignmentFilter((current) =>
      current === "all" ||
      snapshot.competencies.some((competency) => buildOvertimeAssignmentKey(competency.id, null) === current) ||
      snapshot.timeCodes.some((timeCode) => buildOvertimeAssignmentKey(null, timeCode.id) === current)
        ? current
        : "all",
    );
    setSelectedPostingByGroup({});
    setStatusMessage("");
    setManualTargetKey((current) =>
      current &&
      ((current === "main" && snapshot.schedules.length > 0) ||
        snapshot.subSchedules.some((subSchedule) => `sub:${subSchedule.id}` === current))
        ? current
        : snapshot.schedules.length > 0
          ? "main"
          : availableSubSchedules[0]?.id
            ? (`sub:${availableSubSchedules[0].id}` as const)
            : snapshot.subSchedules[0]?.id
              ? (`sub:${snapshot.subSchedules[0].id}` as const)
              : "",
    );
    setManualMainScheduleId((current) =>
      snapshot.schedules.some((schedule) => schedule.id === current) ? current : snapshot.schedules[0]?.id ?? "",
    );
    setManualAssignmentKey((current) =>
      current && availableManualAssignments.includes(current)
        ? current
        : availableManualAssignments[0] ?? "",
    );
    setManualSlotCount(1);
    setManualPostingDates([]);
    setIsManualModalOpen(false);
  }, [
    allEmployees,
    manualAvailableMonths,
    availableSubSchedules,
    snapshot.competencies,
    snapshot.schedules,
    snapshot.subSchedules,
    snapshot.timeCodes,
    viewer.employeeId,
    viewer.role,
  ]);

  useEffect(() => {
    setManualPostingMonth((current) =>
      manualAvailableMonths.includes(current)
        ? current
        : manualAvailableMonths.includes(snapshot.month)
          ? snapshot.month
          : manualAvailableMonths[0] ?? snapshot.month,
    );
  }, [manualAvailableMonths, snapshot.month]);

  useEffect(() => {
    setManualPostingDates([]);
  }, [manualPostingMonth, manualTargetKey]);

  useEffect(() => {
    setSelectedAssignmentFilter("all");
    setSelectedPostingByGroup({});
    setStatusMessage("");
  }, [selectedTargetKey]);

  useEffect(() => {
    setManualAssignmentKey((current) =>
      availableManualAssignments.includes(current)
        ? current
        : availableManualAssignments[0] ?? "",
    );
  }, [availableManualAssignments]);

  const postings = useMemo<OvertimePosting[]>(() => {
    const nextPostings: OvertimePosting[] = [];
    const selectedEmployeeClaims = snapshot.overtimeClaims.filter((claim) => claim.employeeId === claimingEmployeeId);

    for (const schedule of snapshot.schedules) {
      const workedSets = getWorkedSets(schedule, monthDays, extendedMonthDays);

      for (const workedSet of workedSets) {
        const setKey = createSetRangeKey(
          schedule.id,
          workedSet.dates[0],
          workedSet.dates[workedSet.dates.length - 1],
        );

        if (!completedSetRangeKeys.has(setKey)) {
          continue;
        }

        for (const segment of workedSet.segments) {
          if (segment.dates[0]?.slice(0, 7) !== snapshot.month) {
            continue;
          }

          const setDates = segment.dates;

          const scheduleCompetencies = snapshot.competencies.filter((competency) =>
            schedule.competencyIds.includes(competency.id),
          );

          for (const competency of scheduleCompetencies) {
            const missingSlotsByDate = setDates.map((date) => {
              const filledCount = countScheduleAssignmentsForTarget({
                assignments: snapshot.assignments,
                scheduleId: schedule.id,
                date,
                competencyId: competency.id,
              });

              return Math.max(0, competency.requiredStaff - filledCount);
            });

            const maxMissing = Math.max(0, ...missingSlotsByDate);
            const filledCells =
              setDates.length * competency.requiredStaff -
              missingSlotsByDate.reduce((sum, value) => sum + value, 0);
            const staffedPeople = setDates.length > 0 ? filledCells / setDates.length : 0;
            const claimedDates = selectedEmployeeClaims
              .filter(
                (claim) =>
                  claim.scheduleId === schedule.id &&
                  claim.competencyId === competency.id &&
                  setDates.includes(claim.date),
              )
              .map((claim) => claim.date)
              .sort();

            const claimDatesByEmployee = snapshot.overtimeClaims.reduce<Record<string, string[]>>((map, claim) => {
              if (
                claim.scheduleId === schedule.id &&
                claim.competencyId === competency.id &&
                setDates.includes(claim.date)
              ) {
                map[claim.employeeId] ??= [];
                map[claim.employeeId].push(claim.date);
              }

              return map;
            }, {});

            for (const [employeeId, employeeDates] of Object.entries(claimDatesByEmployee)) {
              const orderedDates = setDates.filter((date) => employeeDates.includes(date));
              const claimEmployee = employeeMap[employeeId];
              const assignmentMeta = orderedDates[0]
                ? assignmentMetaIndex[createAssignmentKey(schedule.id, employeeId, orderedDates[0])]
                : undefined;
              const coverageCompetencyId = assignmentMeta?.coverageCompetencyId ?? competency.id;
              const coverageCompetency = snapshot.competencies.find((entry) => entry.id === coverageCompetencyId);
              const swapEmployeeId = assignmentMeta?.swapEmployeeId ?? null;
              const swapEmployee = swapEmployeeId ? employeeMap[swapEmployeeId] : null;
              let currentRun: string[] = [];

              const flushRun = () => {
                if (currentRun.length === 0) {
                  return;
                }

                nextPostings.push({
                  id: `claimed:${schedule.id}:${competency.id}:${employeeId}:${currentRun[0]}`,
                  source: "auto",
                  targetMode: "main",
                  scheduleId: schedule.id,
                  subScheduleId: null,
                  scheduleName: schedule.name,
                  shiftKind: segment.shiftKind,
                  competencyId: competency.id,
                  timeCodeId: null,
                  assignmentKey: buildOvertimeAssignmentKey(competency.id, null),
                  slotCount: 1,
                  competencyCode: competency.code,
                  competencyLabel: competency.label,
                  coverageCompetencyId,
                  coverageCompetencyCode: coverageCompetency?.code ?? competency.code,
                  coverageCompetencyLabel: coverageCompetency?.label ?? competency.label,
                  colorToken: competency.colorToken,
                  dates: [...currentRun],
                  staffedPeople,
                  requiredStaff: competency.requiredStaff,
                  openShifts: 0,
                  manualPostingId: null,
                  claimedEmployeeId: employeeId,
                  claimedByName: claimEmployee?.name ?? "Unknown worker",
                  claimedEmployeeIds: [employeeId],
                  claimedByNames: [claimEmployee?.name ?? "Unknown worker"],
                  swapEmployeeId,
                  swapEmployeeName: swapEmployee?.name ?? null,
                });
                currentRun = [];
              };

              for (let index = 0; index < orderedDates.length; index += 1) {
                const date = orderedDates[index];
                const previousDate = orderedDates[index - 1];
                const currentDateIndex = setDates.indexOf(date);
                const previousDateIndex = previousDate ? setDates.indexOf(previousDate) : -1;

                if (previousDate && currentDateIndex !== previousDateIndex + 1) {
                  flushRun();
                }

                currentRun.push(date);
              }

              flushRun();
            }

            for (let slotIndex = 0; slotIndex < maxMissing; slotIndex += 1) {
              const postingDates = setDates.filter((_, index) => missingSlotsByDate[index] > slotIndex);

              if (postingDates.length === 0) {
                continue;
              }
              const swapCandidates = schedule.employees.reduce<
                Record<string, { employeeId: string; employeeName: string; competencyId: string }>
              >((map, teamEmployee) => {
                if (!teamEmployee.competencyIds.includes(competency.id)) {
                  return map;
                }

                const assignedCompetencyIds = postingDates.reduce<string[]>((ids, date) => {
                  const selection = getCellSelection(teamEmployee, schedule.id, date, assignmentIndex);

                  if (selection.competencyId) {
                    ids.push(selection.competencyId);
                  }

                  return ids;
                }, []);

                if (assignedCompetencyIds.length !== postingDates.length) {
                  return map;
                }

                const offeredCompetencyId = assignedCompetencyIds[0];

                if (
                  !offeredCompetencyId ||
                  offeredCompetencyId === competency.id ||
                  assignedCompetencyIds.some((assignedCompetencyId) => assignedCompetencyId !== offeredCompetencyId)
                ) {
                  return map;
                }

                if (map[offeredCompetencyId]) {
                  return map;
                }

                map[offeredCompetencyId] = {
                  employeeId: teamEmployee.id,
                  employeeName: teamEmployee.name,
                  competencyId: offeredCompetencyId,
                };

                return map;
              }, {});

              const candidateEntries = Object.values(swapCandidates);

                nextPostings.push({
                  id: `${schedule.id}:${competency.id}:${postingDates[0]}:${slotIndex}`,
                  source: "auto",
                  targetMode: "main",
                  scheduleId: schedule.id,
                  subScheduleId: null,
                  scheduleName: schedule.name,
                  shiftKind: segment.shiftKind,
                  competencyId: competency.id,
                  timeCodeId: null,
                  assignmentKey: buildOvertimeAssignmentKey(competency.id, null),
                  slotCount: 1,
                competencyCode: competency.code,
                competencyLabel: competency.label,
                coverageCompetencyId: competency.id,
                coverageCompetencyCode: competency.code,
                coverageCompetencyLabel: competency.label,
                colorToken: competency.colorToken,
                dates: postingDates,
                staffedPeople,
                requiredStaff: competency.requiredStaff,
                openShifts: postingDates.length,
                manualPostingId: null,
                claimedEmployeeId: null,
                claimedByName: null,
                claimedEmployeeIds: [],
                claimedByNames: [],
                swapEmployeeId: null,
                swapEmployeeName: null,
              });

              for (const candidate of candidateEntries) {
                const offeredCompetency = snapshot.competencies.find((entry) => entry.id === candidate.competencyId);

                if (!offeredCompetency) {
                  continue;
                }

                nextPostings.push({
                  id: `${schedule.id}:${candidate.competencyId}:${competency.id}:${postingDates[0]}:${slotIndex}:swap`,
                  source: "auto",
                  targetMode: "main",
                  scheduleId: schedule.id,
                  subScheduleId: null,
                  scheduleName: schedule.name,
                  shiftKind: segment.shiftKind,
                  competencyId: candidate.competencyId,
                  timeCodeId: null,
                  assignmentKey: buildOvertimeAssignmentKey(candidate.competencyId, null),
                  slotCount: 1,
                  competencyCode: offeredCompetency.code,
                  competencyLabel: offeredCompetency.label,
                  coverageCompetencyId: competency.id,
                  coverageCompetencyCode: competency.code,
                  coverageCompetencyLabel: competency.label,
                  colorToken: offeredCompetency.colorToken,
                  dates: postingDates,
                  staffedPeople,
                  requiredStaff: competency.requiredStaff,
                  openShifts: postingDates.length,
                  manualPostingId: null,
                  claimedEmployeeId: null,
                  claimedByName: null,
                  claimedEmployeeIds: [],
                  claimedByNames: [],
                  swapEmployeeId: candidate.employeeId,
                  swapEmployeeName: candidate.employeeName,
                });
              }
            }
          }
        }
      }
    }

    for (const manualPosting of snapshot.manualOvertimePostings) {
      const schedule = manualPosting.scheduleId
        ? snapshot.schedules.find((entry) => entry.id === manualPosting.scheduleId) ?? null
        : null;
      const subSchedule = manualPosting.subScheduleId
        ? snapshot.subSchedules.find((entry) => entry.id === manualPosting.subScheduleId) ?? null
        : null;
      const competency = manualPosting.competencyId
        ? snapshot.competencies.find((entry) => entry.id === manualPosting.competencyId) ?? null
        : null;
      const timeCode = manualPosting.timeCodeId
        ? snapshot.timeCodes.find((entry) => entry.id === manualPosting.timeCodeId) ?? null
        : null;

      if ((!schedule && !subSchedule) || (!competency && !timeCode) || manualPosting.dates.length === 0) {
        continue;
      }

      const filledCells = manualPosting.dates.reduce((count, date) => {
        if (schedule) {
          const filledCount = countScheduleAssignmentsForTarget({
            assignments: snapshot.assignments,
            scheduleId: schedule.id,
            date,
            competencyId: competency?.id ?? null,
            timeCodeId: timeCode?.id ?? null,
          });

          return count + filledCount;
        }

        const filledCount = snapshot.subScheduleAssignments.filter(
          (assignment) =>
            assignment.subScheduleId === subSchedule?.id &&
            assignment.date === date &&
            ((competency && assignment.competencyId === competency.id) ||
              (timeCode && assignment.timeCodeId === timeCode.id)),
        ).length;

        return count + filledCount;
      }, 0);

      const claimsForPosting = snapshot.overtimeClaims.filter(
        (claim) => claim.manualPostingId === manualPosting.id,
      );
      const claimedEmployeeIds = Array.from(new Set(claimsForPosting.map((claim) => claim.employeeId)));
      const claimedByNames = claimedEmployeeIds.map((employeeId) => employeeMap[employeeId]?.name ?? "Unknown worker");
      const claimedEmployeeId = claimedEmployeeIds[0] ?? null;
      const claimedEmployee = claimedEmployeeId ? employeeMap[claimedEmployeeId] : null;
      const remainingSlots = Math.max(0, manualPosting.slotCount - claimedEmployeeIds.length);

      nextPostings.push({
        id: `manual:${manualPosting.id}`,
        source: "manual",
        targetMode: subSchedule ? "sub" : "main",
        scheduleId: schedule?.id ?? null,
        subScheduleId: subSchedule?.id ?? null,
        scheduleName: schedule?.name ?? subSchedule?.name ?? "Unknown schedule",
        shiftKind: manualPosting.shiftKind,
        competencyId: competency?.id ?? null,
        timeCodeId: timeCode?.id ?? null,
        assignmentKey: buildOvertimeAssignmentKey(competency?.id ?? null, timeCode?.id ?? null),
        slotCount: manualPosting.slotCount,
        competencyCode: competency?.code ?? timeCode!.code,
        competencyLabel: competency?.label ?? timeCode!.label,
        coverageCompetencyId: competency?.id ?? null,
        coverageCompetencyCode: competency?.code ?? timeCode!.code,
        coverageCompetencyLabel: competency?.label ?? timeCode!.label,
        colorToken: competency?.colorToken ?? timeCode!.colorToken,
        dates: manualPosting.dates,
        staffedPeople: manualPosting.dates.length > 0 ? filledCells / manualPosting.dates.length : 0,
        requiredStaff: manualPosting.slotCount,
        openShifts: manualPosting.dates.length * remainingSlots,
        manualPostingId: manualPosting.id,
        claimedEmployeeId,
        claimedByName: claimedEmployee?.name ?? null,
        claimedEmployeeIds,
        claimedByNames,
        swapEmployeeId: null,
        swapEmployeeName: null,
      });
    }

    return nextPostings
      .map((posting) => sanitizePostingLabels(posting, competencyMap, timeCodeMap))
      .sort((left, right) =>
        Number(Boolean(right.claimedEmployeeId)) - Number(Boolean(left.claimedEmployeeId)) ||
        Number(right.source === "manual") - Number(left.source === "manual") ||
        Number(right.targetMode === "sub") - Number(left.targetMode === "sub") ||
        left.scheduleName.localeCompare(right.scheduleName) ||
        left.dates[0].localeCompare(right.dates[0]) ||
        left.shiftKind.localeCompare(right.shiftKind) ||
        left.competencyCode.localeCompare(right.competencyCode) ||
        (left.claimedByName ?? "").localeCompare(right.claimedByName ?? ""),
      );
  }, [
    assignmentIndex,
    completedSetRangeKeys,
    competencyMap,
    employeeMap,
    extendedMonthDays,
    monthDays,
    assignmentMetaIndex,
    snapshot,
    snapshot.competencies,
    snapshot.month,
    snapshot.overtimeClaims,
    snapshot.schedules,
    timeCodeMap,
  ]);
  const displayPostings = useMemo(
    () =>
      postings.map((posting) =>
        applyOptimisticClaimOverride(posting, optimisticClaimOverrides[posting.id]),
      ),
    [optimisticClaimOverrides, postings],
  );
  const todayKey = useMemo(() => getTodayDateKey(), []);
  const filteredPostings = useMemo(
    () =>
      displayPostings.filter((posting) => {
        if (selectedTargetMode !== "all" && selectedTargetMode !== posting.targetMode) {
          return false;
        }

        if (
          selectedTargetMode === "sub" &&
          posting.targetMode === "sub" &&
          posting.subScheduleId !== selectedSubScheduleFilter
        ) {
          return false;
        }

        if (selectedAssignmentFilter !== "all" && posting.assignmentKey !== selectedAssignmentFilter) {
          return false;
        }

        if (availabilityFilter === "available") {
          if (posting.openShifts === 0) {
            return false;
          }

          // Hide postings whose shifts are entirely in the past.
          const latestDate = posting.dates.reduce((max, date) => (date > max ? date : max), "");
          if (latestDate && latestDate < todayKey) {
            return false;
          }
        }

        return true;
      }),
    [
      availabilityFilter,
      displayPostings,
      selectedAssignmentFilter,
      selectedSubScheduleFilter,
      selectedTargetMode,
      todayKey,
    ],
  );
  const calendarPostings = useMemo<OvertimeCalendarPosting[]>(
    () =>
      Object.values(
        filteredPostings.reduce<Record<string, OvertimeCalendarPosting>>((entries, posting) => {
          const targetId = posting.targetMode === "main" ? posting.scheduleId : posting.subScheduleId;
          const originalAssignmentId = posting.coverageCompetencyId ?? posting.timeCodeId ?? posting.assignmentKey;
          const key = `${posting.targetMode}:${targetId}:${posting.shiftKind}:${posting.dates.join(",")}:${originalAssignmentId}`;

          entries[key] ??= {
            id: key,
            source: posting.source,
            targetMode: posting.targetMode,
            scheduleName: posting.scheduleName,
            shiftKind: posting.shiftKind,
            competencyCode: posting.coverageCompetencyCode,
            colorToken: posting.coverageCompetencyId
              ? competencyMap[posting.coverageCompetencyId]?.colorToken ?? posting.colorToken
              : posting.colorToken,
            dates: posting.dates,
            openShifts: posting.openShifts,
          };

          return entries;
        }, {}),
      ).sort(
        (left, right) =>
          left.dates[0].localeCompare(right.dates[0]) ||
          left.scheduleName.localeCompare(right.scheduleName) ||
          left.shiftKind.localeCompare(right.shiftKind) ||
          left.competencyCode.localeCompare(right.competencyCode),
      ),
    [competencyMap, filteredPostings],
  );
  const groupedPostings = useMemo(
    () =>
      Object.values(
        filteredPostings.reduce<
          Record<string, { key: string; scheduleName: string; shiftKind: Exclude<ShiftKind, "OFF">; dates: string[]; postings: OvertimePosting[] }>
        >((groups, posting) => {
          const targetId = posting.targetMode === "main" ? posting.scheduleId : posting.subScheduleId;
          const key = `${posting.targetMode}:${targetId}:${posting.shiftKind}:${posting.dates.join(",")}`;
          groups[key] ??= {
            key,
            scheduleName: posting.scheduleName,
            shiftKind: posting.shiftKind,
            dates: posting.dates,
            postings: [],
          };
          groups[key].postings.push(posting);
          return groups;
        }, {}),
      ).sort(
        (left, right) =>
          left.dates[0].localeCompare(right.dates[0]) ||
          left.dates[left.dates.length - 1].localeCompare(right.dates[right.dates.length - 1]) ||
          left.scheduleName.localeCompare(right.scheduleName) ||
          left.shiftKind.localeCompare(right.shiftKind),
      ),
    [filteredPostings],
  );

  const claimingEmployee = claimingEmployeeId ? employeeMap[claimingEmployeeId] ?? null : null;
  const selectedEligibilityReportPosting = useMemo(
    () => displayPostings.find((posting) => posting.id === eligibilityReportPostingId) ?? null,
    [displayPostings, eligibilityReportPostingId],
  );
  const selectedTurnaroundConfirmationPosting = useMemo(
    () => displayPostings.find((posting) => posting.id === turnaroundConfirmationPostingId) ?? null,
    [displayPostings, turnaroundConfirmationPostingId],
  );
  const selectedTurnaroundClaimAction = selectedTurnaroundConfirmationPosting
    ? claimActionState[selectedTurnaroundConfirmationPosting.id] ?? null
    : null;
  const selectedDeletePosting = useMemo(
    () => displayPostings.find((posting) => posting.id === deletePostingId) ?? null,
    [deletePostingId, displayPostings],
  );
  const eligibleEmployeesForReport = useMemo(
    () =>
      selectedEligibilityReportPosting
        ? allEmployees
            .filter(
              (employee) =>
                getClaimStatus(employee, selectedEligibilityReportPosting, snapshot, assignmentIndex).canClaim,
            )
            .map((employee) => ({
              id: employee.id,
              name: employee.name,
              scheduleName: getScheduleById(snapshot, employee.scheduleId)?.name ?? "Unknown",
            }))
        : [],
    [allEmployees, assignmentIndex, selectedEligibilityReportPosting, snapshot],
  );

  useEffect(() => {
    if (eligibilityReportPostingId && !selectedEligibilityReportPosting) {
      setEligibilityReportPostingId(null);
    }
  }, [eligibilityReportPostingId, selectedEligibilityReportPosting]);

  useEffect(() => {
    if (turnaroundConfirmationPostingId && !selectedTurnaroundConfirmationPosting) {
      setTurnaroundConfirmationPostingId(null);
    }
  }, [selectedTurnaroundConfirmationPosting, turnaroundConfirmationPostingId]);

  useEffect(() => {
    if (deletePostingId && !selectedDeletePosting) {
      setDeletePostingId(null);
    }
  }, [deletePostingId, selectedDeletePosting]);

  function refreshOvertimeBoard() {
    startRouteRefreshTransition(() => {
      router.refresh();
    });
  }

  function submitClaim(posting: OvertimePosting, confirmedNightShiftTurnaround = false) {
    if (!claimingEmployeeId) {
      setStatusMessage("Select an employee first.");
      return;
    }

    const actingEmployeeId = claimingEmployeeId;
    const actingEmployeeName = employeeMap[actingEmployeeId]?.name ?? viewer.displayName;

    setClaimActionState((current) => ({ ...current, [posting.id]: "claim" }));
    setStatusMessage("");

    void (async () => {
      try {
        const result = await withClaimTimeout(
          claimOvertimePosting({
            scheduleId: posting.scheduleId,
            subScheduleId: posting.subScheduleId,
            employeeId: actingEmployeeId,
            competencyId: posting.competencyId,
            timeCodeId: posting.timeCodeId,
            coverageCompetencyId: posting.coverageCompetencyId,
            swapEmployeeId: posting.swapEmployeeId,
            manualPostingId: posting.manualPostingId,
            dates: posting.dates,
            confirmedNightShiftTurnaround,
          }),
        );

        setStatusMessage(result.message);

        if (result.ok) {
          setOptimisticClaimOverrides((current) => ({
            ...current,
            [posting.id]: {
              action: "claim",
              employeeId: actingEmployeeId,
              employeeName: actingEmployeeName,
            },
          }));
          refreshOvertimeBoard();
        }
      } catch (error) {
        console.error("Could not claim overtime posting", error);
        setStatusMessage(
          error instanceof Error
            ? `${error.message} Refresh and check whether the claim was saved before trying again.`
            : "Could not claim that overtime posting. Refresh and try again.",
        );
        refreshOvertimeBoard();
      } finally {
        setClaimActionState((current) => {
          const remainingActions = { ...current };
          delete remainingActions[posting.id];
          return remainingActions;
        });
      }
    })();
  }

  function handleClaim(posting: OvertimePosting) {
    if (!claimingEmployeeId) {
      setStatusMessage("Select an employee first.");
      return;
    }

    if (needsTurnaroundConfirmation(claimingEmployee, posting, snapshot)) {
      setTurnaroundConfirmationPostingId(posting.id);
      return;
    }

    submitClaim(posting);
  }

  function handleConfirmTurnaroundClaim() {
    if (!selectedTurnaroundConfirmationPosting) {
      setTurnaroundConfirmationPostingId(null);
      return;
    }

    const posting = selectedTurnaroundConfirmationPosting;
    setTurnaroundConfirmationPostingId(null);
    submitClaim(posting, true);
  }

  function handleRelease(posting: OvertimePosting) {
    if (!claimingEmployeeId) {
      setStatusMessage("Select an employee first.");
      return;
    }

    const actingEmployeeId = claimingEmployeeId;
    const actingEmployeeName = employeeMap[actingEmployeeId]?.name ?? viewer.displayName;

    setClaimActionState((current) => ({ ...current, [posting.id]: "release" }));
    setStatusMessage("");

    void (async () => {
      try {
        const result = await withClaimTimeout(
          releaseOvertimePosting({
            scheduleId: posting.scheduleId,
            subScheduleId: posting.subScheduleId,
            employeeId: actingEmployeeId,
            competencyId: posting.competencyId,
            timeCodeId: posting.timeCodeId,
            dates: posting.dates,
          }),
        );

        setStatusMessage(result.message);

        if (result.ok) {
          setOptimisticClaimOverrides((current) => ({
            ...current,
            [posting.id]: {
              action: "release",
              employeeId: actingEmployeeId,
              employeeName: actingEmployeeName,
            },
          }));
          refreshOvertimeBoard();
        }
      } catch (error) {
        console.error("Could not release overtime posting", error);
        setStatusMessage(
          error instanceof Error
            ? `${error.message} Refresh and check whether the release was saved before trying again.`
            : "Could not release that overtime posting. Refresh and try again.",
        );
        refreshOvertimeBoard();
      } finally {
        setClaimActionState((current) => {
          const remainingActions = { ...current };
          delete remainingActions[posting.id];
          return remainingActions;
        });
      }
    })();
  }

  function handleReleaseClaimRow(claim: MyOvertimeClaimRow) {
    setReleasingClaimId(claim.id);
    setStatusMessage("");

    void (async () => {
      try {
        const result = await withClaimTimeout(
          releaseOvertimePosting({
            scheduleId: claim.scheduleId,
            subScheduleId: claim.subScheduleId,
            employeeId: claim.employeeId,
            competencyId: claim.competencyId,
            timeCodeId: claim.timeCodeId,
            dates: [claim.date],
          }),
        );

        setStatusMessage(result.message);

        if (result.ok) {
          setOptimisticallyReleasedClaimIds((current) =>
            current.includes(claim.id) ? current : [...current, claim.id],
          );
          refreshOvertimeBoard();
        }
      } catch (error) {
        console.error("Could not release overtime claim", error);
        setStatusMessage(
          error instanceof Error
            ? `${error.message} Refresh and check whether the release was saved before trying again.`
            : "Could not release that overtime claim. Refresh and try again.",
        );
        refreshOvertimeBoard();
      } finally {
        setReleasingClaimId(null);
      }
    })();
  }

  function toggleManualPostingDate(date: string) {
    setManualPostingDates((current) =>
      current.includes(date)
        ? current.filter((entry) => entry !== date)
        : [...current, date].sort(),
    );
  }

  function handleCreateManualPosting() {
    const manualCompetencyId = manualAssignmentKey.startsWith("comp:")
      ? manualAssignmentKey.slice("comp:".length)
      : null;
    const manualTimeCodeId = manualAssignmentKey.startsWith("time:")
      ? manualAssignmentKey.slice("time:".length)
      : null;

    startManualTransition(async () => {
      const result = await createManualOvertimePosting({
        scheduleId: manualTargetMode === "main" ? manualMainScheduleId : null,
        subScheduleId: manualTargetMode === "sub" ? manualSubScheduleId : null,
        competencyId: manualCompetencyId,
        timeCodeId: manualTimeCodeId,
        slotCount: manualSlotCount,
        dates: manualPostingDates,
      });

      setStatusMessage(result.message);

      if (result.ok) {
        setManualPostingDates([]);
        setIsManualModalOpen(false);
        refreshOvertimeBoard();
      }
    });
  }

  function handleDeleteManualPosting(posting: OvertimePosting) {
    setDeletePostingId(posting.id);
  }

  function confirmDeleteManualPosting() {
    const manualPostingId = selectedDeletePosting?.manualPostingId;

    if (!manualPostingId) {
      setDeletePostingId(null);
      return;
    }

    startManualTransition(async () => {
      const result = await deleteManualOvertimePosting({
        postingId: manualPostingId,
      });

      setStatusMessage(result.message);

      if (result.ok) {
        setDeletePostingId(null);
        refreshOvertimeBoard();
      }
    });
  }

  return (
    <section className="panel-frame">
      <div className="panel-heading panel-heading--split">
        <h1 className="panel-title">Overtime</h1>
        {availableMonths.length > 0 ? (
          <AppDateSelector
            mode="month"
            value={snapshot.month}
            label="Overtime month"
            availableMonths={availableMonths}
            onChange={(nextMonth) => router.push(`/overtime?month=${nextMonth}`)}
          />
        ) : (
          <div className="field field--static">
            <span>Month</span>
            <strong>No overtime months</strong>
          </div>
        )}
      </div>

      <div className="workspace-toolbar workspace-toolbar--overtime">
        {viewer.role === "worker" ? (
          <div className="field field--static">
            <span>Claim As</span>
            <strong>{claimingEmployee?.name ?? viewer.displayName}</strong>
          </div>
        ) : (
          <label className="field">
            <span>Claim As</span>
            <select
              value={claimingEmployeeId}
              onChange={(event) => setClaimingEmployeeId(event.target.value)}
            >
              {allEmployees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="field">
          <span>Schedule</span>
          <select
            value={selectedTargetKey}
            onChange={(event) => setSelectedTargetKey(event.target.value as OvertimeTargetKey)}
          >
            <option value="all">All</option>
            {snapshot.schedules.length > 0 ? <option value="main">Main schedule</option> : null}
            <optgroup label="Sub-schedules">
              {availableSubSchedules.map((subSchedule) => (
                <option key={`sub:${subSchedule.id}`} value={`sub:${subSchedule.id}`}>
                  {subSchedule.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>

        <label className="field">
          <span>Assignment</span>
          <select
            value={selectedAssignmentFilter}
            onChange={(event) => setSelectedAssignmentFilter(event.target.value)}
          >
            <option value="all">All assignments</option>
            {[
              ...snapshot.competencies
                .filter((competency) => {
                  if (selectedTargetMode === "all") {
                    return true;
                  }

                  if (selectedTargetMode === "main") {
                    return snapshot.schedules.some((schedule) => schedule.competencyIds.includes(competency.id));
                  }

                  return (
                    snapshot.subSchedules.find((subSchedule) => subSchedule.id === selectedSubScheduleFilter)?.competencyIds.includes(competency.id) ?? false
                  );
                })
                .map((competency) => ({
                  key: buildOvertimeAssignmentKey(competency.id, null),
                  label: competency.code,
                })),
              ...snapshot.timeCodes
                .filter((timeCode) => timeCode.usageMode !== "projected_only")
                .map((timeCode) => ({
                  key: buildOvertimeAssignmentKey(null, timeCode.id),
                  label: timeCode.code,
                })),
            ].map((assignment) => (
              <option key={assignment.key} value={assignment.key}>
                {assignment.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Availability</span>
          <select
            value={availabilityFilter}
            onChange={(event) => setAvailabilityFilter(event.target.value as OvertimeAvailabilityFilter)}
          >
            <option value="all">All postings</option>
            <option value="available">Available only</option>
          </select>
        </label>

        <div className="toolbar-actions overtime-toolbar-actions">
          <button
            type="button"
            className="ghost-button overtime-toolbar-button"
            onClick={() => setIsCalendarModalOpen(true)}
            aria-label="Overtime calendar"
            title="Overtime calendar"
          >
            <CalendarIcon />
            <span>Calendar</span>
          </button>
          {viewer.employeeId ? (
            <button
              type="button"
              className="ghost-button overtime-toolbar-button"
              onClick={() => setIsMyClaimsModalOpen(true)}
              aria-label="My overtime claims"
              title="My overtime claims"
            >
              <PersonIcon />
              <span>My claims</span>
            </button>
          ) : null}
          {canManageManualPostings ? (
            <button
              type="button"
              className="ghost-button overtime-toolbar-button overtime-create-posting-button"
              onClick={() => setIsManualModalOpen(true)}
              aria-label="Create overtime posting"
              title="Create overtime posting"
            >
              <CreatePostingIcon />
              <span>Create</span>
            </button>
          ) : null}
        </div>

        <div className="toolbar-status-wrap">
          {statusMessage ? <p className="toolbar-status">{statusMessage}</p> : null}
        </div>
      </div>

      <div className="overtime-list">
        {groupedPostings.map((group) => (
          (() => {
            const visiblePostings = getVisiblePostingsForEmployee(group.postings, claimingEmployee);
            const selectedPostingId = selectedPostingByGroup[group.key];
            const selectedPostingCandidate = selectedPostingId
              ? visiblePostings.find((posting) => posting.id === selectedPostingId) ?? null
              : null;
            const preferredClaimablePosting =
              visiblePostings.find((posting) => {
                if (posting.claimedEmployeeIds.includes(claimingEmployeeId)) {
                  return true;
                }

                return getClaimStatus(claimingEmployee, posting, snapshot, assignmentIndex).canClaim;
              }) ?? null;
            const selectedPosting = selectedPostingCandidate ?? preferredClaimablePosting ?? visiblePostings[0];
            const claimStatus = selectedPosting
              ? getClaimStatus(claimingEmployee, selectedPosting, snapshot, assignmentIndex)
              : { canClaim: false, reason: "No overtime posting selected." };
            const selectedPostingClaimedByViewer = selectedPosting
              ? selectedPosting.claimedEmployeeIds.includes(claimingEmployeeId)
              : false;
            const selectedPostingClaimAction = selectedPosting
              ? claimActionState[selectedPosting.id] ?? null
              : null;

            return (
              <section key={group.key} className="overtime-group">
                <article
                  className={`overtime-card ${selectedPosting && selectedPosting.openShifts === 0 ? "overtime-card--claimed" : ""}`}
                >
                  <div className="overtime-group__header">
                    <div>
                      <p className="overtime-card-team">
                        {selectedTargetMode === "all"
                          ? selectedPosting?.targetMode === "main"
                            ? `Shift ${group.scheduleName}`
                            : group.scheduleName
                          : selectedTargetMode === "main"
                            ? `Shift ${group.scheduleName}`
                            : group.scheduleName}
                      </p>
                      <h2 className="overtime-card-title">
                        {formatShortDate(group.dates[0])} - {formatShortDate(group.dates[group.dates.length - 1])}
                      </h2>
                    </div>
                    <span className="overtime-group__meta">{getShiftLabel(group.shiftKind, group.dates.length)}</span>
                  </div>

                  <div className="overtime-option-pills">
                    {visiblePostings.map((posting) => (
                      <button
                        key={posting.id}
                        type="button"
                        className={`overtime-option-pill legend-pill legend-pill--${posting.colorToken.toLowerCase()} ${
                          selectedPosting?.id === posting.id ? "overtime-option-pill--active" : ""
                        }`}
                        onClick={() =>
                          setSelectedPostingByGroup((current) => ({
                            ...current,
                            [group.key]: posting.id,
                          }))
                        }
                      >
                        <strong>{posting.competencyCode.replace("Post ", "")}</strong>
                        <span>
                          {posting.coverageCompetencyId && posting.competencyId && posting.coverageCompetencyId !== posting.competencyId
                            ? `fills ${posting.coverageCompetencyCode}`
                            : `${posting.openShifts} shift${posting.openShifts === 1 ? "" : "s"}`}
                        </span>
                      </button>
                    ))}
                  </div>

                  {selectedPosting ? (
                    <>
                      <div className="overtime-card-top">
                        <div>
                          <p className="overtime-card-team">
                            {selectedPosting.coverageCompetencyId && selectedPosting.competencyId && selectedPosting.coverageCompetencyId !== selectedPosting.competencyId
                              ? `Needed ${selectedPosting.coverageCompetencyCode}`
                              : selectedPosting.competencyCode}
                          </p>
                          <h3 className="overtime-card-title">
                            {selectedPosting.coverageCompetencyId && selectedPosting.competencyId && selectedPosting.coverageCompetencyId !== selectedPosting.competencyId
                              ? selectedPosting.coverageCompetencyLabel
                              : selectedPosting.competencyLabel}
                          </h3>
                        </div>
                        <div className="metrics-transfer-pill-row">
                          <span className={`legend-pill legend-pill--${selectedPosting.colorToken.toLowerCase()}`}>
                            {selectedPosting.coverageCompetencyId && selectedPosting.competencyId && selectedPosting.coverageCompetencyId !== selectedPosting.competencyId
                              ? `${selectedPosting.competencyCode.replace("Post ", "")} -> ${selectedPosting.coverageCompetencyCode.replace("Post ", "")}`
                              : selectedPosting.competencyCode.replace("Post ", "")}
                          </span>
                          {selectedPosting.source === "manual" ? (
                            <span className="legend-pill legend-pill--slate">Manual</span>
                          ) : null}
                        </div>
                      </div>

                      <div className="overtime-card-meta">
                        <span>
                          {selectedPosting.openShifts} open shift{selectedPosting.openShifts === 1 ? "" : "s"}
                        </span>
                        <span>{formatStaffCount(selectedPosting.staffedPeople)}/{selectedPosting.requiredStaff} staffed</span>
                      </div>

                      {selectedPosting.coverageCompetencyId && selectedPosting.competencyId && selectedPosting.coverageCompetencyId !== selectedPosting.competencyId ? (
                        <div className="overtime-card-meta">
                          <span>
                            Claim {selectedPosting.competencyCode} to fill {selectedPosting.coverageCompetencyCode}
                            {selectedPosting.swapEmployeeName ? ` via ${selectedPosting.swapEmployeeName}` : " via swap"}
                          </span>
                        </div>
                      ) : null}

                      {selectedPosting.source === "manual" ? (
                        <div className="overtime-card-meta">
                          <span>This posting was added manually by a leader/admin.</span>
                        </div>
                      ) : null}

                      <div className="overtime-card-actions">
                        <span className="overtime-card-hint">
                          {selectedPosting.claimedByName
                            ? `${selectedPosting.openShifts === 0 ? "Claimed" : "Partially claimed"} by ${selectedPosting.claimedByNames.join(", ")}${
                                selectedPosting.coverageCompetencyId && selectedPosting.competencyId && selectedPosting.coverageCompetencyId !== selectedPosting.competencyId
                                  ? ` · resolves ${selectedPosting.coverageCompetencyCode}`
                                  : ""
                              }`
                            : claimStatus.reason}
                        </span>
                        <div className="overtime-card-actions__buttons">
                          <button
                            type="button"
                            className="primary-button"
                            onClick={() =>
                              selectedPostingClaimedByViewer
                                ? handleRelease(selectedPosting)
                                : handleClaim(selectedPosting)
                            }
                            disabled={
                              Boolean(selectedPostingClaimAction) ||
                              (!selectedPostingClaimedByViewer && !claimStatus.canClaim)
                            }
                          >
                            {selectedPostingClaimAction
                              ? selectedPostingClaimAction === "release"
                                ? "Releasing..."
                                : "Claiming..."
                              : selectedPostingClaimedByViewer
                              ? "Release Posting"
                              : selectedPosting.openShifts === 0
                              ? "Claimed"
                              : "Claim Posting"}
                          </button>
                          {canManageManualPostings ? (
                            <button
                              type="button"
                              className="ghost-button"
                              onClick={() => setEligibilityReportPostingId(selectedPosting.id)}
                            >
                              Eligible employees
                            </button>
                          ) : null}
                          {canManageManualPostings &&
                          selectedPosting.source === "manual" ? (
                            <button
                              type="button"
                              className="ghost-button"
                              onClick={() => handleDeleteManualPosting(selectedPosting)}
                              disabled={isManagingManual}
                            >
                              {isManagingManual ? "Deleting..." : "Delete Posting"}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </>
                  ) : null}
                </article>
              </section>
            );
          })()
        ))}

        {groupedPostings.length === 0 ? (
          <div className="empty-state">
            {availabilityFilter === "available" ? (
              <>
                <strong>No unclaimed overtime postings.</strong>
                <span>Claimed or filled postings are hidden by the availability filter.</span>
                <button
                  type="button"
                  className="ghost-button empty-state__action"
                  onClick={() => setAvailabilityFilter("all")}
                >
                  Show all postings
                </button>
              </>
            ) : (
              <>
                <strong>No overtime postings.</strong>
                <span>
                  {selectedTargetMode === "all"
                    ? "Complete a set on the Schedule page or create a manual posting to make overtime claimable here."
                    : selectedTargetMode === "main"
                    ? "Complete a set on the Schedule page, or all completed sets are fully staffed."
                    : "Create a manual posting for a sub-schedule to make overtime claimable here."}
                </span>
              </>
            )}
          </div>
        ) : null}
      </div>

      {isManualModalOpen ? (
        <ManualOvertimePostingModal
          snapshot={snapshot}
          availableMonths={manualAvailableMonths}
          selectedMonth={manualPostingMonth}
          selectedTargetKey={manualTargetKey}
          selectedMainScheduleId={manualMainScheduleId}
          selectedAssignmentKey={manualAssignmentKey}
          selectedSlotCount={manualSlotCount}
          selectedDates={manualPostingDates}
          onMonthChange={setManualPostingMonth}
          onTargetChange={(targetKey) => {
            setManualTargetKey(targetKey);
            setManualPostingDates([]);
          }}
          onMainScheduleChange={(scheduleId) => {
            setManualMainScheduleId(scheduleId);
            setManualPostingDates([]);
          }}
          onAssignmentChange={setManualAssignmentKey}
          onSlotCountChange={setManualSlotCount}
          onToggleDate={toggleManualPostingDate}
          onClose={() => setIsManualModalOpen(false)}
          onSubmit={handleCreateManualPosting}
          isSubmitting={isManagingManual}
        />
      ) : null}

      {isMyClaimsModalOpen ? (
        <MyOvertimeClaimsModal
          claims={futureClaimRows}
          employeeName={claimingEmployee?.name ?? viewer.displayName}
          onClose={() => setIsMyClaimsModalOpen(false)}
          onRelease={handleReleaseClaimRow}
          releasingClaimId={releasingClaimId}
        />
      ) : null}

      {isCalendarModalOpen ? (
        <OvertimeCalendarModal
          monthLabel={formatMonthLabel(snapshot.month)}
          monthDays={monthDays}
          postings={calendarPostings}
          onClose={() => setIsCalendarModalOpen(false)}
        />
      ) : null}

      {selectedEligibilityReportPosting ? (
        <OvertimeEligibilityReportModal
          posting={selectedEligibilityReportPosting}
          eligibleEmployees={eligibleEmployeesForReport}
          onClose={() => setEligibilityReportPostingId(null)}
        />
      ) : null}

      {selectedTurnaroundConfirmationPosting && claimingEmployee ? (
        <NightShiftTurnaroundModal
          employeeName={claimingEmployee.name}
          posting={selectedTurnaroundConfirmationPosting}
          onCancel={() => setTurnaroundConfirmationPostingId(null)}
          onConfirm={handleConfirmTurnaroundClaim}
          isSubmitting={Boolean(selectedTurnaroundClaimAction)}
        />
      ) : null}

      {selectedDeletePosting ? (
        <DeleteOvertimePostingModal
          posting={selectedDeletePosting}
          onCancel={() => setDeletePostingId(null)}
          onConfirm={confirmDeleteManualPosting}
          isSubmitting={isManagingManual}
        />
      ) : null}
    </section>
  );
}
