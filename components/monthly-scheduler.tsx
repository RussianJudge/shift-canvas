"use client";

import type { CSSProperties } from "react";
import { useDeferredValue, useEffect, useMemo, useRef, useState, useTransition, startTransition } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";

import {
  cancelTemporaryLoan,
  createTemporaryLoan,
  saveAssignments,
  saveScheduleEmployeeOrder,
  setScheduleSetCompletion,
} from "@/app/actions";
import { parseMutualAssignmentNote } from "@/lib/mutuals";
import { parseTemporaryLoanAssignmentNote } from "@/lib/temporary-loans";
import {
  buildProjectedAssignmentIndex,
  getManualEntryTimeCodes,
} from "@/lib/sub-schedules";
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
  parseAssignmentKey,
  shiftMonthKey,
  shiftForDate,
  toggleCompletedSetEntries,
} from "@/lib/scheduling";
import type {
  Competency,
  Employee,
  SaveAssignmentsInput,
  Schedule,
  SchedulePageSnapshot,
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
 * - shared shift display ordering
 * - cell editing + drag-copy
 * - borrowed overtime rows
 *
 * Comments here focus on the major interaction models rather than every small
 * render detail.
 */
const STORAGE_KEY = "shift-canvas-drafts-v2";
const COLUMN_COPY_STORAGE_KEY = "shift-canvas-column-copy-v1";
const AUTO_SAVE_DEBOUNCE_MS = 2500;
const STALE_SNAPSHOT_PROTECTION_MS = 12000;
const SCHEDULE_ROW_HEIGHT_PX = 51;
type AssignmentSelection = { competencyId: string | null; timeCodeId: string | null; notes: string | null };
type PersistedDraftAssignments = Record<string, AssignmentSelection | null>;
type SelectedCell = { employeeId: string; date: string };
type LoanCancelTarget = {
  loanId: string;
  employeeName: string;
  sourceScheduleName: string;
  targetScheduleName: string;
  date: string;
};
type ShiftOrderEmployee = {
  id: string;
  name: string;
  role: string;
};
type DragRange = {
  employeeId: string;
  startIndex: number;
  currentIndex: number;
  selection: AssignmentSelection;
};

function PrinterIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 8V4h10v4" />
      <path d="M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
      <path d="M7 14h10v6H7z" />
      <path d="M17 12h.01" />
    </svg>
  );
}

type DisplayEmployee = {
  rowId: string;
  sourceEmployeeId: string;
  name: string;
  role: string;
  competencyIds: string[];
  overtimeDates?: string[];
  overtimeCompetencyByDate?: Record<string, string | null>;
  mutualDates?: string[];
  loanDates?: string[];
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
type UnfilledSetCompetency = {
  id: string;
  code: string;
  label: string;
  missingCells: number;
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

function isAssignmentSelection(value: unknown): value is AssignmentSelection {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const selection = value as Partial<AssignmentSelection>;

  return (
    (typeof selection.competencyId === "string" || selection.competencyId === null) &&
    (typeof selection.timeCodeId === "string" || selection.timeCodeId === null) &&
    (typeof selection.notes === "string" || selection.notes === null)
  );
}

function readCopiedColumnTemplateFromStorage(): CopiedColumnTemplate | null {
  if (typeof window === "undefined") {
    return null;
  }

  const savedTemplate = window.sessionStorage.getItem(COLUMN_COPY_STORAGE_KEY);

  if (!savedTemplate) {
    return null;
  }

  try {
    const parsed = JSON.parse(savedTemplate) as Partial<CopiedColumnTemplate>;

    if (
      typeof parsed.scheduleId !== "string" ||
      typeof parsed.sourceDate !== "string" ||
      !parsed.selectionsByEmployeeId ||
      typeof parsed.selectionsByEmployeeId !== "object" ||
      !Object.values(parsed.selectionsByEmployeeId).every(isAssignmentSelection)
    ) {
      window.sessionStorage.removeItem(COLUMN_COPY_STORAGE_KEY);
      return null;
    }

    return {
      scheduleId: parsed.scheduleId,
      sourceDate: parsed.sourceDate,
      selectionsByEmployeeId: parsed.selectionsByEmployeeId,
    };
  } catch {
    window.sessionStorage.removeItem(COLUMN_COPY_STORAGE_KEY);
    return null;
  }
}

function persistCopiedColumnTemplateToStorage(template: CopiedColumnTemplate | null) {
  if (typeof window === "undefined") {
    return;
  }

  if (!template) {
    window.sessionStorage.removeItem(COLUMN_COPY_STORAGE_KEY);
    return;
  }

  window.sessionStorage.setItem(COLUMN_COPY_STORAGE_KEY, JSON.stringify(template));
}

const ScheduleAssignmentModal = dynamic(
  () =>
    import("@/components/schedule-assignment-modal").then((module) => module.ScheduleAssignmentModal),
  { ssr: false },
);

function SetCompletionWarningModal({
  scheduleName,
  dateRange,
  unfilledCompetencies,
  onCancel,
  onConfirm,
  isSubmitting,
}: {
  scheduleName: string;
  dateRange: string;
  unfilledCompetencies: UnfilledSetCompetency[];
  onCancel: () => void;
  onConfirm: () => void;
  isSubmitting: boolean;
}) {
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="assignment-modal-backdrop" onClick={onCancel}>
      <section className="assignment-modal set-completion-modal" onClick={(event) => event.stopPropagation()}>
        <div className="assignment-modal__header">
          <div>
            <h2 className="assignment-modal__title">Mark set complete?</h2>
            <p className="assignment-modal__context">
              For {scheduleName} {dateRange}, the following competencies are unfilled. Continuing will create overtime postings.
            </p>
          </div>
          <button type="button" className="ghost-button" onClick={onCancel} disabled={isSubmitting}>
            Close
          </button>
        </div>

        <div className="set-completion-modal__list">
          {unfilledCompetencies.map((competency) => (
            <div key={competency.id} className="set-completion-modal__row">
              <div>
                <strong>{competency.code}</strong>
                <span>{competency.label}</span>
              </div>
              <small>
                {competency.missingCells} unfilled cell{competency.missingCells === 1 ? "" : "s"} ·{" "}
                {competency.missingDates.map(formatShortDate).join(", ")}
              </small>
            </div>
          ))}
        </div>

        <div className="assignment-modal__footer">
          <button type="button" className="ghost-button" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={onConfirm} disabled={isSubmitting}>
            {isSubmitting ? "Completing..." : "Accept and create overtime"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function TemporaryLoanModal({
  schedules,
  competencies,
  monthDays,
  defaultTargetScheduleId,
  onCancel,
  onSubmit,
  isSubmitting,
}: {
  schedules: Schedule[];
  competencies: Competency[];
  monthDays: Array<{ date: string; dayNumber: number; dayName: string; isWeekend: boolean }>;
  defaultTargetScheduleId: string;
  onCancel: () => void;
  onSubmit: (input: { employeeId: string; targetScheduleId: string; competencyId: string; dates: string[] }) => void;
  isSubmitting: boolean;
}) {
  const employees = useMemo(
    () =>
      Array.from(
        new Map(
          schedules.flatMap((schedule) => schedule.employees.map((employee) => [employee.id, employee] as const)),
        ).values(),
      ).sort((left, right) => left.name.localeCompare(right.name)),
    [schedules],
  );
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [targetScheduleId, setTargetScheduleId] = useState(defaultTargetScheduleId);
  const [competencyId, setCompetencyId] = useState("");
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const employeeMap = useMemo(() => getEmployeeMap(schedules), [schedules]);
  const selectedEmployee = employeeMap[employeeId] ?? null;
  const sourceSchedule = selectedEmployee ? schedules.find((schedule) => schedule.id === selectedEmployee.scheduleId) ?? null : null;
  const targetSchedule = schedules.find((schedule) => schedule.id === targetScheduleId) ?? null;
  const qualifiedCompetencies = useMemo(
    () =>
      targetSchedule && selectedEmployee
        ? competencies
            .filter(
              (competency) =>
                targetSchedule.competencyIds.includes(competency.id) &&
                selectedEmployee.competencyIds.includes(competency.id),
            )
            .sort((left, right) => left.code.localeCompare(right.code))
        : [],
    [competencies, selectedEmployee, targetSchedule],
  );
  const isSameSchedule = Boolean(sourceSchedule && targetSchedule && sourceSchedule.id === targetSchedule.id);
  const canSubmit =
    Boolean(selectedEmployee && sourceSchedule && targetSchedule && competencyId && selectedDates.length > 0) &&
    !isSameSchedule &&
    !isSubmitting;

  useEffect(() => {
    if (qualifiedCompetencies.some((competency) => competency.id === competencyId)) {
      return;
    }

    setCompetencyId(qualifiedCompetencies[0]?.id ?? "");
  }, [competencyId, qualifiedCompetencies]);

  useEffect(() => {
    setSelectedDates((current) =>
      current.filter((date) => {
        if (!sourceSchedule || !targetSchedule) {
          return false;
        }

        return shiftForDate(sourceSchedule, date) !== "OFF" && shiftForDate(targetSchedule, date) !== "OFF";
      }),
    );
  }, [sourceSchedule, targetSchedule]);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="assignment-modal-backdrop" onClick={onCancel}>
      <section className="assignment-modal temporary-loan-modal" onClick={(event) => event.stopPropagation()}>
        <div className="assignment-modal__header">
          <div>
            <h2 className="assignment-modal__title">Temporary loan</h2>
            <p className="assignment-modal__context">
              Loan a worker to another shift for regular worked dates.
            </p>
          </div>
          <button type="button" className="ghost-button" onClick={onCancel} disabled={isSubmitting}>
            Close
          </button>
        </div>

        <div className="modal-form-grid">
          <label className="field">
            <span>Worker</span>
            <select
              value={employeeId}
              onChange={(event) => {
                setEmployeeId(event.target.value);
                setSelectedDates([]);
              }}
              disabled={isSubmitting}
            >
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Target shift</span>
            <select
              value={targetScheduleId}
              onChange={(event) => {
                setTargetScheduleId(event.target.value);
                setSelectedDates([]);
              }}
              disabled={isSubmitting}
            >
              {schedules.map((schedule) => (
                <option key={schedule.id} value={schedule.id}>
                  {schedule.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Target competency</span>
            <select
              value={competencyId}
              onChange={(event) => setCompetencyId(event.target.value)}
              disabled={isSubmitting || qualifiedCompetencies.length === 0}
            >
              {qualifiedCompetencies.length > 0 ? (
                qualifiedCompetencies.map((competency) => (
                  <option key={competency.id} value={competency.id}>
                    {competency.code} · {competency.label}
                  </option>
                ))
              ) : (
                <option value="">No matching competencies</option>
              )}
            </select>
          </label>
        </div>

        <div className="assignment-modal__group">
          <span className="assignment-modal__label">Loan dates</span>
          <div className="temporary-loan-date-grid">
            {monthDays.map((day) => {
              const sourceShiftKind = sourceSchedule ? shiftForDate(sourceSchedule, day.date) : "OFF";
              const targetShiftKind = targetSchedule ? shiftForDate(targetSchedule, day.date) : "OFF";
              const disabled = sourceShiftKind === "OFF" || targetShiftKind === "OFF" || isSameSchedule;
              const isSelected = selectedDates.includes(day.date);

              return (
                <button
                  key={day.date}
                  type="button"
                  className={`temporary-loan-date ${isSelected ? "temporary-loan-date--selected" : ""}`}
                  disabled={disabled || isSubmitting}
                  title={
                    disabled
                      ? isSameSchedule
                        ? "Choose a different target shift"
                        : `Home ${sourceShiftKind.toLowerCase()} · target ${targetShiftKind.toLowerCase()}`
                      : `${day.dayName} ${day.date}`
                  }
                  onClick={() =>
                    setSelectedDates((current) =>
                      current.includes(day.date)
                        ? current.filter((date) => date !== day.date)
                        : [...current, day.date].sort(),
                    )
                  }
                >
                  <span>{day.dayName.slice(0, 1)}</span>
                  <strong>{day.dayNumber}</strong>
                </button>
              );
            })}
          </div>
        </div>

        <p className="toolbar-status">
          {isSameSchedule
            ? "Choose a target shift different from the worker's home shift."
            : selectedDates.length > 0
            ? `${selectedDates.length} date${selectedDates.length === 1 ? "" : "s"} selected.`
            : "Choose one or more regular worked dates."}
        </p>

        <div className="assignment-modal__footer">
          <button type="button" className="ghost-button" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!canSubmit}
            onClick={() =>
              onSubmit({
                employeeId,
                targetScheduleId,
                competencyId,
                dates: selectedDates,
              })
            }
          >
            {isSubmitting ? "Creating..." : "Create loan"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function CancelTemporaryLoanModal({
  target,
  onCancel,
  onConfirm,
  isSubmitting,
}: {
  target: LoanCancelTarget;
  onCancel: () => void;
  onConfirm: () => void;
  isSubmitting: boolean;
}) {
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="assignment-modal-backdrop" onClick={onCancel}>
      <section className="assignment-modal" onClick={(event) => event.stopPropagation()}>
        <div className="assignment-modal__header">
          <div>
            <h2 className="assignment-modal__title">Cancel temporary loan?</h2>
            <p className="assignment-modal__context">
              {target.employeeName} · {formatShortDate(target.date)}
            </p>
          </div>
          <button type="button" className="ghost-button" onClick={onCancel} disabled={isSubmitting}>
            Close
          </button>
        </div>

        <p className="toolbar-status">
          This will remove the loan from {target.targetScheduleName} and restore the home shift marker on{" "}
          {target.sourceScheduleName}.
        </p>

        <div className="assignment-modal__footer">
          <button type="button" className="ghost-button" onClick={onCancel} disabled={isSubmitting}>
            Keep loan
          </button>
          <button type="button" className="primary-button" onClick={onConfirm} disabled={isSubmitting}>
            {isSubmitting ? "Cancelling..." : "Cancel loan"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function ShiftOrderModal({
  scheduleName,
  employees,
  onCancel,
  onSave,
  isSubmitting,
}: {
  scheduleName: string;
  employees: ShiftOrderEmployee[];
  onCancel: () => void;
  onSave: (employeeIds: string[]) => void;
  isSubmitting: boolean;
}) {
  const [orderedEmployees, setOrderedEmployees] = useState(employees);
  const [draggedEmployeeId, setDraggedEmployeeId] = useState<string | null>(null);

  useEffect(() => {
    setOrderedEmployees(employees);
  }, [employees]);

  function moveEmployee(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) {
      return;
    }

    setOrderedEmployees((current) => {
      const next = [...current];
      const [movedEmployee] = next.splice(fromIndex, 1);

      if (!movedEmployee) {
        return current;
      }

      next.splice(toIndex, 0, movedEmployee);
      return next;
    });
  }

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="assignment-modal-backdrop" onClick={onCancel}>
      <section className="assignment-modal shift-order-modal" onClick={(event) => event.stopPropagation()}>
        <div className="assignment-modal__header">
          <div>
            <h2 className="assignment-modal__title">Shift display order</h2>
            <p className="assignment-modal__context">
              Drag workers into the order everyone should see on {scheduleName}.
            </p>
          </div>
          <button type="button" className="ghost-button" onClick={onCancel} disabled={isSubmitting}>
            Close
          </button>
        </div>

        <div className="shift-order-list">
          {orderedEmployees.map((employee, index) => (
            <div
              key={employee.id}
              className={`shift-order-row ${draggedEmployeeId === employee.id ? "shift-order-row--dragging" : ""}`}
              draggable={!isSubmitting}
              onDragStart={(event) => {
                setDraggedEmployeeId(employee.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", employee.id);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                const fromIndex = orderedEmployees.findIndex((entry) => entry.id === draggedEmployeeId);
                moveEmployee(fromIndex, index);
              }}
              onDragEnd={() => setDraggedEmployeeId(null)}
            >
              <span className="shift-order-row__handle" aria-hidden="true">
                ::
              </span>
              <div>
                <strong>{employee.name}</strong>
                <span>{employee.role}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="assignment-modal__footer">
          <button type="button" className="ghost-button" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => onSave(orderedEmployees.map((employee) => employee.id))}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Saving..." : "Save order"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

/** Builds the visible roster, including borrowed overtime and mutual rows for the month. */
function buildDisplayEmployeesForSchedule({
  schedule,
  snapshot,
  employeeMap,
  currentMonth,
  scheduleEmployeeOrderBySchedule,
}: {
  schedule: Schedule;
  snapshot: SchedulePageSnapshot;
  employeeMap: Record<string, Employee>;
  currentMonth: string;
  scheduleEmployeeOrderBySchedule: Record<string, string[]>;
}) {
  const baseRows: DisplayEmployee[] = schedule.employees.map((employee) => ({
    rowId: `base:${employee.id}`,
    sourceEmployeeId: employee.id,
    name: employee.name,
    role: employee.role,
    competencyIds: employee.competencyIds,
  }));

  const borrowedRowsByEmployee = snapshot.overtimeClaims
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
    }, {});

  /**
   * Manual borrowed assignments are saved directly in `schedule_assignments`
   * without an `overtime_claims` row. They still need a temporary visible row on
   * the target shift, or the cell exists in Supabase but has nowhere to render
   * after a refresh.
   */
  for (const assignment of snapshot.assignments) {
    if (assignment.scheduleId !== schedule.id || assignment.date.slice(0, 7) !== currentMonth) {
      continue;
    }

    const employee = employeeMap[assignment.employeeId];

    if (!employee || employee.scheduleId === schedule.id) {
      continue;
    }

    const parsed = parseMutualAssignmentNote(assignment.notes);
    const parsedLoan = parseTemporaryLoanAssignmentNote(assignment.notes);

    if (parsed.targetScheduleId === schedule.id) {
      continue;
    }

    const homeSchedule = getScheduleById(snapshot, employee.scheduleId);
    const existingDates = borrowedRowsByEmployee[employee.id]?.overtimeDates ?? [];
    const existingLoanDates = borrowedRowsByEmployee[employee.id]?.loanDates ?? [];

    if (parsedLoan.role === "target" && parsedLoan.targetScheduleId === schedule.id) {
      borrowedRowsByEmployee[employee.id] = {
        rowId: borrowedRowsByEmployee[employee.id]?.rowId ?? `loan:${schedule.id}:${employee.id}`,
        sourceEmployeeId: employee.id,
        name: employee.name,
        role: borrowedRowsByEmployee[employee.id]?.role ?? `${employee.role} · Loan from ${homeSchedule.name}`,
        competencyIds: employee.competencyIds,
        overtimeDates: borrowedRowsByEmployee[employee.id]?.overtimeDates,
        overtimeCompetencyByDate: borrowedRowsByEmployee[employee.id]?.overtimeCompetencyByDate,
        loanDates: existingLoanDates.includes(assignment.date)
          ? existingLoanDates
          : [...existingLoanDates, assignment.date].sort(),
      };
      continue;
    }

    if (parsedLoan.loanId) {
      continue;
    }

    borrowedRowsByEmployee[employee.id] = {
      rowId: borrowedRowsByEmployee[employee.id]?.rowId ?? `manual:${schedule.id}:${employee.id}`,
      sourceEmployeeId: employee.id,
      name: employee.name,
      role: borrowedRowsByEmployee[employee.id]?.role ?? `${employee.role} · Manual from ${homeSchedule.name}`,
      competencyIds: employee.competencyIds,
      overtimeDates: existingDates.includes(assignment.date)
        ? existingDates
        : [...existingDates, assignment.date].sort(),
      overtimeCompetencyByDate: borrowedRowsByEmployee[employee.id]?.overtimeCompetencyByDate,
    };
  }

  const borrowedRows = Object.values(borrowedRowsByEmployee).sort((left, right) => left.name.localeCompare(right.name));

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

  const rows = [...baseRows, ...borrowedRows, ...mutualRows];
  const orderedIds = scheduleEmployeeOrderBySchedule[schedule.id] ?? [];
  const orderIndex = new Map(orderedIds.map((employeeId, index) => [employeeId, index]));

  return rows
    .map((employee, index) => ({ employee, index }))
    .sort((left, right) => {
      const leftOrder = orderIndex.get(left.employee.sourceEmployeeId);
      const rightOrder = orderIndex.get(right.employee.sourceEmployeeId);

      if (leftOrder !== undefined || rightOrder !== undefined) {
        if (leftOrder === undefined) {
          return 1;
        }

        if (rightOrder === undefined) {
          return -1;
        }

        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }
      }

      return left.index - right.index;
    })
    .map((entry) => entry.employee);
}

function addMonths(monthKey: string, delta: number) {
  return shiftMonthKey(monthKey, delta);
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
  savedUpdates: Array<{ scheduleId: string; employeeId: string; date: string }>,
) {
  const nextAssignments = { ...baselineAssignments };

  for (const update of savedUpdates) {
    const key = createAssignmentKey(update.scheduleId, update.employeeId, update.date);
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
    const key = createAssignmentKey(update.scheduleId, update.employeeId, update.date);

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

function persistDraftAssignmentsToStorage(
  baselineAssignments: Record<string, AssignmentSelection>,
  draftAssignments: Record<string, AssignmentSelection>,
) {
  if (typeof window === "undefined") {
    return;
  }

  const delta = buildDraftDelta(baselineAssignments, draftAssignments);

  if (Object.keys(delta).length === 0) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(delta));
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
  scheduleId: string,
  employeeId: string,
  date: string,
  shiftKind: ShiftKind,
  assignments: Record<string, AssignmentSelection>,
  timeCodes: TimeCode[],
) {
  const key = createAssignmentKey(scheduleId, employeeId, date);

  if (key in assignments) {
    return assignments[key];
  }

  return getDefaultSelection(shiftKind, timeCodes);
}

function isCompetency(competency: Competency | undefined): competency is Competency {
  return Boolean(competency);
}

/**
 * `T` cells often carry a numeric training/reference note. Showing the first
 * three digits directly in the cell keeps the schedule readable without
 * forcing leaders to open the note every time.
 */
function getTimeCodeDisplayCode(timeCode: TimeCode | undefined, notes: string | null) {
  const baseCode = timeCode?.code ?? "";

  if (baseCode.trim().toUpperCase() !== "T") {
    return baseCode;
  }

  const noteDigits = notes?.match(/\d/g)?.slice(0, 3).join("") ?? "";
  return noteDigits ? `${baseCode}${noteDigits}` : baseCode;
}

function isOvertimeManagedSelection(selection: AssignmentSelection) {
  return Boolean(selection.notes?.startsWith("OT|"));
}

function isTemporaryLoanManagedSelection(selection: AssignmentSelection) {
  return Boolean(parseTemporaryLoanAssignmentNote(selection.notes).loanId);
}

function getScheduleCellComment({
  notes,
  employeeName,
  employeeId,
  scheduleId,
  employeeMap,
  scheduleNameMap,
}: {
  notes: string | null;
  employeeName: string;
  employeeId: string;
  scheduleId: string;
  employeeMap: Record<string, Employee>;
  scheduleNameMap: Record<string, string>;
}) {
  const parsedLoan = parseTemporaryLoanAssignmentNote(notes);

  if (parsedLoan.loanId) {
    const sourceScheduleName = parsedLoan.sourceScheduleId
      ? scheduleNameMap[parsedLoan.sourceScheduleId] ?? "their home shift"
      : "their home shift";
    const targetScheduleName = parsedLoan.targetScheduleId
      ? scheduleNameMap[parsedLoan.targetScheduleId] ?? "the target shift"
      : "the target shift";

    return parsedLoan.role === "source"
      ? `${employeeName} is loaned to ${targetScheduleName}.`
      : `${employeeName} is loaned from ${sourceScheduleName}.`;
  }

  const parsedMutual = parseMutualAssignmentNote(notes);

  if (parsedMutual.partnerEmployeeId) {
    const partnerName = employeeMap[parsedMutual.partnerEmployeeId]?.name ?? "their mutual partner";
    const isBorrowedMutualCell = employeeMap[employeeId]?.scheduleId !== scheduleId;

    return isBorrowedMutualCell
      ? `${employeeName} is covering ${partnerName} via mutual.`
      : `${partnerName} is covering ${employeeName} via mutual.`;
  }

  return notes ?? undefined;
}

function getSelectionCode(
  selection: AssignmentSelection,
  competencyMap: Record<string, Competency>,
  timeCodeMap: Record<string, TimeCode>,
) {
  const parsedLoan = parseTemporaryLoanAssignmentNote(selection.notes);

  if (parsedLoan.role === "source") {
    return "LN";
  }

  if (selection.timeCodeId) {
    return getTimeCodeDisplayCode(timeCodeMap[selection.timeCodeId], selection.notes);
  }

  if (selection.competencyId) {
    return getCompactCode(competencyMap[selection.competencyId]?.code ?? "");
  }

  return "";
}

/** Fisher-Yates shuffle used only for internal auto-fill worker ordering. */
function shuffleArray<T>(items: T[]) {
  const nextItems = [...items];

  for (let index = nextItems.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [nextItems[index], nextItems[swapIndex]] = [nextItems[swapIndex], nextItems[index]];
  }

  return nextItems;
}

function buildSingleSetAutofillPlan({
  schedule,
  setDays,
  assignments,
  occupiedAssignments,
  competencies,
  timeCodes,
}: {
  schedule: Schedule;
  setDays: Array<{ date: string }>;
  assignments: Record<string, AssignmentSelection>;
  occupiedAssignments: Record<string, AssignmentSelection>;
  competencies: Competency[];
  timeCodes: TimeCode[];
}) {
  // The auto-fill helper only touches fully blank workers so it never rewrites
  // a planner's partially curated set.
  const nextAssignments = { ...assignments };
  const nextOccupiedAssignments = { ...occupiedAssignments };
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
            schedule.id,
            employee.id,
            day.date,
            shiftKind,
            nextOccupiedAssignments,
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
      const selection = getSelectionForCell(
        schedule.id,
        employee.id,
        day.date,
        shiftKind,
        nextOccupiedAssignments,
        timeCodes,
      );
      return !selection.competencyId && !selection.timeCodeId;
    }),
  );
  const shuffledBlankWorkers = shuffleArray(fullyBlankWorkers);

  let assignedWorkers = 0;
  let assignedCells = 0;

  for (const employee of shuffledBlankWorkers) {
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
      const key = createAssignmentKey(schedule.id, employee.id, day.date);
      const nextSelection = {
        competencyId: bestCompetencyId,
        timeCodeId: null,
        notes: null,
      };
      nextAssignments[key] = nextSelection;
      nextOccupiedAssignments[key] = nextSelection;
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
  occupiedAssignments,
  competencies,
  timeCodes,
}: {
  schedule: Schedule;
  setDays: Array<{ date: string }>;
  assignments: Record<string, AssignmentSelection>;
  occupiedAssignments: Record<string, AssignmentSelection>;
  competencies: Competency[];
  timeCodes: TimeCode[];
}) {
  /**
   * Auto-fill intentionally uses a randomized choice among still-needed
   * competencies. That makes it more flexible, but it also means one pass can
   * land on a suboptimal combination even when another valid fill exists.
   *
   * To make the tool more robust without touching any manually entered cells,
   * we retry from the exact same untouched baseline up to ten times and keep
   * the best result we found.
   */
  const maxAttempts = 10;
  let bestPlan = buildSingleSetAutofillPlan({
    schedule,
    setDays,
    assignments,
    occupiedAssignments,
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
      occupiedAssignments,
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

export function MonthlyScheduler({
  initialSnapshot,
  initialScheduleEmployeeOrderBySchedule,
  canEdit,
  canManageSetBuilder,
  canSwitchSchedule,
  forcedScheduleId,
  initialSelectedScheduleId,
}: {
  initialSnapshot: SchedulePageSnapshot;
  initialScheduleEmployeeOrderBySchedule: Record<string, string[]>;
  canEdit: boolean;
  canManageSetBuilder: boolean;
  canSwitchSchedule: boolean;
  forcedScheduleId: string | null;
  initialSelectedScheduleId?: string | null;
}) {
  // `baselineAssignments` tracks the last server-confirmed state. `draftAssignments`
  // layers in local edits and set actions until auto-save confirms them or the user reverts.
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [selectedScheduleId, setSelectedScheduleId] = useState(
    forcedScheduleId && initialSnapshot.schedules.some((schedule) => schedule.id === forcedScheduleId)
      ? forcedScheduleId
      : initialSnapshot.schedules.some((schedule) => schedule.id === initialSelectedScheduleId)
      ? initialSelectedScheduleId ?? ""
      : initialSnapshot.schedules[0]?.id ?? "",
  );
  const [search, setSearch] = useState("");
  const [selectedCompetencyFilter, setSelectedCompetencyFilter] = useState("all");
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
  const [copiedColumnTemplate, setCopiedColumnTemplate] = useState<CopiedColumnTemplate | null>(
    readCopiedColumnTemplateFromStorage,
  );
  const [dragRange, setDragRange] = useState<DragRange | null>(null);
  const [scheduleEmployeeOrderBySchedule, setScheduleEmployeeOrderBySchedule] = useState<Record<string, string[]>>(
    initialScheduleEmployeeOrderBySchedule,
  );
  const [isDraftHydrated, setIsDraftHydrated] = useState(false);
  const [isMonthLoading, startMonthTransition] = useTransition();
  const [isSavingTransition, startSaveTransition] = useTransition();
  const [activeSaveCount, setActiveSaveCount] = useState(0);
  const [isUpdatingSetCompletion, startSetCompletionTransition] = useTransition();
  const [isSetCompletionWarningOpen, setIsSetCompletionWarningOpen] = useState(false);
  const [isTemporaryLoanModalOpen, setIsTemporaryLoanModalOpen] = useState(false);
  const [loanCancelTarget, setLoanCancelTarget] = useState<LoanCancelTarget | null>(null);
  const [isLoanTransition, startLoanTransition] = useTransition();
  const [isShiftOrderModalOpen, setIsShiftOrderModalOpen] = useState(false);
  const [isSavingShiftOrder, startShiftOrderTransition] = useTransition();
  const isSaving = isSavingTransition || activeSaveCount > 0;
  const isScheduleLocked = isSaving || isUpdatingSetCompletion || isLoanTransition || isSavingShiftOrder;
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const latestAutoSaveTokenRef = useRef(0);
  const baselineAssignmentsRef = useRef(baselineAssignments);
  const draftAssignmentsRef = useRef(draftAssignments);
  const activeSaveCountRef = useRef(0);
  const preserveLocalBaselineUntilRef = useRef(0);
  const scheduleTopScrollRef = useRef<HTMLDivElement | null>(null);
  const scheduleBodyScrollRef = useRef<HTMLElement | null>(null);
  const scheduleGridRef = useRef<HTMLDivElement | null>(null);
  const [scheduleScrollProxyWidth, setScheduleScrollProxyWidth] = useState(0);
  const currentMonth = snapshot.month;

  const competencyMap = useMemo(() => getCompetencyMap(snapshot.competencies), [snapshot.competencies]);
  const timeCodeMap = useMemo(() => getTimeCodeMap(snapshot.timeCodes), [snapshot.timeCodes]);
  const employeeMap = useMemo(() => getEmployeeMap(snapshot.schedules), [snapshot.schedules]);
  const scheduleNameMap = useMemo(
    () => Object.fromEntries(snapshot.schedules.map((schedule) => [schedule.id, schedule.name])),
    [snapshot.schedules],
  );
  const projectedAssignmentIndex = useMemo(
    () => buildProjectedAssignmentIndex(snapshot.projectedAssignments),
    [snapshot.projectedAssignments],
  );
  const effectiveAssignments = useMemo(() => {
    const nextAssignments = { ...draftAssignments };

    for (const assignment of snapshot.projectedAssignments) {
      nextAssignments[createAssignmentKey(assignment.scheduleId, assignment.employeeId, assignment.date)] = {
        competencyId: assignment.competencyId,
        timeCodeId: assignment.timeCodeId,
        notes: assignment.notes ?? null,
      };
    }

    return nextAssignments;
  }, [draftAssignments, snapshot.projectedAssignments]);
  const manualEntryTimeCodes = useMemo(
    () => getManualEntryTimeCodes(snapshot.timeCodes),
    [snapshot.timeCodes],
  );
  const monthDays = useMemo(() => getMonthDays(currentMonth), [currentMonth]);
  const extendedMonthDays = useMemo(() => getExtendedMonthDays(currentMonth), [currentMonth]);
  const activeSchedule = getScheduleById(snapshot, selectedScheduleId);
  const activeScheduleId = activeSchedule?.id ?? "";
  const activeScheduleCompetencies = useMemo(
    () =>
      activeSchedule
        ? snapshot.competencies.filter((competency) => activeSchedule.competencyIds.includes(competency.id))
        : [],
    [activeSchedule, snapshot.competencies],
  );
  useEffect(() => {
    if (
      selectedCompetencyFilter !== "all" &&
      !activeScheduleCompetencies.some((competency) => competency.id === selectedCompetencyFilter)
    ) {
      setSelectedCompetencyFilter("all");
    }
  }, [activeScheduleCompetencies, selectedCompetencyFilter]);
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
  const hasSelectedBuilderTarget = selectedSetDays.length > 0 || selectedColumnDate !== null;
  const competencyCoverage = useMemo(() => {
    if (!activeSchedule) {
      return {};
    }

    return activeScheduleCompetencies.reduce<Record<string, CoverageSummary>>((map, competency) => {
      let filledCells = 0;
      let hasOvertime = false;
      const missingDates: string[] = [];

      for (const day of selectedSetDays) {
        let filledOnDate = 0;

        const overtimeClaimKeys = new Set(
          snapshot.overtimeClaims
            .filter(
              (claim) =>
                claim.scheduleId === activeSchedule.id &&
                claim.competencyId === competency.id &&
                claim.date === day.date,
            )
            .map((claim) => `${claim.employeeId}:${claim.date}:${claim.competencyId}`),
        );

        for (const [key, selection] of Object.entries(effectiveAssignments)) {
          const parsed = parseAssignmentKey(key);

          if (
            !parsed ||
            parsed.scheduleId !== activeSchedule.id ||
            parsed.date !== day.date ||
            selection.competencyId !== competency.id ||
            isOvertimeManagedSelection(selection) ||
            overtimeClaimKeys.has(`${parsed.employeeId}:${parsed.date}:${selection.competencyId}`)
          ) {
            continue;
          }

          filledCells += 1;
          filledOnDate += 1;
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
  }, [activeSchedule, activeScheduleCompetencies, effectiveAssignments, employeeMap, selectedSetDays, snapshot.overtimeClaims, snapshot.timeCodes]);
  const unfilledSetCompetencies = useMemo<UnfilledSetCompetency[]>(
    () =>
      activeScheduleCompetencies
        .map((competency) => {
          const coverage = competencyCoverage[competency.id];
          const missingCells = coverage ? Math.max(0, coverage.requiredCells - coverage.filledCells) : 0;

          return {
            id: competency.id,
            code: competency.code,
            label: competency.label,
            missingCells,
            missingDates: coverage?.missingDates ?? [],
          };
        })
        .filter((competency) => competency.missingCells > 0),
    [activeScheduleCompetencies, competencyCoverage],
  );
  const fullyBlankSetWorkers = useMemo(() => {
    if (!activeSchedule || selectedSetDays.length === 0) {
      return [];
    }

    return activeSchedule.employees.filter((employee) =>
      selectedSetDays.every((day) => {
        const shiftKind = shiftForDate(activeSchedule, day.date);
        const selection = getSelectionForCell(
          activeSchedule.id,
          employee.id,
          day.date,
          shiftKind,
          effectiveAssignments,
          snapshot.timeCodes,
        );

        return !selection.competencyId && !selection.timeCodeId;
      }),
    );
  }, [activeSchedule, effectiveAssignments, selectedSetDays, snapshot.timeCodes]);
  const displayEmployees = useMemo<DisplayEmployee[]>(
    () =>
      activeSchedule
        ? buildDisplayEmployeesForSchedule({
            schedule: activeSchedule,
            snapshot,
            employeeMap,
            currentMonth,
            scheduleEmployeeOrderBySchedule,
          })
        : [],
    [activeSchedule, currentMonth, employeeMap, scheduleEmployeeOrderBySchedule, snapshot],
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
    if (
      selectedCompetencyFilter !== "all" &&
      !employee.competencyIds.includes(selectedCompetencyFilter)
    ) {
      return false;
    }

    if (!deferredSearch) {
      return true;
    }

    return `${employee.name} ${employee.role}`.toLowerCase().includes(deferredSearch);
  });
  const displayEmployeeMap = useMemo(
    () => Object.fromEntries(displayEmployees.map((employee) => [employee.sourceEmployeeId, employee])),
    [displayEmployees],
  );

  useEffect(() => {
    const topScroll = scheduleTopScrollRef.current;
    const bodyScroll = scheduleBodyScrollRef.current;
    const grid = scheduleGridRef.current;

    if (!topScroll || !bodyScroll || !grid) {
      return;
    }

    let isSyncing = false;

    const syncWidths = () => {
      setScheduleScrollProxyWidth(grid.scrollWidth);
    };

    const handleTopScroll = () => {
      if (isSyncing) {
        return;
      }

      isSyncing = true;
      bodyScroll.scrollLeft = topScroll.scrollLeft;
      isSyncing = false;
    };

    const handleBodyScroll = () => {
      if (isSyncing) {
        return;
      }

      isSyncing = true;
      topScroll.scrollLeft = bodyScroll.scrollLeft;
      isSyncing = false;
    };

    syncWidths();
    topScroll.scrollLeft = bodyScroll.scrollLeft;

    topScroll.addEventListener("scroll", handleTopScroll);
    bodyScroll.addEventListener("scroll", handleBodyScroll);

    const resizeObserver = new ResizeObserver(() => {
      syncWidths();
      topScroll.scrollLeft = bodyScroll.scrollLeft;
    });

    resizeObserver.observe(grid);
    resizeObserver.observe(bodyScroll);

    return () => {
      topScroll.removeEventListener("scroll", handleTopScroll);
      bodyScroll.removeEventListener("scroll", handleBodyScroll);
      resizeObserver.disconnect();
    };
  }, [currentMonth, visibleEmployees.length]);

  const dirtyUpdates = useMemo(
    () =>
      Array.from(
        new Set([...Object.keys(baselineAssignments), ...Object.keys(draftAssignments)]),
      ).flatMap((key) => {
        const parsed = parseAssignmentKey(key);
        const employee = parsed ? employeeMap[parsed.employeeId] : null;
        const targetSchedule = parsed ? getScheduleById(snapshot, parsed.scheduleId) : null;

        if (!parsed || !employee || !targetSchedule) {
          return [];
        }

        const shiftKind = shiftForDate(targetSchedule, parsed.date);
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
            employeeId: parsed.employeeId,
            scheduleId: parsed.scheduleId,
            date: parsed.date,
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
          activeSchedule.id,
          editorEmployee.sourceEmployeeId,
          editorCell.date,
          editorShiftKind,
          effectiveAssignments,
          snapshot.timeCodes,
        )
      : { competencyId: null, timeCodeId: null, notes: null };
  const editorClearDisabledReason = isOvertimeManagedSelection(editorSelection)
    ? "This cell came from an overtime posting. Release it from the Overtime page instead of clearing it here."
    : isTemporaryLoanManagedSelection(editorSelection)
    ? "This cell came from a temporary loan. Cancel the temporary loan instead of editing it directly."
    : null;
  const editorEmployeeCompetencies = editorEmployee
    ? editorEmployee.competencyIds
        .filter((competencyId) => activeSchedule?.competencyIds.includes(competencyId))
        .map((competencyId) => competencyMap[competencyId])
        .filter(isCompetency)
    : [];
  const highlightedMissingDates = selectedCoverageCompetencyId
    ? new Set(competencyCoverage[selectedCoverageCompetencyId]?.missingDates ?? [])
    : new Set<string>();
  const activeDirtyUpdates = useMemo(
    () =>
      dirtyUpdates.filter(
        (update) =>
          update.scheduleId === activeSchedule.id &&
          displayEmployeeMap[update.employeeId] &&
          monthDays.some((day) => day.date === update.date),
      ),
    [dirtyUpdates, displayEmployeeMap, monthDays],
  );
  const hasActiveChanges = activeDirtyUpdates.length > 0;
  const activeShiftOrderEmployees = useMemo<ShiftOrderEmployee[]>(() => {
    const orderedIds = scheduleEmployeeOrderBySchedule[activeSchedule.id] ?? [];
    const orderIndex = new Map(orderedIds.map((employeeId, index) => [employeeId, index]));

    return activeSchedule.employees
      .map((employee, index) => ({ employee, index }))
      .sort((left, right) => {
        const leftOrder = orderIndex.get(left.employee.id);
        const rightOrder = orderIndex.get(right.employee.id);

        if (leftOrder !== undefined || rightOrder !== undefined) {
          if (leftOrder === undefined) {
            return 1;
          }

          if (rightOrder === undefined) {
            return -1;
          }

          if (leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
          }
        }

        return left.index - right.index;
      })
      .map(({ employee }) => ({
        id: employee.id,
        name: employee.name,
        role: employee.role,
      }));
  }, [activeSchedule, scheduleEmployeeOrderBySchedule]);

  function getProjectedAssignmentForCell(employeeId: string, date: string) {
    return projectedAssignmentIndex[createAssignmentKey(activeSchedule.id, employeeId, date)] ?? null;
  }

  const gridColumns = `var(--schedule-name-column-width, 7.75rem) repeat(${monthDays.length}, minmax(var(--schedule-day-column-width, 1.72rem), 1fr))`;
  const rowVirtualizer = useVirtualizer({
    count: visibleEmployees.length,
    getScrollElement: () => scheduleBodyScrollRef.current,
    estimateSize: () => SCHEDULE_ROW_HEIGHT_PX,
    overscan: 8,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  function replaceScheduleUrlState(month: string, scheduleId: string) {
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    params.set("month", month);

    if (scheduleId) {
      params.set("schedule", scheduleId);
    } else {
      params.delete("schedule");
    }

    const queryString = params.toString();
    const nextUrl = queryString ? `/schedule?${queryString}` : "/schedule";
    window.history.replaceState(null, "", nextUrl);
  }

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
    setScheduleEmployeeOrderBySchedule(initialScheduleEmployeeOrderBySchedule);
  }, [initialScheduleEmployeeOrderBySchedule]);

  useEffect(() => {
    if (!isDraftHydrated) {
      return;
    }

    const timer = window.setTimeout(() => {
      persistDraftAssignmentsToStorage(baselineAssignments, draftAssignments);
    }, 160);

    return () => window.clearTimeout(timer);
  }, [baselineAssignments, draftAssignments, isDraftHydrated]);

  useEffect(() => {
    // Treat an open cell editor like an in-progress edit session: keep the
    // draft local, then autosave once the modal closes.
    if (!canEdit || isSaving || !isDraftHydrated || !hasActiveChanges || editorCell) {
      return;
    }

    const scheduledUpdates = activeDirtyUpdates.map((update) => ({ ...update }));
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
  }, [activeDirtyUpdates, activeSchedule.id, canEdit, draftAssignments, editorCell, hasActiveChanges, isDraftHydrated, isSaving]);

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
              const key = createAssignmentKey(activeSchedule.id, dragRange.employeeId, date);

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

  function handleAssignmentChange(employeeId: string, date: string, selection: AssignmentSelection) {
    if (isScheduleLocked) {
      return;
    }

    const projectedAssignment = getProjectedAssignmentForCell(employeeId, date);

    if (projectedAssignment) {
      setStatusMessage(
        `This cell is managed by ${projectedAssignment.subScheduleName ?? "a sub-schedule"} and cannot be edited here.`,
      );
      return;
    }

    const employee = employeeMap[employeeId];
    const employeeSchedule = employee ? getScheduleById(snapshot, employee.scheduleId) : null;

    if (!employee || !employeeSchedule) {
      return;
    }

    const shiftKind = shiftForDate(employeeSchedule, date);
    const defaultSelection = getDefaultSelection(shiftKind, snapshot.timeCodes);
    const currentSelection = getSelectionForCell(
      activeSchedule.id,
      employeeId,
      date,
      shiftKind,
      draftAssignments,
      snapshot.timeCodes,
    );
    const key = createAssignmentKey(activeSchedule.id, employeeId, date);
    const shouldResetToDefault =
      defaultSelection.competencyId === selection.competencyId &&
      defaultSelection.timeCodeId === selection.timeCodeId &&
      defaultSelection.notes === selection.notes;

    if (shouldResetToDefault && isOvertimeManagedSelection(currentSelection)) {
      setStatusMessage(
        "Overtime-filled cells must be released from the Overtime page before they can be cleared here.",
      );
      return;
    }

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

    if (getProjectedAssignmentForCell(employeeId, date)) {
      return;
    }

    if (canManageSetBuilder) {
      setSelectedSetAnchorDate(date);
      setSelectedCoverageCompetencyId(null);
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
      const nextMonth = addMonths(currentMonth, delta);
      persistDraftAssignmentsToStorage(baselineAssignmentsRef.current, draftAssignmentsRef.current);
      setStatusMessage("Changing month");
      router.push(`/schedule?month=${nextMonth}&schedule=${selectedScheduleId}`, { scroll: false });
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

  async function saveActiveDraftsBeforeLoan() {
    if (activeDirtyUpdates.length === 0) {
      return true;
    }

    const saveResult = await runTrackedAssignmentSave({
      scheduleId: activeSchedule.id,
      updates: activeDirtyUpdates,
    });

    setStatusMessage(saveResult.message);

    if (!saveResult.ok) {
      return false;
    }

    protectLocalBaselineFromStaleSnapshots();
    setBaselineAssignments(cloneAssignments(draftAssignments));
    return true;
  }

  function handleCreateTemporaryLoan(input: {
    employeeId: string;
    targetScheduleId: string;
    competencyId: string;
    dates: string[];
  }) {
    if (!canEdit || isScheduleLocked) {
      return;
    }

    startLoanTransition(async () => {
      const savedDrafts = await saveActiveDraftsBeforeLoan();

      if (!savedDrafts) {
        return;
      }

      setStatusMessage("Creating temporary loan...");
      const result = await createTemporaryLoan(input);
      setStatusMessage(result.message);

      if (!result.ok) {
        return;
      }

      setIsTemporaryLoanModalOpen(false);
      setSelectedCell(null);
      setEditorCell(null);
      router.refresh();
    });
  }

  function handleCancelTemporaryLoan() {
    if (!loanCancelTarget || !canEdit || isScheduleLocked) {
      return;
    }

    const loanId = loanCancelTarget.loanId;

    startLoanTransition(async () => {
      const savedDrafts = await saveActiveDraftsBeforeLoan();

      if (!savedDrafts) {
        return;
      }

      setStatusMessage("Cancelling temporary loan...");
      const result = await cancelTemporaryLoan({ loanId });
      setStatusMessage(result.message);

      if (!result.ok) {
        return;
      }

      setLoanCancelTarget(null);
      setSelectedCell(null);
      setEditorCell(null);
      router.refresh();
    });
  }

  function handleSaveShiftOrder(employeeIds: string[]) {
    if (!canManageSetBuilder || isScheduleLocked) {
      return;
    }

    const nextOrder = Array.from(new Set(employeeIds));

    setScheduleEmployeeOrderBySchedule((current) => ({
      ...current,
      [activeSchedule.id]: nextOrder,
    }));
    setIsShiftOrderModalOpen(false);

    startShiftOrderTransition(async () => {
      setStatusMessage("Saving shift display order...");
      const result = await saveScheduleEmployeeOrder({
        scheduleId: activeSchedule.id,
        employeeIds: nextOrder,
      });

      setStatusMessage(result.message);

      if (!result.ok) {
        setScheduleEmployeeOrderBySchedule(initialScheduleEmployeeOrderBySchedule);
        return;
      }

      router.refresh();
    });
  }

  function completeSelectedSet(nextIsComplete: boolean) {
    if (isScheduleLocked || !canEdit || !canManageSetBuilder || selectedSetDays.length === 0) {
      return;
    }

    const startDate = selectedSetDays[0].date;
    const endDate = selectedSetDays[selectedSetDays.length - 1].date;

    startSetCompletionTransition(async () => {
      /**
       * Completing a set causes the page to revalidate from Supabase. If we let
       * that happen while there are still unsaved local draft cells, the fresh
       * server snapshot will not include those browser-only edits and they will
       * appear to "turn into OFF". Saving first keeps time codes and
       * competencies in sync with the completion toggle.
       */
      if (activeDirtyUpdates.length > 0) {
        const saveResult = await runTrackedAssignmentSave({
          scheduleId: activeSchedule.id,
          updates: activeDirtyUpdates,
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
        (claim): claim is (typeof snapshot.overtimeClaims)[number] & { scheduleId: string } =>
          claim.scheduleId === activeSchedule.id &&
          claim.date >= startDate &&
          claim.date <= endDate,
      );
      const removedClaimKeys = new Set(
        removedClaims.map((claim) => createAssignmentKey(claim.scheduleId, claim.employeeId, claim.date)),
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

  function handleSetCompletion() {
    if (isScheduleLocked || !canEdit || !canManageSetBuilder || selectedSetDays.length === 0) {
      return;
    }

    const nextIsComplete = !isSelectedSetComplete;

    if (nextIsComplete && unfilledSetCompetencies.length > 0) {
      setIsSetCompletionWarningOpen(true);
      return;
    }

    completeSelectedSet(nextIsComplete);
  }

  function handleConfirmSetCompletionWarning() {
    setIsSetCompletionWarningOpen(false);
    completeSelectedSet(true);
  }

  function handleAutofillSet() {
    if (isScheduleLocked || !canEdit || !canManageSetBuilder || selectedSetDays.length === 0 || isSelectedSetComplete) {
      return;
    }

    const plan = buildSetAutofillPlan({
      schedule: activeSchedule,
      setDays: selectedSetDays,
      assignments: draftAssignments,
      occupiedAssignments: effectiveAssignments,
      competencies: activeScheduleCompetencies,
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
            activeSchedule.id,
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
        if (getProjectedAssignmentForCell(employee.id, day.date)) {
          return null;
        }

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
      }).filter(Boolean) as StoredAssignment[];
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
    if (isScheduleLocked || !canManageSetBuilder) {
      return;
    }

    if (!selectedColumnDate) {
      setStatusMessage("Select a date column first, then copy it.");
      return;
    }

    const selectionsByEmployeeId = Object.fromEntries(
      activeSchedule.employees.map((employee) => [
        employee.id,
        getSelectionForCell(
          activeSchedule.id,
          employee.id,
          selectedColumnDate,
          shiftForDate(activeSchedule, selectedColumnDate),
          draftAssignments,
          snapshot.timeCodes,
        ),
      ]),
    );

    const nextTemplate = {
      scheduleId: activeSchedule.id,
      sourceDate: selectedColumnDate,
      selectionsByEmployeeId,
    };

    setCopiedColumnTemplate(nextTemplate);
    persistCopiedColumnTemplateToStorage(nextTemplate);
    setStatusMessage(`Column copied from ${formatShortDate(selectedColumnDate)}.`);
  }

  function handlePasteColumn() {
    if (isScheduleLocked || !canEdit || !canManageSetBuilder) {
      return;
    }

    if (!copiedColumnTemplate) {
      setStatusMessage("Copy a column before pasting.");
      return;
    }

    if (!selectedColumnDate) {
      setStatusMessage("Select a target date column first, then paste.");
      return;
    }

    if (copiedColumnTemplate.scheduleId !== activeScheduleId) {
      setStatusMessage("Copied columns can only be pasted within the same shift.");
      return;
    }

    if (copiedColumnTemplate.sourceDate === selectedColumnDate) {
      setStatusMessage("Select a different target date before pasting this column.");
      return;
    }

    if (completedSetDates.has(selectedColumnDate)) {
      setStatusMessage("Completed set columns are locked. Reopen the set before pasting.");
      return;
    }

    if (!canPasteColumn) {
      setStatusMessage("This column cannot be pasted here.");
      return;
    }

    const pasteUpdates = activeSchedule.employees.flatMap<StoredAssignment>((employee) => {
      if (getProjectedAssignmentForCell(employee.id, selectedColumnDate)) {
        return [];
      }

      const copiedSelection = copiedColumnTemplate.selectionsByEmployeeId[employee.id];
      const nextSelection =
        copiedSelection ??
        getDefaultSelection(shiftForDate(activeSchedule, selectedColumnDate), snapshot.timeCodes);

      return [{
        employeeId: employee.id,
        scheduleId: activeSchedule.id,
        date: selectedColumnDate,
        competencyId: nextSelection.competencyId,
        timeCodeId: nextSelection.timeCodeId,
        notes: nextSelection.notes ?? null,
        shiftKind: shiftForDate(activeSchedule, selectedColumnDate),
      }];
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
            delete nextAssignments[createAssignmentKey(activeSchedule.id, employee.id, day.date)];
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
        <div className="schedule-heading-month" aria-label="Schedule month">
          <button
            type="button"
            className="schedule-heading-month__button schedule-heading-month__button--previous"
            onClick={() => handleMonthChange(-1)}
            aria-label="Previous month"
          >
            ‹
          </button>
          <h1 className="panel-title schedule-heading-month__label">{formatMonthDateRange(monthDays)}</h1>
          <button
            type="button"
            className="schedule-heading-month__button schedule-heading-month__button--next"
            onClick={() => handleMonthChange(1)}
            aria-label="Next month"
          >
            ›
          </button>
        </div>
        <div className="planner-actions planner-actions--schedule">
          <div className="planner-actions__row planner-actions__row--save">
            {canEdit && canManageSetBuilder ? (
              <button
                type="button"
                className="ghost-button"
                onClick={() => setIsTemporaryLoanModalOpen(true)}
                disabled={isScheduleLocked}
              >
                Temporary loan
              </button>
            ) : null}
            {canManageSetBuilder ? (
              <button
                type="button"
                className="ghost-button"
                onClick={() => setIsShiftOrderModalOpen(true)}
                disabled={isScheduleLocked}
              >
                Shift order
              </button>
            ) : null}
            <button
              type="button"
              className="ghost-button icon-button schedule-print-button"
              onClick={handlePrintSchedules}
              aria-label="Print schedules"
              title="Print schedules"
            >
              <PrinterIcon />
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
                const nextScheduleId = event.target.value;
                setSelectedScheduleId(nextScheduleId);
                replaceScheduleUrlState(currentMonth, nextScheduleId);
                setSelectedCoverageCompetencyId(null);
                setSelectedCompetencyFilter("all");
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

        <label className="field">
          <span>Competency</span>
          <select
            value={selectedCompetencyFilter}
            onChange={(event) => setSelectedCompetencyFilter(event.target.value)}
          >
            <option value="all">All competencies</option>
            {activeScheduleCompetencies.map((competency) => (
              <option key={competency.id} value={competency.id}>
                {competency.code} · {competency.label}
              </option>
            ))}
          </select>
        </label>
        <div className="toolbar-status-wrap">
          {isMonthLoading ? <p className="toolbar-status">Loading month...</p> : null}
          {!isMonthLoading && statusMessage ? <p className="toolbar-status">{statusMessage}</p> : null}
        </div>
      </div>

      {canManageSetBuilder && hasSelectedBuilderTarget ? (
        <section className="set-builder" aria-label="Set builder">
          <div className="set-builder__surface">
            <div className="set-builder-heading">
              <div className="set-builder-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={handleCopyColumn}
                  disabled={isScheduleLocked}
                >
                  Copy column
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={handlePasteColumn}
                  disabled={isScheduleLocked || !canEdit}
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
              {activeScheduleCompetencies.map((competency) => {
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

      <div className="schedule-scroll-shell">
        <div
          ref={scheduleTopScrollRef}
          className="schedule-wrap schedule-wrap--top-scroll"
          aria-hidden="true"
        >
          <div className="schedule-wrap__scroll-proxy" style={{ width: scheduleScrollProxyWidth }} />
        </div>

        <section
          ref={scheduleBodyScrollRef}
          className={`schedule-wrap ${isScheduleLocked ? "schedule-wrap--locked" : ""}`}
          aria-label="Monthly schedule grid"
          aria-busy={isScheduleLocked}
        >
          <div ref={scheduleGridRef} className="schedule-grid">
            <div className="schedule-grid__header" style={{ gridTemplateColumns: gridColumns }}>
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
            </div>

            {visibleEmployees.length > 0 ? (
              <div
                className="schedule-grid__rows"
                style={{
                  height: rowVirtualizer.getTotalSize(),
                }}
              >
                {virtualRows.map((virtualRow) => {
                  const employee = visibleEmployees[virtualRow.index];

                  if (!employee) {
                    return null;
                  }

                  return (
                    <EmployeeRow
                      key={employee.rowId}
                      employee={employee}
                      schedule={activeSchedule}
                      monthDays={monthDays}
                      assignments={effectiveAssignments}
                      projectedAssignmentIndex={projectedAssignmentIndex}
                      competencyMap={competencyMap}
                      timeCodeMap={timeCodeMap}
                      timeCodes={snapshot.timeCodes}
                      employeeMap={employeeMap}
                      scheduleNameMap={scheduleNameMap}
                      completedSetDates={completedSetDates}
                      selectedCell={selectedCell}
                      dragRange={dragRange}
                      highlightedMissingDates={highlightedMissingDates}
                      selectedCoverageCompetencyId={selectedCoverageCompetencyId}
                      selectedSetDays={selectedSetDays}
                      canEdit={canEdit && !isScheduleLocked}
                      onCellPointerDown={handleCellPointerDown}
                      onDragHover={handleDragHover}
                      onCellClick={(cell) => {
                        if (!canEdit || isScheduleLocked) {
                          return;
                        }

                        if (canManageSetBuilder) {
                          setSelectedSetAnchorDate(cell.date);
                          setSelectedCoverageCompetencyId(null);
                        }

                        const projectedAssignment = getProjectedAssignmentForCell(cell.employeeId, cell.date);

                        if (projectedAssignment) {
                          setStatusMessage(
                            `This cell is managed by ${projectedAssignment.subScheduleName ?? "a sub-schedule"} and must be changed from Sub-Schedules.`,
                          );
                          return;
                        }

                        const clickedEmployee = displayEmployeeMap[cell.employeeId] ?? null;
                        const clickedShiftKind = shiftForDate(activeSchedule, cell.date);
                        const clickedSelection = getSelectionForCell(
                          activeSchedule.id,
                          cell.employeeId,
                          cell.date,
                          clickedShiftKind,
                          effectiveAssignments,
                          snapshot.timeCodes,
                        );
                        const parsedLoan = parseTemporaryLoanAssignmentNote(clickedSelection.notes);

                        if (parsedLoan.loanId) {
                          setLoanCancelTarget({
                            loanId: parsedLoan.loanId,
                            employeeName: clickedEmployee?.name ?? "This worker",
                            sourceScheduleName: parsedLoan.sourceScheduleId
                              ? scheduleNameMap[parsedLoan.sourceScheduleId] ?? "their home shift"
                              : "their home shift",
                            targetScheduleName: parsedLoan.targetScheduleId
                              ? scheduleNameMap[parsedLoan.targetScheduleId] ?? "the target shift"
                              : "the target shift",
                            date: cell.date,
                          });
                          setEditorCell(null);
                          return;
                        }

                        setSelectedCell(cell);
                        setEditorCell(cell);
                      }}
                      rowStyle={{
                        gridTemplateColumns: gridColumns,
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualRow.start}px)`,
                        height: `${virtualRow.size}px`,
                      }}
                    />
                  );
                })}
              </div>
            ) : (
              <div
                className="empty-state sticky-column"
                style={{ gridColumn: `1 / span ${monthDays.length + 1}` }}
              >
                <strong>No employees matched that search.</strong>
                <span>Try a different name, role, or clear the filter.</span>
              </div>
            )}
          </div>
        </section>
      </div>

      {isSetCompletionWarningOpen && activeSchedule && selectedSetDays.length > 0 ? (
        <SetCompletionWarningModal
          scheduleName={activeSchedule.name}
          dateRange={`${formatShortDate(selectedSetDays[0].date)}-${formatShortDate(
            selectedSetDays[selectedSetDays.length - 1].date,
          )}`}
          unfilledCompetencies={unfilledSetCompetencies}
          onCancel={() => setIsSetCompletionWarningOpen(false)}
          onConfirm={handleConfirmSetCompletionWarning}
          isSubmitting={isUpdatingSetCompletion}
        />
      ) : null}

      {isTemporaryLoanModalOpen ? (
        <TemporaryLoanModal
          schedules={snapshot.schedules}
          competencies={snapshot.competencies}
          monthDays={monthDays}
          defaultTargetScheduleId={activeSchedule.id}
          onCancel={() => setIsTemporaryLoanModalOpen(false)}
          onSubmit={handleCreateTemporaryLoan}
          isSubmitting={isLoanTransition}
        />
      ) : null}

      {loanCancelTarget ? (
        <CancelTemporaryLoanModal
          target={loanCancelTarget}
          onCancel={() => setLoanCancelTarget(null)}
          onConfirm={handleCancelTemporaryLoan}
          isSubmitting={isLoanTransition}
        />
      ) : null}

      {isShiftOrderModalOpen ? (
        <ShiftOrderModal
          scheduleName={activeSchedule.name}
          employees={activeShiftOrderEmployees}
          onCancel={() => setIsShiftOrderModalOpen(false)}
          onSave={handleSaveShiftOrder}
          isSubmitting={isSavingShiftOrder}
        />
      ) : null}

      {canEdit && !isScheduleLocked ? (
        <ScheduleAssignmentModal
          selectedEmployeeName={editorEmployee?.name ?? null}
          selectedDate={editorCell?.date ?? null}
          shiftKind={editorShiftKind}
          selection={editorSelection}
          competencies={editorEmployeeCompetencies}
          timeCodes={manualEntryTimeCodes}
          clearDisabledReason={editorClearDisabledReason}
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
  schedule,
  monthDays,
  assignments,
  projectedAssignmentIndex,
  competencyMap,
  timeCodeMap,
  timeCodes,
  employeeMap,
  scheduleNameMap,
  completedSetDates,
  selectedCell,
  dragRange,
  highlightedMissingDates,
  selectedCoverageCompetencyId,
  selectedSetDays,
  canEdit,
  onCellPointerDown,
  onDragHover,
  onCellClick,
  rowStyle,
}: {
  employee: DisplayEmployee;
  schedule: Schedule;
  monthDays: Array<{ date: string; dayNumber: number; dayName: string; isWeekend: boolean }>;
  assignments: Record<string, AssignmentSelection>;
  projectedAssignmentIndex: Record<string, StoredAssignment>;
  competencyMap: Record<string, Competency>;
  timeCodeMap: Record<string, TimeCode>;
  timeCodes: TimeCode[];
  employeeMap: Record<string, Employee>;
  scheduleNameMap: Record<string, string>;
  completedSetDates: Set<string>;
  selectedCell: SelectedCell | null;
  dragRange: DragRange | null;
  highlightedMissingDates: Set<string>;
  selectedCoverageCompetencyId: string | null;
  selectedSetDays: Array<{ date: string }>;
  canEdit: boolean;
  onCellPointerDown: (
    employeeId: string,
    date: string,
    dayIndex: number,
    selection: AssignmentSelection,
  ) => void;
  onDragHover: (employeeId: string, dayIndex: number) => void;
  onCellClick: (cell: SelectedCell) => void;
  rowStyle?: CSSProperties;
}) {
  const setDates = new Set(selectedSetDays.map((day) => day.date));
  const overtimeDateSet = employee.overtimeDates ? new Set(employee.overtimeDates) : null;
  const mutualDateSet = employee.mutualDates ? new Set(employee.mutualDates) : null;
  const loanDateSet = employee.loanDates ? new Set(employee.loanDates) : null;
  const hasLimitedBorrowedDates = Boolean(overtimeDateSet || mutualDateSet || loanDateSet);

  return (
    <div className="schedule-grid-row" style={rowStyle}>
      <div className="employee-cell sticky-column">
        <div className="employee-cell__main">
          <strong title={employee.name}>
            <span className="employee-name-full">{employee.name}</span>
            <span className="employee-name-compact">{getCompactEmployeeName(employee.name)}</span>
          </strong>
        </div>
      </div>

      {monthDays.map((day, dayIndex) => {
        const isBorrowedCellVisible =
          !hasLimitedBorrowedDates ||
          Boolean(overtimeDateSet?.has(day.date) || mutualDateSet?.has(day.date) || loanDateSet?.has(day.date));
        const isLockedCell = completedSetDates.has(day.date);
        const showLockedCell = isBorrowedCellVisible && isLockedCell;
        const projectedAssignment =
          projectedAssignmentIndex[createAssignmentKey(schedule.id, employee.sourceEmployeeId, day.date)] ?? null;
        const isProjectedCell = Boolean(projectedAssignment);
        const shiftKind = isBorrowedCellVisible ? shiftForDate(schedule, day.date) : "OFF";
        const selection = isBorrowedCellVisible
          ? getSelectionForCell(
              schedule.id,
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
        const isTemporaryLoanCell = isTemporaryLoanManagedSelection(selection);
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
        const cellTitle = isProjectedCell
          ? `${projectedAssignment?.subScheduleName ?? "Sub-schedule"} manages this cell`
          : getScheduleCellComment({
              notes: selection.notes,
              employeeName: employee.name,
              employeeId: employee.sourceEmployeeId,
              scheduleId: schedule.id,
              employeeMap,
              scheduleNameMap,
            });

        return (
          <div
            key={`${employee.rowId}-${day.date}`}
            className={`shift-cell shift-cell--${getShiftTone(shiftKind)} ${
              day.isWeekend ? "shift-cell--weekend" : ""
            } ${activeColorToken ? `legend-pill--${activeColorToken.toLowerCase()}` : ""} ${
              activeColorToken ? "shift-cell--coded" : ""
            } ${showLockedCell ? "shift-cell--locked" : ""} ${
              showLockedCell && activeColorToken ? "shift-cell--locked-coded" : ""
            } ${isSelected ? "shift-cell--selected" : ""} ${
              isInDragRange ? "shift-cell--range" : ""
            } ${highlightedMissingDates.has(day.date) && setDates.has(day.date) ? "shift-cell--missing-column" : ""} ${
              isCoverageFocus ? "shift-cell--coverage-focus" : ""
            } ${hasCellNote ? "shift-cell--has-note" : ""} ${isProjectedCell ? "shift-cell--projected" : ""}`}
            onPointerDown={(event) => {
              if (
                event.button !== 0 ||
                !canEdit ||
                !isBorrowedCellVisible ||
                isLockedCell ||
                isProjectedCell ||
                isTemporaryLoanCell
              ) {
                return;
              }

              onCellPointerDown(employee.sourceEmployeeId, day.date, dayIndex, effectiveSelection);
            }}
            onPointerEnter={(event) => {
              if (
                canEdit &&
                isBorrowedCellVisible &&
                !isLockedCell &&
                !isTemporaryLoanCell &&
                dragRange &&
                event.buttons === 1
              ) {
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
              title={cellTitle}
            >
              {isBorrowedCellVisible ? getSelectionCode(effectiveSelection, competencyMap, timeCodeMap) : ""}
              {hasCellNote ? <span className="shift-cell__note-indicator" aria-hidden="true" /> : null}
            </button>
          </div>
        );
      })}
    </div>
  );
}
