"use client";

import type { CSSProperties } from "react";
import { useDeferredValue, useEffect, useMemo, useRef, useState, useTransition, startTransition } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";

import { saveAssignments, saveSchedulePins, setScheduleSetCompletion } from "@/app/actions";
import { parseMutualAssignmentNote } from "@/lib/mutuals";
import {
  buildAssignmentIndex,
  createAssignmentKey,
  formatMonthLabel,
  getCompetencyMap,
  getCompletedSetDatesForMonth,
  getEmployeeMap,
  getExtendedMonthDays,
  getMonthDays,
  getScheduleById,
  getTimeCodeMap,
  getWorkedSetDays,
  isCompletedSetRange,
  shiftMonthKey,
  shiftForDate,
  toggleCompletedSetEntries,
} from "@/lib/scheduling";
import type {
  Competency,
  Employee,
  SaveAssignmentsInput,
  Schedule,
  SchedulerSnapshot,
  ShiftKind,
  StoredAssignment,
  TimeCode,
} from "@/lib/types";

/**
 * The scheduler is the most interaction-heavy screen in the app.
 *
 * It combines:
 * - month loading
 * - unsaved draft persistence
 * - debounced auto-save
 * - set-builder workflows
 * - whole-column copy/paste from a clicked day
 * - per-user row pinning
 * - cell editing + drag-copy
 * - borrowed overtime rows
 *
 * Comments here focus on the major interaction models rather than every small
 * render detail.
 */
const STORAGE_KEY = "shift-canvas-drafts-v2";
const AUTO_SAVE_DEBOUNCE_MS = 2500;
const STALE_SNAPSHOT_PROTECTION_MS = 12000;
type AssignmentSelection = { competencyId: string | null; timeCodeId: string | null; notes: string | null };
type PersistedDraftAssignments = Record<string, AssignmentSelection | null>;
type SelectedCell = { employeeId: string; date: string };
type DragRange = {
  employeeId: string;
  startIndex: number;
  currentIndex: number;
  selection: AssignmentSelection;
};

type DisplayEmployee = {
  rowId: string;
  sourceEmployeeId: string;
  name: string;
  role: string;
  competencyIds: string[];
  overtimeDates?: string[];
  overtimeCompetencyByDate?: Record<string, string>;
  mutualDates?: string[];
};

type CoverageSummary = {
  filledCells: number;
  requiredCells: number;
  assignedPeople: number;
  requiredStaff: number;
  hasOvertime: boolean;
  isUnderstaffed: boolean;
  missingDates: string[];
};

type CopiedSetTemplate = {
  scheduleId: string;
  sourceStartDate: string;
  setLength: number;
  selectionsByEmployeeId: Record<string, AssignmentSelection[]>;
};

type CopiedColumnTemplate = {
  scheduleId: string;
  sourceDate: string;
  selectionsByEmployeeId: Record<string, AssignmentSelection>;
};

/** Builds the visible roster, including borrowed overtime and mutual rows for the month. */
function buildDisplayEmployeesForSchedule({
  schedule,
  snapshot,
  employeeMap,
  currentMonth,
  pinnedEmployeesBySchedule,
}: {
  schedule: Schedule;
  snapshot: SchedulerSnapshot;
  employeeMap: Record<string, Employee>;
  currentMonth: string;
  pinnedEmployeesBySchedule: Record<string, string[]>;
}) {
  const baseRows: DisplayEmployee[] = schedule.employees.map((employee) => ({
    rowId: `base:${employee.id}`,
    sourceEmployeeId: employee.id,
    name: employee.name,
    role: employee.role,
    competencyIds: employee.competencyIds,
  }));

  const overtimeRows = Object.values(
    snapshot.overtimeClaims
      .filter((claim) => claim.scheduleId === schedule.id && claim.date.slice(0, 7) === currentMonth)
      .reduce<Record<string, DisplayEmployee>>((rows, claim) => {
        const employee = employeeMap[claim.employeeId];

        if (!employee || employee.scheduleId === schedule.id) {
          return rows;
        }

        const homeSchedule = getScheduleById(snapshot, employee.scheduleId);
        const existingDates = rows[employee.id]?.overtimeDates ?? [];
        const existingCompetencies = rows[employee.id]?.overtimeCompetencyByDate ?? {};

        rows[employee.id] = {
          rowId: `ot:${schedule.id}:${employee.id}`,
          sourceEmployeeId: employee.id,
          name: employee.name,
          role: `${employee.role} · OT from ${homeSchedule.name}`,
          competencyIds: employee.competencyIds,
          overtimeDates: existingDates.includes(claim.date)
            ? existingDates
            : [...existingDates, claim.date].sort(),
          overtimeCompetencyByDate: {
            ...existingCompetencies,
            [claim.date]: claim.competencyId,
          },
        };

        return rows;
      }, {}),
  ).sort((left, right) => left.name.localeCompare(right.name));

  const mutualRows = Object.values(
    snapshot.assignments
      .filter((assignment) => assignment.date.slice(0, 7) === currentMonth)
      .reduce<Record<string, DisplayEmployee>>((rows, assignment) => {
        const parsed = parseMutualAssignmentNote(assignment.notes);

        if (parsed.targetScheduleId !== schedule.id) {
          return rows;
        }

        const employee = employeeMap[assignment.employeeId];

        if (!employee || employee.scheduleId === schedule.id) {
          return rows;
        }

        const homeSchedule = getScheduleById(snapshot, employee.scheduleId);
        const existingDates = rows[employee.id]?.mutualDates ?? [];

        rows[employee.id] = {
          rowId: `mut:${schedule.id}:${employee.id}`,
          sourceEmployeeId: employee.id,
          name: employee.name,
          role: `${employee.role} · Mutual from ${homeSchedule.name}`,
          competencyIds: employee.competencyIds,
          mutualDates: existingDates.includes(assignment.date)
            ? existingDates
            : [...existingDates, assignment.date].sort(),
        };

        return rows;
      }, {}),
  ).sort((left, right) => left.name.localeCompare(right.name));

  const rows = [...baseRows, ...overtimeRows, ...mutualRows];
  const pinnedIds = pinnedEmployeesBySchedule[schedule.id] ?? [];
  const pinnedIndex = new Map(pinnedIds.map((employeeId, index) => [employeeId, index]));

  return rows
    .map((employee, index) => ({ employee, index }))
    .sort((left, right) => {
      const leftPinned = pinnedIndex.get(left.employee.sourceEmployeeId);
      const rightPinned = pinnedIndex.get(right.employee.sourceEmployeeId);

      if (leftPinned !== undefined || rightPinned !== undefined) {
        if (leftPinned === undefined) {
          return 1;
        }

        if (rightPinned === undefined) {
          return -1;
        }

        if (leftPinned !== rightPinned) {
          return leftPinned - rightPinned;
        }
      }

      return left.index - right.index;
    })
    .map((entry) => entry.employee);
}

function isMonthKey(value: string) {
  return /^\d{4}-\d{2}$/.test(value);
}

function addMonths(monthKey: string, delta: number) {
  return shiftMonthKey(monthKey, delta);
}

function stripMonthWindowEntries(assignments: Record<string, AssignmentSelection>, monthKey: string) {
  const months = new Set([shiftMonthKey(monthKey, -1), monthKey, shiftMonthKey(monthKey, 1)]);

  return Object.fromEntries(
    Object.entries(assignments).filter((entry) => !months.has(entry[0].slice(-10, -3))),
  );
}

function pickMonthWindowEntries(assignments: Record<string, AssignmentSelection>, monthKey: string) {
  const months = new Set([shiftMonthKey(monthKey, -1), monthKey, shiftMonthKey(monthKey, 1)]);

  return Object.fromEntries(
    Object.entries(assignments).filter((entry) => months.has(entry[0].slice(-10, -3))),
  );
}

function getShiftTone(shift: ShiftKind) {
  if (shift === "DAY") {
    return "day";
  }

  if (shift === "NIGHT") {
    return "night";
  }

  return "off";
}

function stripMonthEntries(assignments: Record<string, AssignmentSelection>, monthKey: string) {
  return Object.fromEntries(
    Object.entries(assignments).filter((entry) => !entry[0].includes(`:${monthKey}-`)),
  );
}

function pickMonthEntries(assignments: Record<string, AssignmentSelection>, monthKey: string) {
  return Object.fromEntries(
    Object.entries(assignments).filter((entry) => entry[0].includes(`:${monthKey}-`)),
  );
}

function getCompactCode(code: string) {
  if (code.startsWith("Post ")) {
    return code.replace("Post ", "");
  }

  if (code.startsWith("Dock ")) {
    return code.replace("Dock ", "D");
  }

  if (code.startsWith("Pack ")) {
    return code.replace("Pack ", "PK");
  }

  return code.replace(/\s+/g, "");
}

/** Shortens names on narrow screens while keeping the first name intact. */
function getCompactEmployeeName(name: string) {
  const segments = name.trim().split(/\s+/).filter(Boolean);

  if (segments.length <= 1) {
    return name;
  }

  return `${segments[0]} ${segments[segments.length - 1][0]}.`;
}

function getScheduleAccent(scheduleId: string) {
  const accents = ["#f97316", "#0f766e", "#2563eb", "#be123c", "#7c3aed", "#4d7c0f"];
  let hash = 0;

  for (const character of scheduleId) {
    hash = (hash + character.charCodeAt(0)) % accents.length;
  }

  return accents[hash];
}

function cloneAssignments(assignments: Record<string, AssignmentSelection>) {
  return Object.fromEntries(
    Object.entries(assignments).map(([key, selection]) => [key, { ...selection }]),
  );
}

/**
 * Applies a confirmed save result back into the baseline map without touching
 * any newer browser-only edits that may have happened while the request was in
 * flight.
 */
function applySavedUpdatesToBaseline(
  baselineAssignments: Record<string, AssignmentSelection>,
  savedAssignments: Record<string, AssignmentSelection>,
  savedUpdates: Array<{ employeeId: string; date: string }>,
) {
  const nextAssignments = { ...baselineAssignments };

  for (const update of savedUpdates) {
    const key = createAssignmentKey(update.employeeId, update.date);
    const savedSelection = savedAssignments[key];

    if (savedSelection) {
      nextAssignments[key] = { ...savedSelection };
      continue;
    }

    delete nextAssignments[key];
  }

  return nextAssignments;
}

function applyStoredUpdatesToAssignments(
  assignments: Record<string, AssignmentSelection>,
  updates: StoredAssignment[],
) {
  const nextAssignments = { ...assignments };

  for (const update of updates) {
    const key = createAssignmentKey(update.employeeId, update.date);

    if (!update.competencyId && !update.timeCodeId && !update.notes) {
      delete nextAssignments[key];
      continue;
    }

    nextAssignments[key] = {
      competencyId: update.competencyId,
      timeCodeId: update.timeCodeId,
      notes: update.notes ?? null,
    };
  }

  return nextAssignments;
}

function buildDraftDelta(
  baselineAssignments: Record<string, AssignmentSelection>,
  draftAssignments: Record<string, AssignmentSelection>,
): PersistedDraftAssignments {
  return Array.from(
    new Set([...Object.keys(baselineAssignments), ...Object.keys(draftAssignments)]),
  ).reduce<PersistedDraftAssignments>((delta, key) => {
    const baseline = baselineAssignments[key] ?? null;
    const draft = draftAssignments[key] ?? null;

    if (
      baseline?.competencyId === draft?.competencyId &&
      baseline?.timeCodeId === draft?.timeCodeId &&
      baseline?.notes === draft?.notes
    ) {
      return delta;
    }

    delta[key] = draft ? { ...draft } : null;
    return delta;
  }, {});
}

/** Applies a nullable assignment delta to a copy of an assignment map. */
function applyAssignmentDelta(
  assignments: Record<string, AssignmentSelection>,
  delta: PersistedDraftAssignments,
) {
  const nextAssignments = { ...assignments };

  for (const [key, selection] of Object.entries(delta)) {
    if (selection) {
      nextAssignments[key] = { ...selection };
    } else {
      delete nextAssignments[key];
    }
  }

  return nextAssignments;
}

/** Small display helper for schedule header and set messages. */
function formatShortDate(isoDate: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

function formatMonthDateRange(monthDays: Array<{ date: string; dayNumber: number }>) {
  const firstDay = monthDays[0];

  if (!firstDay) {
    return "";
  }

  const firstDate = new Date(`${firstDay.date}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(firstDate);
}

function formatStaffCount(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function getDefaultSelection(_shiftKind: ShiftKind, _timeCodes: TimeCode[]): AssignmentSelection {
  return {
    competencyId: null,
    timeCodeId: null,
    notes: null,
  };
}

function getSelectionForCell(
  employeeId: string,
  date: string,
  shiftKind: ShiftKind,
  assignments: Record<string, AssignmentSelection>,
  timeCodes: TimeCode[],
) {
  const key = createAssignmentKey(employeeId, date);

  if (key in assignments) {
    return assignments[key];
  }

  return getDefaultSelection(shiftKind, timeCodes);
}

function isCompetency(competency: Competency | undefined): competency is Competency {
  return Boolean(competency);
}

function getSelectionCode(
  selection: AssignmentSelection,
  competencyMap: Record<string, Competency>,
  timeCodeMap: Record<string, TimeCode>,
) {
  if (selection.timeCodeId) {
    return timeCodeMap[selection.timeCodeId]?.code ?? "";
  }

  if (selection.competencyId) {
    return getCompactCode(competencyMap[selection.competencyId]?.code ?? "");
  }

  return "";
}

function buildSingleSetAutofillPlan({
  schedule,
  setDays,
  assignments,
  competencies,
  timeCodes,
}: {
  schedule: Schedule;
  setDays: Array<{ date: string }>;
  assignments: Record<string, AssignmentSelection>;
  competencies: Competency[];
  timeCodes: TimeCode[];
}) {
  // The auto-fill helper only touches fully blank workers so it never rewrites
  // a planner's partially curated set.
  const nextAssignments = { ...assignments };
  const setLength = setDays.length;

  if (setLength === 0) {
    return {
      nextAssignments,
      assignedWorkers: 0,
      assignedCells: 0,
      unresolvedCompetencies: 0,
    };
  }

  const missingCellsByCompetency = new Map<string, number>();

  for (const competency of competencies) {
    let filledCells = 0;

    for (const day of setDays) {
      for (const employee of schedule.employees) {
        const shiftKind = shiftForDate(schedule, day.date);
        const selection = getSelectionForCell(
          employee.id,
          day.date,
          shiftKind,
          nextAssignments,
          timeCodes,
        );

        if (selection.competencyId === competency.id) {
          filledCells += 1;
        }
      }
    }

    missingCellsByCompetency.set(
      competency.id,
      Math.max(0, competency.requiredStaff * setLength - filledCells),
    );
  }

  const fullyBlankWorkers = schedule.employees.filter((employee) =>
    setDays.every((day) => {
      const shiftKind = shiftForDate(schedule, day.date);
      const selection = getSelectionForCell(employee.id, day.date, shiftKind, nextAssignments, timeCodes);
      return !selection.competencyId && !selection.timeCodeId;
    }),
  );

  let assignedWorkers = 0;
  let assignedCells = 0;

  for (const employee of fullyBlankWorkers) {
    const availableCompetencyIds = employee.competencyIds
      .map((competencyId) => ({
        competencyId,
        missingCells: missingCellsByCompetency.get(competencyId) ?? 0,
      }))
      .filter((entry) => entry.missingCells > 0)
      .map((entry) => entry.competencyId);

    if (availableCompetencyIds.length === 0) {
      continue;
    }

    const bestCompetencyId =
      availableCompetencyIds[Math.floor(Math.random() * availableCompetencyIds.length)];

    for (const day of setDays) {
      nextAssignments[createAssignmentKey(employee.id, day.date)] = {
        competencyId: bestCompetencyId,
        timeCodeId: null,
        notes: null,
      };
      assignedCells += 1;
    }

    assignedWorkers += 1;
    missingCellsByCompetency.set(
      bestCompetencyId,
      Math.max(0, (missingCellsByCompetency.get(bestCompetencyId) ?? 0) - setLength),
    );
  }

  const unresolvedCompetencies = Array.from(missingCellsByCompetency.values()).filter((value) => value > 0).length;

  return {
    nextAssignments,
    assignedWorkers,
    assignedCells,
    unresolvedCompetencies,
  };
}

function buildSetAutofillPlan({
  schedule,
  setDays,
  assignments,
  competencies,
  timeCodes,
}: {
  schedule: Schedule;
  setDays: Array<{ date: string }>;
  assignments: Record<string, AssignmentSelection>;
  competencies: Competency[];
  timeCodes: TimeCode[];
}) {
  /**
   * Auto-fill intentionally uses a randomized choice among still-needed
   * competencies. That makes it more flexible, but it also means one pass can
   * land on a suboptimal combination even when another valid fill exists.
   *
   * To make the tool more robust without touching any manually entered cells,
   * we retry from the exact same untouched baseline up to five times and keep
   * the best result we found.
   */
  const maxAttempts = 5;
  let bestPlan = buildSingleSetAutofillPlan({
    schedule,
    setDays,
    assignments,
    competencies,
    timeCodes,
  });

  for (let attempt = 1; attempt < maxAttempts; attempt += 1) {
    if (bestPlan.unresolvedCompetencies === 0) {
      break;
    }

    const candidatePlan = buildSingleSetAutofillPlan({
      schedule,
      setDays,
      assignments,
      competencies,
      timeCodes,
    });

    const shouldReplace =
      candidatePlan.unresolvedCompetencies < bestPlan.unresolvedCompetencies ||
      (candidatePlan.unresolvedCompetencies === bestPlan.unresolvedCompetencies &&
        candidatePlan.assignedWorkers > bestPlan.assignedWorkers) ||
      (candidatePlan.unresolvedCompetencies === bestPlan.unresolvedCompetencies &&
        candidatePlan.assignedWorkers === bestPlan.assignedWorkers &&
        candidatePlan.assignedCells > bestPlan.assignedCells);

    if (shouldReplace) {
      bestPlan = candidatePlan;
    }
  }

  return bestPlan;
}

/** Window-centered assignment picker used for individual cell edits. */
function AssignmentModal({
  selectedEmployee,
  selectedDate,
  shiftKind,
  selection,
  competencies,
  timeCodes,
  onApply,
  onClear,
  onClose,
}: {
  selectedEmployee: DisplayEmployee | null;
  selectedDate: string | null;
  shiftKind: ShiftKind;
  selection: AssignmentSelection;
  competencies: Competency[];
  timeCodes: TimeCode[];
  onApply: (selection: AssignmentSelection) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  if (!selectedEmployee || !selectedDate) {
    return null;
  }

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="assignment-modal-backdrop" onClick={onClose}>
      <section
        className="assignment-modal"
        aria-label="Assignment editor"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="assignment-modal__header">
          <div>
            <h2 className="assignment-modal__title">Assignment</h2>
            <p className="assignment-modal__context">
              {selectedEmployee.name} · {formatShortDate(selectedDate)} · {shiftKind.toLowerCase()}
            </p>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="assignment-modal__group">
          <span className="assignment-modal__label">Time Codes</span>
          <div className="assignment-modal__options">
            {timeCodes.map((timeCode) => (
              <button
                key={timeCode.id}
                type="button"
                className={`legend-pill legend-pill--${timeCode.colorToken.toLowerCase()} ${
                  selection.timeCodeId === timeCode.id ? "legend-pill--selected" : ""
                }`}
                onClick={() => {
                  onApply({
                    ...selection,
                    competencyId: null,
                    timeCodeId: timeCode.id,
                  });
                  onClose();
                }}
              >
                {timeCode.code}
              </button>
            ))}
          </div>
        </div>

        <div className="assignment-modal__group">
          <span className="assignment-modal__label">Competencies</span>
          <div className="assignment-modal__options">
            {competencies.map((competency) => (
              <button
                key={competency.id}
                type="button"
                className={`legend-pill legend-pill--${competency.colorToken.toLowerCase()} ${
                  selection.competencyId === competency.id ? "legend-pill--selected" : ""
                }`}
                onClick={() => {
                  onApply({
                    ...selection,
                    competencyId: competency.id,
                    timeCodeId: null,
                  });
                  onClose();
                }}
              >
                {getCompactCode(competency.code)}
              </button>
            ))}
          </div>
        </div>

        <div className="assignment-modal__group">
          <label className="assignment-modal__label" htmlFor="assignment-note">
            Note
          </label>
          <textarea
            id="assignment-note"
            className="assignment-modal__note-input"
            rows={3}
            value={selection.notes ?? ""}
            placeholder="Add a note for this cell"
            onChange={(event) =>
              onApply({
                ...selection,
                notes: event.target.value || null,
              })
            }
          />
        </div>

        <div className="assignment-modal__footer">
          <button
            type="button"
            className="ghost-button"
            onClick={onClear}
          >
            Clear assignment
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export function MonthlyScheduler({
  initialSnapshot,
  initialPinnedEmployeesBySchedule,
  canEdit,
  canManageSetBuilder,
  canSwitchSchedule,
  forcedScheduleId,
}: {
  initialSnapshot: SchedulerSnapshot;
  initialPinnedEmployeesBySchedule: Record<string, string[]>;
  canEdit: boolean;
  canManageSetBuilder: boolean;
  canSwitchSchedule: boolean;
  forcedScheduleId: string | null;
}) {
  // `baselineAssignments` tracks the last server-confirmed state. `draftAssignments`
  // layers in local edits and set actions until auto-save confirms them or the user reverts.
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [currentMonth, setCurrentMonth] = useState(initialSnapshot.month);
  const [selectedScheduleId, setSelectedScheduleId] = useState(
    forcedScheduleId ?? initialSnapshot.schedules[0]?.id ?? "",
  );
  const [search, setSearch] = useState("");
  const [baselineAssignments, setBaselineAssignments] = useState(() =>
    buildAssignmentIndex(initialSnapshot.assignments),
  );
  const [draftAssignments, setDraftAssignments] = useState(() =>
    buildAssignmentIndex(initialSnapshot.assignments),
  );
  const [statusMessage, setStatusMessage] = useState("");
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);
  const [editorCell, setEditorCell] = useState<SelectedCell | null>(null);
  const [selectedSetAnchorDate, setSelectedSetAnchorDate] = useState<string | null>(null);
  const [selectedCoverageCompetencyId, setSelectedCoverageCompetencyId] = useState<string | null>(null);
  const [copiedSetTemplate, setCopiedSetTemplate] = useState<CopiedSetTemplate | null>(null);
  const [copiedColumnTemplate, setCopiedColumnTemplate] = useState<CopiedColumnTemplate | null>(null);
  const [dragRange, setDragRange] = useState<DragRange | null>(null);
  const [pinnedEmployeesBySchedule, setPinnedEmployeesBySchedule] = useState<Record<string, string[]>>(
    initialPinnedEmployeesBySchedule,
  );
  const [isDraftHydrated, setIsDraftHydrated] = useState(false);
  const [isMonthLoading, startMonthTransition] = useTransition();
  const [isSavingTransition, startSaveTransition] = useTransition();
  const [activeSaveCount, setActiveSaveCount] = useState(0);
  const [isUpdatingSetCompletion, startSetCompletionTransition] = useTransition();
  const [isSavingPins, startPinSaveTransition] = useTransition();
  const isSaving = isSavingTransition || activeSaveCount > 0;
  const isScheduleLocked = isSaving || isUpdatingSetCompletion;
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const latestAutoSaveTokenRef = useRef(0);
  const baselineAssignmentsRef = useRef(baselineAssignments);
  const draftAssignmentsRef = useRef(draftAssignments);
  const activeSaveCountRef = useRef(0);
  const preserveLocalBaselineUntilRef = useRef(0);

  const competencyMap = useMemo(() => getCompetencyMap(snapshot.competencies), [snapshot.competencies]);
  const timeCodeMap = useMemo(() => getTimeCodeMap(snapshot.timeCodes), [snapshot.timeCodes]);
  const employeeMap = useMemo(() => getEmployeeMap(snapshot.schedules), [snapshot.schedules]);
  const monthDays = useMemo(() => getMonthDays(currentMonth), [currentMonth]);
  const extendedMonthDays = useMemo(() => getExtendedMonthDays(currentMonth), [currentMonth]);
  const activeSchedule = getScheduleById(snapshot, selectedScheduleId);
  const activeScheduleId = activeSchedule?.id ?? "";
  const selectedSetDays = useMemo(
    () => (activeSchedule ? getWorkedSetDays(activeSchedule, extendedMonthDays, selectedSetAnchorDate) : []),
    [activeSchedule, extendedMonthDays, selectedSetAnchorDate],
  );
  const completedSetDates = useMemo(
    () => (activeSchedule ? getCompletedSetDatesForMonth(snapshot.completedSets, activeSchedule.id, monthDays) : new Set<string>()),
    [activeSchedule, monthDays, snapshot.completedSets],
  );
  const isSelectedSetComplete =
    activeSchedule && selectedSetDays.length > 0
      ? isCompletedSetRange(
          snapshot.completedSets,
          activeSchedule.id,
          selectedSetDays[0].date,
          selectedSetDays[selectedSetDays.length - 1].date,
        )
      : false;
  const canPasteSet =
    copiedSetTemplate !== null &&
    copiedSetTemplate.scheduleId === activeScheduleId &&
    copiedSetTemplate.setLength === selectedSetDays.length &&
    selectedSetDays.length > 0 &&
    !isSelectedSetComplete &&
    copiedSetTemplate.sourceStartDate !== selectedSetDays[0]?.date;
  const selectedColumnDate =
    selectedSetAnchorDate && monthDays.some((day) => day.date === selectedSetAnchorDate)
      ? selectedSetAnchorDate
      : null;
  const canPasteColumn =
    copiedColumnTemplate !== null &&
    copiedColumnTemplate.scheduleId === activeScheduleId &&
    selectedColumnDate !== null &&
    copiedColumnTemplate.sourceDate !== selectedColumnDate &&
    !completedSetDates.has(selectedColumnDate);
  const competencyCoverage = useMemo(() => {
    if (!activeSchedule) {
      return {};
    }

    return snapshot.competencies.reduce<Record<string, CoverageSummary>>((map, competency) => {
      let filledCells = 0;
      let hasOvertime = false;
      const missingDates: string[] = [];

      for (const day of selectedSetDays) {
        let filledOnDate = 0;

        for (const employee of activeSchedule.employees) {
          const shiftKind = shiftForDate(activeSchedule, day.date);
          const selection = getSelectionForCell(
            employee.id,
            day.date,
            shiftKind,
            draftAssignments,
            snapshot.timeCodes,
          );

          if (selection.competencyId === competency.id) {
            filledCells += 1;
            filledOnDate += 1;
          }
        }

        for (const claim of snapshot.overtimeClaims) {
          const claimEmployee = employeeMap[claim.employeeId];

          if (
            claim.scheduleId === activeSchedule.id &&
            claim.competencyId === competency.id &&
            claim.date === day.date &&
            claimEmployee?.scheduleId !== activeSchedule.id
          ) {
            filledCells += 1;
            filledOnDate += 1;
            hasOvertime = true;
          }
        }

        if (filledOnDate < competency.requiredStaff) {
          missingDates.push(day.date);
        }
      }

      const requiredCells = competency.requiredStaff * selectedSetDays.length;
      const assignedPeople = selectedSetDays.length > 0 ? filledCells / selectedSetDays.length : 0;

      map[competency.id] = {
        filledCells,
        requiredCells,
        assignedPeople,
        requiredStaff: competency.requiredStaff,
        hasOvertime,
        isUnderstaffed: selectedSetDays.length === 0 || filledCells < requiredCells,
        missingDates,
      };

      return map;
    }, {});
  }, [activeSchedule, draftAssignments, employeeMap, selectedSetDays, snapshot.competencies, snapshot.overtimeClaims, snapshot.timeCodes]);
  const unassignedSetCells = useMemo(() => {
    if (!activeSchedule || selectedSetDays.length === 0) {
      return [];
    }

    return activeSchedule.employees.flatMap((employee) =>
      selectedSetDays.flatMap((day) => {
        const shiftKind = shiftForDate(activeSchedule, day.date);
        const selection = getSelectionForCell(
          employee.id,
          day.date,
          shiftKind,
          draftAssignments,
          snapshot.timeCodes,
        );

        if (selection.competencyId || selection.timeCodeId) {
          return [];
        }

        return [
          {
            employeeName: employee.name,
            date: day.date,
          },
        ];
      }),
    );
  }, [activeSchedule, draftAssignments, selectedSetDays, snapshot.timeCodes]);
  const fullyBlankSetWorkers = useMemo(() => {
    if (!activeSchedule || selectedSetDays.length === 0) {
      return [];
    }

    return activeSchedule.employees.filter((employee) =>
      selectedSetDays.every((day) => {
        const shiftKind = shiftForDate(activeSchedule, day.date);
        const selection = getSelectionForCell(
          employee.id,
          day.date,
          shiftKind,
          draftAssignments,
          snapshot.timeCodes,
        );

        return !selection.competencyId && !selection.timeCodeId;
      }),
    );
  }, [activeSchedule, draftAssignments, selectedSetDays, snapshot.timeCodes]);
  const displayEmployees = useMemo<DisplayEmployee[]>(
    () =>
      activeSchedule
        ? buildDisplayEmployeesForSchedule({
            schedule: activeSchedule,
            snapshot,
            employeeMap,
            currentMonth,
            pinnedEmployeesBySchedule,
          })
        : [],
    [activeSchedule, currentMonth, employeeMap, pinnedEmployeesBySchedule, snapshot],
  );
  if (!activeSchedule) {
    return (
      <section className="panel-frame">
        <div className="panel-heading">
          <h1 className="panel-title">Schedule</h1>
        </div>

        <div className="workspace-toolbar workspace-toolbar--personnel">
          <p className="toolbar-status">No shifts available.</p>
        </div>
      </section>
    );
  }

  const visibleEmployees = displayEmployees.filter((employee) => {
    if (!deferredSearch) {
      return true;
    }

    return `${employee.name} ${employee.role}`.toLowerCase().includes(deferredSearch);
  });
  const displayEmployeeMap = useMemo(
    () => Object.fromEntries(displayEmployees.map((employee) => [employee.sourceEmployeeId, employee])),
    [displayEmployees],
  );

  const dirtyUpdates = useMemo(
    () =>
      Array.from(
        new Set([...Object.keys(baselineAssignments), ...Object.keys(draftAssignments)]),
      ).flatMap((key) => {
        const [employeeId, date] = key.split(":");
        const employee = employeeMap[employeeId];
        const employeeSchedule = employee ? getScheduleById(snapshot, employee.scheduleId) : null;

        if (!employee || !employeeSchedule) {
          return [];
        }

        const shiftKind = shiftForDate(employeeSchedule, date);
        const baseline = baselineAssignments[key] ?? { competencyId: null, timeCodeId: null, notes: null };
        const draft = draftAssignments[key] ?? { competencyId: null, timeCodeId: null, notes: null };

        if (
          baseline.competencyId === draft.competencyId &&
          baseline.timeCodeId === draft.timeCodeId &&
          baseline.notes === draft.notes
        ) {
          return [];
        }

        return [
          {
            employeeId,
            date,
            competencyId: draft.competencyId,
            timeCodeId: draft.timeCodeId,
            notes: draft.notes,
            shiftKind,
          },
        ];
      }),
    [baselineAssignments, draftAssignments, employeeMap, snapshot],
  );
  const hasChanges = dirtyUpdates.length > 0;

  const selectedEmployee = selectedCell ? displayEmployeeMap[selectedCell.employeeId] ?? null : null;
  const editorEmployee = editorCell ? displayEmployeeMap[editorCell.employeeId] ?? null : null;
  const editorShiftKind =
    editorCell && activeSchedule ? shiftForDate(activeSchedule, editorCell.date) : "OFF";
  const editorSelection =
    editorCell && editorEmployee
      ? getSelectionForCell(
          editorEmployee.sourceEmployeeId,
          editorCell.date,
          editorShiftKind,
          draftAssignments,
          snapshot.timeCodes,
        )
      : { competencyId: null, timeCodeId: null, notes: null };
  const editorEmployeeCompetencies = editorEmployee
    ? editorEmployee.competencyIds.map((competencyId) => competencyMap[competencyId]).filter(isCompetency)
    : [];
  const highlightedMissingDates = selectedCoverageCompetencyId
    ? new Set(competencyCoverage[selectedCoverageCompetencyId]?.missingDates ?? [])
    : new Set<string>();

  const gridColumns = `var(--schedule-name-column-width, 10.5rem) repeat(${monthDays.length}, minmax(3rem, 1fr))`;

  useEffect(() => {
    if (!forcedScheduleId || selectedScheduleId === forcedScheduleId) {
      return;
    }

    setSelectedScheduleId(forcedScheduleId);
  }, [forcedScheduleId, selectedScheduleId]);

  useEffect(() => {
    baselineAssignmentsRef.current = baselineAssignments;
  }, [baselineAssignments]);

  useEffect(() => {
    draftAssignmentsRef.current = draftAssignments;
  }, [draftAssignments]);

  useEffect(() => {
    activeSaveCountRef.current = activeSaveCount;
  }, [activeSaveCount]);

  function protectLocalBaselineFromStaleSnapshots() {
    preserveLocalBaselineUntilRef.current = Date.now() + STALE_SNAPSHOT_PROTECTION_MS;
  }

  async function runTrackedAssignmentSave(input: SaveAssignmentsInput) {
    activeSaveCountRef.current += 1;
    setActiveSaveCount((current) => current + 1);

    try {
      return await saveAssignments(input);
    } finally {
      activeSaveCountRef.current = Math.max(0, activeSaveCountRef.current - 1);
      setActiveSaveCount((current) => Math.max(0, current - 1));
    }
  }

  useEffect(() => {
    const nextAssignments = buildAssignmentIndex(initialSnapshot.assignments);
    const currentBaselineAssignments = baselineAssignmentsRef.current;
    const currentDraftAssignments = draftAssignmentsRef.current;
    const unsavedDraftDelta = buildDraftDelta(currentBaselineAssignments, currentDraftAssignments);
    const shouldProtectLocalBaseline =
      activeSaveCountRef.current > 0 || Date.now() < preserveLocalBaselineUntilRef.current;
    const locallyConfirmedDelta = shouldProtectLocalBaseline
      ? buildDraftDelta(nextAssignments, currentBaselineAssignments)
      : {};
    const mergedBaselineAssignments = applyAssignmentDelta(nextAssignments, locallyConfirmedDelta);

    setSnapshot(initialSnapshot);
    setCurrentMonth(initialSnapshot.month);
    setSelectedScheduleId((current) =>
      forcedScheduleId && initialSnapshot.schedules.some((schedule) => schedule.id === forcedScheduleId)
        ? forcedScheduleId
        : initialSnapshot.schedules.some((schedule) => schedule.id === current)
        ? current
        : initialSnapshot.schedules[0]?.id ?? "",
    );
    setBaselineAssignments(mergedBaselineAssignments);
    setDraftAssignments(() =>
      applyAssignmentDelta(mergedBaselineAssignments, unsavedDraftDelta),
    );
    setStatusMessage("");
    setDragRange(null);

    /**
     * Do not eagerly clear the active selection/editor state here.
     *
     * Why: autosave revalidates `/schedule`, which produces a fresh
     * `initialSnapshot` even when the user is still working in the same month.
     * If we always null out the editor on every incoming snapshot, an open cell
     * modal closes as soon as another save finishes in the background.
     *
     * Instead, we preserve the current UI target and let the narrower
     * visibility/completion effects below decide whether that cell is still
     * valid in the refreshed month data.
     */
  }, [forcedScheduleId, initialSnapshot]);

  useEffect(() => {
    if (!selectedCell) {
      return;
    }

    const employeeStillVisible = displayEmployees.some(
      (employee) => employee.sourceEmployeeId === selectedCell.employeeId,
    );
    const dateStillVisible = monthDays.some((day) => day.date === selectedCell.date);

    if (!employeeStillVisible || !dateStillVisible) {
      setSelectedCell(null);
    }
  }, [displayEmployees, monthDays, selectedCell]);

  useEffect(() => {
    if (!editorCell) {
      return;
    }

    const employeeStillVisible = displayEmployees.some(
      (employee) => employee.sourceEmployeeId === editorCell.employeeId,
    );
    const dateStillVisible = monthDays.some((day) => day.date === editorCell.date);

    if (!employeeStillVisible || !dateStillVisible) {
      setEditorCell(null);
    }
  }, [displayEmployees, editorCell, monthDays]);

  useEffect(() => {
    if (!editorCell || !completedSetDates.has(editorCell.date)) {
      return;
    }

    setEditorCell(null);
  }, [completedSetDates, editorCell]);

  useEffect(() => {
    if (!selectedSetAnchorDate || monthDays.some((day) => day.date === selectedSetAnchorDate)) {
      return;
    }

    setSelectedSetAnchorDate(null);
    setSelectedCoverageCompetencyId(null);
  }, [monthDays, selectedSetAnchorDate]);

  useEffect(() => {
    const savedDrafts = window.localStorage.getItem(STORAGE_KEY);

    if (savedDrafts) {
      try {
        const parsed = JSON.parse(savedDrafts) as PersistedDraftAssignments;
        setDraftAssignments((current) => {
          const next = { ...current };

          for (const [key, selection] of Object.entries(parsed)) {
            if (selection) {
              next[key] = selection;
            } else {
              delete next[key];
            }
          }

          return next;
        });
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }

    setIsDraftHydrated(true);
  }, []);

  useEffect(() => {
    setPinnedEmployeesBySchedule(initialPinnedEmployeesBySchedule);
  }, [initialPinnedEmployeesBySchedule]);

  useEffect(() => {
    if (!isDraftHydrated) {
      return;
    }

    const timer = window.setTimeout(() => {
      const delta = buildDraftDelta(baselineAssignments, draftAssignments);

      if (Object.keys(delta).length === 0) {
        window.localStorage.removeItem(STORAGE_KEY);
        return;
      }

      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(delta));
    }, 160);

    return () => window.clearTimeout(timer);
  }, [baselineAssignments, draftAssignments, isDraftHydrated]);

  useEffect(() => {
    // Treat an open cell editor like an in-progress edit session: keep the
    // draft local, then autosave once the modal closes.
    if (!canEdit || isSaving || !isDraftHydrated || !hasChanges || editorCell) {
      return;
    }

    const scheduledUpdates = dirtyUpdates.map((update) => ({ ...update }));
    const scheduledDraftAssignments = cloneAssignments(draftAssignments);
    const autoSaveToken = latestAutoSaveTokenRef.current + 1;

    latestAutoSaveTokenRef.current = autoSaveToken;

    const timer = window.setTimeout(() => {
      startSaveTransition(async () => {
        if (latestAutoSaveTokenRef.current === autoSaveToken) {
          setStatusMessage(
            `Saving ${scheduledUpdates.length} change${scheduledUpdates.length === 1 ? "" : "s"}...`,
          );
        }

        const result = await runTrackedAssignmentSave({
          scheduleId: activeSchedule.id,
          updates: scheduledUpdates,
        });

        if (result.ok) {
          protectLocalBaselineFromStaleSnapshots();
          setBaselineAssignments((current) =>
            applySavedUpdatesToBaseline(current, scheduledDraftAssignments, scheduledUpdates),
          );
        }

        if (latestAutoSaveTokenRef.current === autoSaveToken) {
          setStatusMessage(result.ok ? "Changes saved automatically." : result.message);
        }
      });
    }, AUTO_SAVE_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [activeSchedule.id, canEdit, dirtyUpdates, draftAssignments, editorCell, hasChanges, isDraftHydrated, isSaving]);

  useEffect(() => {
    function handlePointerUp() {
      if (!dragRange) {
        return;
      }

      const startIndex = Math.min(dragRange.startIndex, dragRange.currentIndex);
      const endIndex = Math.max(dragRange.startIndex, dragRange.currentIndex);

      if (endIndex > startIndex) {
        const rangeDates = monthDays.slice(startIndex, endIndex + 1).map((day) => day.date);

        startTransition(() => {
          setDraftAssignments((current) => {
            const nextAssignments = { ...current };

            for (const date of rangeDates) {
              const employee = employeeMap[dragRange.employeeId];
              const employeeSchedule = employee ? getScheduleById(snapshot, employee.scheduleId) : null;

              if (!employee || !employeeSchedule) {
                continue;
              }

              const shiftKind = shiftForDate(employeeSchedule, date);
              const defaultSelection = getDefaultSelection(shiftKind, snapshot.timeCodes);
              const key = createAssignmentKey(dragRange.employeeId, date);

              if (
                defaultSelection.competencyId === dragRange.selection.competencyId &&
                defaultSelection.timeCodeId === dragRange.selection.timeCodeId &&
                defaultSelection.notes === dragRange.selection.notes
              ) {
                delete nextAssignments[key];
                continue;
              }

              nextAssignments[key] = {
                ...dragRange.selection,
              };
            }

            return nextAssignments;
          });
          setStatusMessage(`Copied assignment across ${rangeDates.length} days`);
        });
      }

      setDragRange(null);
    }

    window.addEventListener("pointerup", handlePointerUp);

    return () => window.removeEventListener("pointerup", handlePointerUp);
  }, [dragRange, employeeMap, monthDays, snapshot, snapshot.timeCodes]);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setEditorCell(null);
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, []);

  useEffect(() => {
    if (currentMonth === snapshot.month || !isMonthKey(currentMonth)) {
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    setStatusMessage(`Loading ${formatMonthLabel(currentMonth)}`);

    fetch(`/api/scheduler?month=${currentMonth}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Unable to load month data.");
        }

        const nextSnapshot = (await response.json()) as SchedulerSnapshot;

        if (cancelled) {
          return;
        }

        const incomingMonthAssignments = buildAssignmentIndex(nextSnapshot.assignments);

        startTransition(() => {
          setSnapshot(nextSnapshot);
          setSelectedScheduleId((current) =>
            forcedScheduleId && nextSnapshot.schedules.some((schedule) => schedule.id === forcedScheduleId)
              ? forcedScheduleId
              : nextSnapshot.schedules.some((schedule) => schedule.id === current)
              ? current
              : nextSnapshot.schedules[0]?.id ?? "",
          );
          setBaselineAssignments((current) => ({
            ...stripMonthWindowEntries(current, currentMonth),
            ...incomingMonthAssignments,
          }));
          setDraftAssignments((current) => ({
            ...stripMonthWindowEntries(current, currentMonth),
            ...incomingMonthAssignments,
            ...pickMonthWindowEntries(current, currentMonth),
          }));
          setStatusMessage(`Loaded ${formatMonthLabel(currentMonth)}`);
        });
      })
      .catch((error) => {
        if (cancelled || error instanceof DOMException) {
          return;
        }

        setStatusMessage("Could not load that month. Staying on your current draft.");
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [currentMonth, snapshot.month]);

  function handleAssignmentChange(employeeId: string, date: string, selection: AssignmentSelection) {
    if (isScheduleLocked) {
      return;
    }

    const employee = employeeMap[employeeId];
    const employeeSchedule = employee ? getScheduleById(snapshot, employee.scheduleId) : null;

    if (!employee || !employeeSchedule) {
      return;
    }

    const shiftKind = shiftForDate(employeeSchedule, date);
    const defaultSelection = getDefaultSelection(shiftKind, snapshot.timeCodes);
    const key = createAssignmentKey(employeeId, date);
    const shouldResetToDefault =
      defaultSelection.competencyId === selection.competencyId &&
      defaultSelection.timeCodeId === selection.timeCodeId &&
      defaultSelection.notes === selection.notes;

    startTransition(() => {
      setDraftAssignments((current) => {
        const nextAssignments = { ...current };

        if (shouldResetToDefault) {
          delete nextAssignments[key];
          return nextAssignments;
        }

        nextAssignments[key] = selection;
        return nextAssignments;
      });
      setStatusMessage("Draft updated locally");
    });
  }

  function handleCellPointerDown(
    employeeId: string,
    date: string,
    dayIndex: number,
    selection: AssignmentSelection,
  ) {
    if (isScheduleLocked) {
      return;
    }

    setSelectedCell({ employeeId, date });
    setDragRange({
      employeeId,
      startIndex: dayIndex,
      currentIndex: dayIndex,
      selection,
    });
  }

  function handleDragHover(employeeId: string, dayIndex: number) {
    if (isScheduleLocked) {
      return;
    }

    setDragRange((current) => {
      if (!current || current.employeeId !== employeeId || current.currentIndex === dayIndex) {
        return current;
      }

      return {
        ...current,
        currentIndex: dayIndex,
      };
    });
  }

  function handleMonthChange(delta: number) {
    startMonthTransition(() => {
      setCurrentMonth((current) => {
        const nextMonth = addMonths(current, delta);
        router.push(`/schedule?month=${nextMonth}`, { scroll: false });
        return nextMonth;
      });
      setStatusMessage("Changing month");
    });
  }

  function saveBulkAssignmentUpdates(updates: StoredAssignment[], successMessage: string) {
    if (!canEdit || isScheduleLocked || updates.length === 0) {
      return;
    }

    const scheduledUpdates = updates.map((update) => ({ ...update }));
    const autoSaveToken = latestAutoSaveTokenRef.current + 1;

    latestAutoSaveTokenRef.current = autoSaveToken;

    startSaveTransition(async () => {
      if (latestAutoSaveTokenRef.current === autoSaveToken) {
        setStatusMessage(
          `Saving ${scheduledUpdates.length} pasted cell${scheduledUpdates.length === 1 ? "" : "s"}...`,
        );
      }

      const result = await runTrackedAssignmentSave({
        scheduleId: activeSchedule.id,
        updates: scheduledUpdates,
      });

      if (result.ok) {
        protectLocalBaselineFromStaleSnapshots();
        setBaselineAssignments((current) => applyStoredUpdatesToAssignments(current, scheduledUpdates));
      }

      if (latestAutoSaveTokenRef.current === autoSaveToken) {
        setStatusMessage(result.ok ? successMessage : result.message);
      }
    });
  }

  function handlePinToggle(employeeId: string) {
    const currentPins = pinnedEmployeesBySchedule[activeSchedule.id] ?? [];
    const nextPins = currentPins.includes(employeeId)
      ? currentPins.filter((pinnedEmployeeId) => pinnedEmployeeId !== employeeId)
      : [...currentPins, employeeId];

    startTransition(() => {
      setPinnedEmployeesBySchedule((current) => {
        const next = Object.fromEntries(
          Object.entries(current).map(([scheduleId, employeeIds]) => [scheduleId, [...employeeIds]]),
        ) as Record<string, string[]>;

        if (nextPins.length === 0) {
          delete next[activeSchedule.id];
        } else {
          next[activeSchedule.id] = nextPins;
        }

        if (currentPins.includes(employeeId)) {
          setStatusMessage("Employee unpinned");
          return next;
        }

        setStatusMessage("Employee pinned to top");
        return next;
      });
    });

    startPinSaveTransition(async () => {
      const result = await saveSchedulePins({
        scheduleId: activeSchedule.id,
        pinnedEmployeeIds: nextPins,
      });

      if (!result.ok) {
        setStatusMessage(result.message);
      }
    });
  }

  function handleSetCompletion() {
    if (isScheduleLocked || !canEdit || !canManageSetBuilder || selectedSetDays.length === 0) {
      return;
    }

    const startDate = selectedSetDays[0].date;
    const endDate = selectedSetDays[selectedSetDays.length - 1].date;
    const nextIsComplete = !isSelectedSetComplete;

    if (nextIsComplete && unassignedSetCells.length > 0) {
      const preview = unassignedSetCells
        .slice(0, 3)
        .map((cell) => `${cell.employeeName} on ${formatShortDate(cell.date)}`)
        .join(", ");
      const remainingCount = Math.max(0, unassignedSetCells.length - 3);
      const shouldContinue = window.confirm(
        `${unassignedSetCells.length} working cell${unassignedSetCells.length === 1 ? " is" : "s are"} still blank in this set${
          preview ? `, including ${preview}` : ""
        }${remainingCount > 0 ? `, plus ${remainingCount} more` : ""}. If you continue, those staff will be treated as off and overtime will post as needed. Continue?`,
      );

      if (!shouldContinue) {
        return;
      }
    }

    startSetCompletionTransition(async () => {
      /**
       * Completing a set causes the page to revalidate from Supabase. If we let
       * that happen while there are still unsaved local draft cells, the fresh
       * server snapshot will not include those browser-only edits and they will
       * appear to "turn into OFF". Saving first keeps time codes and
       * competencies in sync with the completion toggle.
       */
      if (dirtyUpdates.length > 0) {
        const saveResult = await runTrackedAssignmentSave({
          scheduleId: activeSchedule.id,
          updates: dirtyUpdates,
        });

        setStatusMessage(saveResult.message);

        if (!saveResult.ok) {
          return;
        }

        protectLocalBaselineFromStaleSnapshots();
        setBaselineAssignments(cloneAssignments(draftAssignments));
      }

      const result = await setScheduleSetCompletion({
        scheduleId: activeSchedule.id,
        month: currentMonth,
        startDate,
        endDate,
        isComplete: nextIsComplete,
      });

      setStatusMessage(result.message);

      if (!result.ok) {
        return;
      }

      const removedClaims = snapshot.overtimeClaims.filter(
        (claim) =>
          claim.scheduleId === activeSchedule.id &&
          claim.date >= startDate &&
          claim.date <= endDate,
      );
      const removedClaimKeys = new Set(
        removedClaims.map((claim) => createAssignmentKey(claim.employeeId, claim.date)),
      );

      startTransition(() => {
        setSnapshot((current) => ({
          ...current,
          completedSets: toggleCompletedSetEntries(
            current.completedSets,
            activeSchedule.id,
            startDate,
            endDate,
            nextIsComplete,
          ),
          overtimeClaims: nextIsComplete
            ? current.overtimeClaims
            : current.overtimeClaims.filter(
                (claim) =>
                  claim.scheduleId !== activeSchedule.id ||
                  claim.date < startDate ||
                  claim.date > endDate,
              ),
        }));

        if (!nextIsComplete && removedClaimKeys.size > 0) {
          setBaselineAssignments((current) => {
            const next = { ...current };
            removedClaimKeys.forEach((key) => delete next[key]);
            return next;
          });
          setDraftAssignments((current) => {
            const next = { ...current };
            removedClaimKeys.forEach((key) => delete next[key]);
            return next;
          });
        }
      });
    });
  }

  function handleAutofillSet() {
    if (isScheduleLocked || !canEdit || !canManageSetBuilder || selectedSetDays.length === 0 || isSelectedSetComplete) {
      return;
    }

    const plan = buildSetAutofillPlan({
      schedule: activeSchedule,
      setDays: selectedSetDays,
      assignments: draftAssignments,
      competencies: snapshot.competencies,
      timeCodes: snapshot.timeCodes,
    });

    if (plan.assignedWorkers === 0) {
      setStatusMessage(
        fullyBlankSetWorkers.length === 0
          ? "No fully blank workers available in this set."
          : "No qualified blank workers could fill the remaining post requirements.",
      );
      return;
    }

    startTransition(() => {
      setDraftAssignments(plan.nextAssignments);
      setStatusMessage(
        plan.unresolvedCompetencies > 0
          ? `Auto-filled ${plan.assignedWorkers} worker${plan.assignedWorkers === 1 ? "" : "s"} across ${plan.assignedCells} cells. ${plan.unresolvedCompetencies} post requirement${plan.unresolvedCompetencies === 1 ? "" : "s"} still short.`
          : `Auto-filled ${plan.assignedWorkers} worker${plan.assignedWorkers === 1 ? "" : "s"} across ${plan.assignedCells} cells.`,
      );
    });
  }

  function handleCopySet() {
    if (isScheduleLocked || !canManageSetBuilder || selectedSetDays.length === 0 || !isSelectedSetComplete) {
      return;
    }

    const selectionsByEmployeeId = Object.fromEntries(
      activeSchedule.employees.map((employee) => [
        employee.id,
        selectedSetDays.map((day) =>
          getSelectionForCell(
            employee.id,
            day.date,
            shiftForDate(activeSchedule, day.date),
            draftAssignments,
            snapshot.timeCodes,
          ),
        ),
      ]),
    );

    setCopiedSetTemplate({
      scheduleId: activeSchedule.id,
      sourceStartDate: selectedSetDays[0].date,
      setLength: selectedSetDays.length,
      selectionsByEmployeeId,
    });
    setStatusMessage("Set copied. Select another set on this shift to paste it.");
  }

  function handlePasteSet() {
    if (isScheduleLocked || !canEdit || !canManageSetBuilder || !copiedSetTemplate || !canPasteSet) {
      return;
    }

    const pasteUpdates = activeSchedule.employees.flatMap<StoredAssignment>((employee) => {
      const copiedSelections = copiedSetTemplate.selectionsByEmployeeId[employee.id];

      if (!copiedSelections) {
        return [];
      }

      return selectedSetDays.map((day, index) => {
        const copiedSelection =
          copiedSelections[index] ?? getDefaultSelection(shiftForDate(activeSchedule, day.date), snapshot.timeCodes);

        return {
          employeeId: employee.id,
          scheduleId: activeSchedule.id,
          date: day.date,
          competencyId: copiedSelection.competencyId,
          timeCodeId: copiedSelection.timeCodeId,
          notes: copiedSelection.notes ?? null,
          shiftKind: shiftForDate(activeSchedule, day.date),
        };
      });
    });
    const successMessage = `Pasted set onto ${formatShortDate(selectedSetDays[0].date)}-${formatShortDate(
      selectedSetDays[selectedSetDays.length - 1].date,
    )} and saved.`;

    startTransition(() => {
      setDraftAssignments((current) => applyStoredUpdatesToAssignments(current, pasteUpdates));
      setStatusMessage(successMessage.replace(" and saved.", "."));
    });

    saveBulkAssignmentUpdates(pasteUpdates, successMessage);
  }

  function handleCopyColumn() {
    if (isScheduleLocked || !canManageSetBuilder || !selectedColumnDate) {
      return;
    }

    const selectionsByEmployeeId = Object.fromEntries(
      activeSchedule.employees.map((employee) => [
        employee.id,
        getSelectionForCell(
          employee.id,
          selectedColumnDate,
          shiftForDate(activeSchedule, selectedColumnDate),
          draftAssignments,
          snapshot.timeCodes,
        ),
      ]),
    );

    setCopiedColumnTemplate({
      scheduleId: activeSchedule.id,
      sourceDate: selectedColumnDate,
      selectionsByEmployeeId,
    });
    setStatusMessage(`Column copied from ${formatShortDate(selectedColumnDate)}.`);
  }

  function handlePasteColumn() {
    if (isScheduleLocked || !canEdit || !canManageSetBuilder || !copiedColumnTemplate || !selectedColumnDate || !canPasteColumn) {
      return;
    }

    const pasteUpdates = activeSchedule.employees.map<StoredAssignment>((employee) => {
      const copiedSelection = copiedColumnTemplate.selectionsByEmployeeId[employee.id];
      const nextSelection =
        copiedSelection ??
        getDefaultSelection(shiftForDate(activeSchedule, selectedColumnDate), snapshot.timeCodes);

      return {
        employeeId: employee.id,
        scheduleId: activeSchedule.id,
        date: selectedColumnDate,
        competencyId: nextSelection.competencyId,
        timeCodeId: nextSelection.timeCodeId,
        notes: nextSelection.notes ?? null,
        shiftKind: shiftForDate(activeSchedule, selectedColumnDate),
      };
    });
    const successMessage = `Pasted column onto ${formatShortDate(selectedColumnDate)} and saved.`;

    startTransition(() => {
      setDraftAssignments((current) => applyStoredUpdatesToAssignments(current, pasteUpdates));
      setStatusMessage(successMessage.replace(" and saved.", "."));
    });

    saveBulkAssignmentUpdates(pasteUpdates, successMessage);
  }

  function handleClearSet() {
    if (isScheduleLocked || !canEdit || !canManageSetBuilder || selectedSetDays.length === 0 || isSelectedSetComplete) {
      return;
    }

    startTransition(() => {
      setDraftAssignments((current) => {
        const nextAssignments = { ...current };

        for (const employee of activeSchedule.employees) {
          for (const day of selectedSetDays) {
            delete nextAssignments[createAssignmentKey(employee.id, day.date)];
          }
        }

        return nextAssignments;
      });
      setStatusMessage(
        `Cleared ${activeSchedule.name} set from ${formatShortDate(selectedSetDays[0].date)} to ${formatShortDate(
          selectedSetDays[selectedSetDays.length - 1].date,
        )}.`,
      );
    });
  }

  function handlePrintSchedules() {
    const target = `/schedule/print?month=${currentMonth}`;
    const printWindow = window.open(target, "_blank");

    if (!printWindow) {
      router.push(target);
    }
  }

  return (
    <section
      className="panel-frame"
      style={{ "--team-accent": getScheduleAccent(activeSchedule.id) } as CSSProperties}
    >
      <div className="panel-heading panel-heading--split">
        <h1 className="panel-title">{formatMonthDateRange(monthDays)}</h1>
        <div className="planner-actions">
          <div className="planner-actions__row planner-actions__row--nav">
            <button type="button" className="ghost-button" onClick={() => handleMonthChange(-1)}>
              Previous month
            </button>
            <button type="button" className="ghost-button" onClick={() => handleMonthChange(1)}>
              Next month
            </button>
          </div>
          <div className="planner-actions__row planner-actions__row--save">
            <button type="button" className="ghost-button" onClick={handlePrintSchedules}>
              Print schedules
            </button>
          </div>
        </div>
      </div>

      <div className="workspace-toolbar workspace-toolbar--scheduler">
        {canSwitchSchedule ? (
          <label className="field">
            <span>Shift</span>
            <select
              value={selectedScheduleId}
              onChange={(event) => {
                setSelectedScheduleId(event.target.value);
                setSelectedCoverageCompetencyId(null);
              }}
            >
              {snapshot.schedules.map((schedule) => (
                <option key={schedule.id} value={schedule.id}>
                  {schedule.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="field field--static">
            <span>Shift</span>
            <strong>{activeSchedule.name}</strong>
          </div>
        )}

        <label className="field">
          <span>Search employee</span>
          <input
            type="search"
            placeholder="Enter employee name"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="toolbar-status-wrap">
          {isMonthLoading ? <p className="toolbar-status">Loading month...</p> : null}
          {!isMonthLoading && statusMessage ? <p className="toolbar-status">{statusMessage}</p> : null}
        </div>
      </div>

      {canManageSetBuilder && selectedSetDays.length > 0 ? (
        <section className="set-builder" aria-label="Set builder">
          <div className="set-builder__surface">
            <div className="set-builder-heading">
              <div className="set-builder-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={handleCopyColumn}
                  disabled={isScheduleLocked || !selectedColumnDate}
                >
                  Copy column
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={handlePasteColumn}
                  disabled={isScheduleLocked || !canPasteColumn}
                >
                  Paste column
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={handleCopySet}
                  disabled={isScheduleLocked || selectedSetDays.length === 0 || !isSelectedSetComplete}
                >
                  Copy set
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={handlePasteSet}
                  disabled={isScheduleLocked || !canPasteSet}
                >
                  Paste set
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={handleClearSet}
                  disabled={isScheduleLocked || selectedSetDays.length === 0 || isSelectedSetComplete}
                >
                  Clear set
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={handleAutofillSet}
                  disabled={
                    isScheduleLocked ||
                    selectedSetDays.length === 0 ||
                    isSelectedSetComplete ||
                    fullyBlankSetWorkers.length === 0
                  }
                >
                  Auto-fill set
                </button>
                <button
                  type="button"
                  className={`ghost-button ${isSelectedSetComplete ? "ghost-button--active" : ""}`}
                  onClick={handleSetCompletion}
                  disabled={isScheduleLocked || selectedSetDays.length === 0}
                >
                  {isUpdatingSetCompletion
                    ? isSelectedSetComplete
                      ? "Reopening..."
                      : "Completing..."
                    : isSelectedSetComplete
                    ? "Set Complete"
                    : "Mark Set Complete"}
                </button>
              </div>
              <div className="set-builder-legend">
                <span className="set-builder-legend__item">Filled</span>
                <span className="set-builder-legend__item set-builder-legend__item--under">Understaffed</span>
                <span className="set-builder-legend__item set-builder-legend__item--ot">Overtime</span>
              </div>
            </div>

            <div className="set-builder-pills">
              {snapshot.competencies.map((competency) => {
                const coverage = competencyCoverage[competency.id];

                return (
                  <button
                    key={competency.id}
                    type="button"
                    onClick={() =>
                      setSelectedCoverageCompetencyId((current) =>
                        current === competency.id ? null : competency.id,
                      )
                    }
                    className={`set-builder-pill legend-pill legend-pill--${competency.colorToken.toLowerCase()} ${
                      coverage?.isUnderstaffed ? "set-builder-pill--understaffed" : ""
                    } ${coverage?.hasOvertime ? "set-builder-pill--overtime" : ""} ${
                      !coverage?.isUnderstaffed && selectedSetDays.length > 0 ? "set-builder-pill--filled" : ""
                    } ${
                      selectedSetDays.length === 0 ? "set-builder-pill--disabled" : ""
                    } ${selectedCoverageCompetencyId === competency.id ? "set-builder-pill--active" : ""}`}
                    title={`${competency.label} · ${coverage?.filledCells ?? 0}/${coverage?.requiredCells ?? 0} cells filled in this set`}
                    disabled={isScheduleLocked || selectedSetDays.length === 0}
                  >
                    <strong>{getCompactCode(competency.code)}</strong>
                    <span>{formatStaffCount(coverage?.assignedPeople ?? 0)}/{coverage?.requiredStaff ?? competency.requiredStaff}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      <section
        className={`schedule-wrap ${isScheduleLocked ? "schedule-wrap--locked" : ""}`}
        aria-label="Monthly schedule grid"
        aria-busy={isScheduleLocked}
      >
        <div className="schedule-grid" style={{ gridTemplateColumns: gridColumns }}>
          <div className="employee-header sticky-column">
            <span>{formatMonthLabel(currentMonth)}</span>
            <strong>Employees</strong>
          </div>

          {monthDays.map((day) => {
            const isSetDay = selectedSetDays.some((setDay) => setDay.date === day.date);
            const isMissingDay = highlightedMissingDates.has(day.date);
            const isCompletedDay = completedSetDates.has(day.date);

            return (
              <div
                key={day.date}
                className={`day-header ${day.isWeekend ? "day-header--weekend" : ""} ${
                  isCompletedDay ? "day-header--completed" : ""
                } ${
                  selectedSetAnchorDate === day.date ? "day-header--set-anchor" : ""
                } ${isSetDay ? "day-header--set" : ""} ${isMissingDay ? "day-header--missing" : ""}`}
                title={`${day.dayName} ${day.date}`}
                onClick={
                  canManageSetBuilder && !isScheduleLocked
                    ? () => {
                        setSelectedSetAnchorDate(day.date);
                        setSelectedCoverageCompetencyId(null);
                      }
                    : undefined
                }
              >
                <span>{day.dayName.slice(0, 1)}</span>
                <strong>{day.dayNumber}</strong>
              </div>
            );
          })}

          {visibleEmployees.map((employee) => (
            <EmployeeRow
              key={employee.rowId}
              employee={employee}
              isPinned={(pinnedEmployeesBySchedule[activeSchedule.id] ?? []).includes(employee.sourceEmployeeId)}
              schedule={activeSchedule}
              monthDays={monthDays}
              assignments={draftAssignments}
              competencyMap={competencyMap}
              timeCodeMap={timeCodeMap}
              timeCodes={snapshot.timeCodes}
              completedSetDates={completedSetDates}
              selectedCell={selectedCell}
              dragRange={dragRange}
              highlightedMissingDates={highlightedMissingDates}
              selectedCoverageCompetencyId={selectedCoverageCompetencyId}
              selectedSetDays={selectedSetDays}
              canEdit={canEdit && !isScheduleLocked}
              onPinToggle={handlePinToggle}
              onCellPointerDown={handleCellPointerDown}
              onDragHover={handleDragHover}
              onCellClick={(cell) => {
                if (!canEdit || isScheduleLocked) {
                  return;
                }

                setSelectedCell(cell);
                setEditorCell(cell);
              }}
            />
          ))}

          {visibleEmployees.length === 0 ? (
            <div
              className="empty-state sticky-column"
              style={{ gridColumn: `1 / span ${monthDays.length + 1}` }}
            >
              <strong>No employees matched that search.</strong>
              <span>Try a different name, role, or clear the filter.</span>
            </div>
          ) : null}
        </div>
      </section>

      {canEdit && !isScheduleLocked ? (
        <AssignmentModal
          selectedEmployee={editorEmployee}
          selectedDate={editorCell?.date ?? null}
          shiftKind={editorShiftKind}
          selection={editorSelection}
          competencies={editorEmployeeCompetencies}
          timeCodes={snapshot.timeCodes}
          onApply={(selection) => {
            if (!editorCell) {
              return;
            }

            handleAssignmentChange(editorCell.employeeId, editorCell.date, selection);
          }}
          onClear={() => {
            if (!editorCell) {
              return;
            }

            handleAssignmentChange(
              editorCell.employeeId,
              editorCell.date,
              getDefaultSelection(editorShiftKind, snapshot.timeCodes),
            );
            setEditorCell(null);
          }}
          onClose={() => setEditorCell(null)}
        />
      ) : null}
    </section>
  );
}

function EmployeeRow({
  employee,
  isPinned,
  schedule,
  monthDays,
  assignments,
  competencyMap,
  timeCodeMap,
  timeCodes,
  completedSetDates,
  selectedCell,
  dragRange,
  highlightedMissingDates,
  selectedCoverageCompetencyId,
  selectedSetDays,
  canEdit,
  onPinToggle,
  onCellPointerDown,
  onDragHover,
  onCellClick,
}: {
  employee: DisplayEmployee;
  isPinned: boolean;
  schedule: Schedule;
  monthDays: Array<{ date: string; dayNumber: number; dayName: string; isWeekend: boolean }>;
  assignments: Record<string, AssignmentSelection>;
  competencyMap: Record<string, Competency>;
  timeCodeMap: Record<string, TimeCode>;
  timeCodes: TimeCode[];
  completedSetDates: Set<string>;
  selectedCell: SelectedCell | null;
  dragRange: DragRange | null;
  highlightedMissingDates: Set<string>;
  selectedCoverageCompetencyId: string | null;
  selectedSetDays: Array<{ date: string }>;
  canEdit: boolean;
  onPinToggle: (employeeId: string) => void;
  onCellPointerDown: (
    employeeId: string,
    date: string,
    dayIndex: number,
    selection: AssignmentSelection,
  ) => void;
  onDragHover: (employeeId: string, dayIndex: number) => void;
  onCellClick: (cell: SelectedCell) => void;
}) {
  const setDates = new Set(selectedSetDays.map((day) => day.date));
  const overtimeDateSet = employee.overtimeDates ? new Set(employee.overtimeDates) : null;
  const mutualDateSet = employee.mutualDates ? new Set(employee.mutualDates) : null;

  return (
    <>
      <div className="employee-cell sticky-column">
        <div className="employee-cell__main">
          <strong title={employee.name}>
            <span className="employee-name-full">{employee.name}</span>
            <span className="employee-name-compact">{getCompactEmployeeName(employee.name)}</span>
          </strong>
          <span>{employee.role}</span>
        </div>
        <button
          type="button"
          className={`employee-pin-button ${isPinned ? "employee-pin-button--active" : ""}`}
          onClick={() => onPinToggle(employee.sourceEmployeeId)}
          aria-pressed={isPinned}
          title={isPinned ? "Unpin employee" : "Pin employee to top"}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 3h6l-1 5 4 4v2h-5v7l-1-1-1 1v-7H6v-2l4-4-1-5Z" />
          </svg>
        </button>
      </div>

      {monthDays.map((day, dayIndex) => {
        const isBorrowedCellVisible =
          (!overtimeDateSet || overtimeDateSet.has(day.date)) &&
          (!mutualDateSet || mutualDateSet.has(day.date));
        const isLockedCell = completedSetDates.has(day.date);
        const shiftKind = isBorrowedCellVisible ? shiftForDate(schedule, day.date) : "OFF";
        const selection = isBorrowedCellVisible
          ? getSelectionForCell(
              employee.sourceEmployeeId,
              day.date,
              shiftKind,
              assignments,
              timeCodes,
            )
          : {
              competencyId: null,
              timeCodeId: null,
              notes: null,
            };
        const overtimeClaimCompetencyId =
          !selection.competencyId && !selection.timeCodeId
            ? employee.overtimeCompetencyByDate?.[day.date] ?? null
            : null;
        const effectiveSelection =
          overtimeClaimCompetencyId
            ? {
                competencyId: overtimeClaimCompetencyId,
                timeCodeId: null,
                notes: selection.notes,
              }
            : selection;
        const activeCompetency = effectiveSelection.competencyId ? competencyMap[effectiveSelection.competencyId] : null;
        const activeTimeCode = effectiveSelection.timeCodeId ? timeCodeMap[effectiveSelection.timeCodeId] : null;
        const activeColorToken = activeTimeCode?.colorToken ?? activeCompetency?.colorToken ?? "";
        const hasCellNote = Boolean(selection.notes?.trim());
        const isSelected =
          selectedCell?.employeeId === employee.sourceEmployeeId && selectedCell.date === day.date;
        const isInDragRange =
          dragRange?.employeeId === employee.sourceEmployeeId &&
          dayIndex >= Math.min(dragRange.startIndex, dragRange.currentIndex) &&
          dayIndex <= Math.max(dragRange.startIndex, dragRange.currentIndex);
        const isCoverageFocus =
          Boolean(selectedCoverageCompetencyId) &&
          setDates.has(day.date) &&
          highlightedMissingDates.has(day.date) &&
          activeCompetency?.id === selectedCoverageCompetencyId;

        return (
          <div
            key={`${employee.rowId}-${day.date}`}
            className={`shift-cell shift-cell--${getShiftTone(shiftKind)} ${
              day.isWeekend ? "shift-cell--weekend" : ""
            } ${activeColorToken ? `legend-pill--${activeColorToken.toLowerCase()}` : ""} ${
              activeColorToken ? "shift-cell--coded" : ""
            } ${isLockedCell ? "shift-cell--locked" : ""} ${
              isLockedCell && activeColorToken ? "shift-cell--locked-coded" : ""
            } ${isSelected ? "shift-cell--selected" : ""} ${
              isInDragRange ? "shift-cell--range" : ""
            } ${highlightedMissingDates.has(day.date) && setDates.has(day.date) ? "shift-cell--missing-column" : ""} ${
              isCoverageFocus ? "shift-cell--coverage-focus" : ""
            } ${hasCellNote ? "shift-cell--has-note" : ""}`}
            onPointerDown={(event) => {
              if (event.button !== 0 || !canEdit || !isBorrowedCellVisible || isLockedCell) {
                return;
              }

              onCellPointerDown(employee.sourceEmployeeId, day.date, dayIndex, effectiveSelection);
            }}
            onPointerEnter={(event) => {
              if (canEdit && isBorrowedCellVisible && !isLockedCell && dragRange && event.buttons === 1) {
                onDragHover(employee.sourceEmployeeId, dayIndex);
              }
            }}
          >
            <button
              type="button"
              className={`shift-cell-button ${
                activeColorToken ? `legend-pill--${activeColorToken.toLowerCase()}` : ""
              }`}
              onClick={() => {
                if (!canEdit || !isBorrowedCellVisible || isLockedCell) {
                  return;
                }

                onCellClick({ employeeId: employee.sourceEmployeeId, date: day.date });
              }}
              disabled={!canEdit || !isBorrowedCellVisible || isLockedCell}
              aria-label={`${employee.name} ${day.date} assignment`}
              title={selection.notes ?? undefined}
            >
              {isBorrowedCellVisible ? getSelectionCode(effectiveSelection, competencyMap, timeCodeMap) : ""}
              {hasCellNote ? <span className="shift-cell__note-indicator" aria-hidden="true" /> : null}
            </button>
          </div>
        );
      })}
    </>
  );
}
