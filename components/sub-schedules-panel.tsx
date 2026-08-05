"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";

import {
  deleteSubSchedule,
  saveSubScheduleAssignments,
  saveSubSchedules,
} from "@/app/actions";
import { AppDateSelector } from "@/components/app-date-selector";
import { parseOvertimeAssignmentNote } from "@/lib/overtime";
import {
  formatMonthLabel,
  getCompetencyMap,
  getEmployeeMap,
  getMonthDays,
  getScheduleById,
  getTimeCodeMap,
} from "@/lib/scheduling";
import { getManualEntryTimeCodes } from "@/lib/sub-schedules";
import type {
  Competency,
  DeleteSubScheduleInput,
  Employee,
  SaveSubScheduleAssignmentsInput,
  SaveSubSchedulesInput,
  SchedulerSnapshot,
  SubScheduleAssignmentUpdate,
  SubScheduleUpdate,
  TimeCode,
} from "@/lib/types";

type EditableSubSchedule = {
  id: string;
  name: string;
  summaryTimeCodeId: string;
  isArchived: boolean;
  competencyIds: string[];
  carryWorkersAcrossMonths: boolean;
};

type SubScheduleCellSelection = {
  competencyId: string | null;
  timeCodeId: string | null;
  notes: string | null;
};

type EditorCell = {
  employeeId: string;
  date: string;
};

type DragRange = {
  employeeId: string;
  startIndex: number;
  currentIndex: number;
  selection: SubScheduleCellSelection;
};

const SUBSCHEDULE_AUTO_SAVE_DEBOUNCE_MS = 2500;

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 8.25a3.75 3.75 0 1 1 0 7.5a3.75 3.75 0 0 1 0-7.5Z" />
      <path d="M19.5 12a7.46 7.46 0 0 0-.15-1.5l2.1-1.62l-2-3.46l-2.48 1a7.6 7.6 0 0 0-2.6-1.5L14 2.25h-4l-.38 2.67a7.6 7.6 0 0 0-2.6 1.5l-2.48-1l-2 3.46l2.1 1.62a7.4 7.4 0 0 0 0 3l-2.1 1.62l2 3.46l2.48-1a7.6 7.6 0 0 0 2.6 1.5l.38 2.67h4l.38-2.67a7.6 7.6 0 0 0 2.6-1.5l2.48 1l2-3.46l-2.1-1.62c.1-.49.15-.99.15-1.5Z" />
    </svg>
  );
}

function createSubScheduleCellKey(employeeId: string, date: string) {
  return `${employeeId}:${date}`;
}

function cloneSubSchedules(subSchedules: EditableSubSchedule[]) {
  return subSchedules.map((subSchedule) => ({ ...subSchedule }));
}

function normalizeSubSchedule(subSchedule: EditableSubSchedule): SubScheduleUpdate {
  return {
    subScheduleId: subSchedule.id,
    name: subSchedule.name.trim(),
    summaryTimeCodeId: subSchedule.summaryTimeCodeId,
    isArchived: subSchedule.isArchived,
    carryWorkersAcrossMonths: subSchedule.carryWorkersAcrossMonths,
  };
}

function getSubScheduleIssues(subSchedule: EditableSubSchedule) {
  const issues: string[] = [];

  if (!subSchedule.name.trim()) {
    issues.push("Name required");
  }

  if (!subSchedule.summaryTimeCodeId) {
    issues.push("Summary code required");
  }

  return issues;
}

function cloneCellSelections(selections: Record<string, SubScheduleCellSelection>) {
  return Object.fromEntries(
    Object.entries(selections).map(([key, selection]) => [key, { ...selection }]),
  ) as Record<string, SubScheduleCellSelection>;
}

function buildCellSelectionMap(snapshot: SchedulerSnapshot, subScheduleId: string, month: string) {
  return snapshot.subScheduleAssignments
    .filter(
      (assignment) =>
        assignment.subScheduleId === subScheduleId &&
        assignment.date.slice(0, 7) === month,
    )
    .reduce<Record<string, SubScheduleCellSelection>>((map, assignment) => {
      map[createSubScheduleCellKey(assignment.employeeId, assignment.date)] = {
        competencyId: assignment.competencyId,
        timeCodeId: assignment.timeCodeId,
        notes: assignment.notes ?? null,
      };
      return map;
    }, {});
}

function buildDirtySubScheduleAssignmentUpdates({
  subScheduleId,
  baselineSelections,
  draftSelections,
}: {
  subScheduleId: string;
  baselineSelections: Record<string, SubScheduleCellSelection>;
  draftSelections: Record<string, SubScheduleCellSelection>;
}) {
  return Array.from(
    new Set([...Object.keys(baselineSelections), ...Object.keys(draftSelections)]),
  ).flatMap<SubScheduleAssignmentUpdate>((key) => {
    const [employeeId, date] = key.split(":");
    const baseline = baselineSelections[key] ?? { competencyId: null, timeCodeId: null, notes: null };
    const draft = draftSelections[key] ?? { competencyId: null, timeCodeId: null, notes: null };

    if (
      baseline.competencyId === draft.competencyId &&
      baseline.timeCodeId === draft.timeCodeId &&
      baseline.notes === draft.notes
    ) {
      return [];
    }

    return [
      {
        subScheduleAssignmentId: `ssa-${subScheduleId}-${employeeId}-${date}`,
        employeeId,
        date,
        competencyId: draft.competencyId,
        timeCodeId: draft.timeCodeId,
        notes: draft.notes,
      },
    ];
  });
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

function getTimeCodeDisplayCode(timeCode: TimeCode | undefined, notes: string | null) {
  const baseCode = timeCode?.code ?? "";

  if (baseCode.trim().toUpperCase() !== "T") {
    return baseCode;
  }

  const noteDigits = notes?.match(/\d/g)?.slice(0, 3).join("") ?? "";
  return noteDigits ? `${baseCode}${noteDigits}` : baseCode;
}

function getCellCode(
  selection: SubScheduleCellSelection,
  competencyMap: Record<string, Competency>,
  timeCodeMap: Record<string, TimeCode>,
) {
  if (selection.timeCodeId) {
    return getTimeCodeDisplayCode(timeCodeMap[selection.timeCodeId], selection.notes);
  }

  if (!selection.competencyId) {
    return "";
  }

  return getCompactCode(competencyMap[selection.competencyId]?.code ?? "");
}

function getCellTitle(notes: string | null) {
  const parsedOvertime = parseOvertimeAssignmentNote(notes);

  if (parsedOvertime.claimantEmployeeId) {
    return "Overtime assignment";
  }

  return notes ?? undefined;
}

function SubScheduleCellModal({
  employee,
  date,
  selection,
  competencies,
  timeCodes,
  onApply,
  onClear,
  onClose,
}: {
  employee: Employee | null;
  date: string | null;
  selection: SubScheduleCellSelection;
  competencies: Competency[];
  timeCodes: TimeCode[];
  onApply: (selection: SubScheduleCellSelection) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  if (!employee || !date || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="assignment-modal-backdrop" onClick={onClose}>
      <section
        className="assignment-modal"
        aria-label="Sub-schedule assignment editor"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="assignment-modal__header">
          <div>
            <h2 className="assignment-modal__title">Sub-Schedule Assignment</h2>
            <p className="assignment-modal__context">
              {employee.name} · {date}
            </p>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="assignment-modal__group">
          <span className="assignment-modal__label">Posts</span>
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
                {getTimeCodeDisplayCode(timeCode, selection.notes)}
              </button>
            ))}
          </div>
        </div>

        <div className="assignment-modal__group">
          <label className="assignment-modal__label" htmlFor="subschedule-note">
            Note
          </label>
          <textarea
            id="subschedule-note"
            className="assignment-modal__note-input"
            rows={3}
            value={selection.notes ?? ""}
            placeholder="Add a note for this sub-schedule cell"
            onChange={(event) =>
              onApply({
                ...selection,
                notes: event.target.value || null,
              })
            }
          />
        </div>

        <div className="assignment-modal__footer">
          <button type="button" className="ghost-button" onClick={onClear}>
            Clear assignment
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function SubScheduleSettingsModal({
  subSchedule,
  summaryTimeCodes,
  issues,
  hasChanges,
  isSaving,
  isDeleting,
  isPersisted,
  onChange,
  onClose,
  onDelete,
  onRevert,
  onSave,
}: {
  subSchedule: EditableSubSchedule;
  summaryTimeCodes: TimeCode[];
  issues: string[];
  hasChanges: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  isPersisted: boolean;
  onChange: (updater: (subSchedule: EditableSubSchedule) => EditableSubSchedule) => void;
  onClose: () => void;
  onDelete: () => void;
  onRevert: () => void;
  onSave: () => void;
}) {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const isBusy = isSaving || isDeleting;

  return createPortal(
    <div className="assignment-modal-backdrop" onClick={onClose}>
      <section className="assignment-modal mutual-modal" onClick={(event) => event.stopPropagation()}>
        <div className="assignment-modal__header">
          <div>
            <span className="assignment-modal__eyebrow">Sub-schedule settings</span>
            <h2 className="assignment-modal__title">{subSchedule.name || "New sub-schedule"}</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onClose} disabled={isBusy}>
            Close
          </button>
        </div>

        <div className="modal-form-grid">
          <label className="field">
            <span>Name</span>
            <input
              value={subSchedule.name}
              disabled={isBusy}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
          </label>

          <label className="field">
            <span>Summary code</span>
            <select
              value={subSchedule.summaryTimeCodeId}
              disabled={isBusy}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  summaryTimeCodeId: event.target.value,
                }))
              }
            >
              <option value="">Select summary code</option>
              {summaryTimeCodes.map((timeCode) => (
                <option key={timeCode.id} value={timeCode.id}>
                  {timeCode.code} · {timeCode.label}
                </option>
              ))}
            </select>
          </label>

          <label className="subschedule-status-toggle">
            <input
              type="checkbox"
              checked={!subSchedule.isArchived}
              disabled={isBusy}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  isArchived: !event.target.checked,
                }))
              }
            />
            <span>Active</span>
          </label>
        </div>

        {issues.length > 0 ? <p className="toolbar-status">{issues[0]}</p> : null}

        <div className="assignment-modal__danger-zone">
          <div>
            <strong>Delete sub-schedule</strong>
            <span>
              {isPersisted
                ? "Deletes this sub-schedule and its projected staffing rows."
                : "Removes this unsaved sub-schedule draft."}
            </span>
          </div>
          {isConfirmingDelete ? (
            <div className="table-actions-inline">
              <button
                type="button"
                className="table-action"
                onClick={() => setIsConfirmingDelete(false)}
                disabled={isBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="table-action table-action--danger"
                onClick={onDelete}
                disabled={isBusy}
              >
                {isDeleting ? "Deleting..." : "Confirm delete"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="table-action table-action--danger"
              onClick={() => setIsConfirmingDelete(true)}
              disabled={isBusy}
            >
              Delete
            </button>
          )}
        </div>

        <div className="assignment-modal__footer">
          <button type="button" className="ghost-button" onClick={onRevert} disabled={isBusy || !hasChanges}>
            Revert
          </button>
          <button type="button" className="primary-button" onClick={onSave} disabled={isBusy || !hasChanges || issues.length > 0}>
            {isSaving ? "Saving..." : "Save settings"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function AddSubScheduleEmployeeModal({
  employees,
  selectedEmployeeId,
  onSelect,
  onAdd,
  onClose,
}: {
  employees: Employee[];
  selectedEmployeeId: string;
  onSelect: (employeeId: string) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  return createPortal(
    <div className="assignment-modal-backdrop" onClick={onClose}>
      <section className="assignment-modal mutual-modal" onClick={(event) => event.stopPropagation()}>
        <div className="assignment-modal__header">
          <div>
            <span className="assignment-modal__eyebrow">Sub-schedule row</span>
            <h2 className="assignment-modal__title">Add employee</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
        </div>

        {employees.length > 0 ? (
          <label className="field">
            <span>Employee</span>
            <select value={selectedEmployeeId} onChange={(event) => onSelect(event.target.value)}>
              <option value="">Select employee</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="empty-state">
            <strong>All employees are already visible.</strong>
            <span>Every available worker has a row in this sub-schedule.</span>
          </div>
        )}

        <div className="assignment-modal__footer">
          <button type="button" className="primary-button" onClick={onAdd} disabled={!selectedEmployeeId}>
            Add row
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

/** Dedicated planner for overlay schedules that project summary codes back home. */
export function SubSchedulesPanel({
  snapshot,
  initialSelectedSubScheduleId = "",
}: {
  snapshot: SchedulerSnapshot;
  initialSelectedSubScheduleId?: string;
}) {
  const router = useRouter();
  const monthDays = useMemo(() => getMonthDays(snapshot.month), [snapshot.month]);
  const competencyMap = useMemo(() => getCompetencyMap(snapshot.competencies), [snapshot.competencies]);
  const timeCodeMap = useMemo(() => getTimeCodeMap(snapshot.timeCodes), [snapshot.timeCodes]);
  const employeeMap = useMemo(() => getEmployeeMap(snapshot.schedules), [snapshot.schedules]);
  const employees = useMemo(
    () =>
      snapshot.schedules
        .flatMap((schedule) => schedule.employees)
        .sort((left, right) => left.name.localeCompare(right.name)),
    [snapshot.schedules],
  );
  const projectedSummaryTimeCodes = useMemo(
    () => snapshot.timeCodes.filter((timeCode) => timeCode.usageMode !== "manual"),
    [snapshot.timeCodes],
  );
  const initialSubSchedules = useMemo<EditableSubSchedule[]>(
    () =>
      snapshot.subSchedules.map((subSchedule) => ({
        id: subSchedule.id,
        name: subSchedule.name,
        summaryTimeCodeId: subSchedule.summaryTimeCodeId,
        isArchived: subSchedule.isArchived,
        competencyIds: subSchedule.competencyIds,
        carryWorkersAcrossMonths: subSchedule.carryWorkersAcrossMonths,
      })),
    [snapshot.subSchedules],
  );

  const [subSchedules, setSubSchedules] = useState(initialSubSchedules);
  const [baselineSubSchedules, setBaselineSubSchedules] = useState(initialSubSchedules);
  const [selectedSubScheduleId, setSelectedSubScheduleId] = useState(
    initialSubSchedules.some((subSchedule) => subSchedule.id === initialSelectedSubScheduleId)
      ? initialSelectedSubScheduleId
      : initialSubSchedules.find((subSchedule) => !subSchedule.isArchived)?.id ?? initialSubSchedules[0]?.id ?? "",
  );
  const [statusMessage, setStatusMessage] = useState("");
  const [assignmentMessage, setAssignmentMessage] = useState("");
  const [editorCell, setEditorCell] = useState<EditorCell | null>(null);
  const [dragRange, setDragRange] = useState<DragRange | null>(null);
  const [addedEmployeeIds, setAddedEmployeeIds] = useState<string[]>([]);
  const [employeeToAddId, setEmployeeToAddId] = useState("");
  const [isEmployeePickerOpen, setIsEmployeePickerOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isSavingDefinitions, startDefinitionSaveTransition] = useTransition();
  const [isDeletingDefinition, startDefinitionDeleteTransition] = useTransition();
  const [isSavingAssignments, startAssignmentSaveTransition] = useTransition();
  const lastAssignmentSaveSignatureRef = useRef("");

  useEffect(() => {
    setSubSchedules(cloneSubSchedules(initialSubSchedules));
    setBaselineSubSchedules(cloneSubSchedules(initialSubSchedules));
    setSelectedSubScheduleId((current) => {
      if (initialSubSchedules.some((subSchedule) => subSchedule.id === current)) {
        return current;
      }

      if (initialSubSchedules.some((subSchedule) => subSchedule.id === initialSelectedSubScheduleId)) {
        return initialSelectedSubScheduleId;
      }

      return initialSubSchedules.find((subSchedule) => !subSchedule.isArchived)?.id ?? initialSubSchedules[0]?.id ?? "";
    });
    setAddedEmployeeIds([]);
    setEmployeeToAddId("");
    setIsEmployeePickerOpen(false);
    setIsSettingsModalOpen(false);
    setStatusMessage("");
    setAssignmentMessage("");
  }, [initialSelectedSubScheduleId, initialSubSchedules]);

  const activeSubSchedule =
    subSchedules.find((subSchedule) => subSchedule.id === selectedSubScheduleId) ?? null;
  const isPersistedActiveSubSchedule = activeSubSchedule
    ? snapshot.subSchedules.some((subSchedule) => subSchedule.id === activeSubSchedule.id)
    : false;
  const baselineAssignmentSelections = useMemo(
    () =>
      activeSubSchedule
        ? buildCellSelectionMap(snapshot, activeSubSchedule.id, snapshot.month)
        : {},
    [activeSubSchedule, snapshot],
  );
  const [draftAssignmentSelections, setDraftAssignmentSelections] = useState<Record<string, SubScheduleCellSelection>>(
    baselineAssignmentSelections,
  );

  useEffect(() => {
    setDraftAssignmentSelections(cloneCellSelections(baselineAssignmentSelections));
    setEditorCell(null);
    setDragRange(null);
    setAddedEmployeeIds([]);
    setEmployeeToAddId("");
    setIsEmployeePickerOpen(false);
    setAssignmentMessage("");
    lastAssignmentSaveSignatureRef.current = "";
  }, [baselineAssignmentSelections]);

  const dirtySubScheduleIds = useMemo(
    () =>
      new Set(
        subSchedules
          .map((subSchedule) => normalizeSubSchedule(subSchedule))
          .filter((subSchedule) => {
            const baseline = baselineSubSchedules.find((entry) => entry.id === subSchedule.subScheduleId);
            return JSON.stringify(baseline ? normalizeSubSchedule(baseline) : null) !== JSON.stringify(subSchedule);
          })
          .map((subSchedule) => subSchedule.subScheduleId),
      ),
    [baselineSubSchedules, subSchedules],
  );
  const invalidSubScheduleIds = useMemo(
    () =>
      new Set(subSchedules.filter((subSchedule) => getSubScheduleIssues(subSchedule).length > 0).map((subSchedule) => subSchedule.id)),
    [subSchedules],
  );
  const definitionUpdates = useMemo(
    () =>
      subSchedules
        .map((subSchedule) => normalizeSubSchedule(subSchedule))
        .filter((subSchedule) => {
          const baseline = baselineSubSchedules.find((entry) => entry.id === subSchedule.subScheduleId);
          return JSON.stringify(baseline ? normalizeSubSchedule(baseline) : null) !== JSON.stringify(subSchedule);
        }),
    [baselineSubSchedules, subSchedules],
  );
  const hasDefinitionChanges = definitionUpdates.length > 0;
  const assignmentUpdates = useMemo(
    () =>
      activeSubSchedule
        ? buildDirtySubScheduleAssignmentUpdates({
            subScheduleId: activeSubSchedule.id,
            baselineSelections: baselineAssignmentSelections,
            draftSelections: draftAssignmentSelections,
          })
        : [],
    [activeSubSchedule, baselineAssignmentSelections, draftAssignmentSelections],
  );
  const hasAssignmentChanges = assignmentUpdates.length > 0;
  const assignmentUpdateSignature = useMemo(
    () => JSON.stringify(assignmentUpdates),
    [assignmentUpdates],
  );

  useEffect(() => {
    if (
      !activeSubSchedule ||
      !isPersistedActiveSubSchedule ||
      activeSubSchedule.isArchived ||
      !hasAssignmentChanges ||
      isSavingAssignments ||
      assignmentUpdateSignature === lastAssignmentSaveSignatureRef.current
    ) {
      return;
    }

    const subScheduleId = activeSubSchedule.id;
    const updates = assignmentUpdates;
    const signature = assignmentUpdateSignature;

    const timer = window.setTimeout(() => {
      lastAssignmentSaveSignatureRef.current = signature;
      setAssignmentMessage("Saving changes automatically...");

      startAssignmentSaveTransition(async () => {
        const result = await saveSubScheduleAssignments({
          subScheduleId,
          updates,
        } as SaveSubScheduleAssignmentsInput);

        setAssignmentMessage(result.ok ? "Changes saved automatically." : result.message);

        if (result.ok) {
          setEditorCell(null);
          router.refresh();
        } else {
          lastAssignmentSaveSignatureRef.current = "";
        }
      });
    }, SUBSCHEDULE_AUTO_SAVE_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [
    activeSubSchedule,
    assignmentUpdateSignature,
    assignmentUpdates,
    hasAssignmentChanges,
    isPersistedActiveSubSchedule,
    isSavingAssignments,
    router,
    startAssignmentSaveTransition,
  ]);

  const assignedEmployeeIds = useMemo(
    () =>
      new Set(
        Object.entries(draftAssignmentSelections)
          .filter(([, selection]) => selection.competencyId || selection.timeCodeId || selection.notes)
          .map(([key]) => key.split(":")[0]),
      ),
    [draftAssignmentSelections],
  );
  const rowEmployeeIds = useMemo(
    () =>
      Array.from(new Set([...assignedEmployeeIds, ...addedEmployeeIds])).sort((left, right) => {
        const leftName = employeeMap[left]?.name ?? left;
        const rightName = employeeMap[right]?.name ?? right;
        return leftName.localeCompare(rightName);
      }),
    [addedEmployeeIds, assignedEmployeeIds, employeeMap],
  );
  const availableEmployeesToAdd = useMemo(
    () => employees.filter((employee) => !rowEmployeeIds.includes(employee.id)),
    [employees, rowEmployeeIds],
  );
  const editorEmployee = editorCell ? employeeMap[editorCell.employeeId] ?? null : null;
  const editorSelection =
    editorCell
      ? draftAssignmentSelections[createSubScheduleCellKey(editorCell.employeeId, editorCell.date)] ?? {
          competencyId: null,
          timeCodeId: null,
          notes: null,
        }
      : { competencyId: null, timeCodeId: null, notes: null };
  const allowedSubScheduleCompetencyIds = useMemo(
    () => new Set(activeSubSchedule?.competencyIds ?? []),
    [activeSubSchedule],
  );
  const editorCompetencies = editorEmployee
    ? editorEmployee.competencyIds
        .filter((competencyId) => allowedSubScheduleCompetencyIds.has(competencyId))
        .map((competencyId) => competencyMap[competencyId])
        .filter((competency): competency is Competency => Boolean(competency))
    : [];
  const editableTimeCodes = useMemo(
    () => getManualEntryTimeCodes(snapshot.timeCodes),
    [snapshot.timeCodes],
  );
  const activeSubScheduleIssues = activeSubSchedule ? getSubScheduleIssues(activeSubSchedule) : [];

  function updateSubSchedule(
    subScheduleId: string,
    updater: (subSchedule: EditableSubSchedule) => EditableSubSchedule,
  ) {
    setSubSchedules((current) =>
      current.map((subSchedule) => (subSchedule.id === subScheduleId ? updater(subSchedule) : subSchedule)),
    );
  }

  function handleAddSubSchedule() {
    const defaultSummaryTimeCodeId = projectedSummaryTimeCodes[0]?.id ?? "";
    const nextSubSchedule: EditableSubSchedule = {
      id: `sub-schedule-${crypto.randomUUID().slice(0, 8)}`,
      name: "New sub-schedule",
      summaryTimeCodeId: defaultSummaryTimeCodeId,
      isArchived: false,
      competencyIds: [],
      carryWorkersAcrossMonths: false,
    };

    setSubSchedules((current) => [nextSubSchedule, ...current]);
    setSelectedSubScheduleId(nextSubSchedule.id);
    setIsSettingsModalOpen(true);
    setStatusMessage("");
  }

  function handleSaveDefinitions({ closeModal = false }: { closeModal?: boolean } = {}) {
    if (invalidSubScheduleIds.size > 0) {
      setStatusMessage("Fix the highlighted sub-schedules before saving.");
      return;
    }

    startDefinitionSaveTransition(async () => {
      const result = await saveSubSchedules({
        updates: definitionUpdates,
      } as SaveSubSchedulesInput);

      setStatusMessage(result.message);

      if (result.ok) {
        setBaselineSubSchedules(cloneSubSchedules(subSchedules));
        if (closeModal) {
          setIsSettingsModalOpen(false);
        }
        router.refresh();
      }
    });
  }

  function handleRevertDefinitions({ closeModal = false }: { closeModal?: boolean } = {}) {
    setSubSchedules(cloneSubSchedules(baselineSubSchedules));
    if (closeModal) {
      setIsSettingsModalOpen(false);
    }
    setStatusMessage("Changes reverted.");
  }

  function handleDeleteSubSchedule(subScheduleId: string) {
    const isPersistedSubSchedule = snapshot.subSchedules.some((subSchedule) => subSchedule.id === subScheduleId);

    if (!isPersistedSubSchedule) {
      setSubSchedules((current) => current.filter((subSchedule) => subSchedule.id !== subScheduleId));
      setBaselineSubSchedules((current) => current.filter((subSchedule) => subSchedule.id !== subScheduleId));
      setSelectedSubScheduleId((current) => {
        if (current !== subScheduleId) {
          return current;
        }

        const nextSubSchedule = subSchedules.find((subSchedule) => subSchedule.id !== subScheduleId);
        return nextSubSchedule?.id ?? "";
      });
      setIsSettingsModalOpen(false);
      setStatusMessage("Sub-schedule draft deleted.");
      return;
    }

    startDefinitionDeleteTransition(async () => {
      const result = await deleteSubSchedule({
        subScheduleId,
      } as DeleteSubScheduleInput);

      setStatusMessage(result.message);

      if (result.ok) {
        setSubSchedules((current) => current.filter((subSchedule) => subSchedule.id !== subScheduleId));
        setBaselineSubSchedules((current) => current.filter((subSchedule) => subSchedule.id !== subScheduleId));
        setSelectedSubScheduleId((current) => {
          if (current !== subScheduleId) {
            return current;
          }

          const nextSubSchedule = subSchedules.find((subSchedule) => subSchedule.id !== subScheduleId);
          return nextSubSchedule?.id ?? "";
        });
        setIsSettingsModalOpen(false);
        router.refresh();
      }
    });
  }

  function handleMonthChange(nextMonth: string) {
    const params = new URLSearchParams({ month: nextMonth });

    if (selectedSubScheduleId) {
      params.set("subSchedule", selectedSubScheduleId);
    }

    router.push(`/sub-schedules?${params.toString()}`, { scroll: false });
  }

  function handleAddEmployeeRow() {
    const employeeId = employeeToAddId;

    if (!employeeId) {
      return;
    }

    setAddedEmployeeIds((current) =>
      current.includes(employeeId) ? current : [...current, employeeId],
    );
    setEmployeeToAddId("");
    setIsEmployeePickerOpen(false);
    setAssignmentMessage("");
  }

  function handleCellChange(employeeId: string, date: string, selection: SubScheduleCellSelection) {
    const key = createSubScheduleCellKey(employeeId, date);

    setDraftAssignmentSelections((current) => {
      const nextSelections = { ...current };

      if (!selection.competencyId && !selection.timeCodeId && !(selection.notes?.trim().length ?? 0)) {
        delete nextSelections[key];
        return nextSelections;
      }

      nextSelections[key] = {
        competencyId: selection.competencyId,
        timeCodeId: selection.timeCodeId,
        notes: selection.notes?.trim() ? selection.notes.trim() : null,
      };

      return nextSelections;
    });
    setAssignmentMessage("Draft updated locally.");
  }

  function handleCellPointerDown(
    employeeId: string,
    dayIndex: number,
    selection: SubScheduleCellSelection,
  ) {
    if (!isPersistedActiveSubSchedule || activeSubSchedule?.isArchived) {
      return;
    }

    setDragRange({
      employeeId,
      startIndex: dayIndex,
      currentIndex: dayIndex,
      selection,
    });
  }

  function handleDragHover(employeeId: string, dayIndex: number) {
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

  useEffect(() => {
    function handlePointerUp() {
      if (!dragRange) {
        return;
      }

      const startIndex = Math.min(dragRange.startIndex, dragRange.currentIndex);
      const endIndex = Math.max(dragRange.startIndex, dragRange.currentIndex);

      if (endIndex > startIndex) {
        const rangeDates = monthDays.slice(startIndex, endIndex + 1).map((day) => day.date);

        setDraftAssignmentSelections((current) => {
          const nextSelections = { ...current };

          for (const date of rangeDates) {
            const key = createSubScheduleCellKey(dragRange.employeeId, date);

            if (
              !dragRange.selection.competencyId &&
              !dragRange.selection.timeCodeId &&
              !(dragRange.selection.notes?.trim().length ?? 0)
            ) {
              delete nextSelections[key];
              continue;
            }

            nextSelections[key] = {
              competencyId: dragRange.selection.competencyId,
              timeCodeId: dragRange.selection.timeCodeId,
              notes: dragRange.selection.notes?.trim() ? dragRange.selection.notes.trim() : null,
            };
          }

          return nextSelections;
        });
        setAssignmentMessage(`Copied assignment across ${rangeDates.length} days.`);
      }

      setDragRange(null);
    }

    window.addEventListener("pointerup", handlePointerUp);

    return () => window.removeEventListener("pointerup", handlePointerUp);
  }, [dragRange, monthDays]);

  return (
    <section className="panel-frame">
      <div className="panel-heading panel-heading--split">
        <h1 className="panel-title">Sub-Schedules</h1>
        <AppDateSelector
          mode="month"
          value={snapshot.month}
          label="Sub-schedules month"
          className="sub-schedules-month-pager"
          onChange={handleMonthChange}
        />
      </div>

      <div className="workspace-toolbar subschedule-toolbar">
        {subSchedules.length === 0 ? (
          <div className="empty-state">
            <strong>No sub-schedules yet.</strong>
            <span>Add one to start planning outage or event staffing.</span>
          </div>
        ) : activeSubSchedule ? (
          <label className="field">
            <span>Sub-schedule</span>
            <select
              value={selectedSubScheduleId}
              onChange={(event) => setSelectedSubScheduleId(event.target.value)}
            >
              {subSchedules.map((subSchedule) => (
                <option key={subSchedule.id} value={subSchedule.id}>
                  {subSchedule.name}
                  {subSchedule.isArchived ? " (Archived)" : ""}
                  {dirtySubScheduleIds.has(subSchedule.id) ? " *" : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="toolbar-actions">
          <button
            type="button"
            className="icon-button"
            onClick={handleAddSubSchedule}
            aria-label="Add sub-schedule"
            title="Add sub-schedule"
          >
            <PlusIcon />
          </button>
          {activeSubSchedule ? (
            <button
              type="button"
              className="icon-button"
              onClick={() => setIsSettingsModalOpen(true)}
              aria-label="Sub-schedule settings"
              title="Sub-schedule settings"
            >
              <SettingsIcon />
            </button>
          ) : null}
        </div>

        {activeSubSchedule ? (
          <div className="toolbar-status-wrap">
            {activeSubScheduleIssues.length > 0 ? (
              <p className="toolbar-status">{activeSubScheduleIssues[0]}</p>
            ) : dirtySubScheduleIds.has(activeSubSchedule.id) ? (
              <p className="toolbar-status">This sub-schedule has unsaved changes.</p>
            ) : statusMessage ? (
              <p className="toolbar-status">{statusMessage}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <section className="metrics-section">
        {activeSubSchedule ? (
          <>
            <div className="toolbar-status-wrap subschedule-builder-status">
              {!isPersistedActiveSubSchedule ? (
                <p className="toolbar-status">Save this new sub-schedule definition before staffing it.</p>
              ) : activeSubSchedule.isArchived ? (
                <p className="toolbar-status">Archived sub-schedules stay visible for history but cannot be edited.</p>
              ) : isSavingAssignments ? (
                <p className="toolbar-status">Saving changes automatically...</p>
              ) : assignmentMessage ? (
                <p className="toolbar-status">{assignmentMessage}</p>
              ) : activeSubSchedule.competencyIds.length === 0 ? (
                <p className="toolbar-status">No posts are assigned to this sub-schedule yet, but time codes and notes can still be saved.</p>
              ) : null}
            </div>

            <div className="subschedule-grid-wrap">
              <div
                className="subschedule-grid"
                style={{
                  gridTemplateColumns: `12rem repeat(${monthDays.length}, minmax(2.1rem, 1fr))`,
                }}
              >
                <div className="employee-header sticky-column">
                  <span>{formatMonthLabel(snapshot.month)}</span>
                  <strong>{activeSubSchedule.name}</strong>
                </div>

                {monthDays.map((day) => (
                  <div
                    key={`${activeSubSchedule.id}-${day.date}`}
                    className={`day-header ${day.isWeekend ? "day-header--weekend" : ""}`}
                  >
                    <span>{day.dayName.slice(0, 1)}</span>
                    <strong>{day.dayNumber}</strong>
                  </div>
                ))}

                {rowEmployeeIds.flatMap((employeeId) => {
                  const employee = employeeMap[employeeId];

                  if (!employee) {
                    return [];
                  }

                  const homeSchedule = employee.scheduleId ? getScheduleById(snapshot, employee.scheduleId) : null;

                  return [
                    <div key={`sub-row-${employeeId}`} className="employee-cell sticky-column">
                      <div className="employee-cell__main">
                        <strong>{employee.name}</strong>
                        <span>{homeSchedule?.name ?? "Unassigned"}</span>
                      </div>
                    </div>,
                    ...monthDays.map((day, dayIndex) => {
                      const key = createSubScheduleCellKey(employee.id, day.date);
                      const selection = draftAssignmentSelections[key] ?? {
                        competencyId: null,
                        timeCodeId: null,
                        notes: null,
                      };
                      const competency = selection.competencyId ? competencyMap[selection.competencyId] : null;
                      const timeCode = selection.timeCodeId ? timeCodeMap[selection.timeCodeId] : null;
                      const colorToken = timeCode?.colorToken ?? competency?.colorToken ?? "";
                      const isInDragRange =
                        dragRange?.employeeId === employee.id &&
                        dayIndex >= Math.min(dragRange.startIndex, dragRange.currentIndex) &&
                        dayIndex <= Math.max(dragRange.startIndex, dragRange.currentIndex);

                      return (
                        <div
                          key={`sub-cell-${employee.id}-${day.date}`}
                          className={`shift-cell shift-cell--day ${day.isWeekend ? "shift-cell--weekend" : ""} ${
                            colorToken ? `legend-pill--${colorToken.toLowerCase()}` : ""
                          } ${colorToken ? "shift-cell--coded" : ""} ${
                            selection.notes ? "shift-cell--has-note" : ""
                          } ${isInDragRange ? "shift-cell--range" : ""}`}
                          onPointerDown={(event) => {
                            if (
                              event.button !== 0 ||
                              !isPersistedActiveSubSchedule ||
                              activeSubSchedule.isArchived
                            ) {
                              return;
                            }

                            handleCellPointerDown(employee.id, dayIndex, selection);
                          }}
                          onPointerEnter={(event) => {
                            if (
                              dragRange &&
                              isPersistedActiveSubSchedule &&
                              !activeSubSchedule.isArchived &&
                              event.buttons === 1
                            ) {
                              handleDragHover(employee.id, dayIndex);
                            }
                          }}
                        >
                          <button
                            type="button"
                            className={`shift-cell-button ${
                              colorToken ? `legend-pill--${colorToken.toLowerCase()}` : ""
                            }`}
                            disabled={!isPersistedActiveSubSchedule || activeSubSchedule.isArchived}
                            title={getCellTitle(selection.notes)}
                            onClick={() => setEditorCell({ employeeId: employee.id, date: day.date })}
                          >
                            {getCellCode(selection, competencyMap, timeCodeMap)}
                            {selection.notes ? <span className="shift-cell__note-indicator" aria-hidden="true" /> : null}
                          </button>
                        </div>
                      );
                    }),
                  ];
                })}

                <div className="employee-cell sticky-column subschedule-add-row">
                  <button
                    type="button"
                    className="subschedule-add-row__button"
                    onClick={() => {
                      setEmployeeToAddId("");
                      setIsEmployeePickerOpen(true);
                    }}
                    disabled={
                      !isPersistedActiveSubSchedule ||
                      activeSubSchedule.isArchived ||
                      availableEmployeesToAdd.length === 0
                    }
                  >
                    <span aria-hidden="true">+</span>
                    {rowEmployeeIds.length === 0 ? "Add first worker" : "Add row"}
                  </button>
                </div>
                {monthDays.map((day) => (
                  <div
                    key={`sub-add-row-cell-${day.date}`}
                    className={`shift-cell shift-cell--day subschedule-add-row__cell ${
                      day.isWeekend ? "shift-cell--weekend" : ""
                    }`}
                    aria-hidden="true"
                  />
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <strong>Select a sub-schedule to start staffing it.</strong>
            <span>Definitions live above, and the monthly builder appears here once one is selected.</span>
          </div>
        )}
      </section>

      {activeSubSchedule && isPersistedActiveSubSchedule && !activeSubSchedule.isArchived ? (
        <SubScheduleCellModal
          employee={editorEmployee}
          date={editorCell?.date ?? null}
          selection={editorSelection}
          competencies={editorCompetencies}
          timeCodes={editableTimeCodes}
          onApply={(selection) => {
            if (!editorCell) {
              return;
            }

            handleCellChange(editorCell.employeeId, editorCell.date, selection);
          }}
          onClear={() => {
            if (!editorCell) {
              return;
            }

            handleCellChange(editorCell.employeeId, editorCell.date, {
              competencyId: null,
              timeCodeId: null,
              notes: null,
            });
            setEditorCell(null);
          }}
          onClose={() => setEditorCell(null)}
        />
      ) : null}

      {isEmployeePickerOpen ? (
        <AddSubScheduleEmployeeModal
          employees={availableEmployeesToAdd}
          selectedEmployeeId={employeeToAddId}
          onSelect={setEmployeeToAddId}
          onAdd={handleAddEmployeeRow}
          onClose={() => {
            setEmployeeToAddId("");
            setIsEmployeePickerOpen(false);
          }}
        />
      ) : null}

      {activeSubSchedule && isSettingsModalOpen ? (
        <SubScheduleSettingsModal
          subSchedule={activeSubSchedule}
          summaryTimeCodes={projectedSummaryTimeCodes}
          issues={activeSubScheduleIssues}
          hasChanges={hasDefinitionChanges}
          isSaving={isSavingDefinitions}
          isDeleting={isDeletingDefinition}
          isPersisted={isPersistedActiveSubSchedule}
          onChange={(updater) => updateSubSchedule(activeSubSchedule.id, updater)}
          onClose={() => setIsSettingsModalOpen(false)}
          onDelete={() => handleDeleteSubSchedule(activeSubSchedule.id)}
          onRevert={() => handleRevertDefinitions({ closeModal: true })}
          onSave={() => handleSaveDefinitions({ closeModal: true })}
        />
      ) : null}
    </section>
  );
}
