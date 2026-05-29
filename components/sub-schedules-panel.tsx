"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";

import {
  saveSubScheduleAssignments,
  saveSubSchedules,
} from "@/app/actions";
import {
  formatMonthLabel,
  getCompetencyMap,
  getEmployeeMap,
  getMonthDays,
  getScheduleById,
  getTimeCodeMap,
  shiftMonthKey,
} from "@/lib/scheduling";
import { getManualEntryTimeCodes } from "@/lib/sub-schedules";
import type {
  Competency,
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
};

type SubScheduleCellSelection = {
  competencyId: string | null;
  timeCodeId: string | null;
  notes: string | null;
};

type SubScheduleRowEntry =
  | { kind: "employee"; employeeId: string }
  | {
      kind: "overtime";
      rowId: string;
      dates: string[];
      selection: SubScheduleCellSelection;
      title: string;
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

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 8.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7Z" />
      <path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.8 1.8 0 0 0-1.98-.36a1.8 1.8 0 0 0-1.1 1.65V21a2 2 0 0 1-4 0v-.09a1.8 1.8 0 0 0-1.1-1.65a1.8 1.8 0 0 0-1.98.36l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.8 1.8 0 0 0 4.6 15a1.8 1.8 0 0 0-1.65-1.1H3a2 2 0 0 1 0-4h.09A1.8 1.8 0 0 0 4.74 8.8a1.8 1.8 0 0 0-.36-1.98l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.8 1.8 0 0 0 1.98.36A1.8 1.8 0 0 0 10.9 2.7V3a2 2 0 0 1 4 0v-.09a1.8 1.8 0 0 0 1.1 1.65a1.8 1.8 0 0 0 1.98-.36l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.8 1.8 0 0 0-.36 1.98a1.8 1.8 0 0 0 1.65 1.1H21a2 2 0 0 1 0 4h-.09A1.8 1.8 0 0 0 19.4 15Z" />
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

function SubScheduleDefinitionModal({
  title,
  context,
  subSchedule,
  summaryTimeCodes,
  issues,
  statusMessage,
  isSaving,
  saveLabel,
  onUpdate,
  onSave,
  onRevert,
  onClose,
}: {
  title: string;
  context: string;
  subSchedule: EditableSubSchedule;
  summaryTimeCodes: TimeCode[];
  issues: string[];
  statusMessage: string;
  isSaving: boolean;
  saveLabel: string;
  onUpdate: (updater: (subSchedule: EditableSubSchedule) => EditableSubSchedule) => void;
  onSave: () => void;
  onRevert?: () => void;
  onClose: () => void;
}) {
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="assignment-modal-backdrop" onClick={onClose}>
      <section
        className="assignment-modal subschedule-definition-modal"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="assignment-modal__header">
          <div>
            <h2 className="assignment-modal__title">{title}</h2>
            <p className="assignment-modal__context">{context}</p>
          </div>
          <button type="button" className="ghost-button" onClick={onClose} disabled={isSaving}>
            Close
          </button>
        </div>

        <div className="metrics-transfer-grid">
          <label className="field">
            <span>Name</span>
            <input
              value={subSchedule.name}
              onChange={(event) =>
                onUpdate((current) => ({
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
              onChange={(event) =>
                onUpdate((current) => ({
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

          <label className="subschedule-status-toggle subschedule-status-toggle--modal">
            <input
              type="checkbox"
              checked={subSchedule.isArchived}
              onChange={(event) =>
                onUpdate((current) => ({
                  ...current,
                  isArchived: event.target.checked,
                }))
              }
            />
            <span>{subSchedule.isArchived ? "Archived" : "Active"}</span>
          </label>
        </div>

        {issues.length > 0 ? <p className="toolbar-status">{issues[0]}</p> : null}
        {statusMessage ? <p className="toolbar-status">{statusMessage}</p> : null}

        <div className="assignment-modal__footer">
          {onRevert ? (
            <button type="button" className="ghost-button" onClick={onRevert} disabled={isSaving}>
              Revert
            </button>
          ) : null}
          <button type="button" className="primary-button" onClick={onSave} disabled={isSaving || issues.length > 0}>
            {isSaving ? "Saving..." : saveLabel}
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
}: {
  snapshot: SchedulerSnapshot;
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
      })),
    [snapshot.subSchedules],
  );

  const [subSchedules, setSubSchedules] = useState(initialSubSchedules);
  const [baselineSubSchedules, setBaselineSubSchedules] = useState(initialSubSchedules);
  const [selectedSubScheduleId, setSelectedSubScheduleId] = useState(
    initialSubSchedules.find((subSchedule) => !subSchedule.isArchived)?.id ?? initialSubSchedules[0]?.id ?? "",
  );
  const [statusMessage, setStatusMessage] = useState("");
  const [assignmentMessage, setAssignmentMessage] = useState("");
  const [editorCell, setEditorCell] = useState<EditorCell | null>(null);
  const [dragRange, setDragRange] = useState<DragRange | null>(null);
  const [addedEmployeeIds, setAddedEmployeeIds] = useState<string[]>([]);
  const [employeeToAddId, setEmployeeToAddId] = useState("");
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [newSubScheduleDraft, setNewSubScheduleDraft] = useState<EditableSubSchedule | null>(null);
  const [isSavingDefinitions, startDefinitionSaveTransition] = useTransition();
  const [isSavingAssignments, startAssignmentSaveTransition] = useTransition();

  useEffect(() => {
    setSubSchedules(cloneSubSchedules(initialSubSchedules));
    setBaselineSubSchedules(cloneSubSchedules(initialSubSchedules));
    setSelectedSubScheduleId((current) => {
      if (initialSubSchedules.some((subSchedule) => subSchedule.id === current)) {
        return current;
      }

      return initialSubSchedules.find((subSchedule) => !subSchedule.isArchived)?.id ?? initialSubSchedules[0]?.id ?? "";
    });
    setAddedEmployeeIds([]);
    setEmployeeToAddId("");
    setIsSettingsModalOpen(false);
    setNewSubScheduleDraft(null);
    setStatusMessage("");
    setAssignmentMessage("");
  }, [initialSubSchedules]);

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
    setAssignmentMessage("");
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
  const overtimeAvailableRows = useMemo<SubScheduleRowEntry[]>(() => {
    if (!activeSubSchedule) {
      return [];
    }

    return snapshot.manualOvertimePostings.flatMap<SubScheduleRowEntry>((posting) => {
      if (posting.subScheduleId !== activeSubSchedule.id || posting.dates.length === 0) {
        return [];
      }

      const competency = posting.competencyId ? competencyMap[posting.competencyId] : null;
      const timeCode = posting.timeCodeId ? timeCodeMap[posting.timeCodeId] : null;

      if (!competency && !timeCode) {
        return [];
      }

      const claimedEmployeeIds = new Set(
        snapshot.overtimeClaims
          .filter((claim) => claim.manualPostingId === posting.id)
          .map((claim) => claim.employeeId),
      );
      const openSlots = Math.max(0, posting.slotCount - claimedEmployeeIds.size);

      return Array.from({ length: openSlots }, (_, slotIndex) => ({
        kind: "overtime" as const,
        rowId: `ot-open:${posting.id}:${slotIndex}`,
        dates: posting.dates,
        selection: {
          competencyId: posting.competencyId,
          timeCodeId: posting.timeCodeId ?? null,
          notes: null,
        },
        title: `${competency?.code ?? timeCode?.code ?? "Overtime"} posting`,
      }));
    });
  }, [activeSubSchedule, competencyMap, snapshot.manualOvertimePostings, snapshot.overtimeClaims, timeCodeMap]);
  const rowEntries = useMemo<SubScheduleRowEntry[]>(
    () => [
      ...rowEmployeeIds.map((employeeId) => ({ kind: "employee" as const, employeeId })),
      ...overtimeAvailableRows,
    ],
    [overtimeAvailableRows, rowEmployeeIds],
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
  const selectedSummaryTimeCode = activeSubSchedule
    ? snapshot.timeCodes.find((timeCode) => timeCode.id === activeSubSchedule.summaryTimeCodeId) ?? null
    : null;
  const activeSubScheduleIssues = activeSubSchedule ? getSubScheduleIssues(activeSubSchedule) : [];

  function updateSubSchedule(
    subScheduleId: string,
    updater: (subSchedule: EditableSubSchedule) => EditableSubSchedule,
  ) {
    setSubSchedules((current) =>
      current.map((subSchedule) => (subSchedule.id === subScheduleId ? updater(subSchedule) : subSchedule)),
    );
  }

  function openNewSubScheduleModal() {
    const defaultSummaryTimeCodeId = projectedSummaryTimeCodes[0]?.id ?? "";
    setNewSubScheduleDraft({
      id: `sub-schedule-${crypto.randomUUID().slice(0, 8)}`,
      name: "",
      summaryTimeCodeId: defaultSummaryTimeCodeId,
      isArchived: false,
      competencyIds: [],
    });
    setStatusMessage("");
  }

  function handleSaveDefinitions({ closeOnSuccess = false }: { closeOnSuccess?: boolean } = {}) {
    if (!hasDefinitionChanges) {
      setStatusMessage("");
      if (closeOnSuccess) {
        setIsSettingsModalOpen(false);
      }
      return;
    }

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
        if (closeOnSuccess) {
          setIsSettingsModalOpen(false);
        }
        router.refresh();
      }
    });
  }

  function handleRevertActiveSubSchedule() {
    if (!activeSubSchedule) {
      return;
    }

    const baseline = baselineSubSchedules.find((subSchedule) => subSchedule.id === activeSubSchedule.id);

    if (!baseline) {
      setSubSchedules((current) => current.filter((subSchedule) => subSchedule.id !== activeSubSchedule.id));
      setSelectedSubScheduleId(
        baselineSubSchedules.find((subSchedule) => !subSchedule.isArchived)?.id ?? baselineSubSchedules[0]?.id ?? "",
      );
      setIsSettingsModalOpen(false);
      setStatusMessage("New sub-schedule discarded.");
      return;
    }

    updateSubSchedule(activeSubSchedule.id, () => ({ ...baseline }));
    setStatusMessage("Sub-schedule settings reverted.");
  }

  function handleCreateSubSchedule() {
    if (!newSubScheduleDraft) {
      return;
    }

    const issues = getSubScheduleIssues(newSubScheduleDraft);

    if (issues.length > 0) {
      setStatusMessage(issues[0]);
      return;
    }

    startDefinitionSaveTransition(async () => {
      const result = await saveSubSchedules({
        updates: [normalizeSubSchedule(newSubScheduleDraft)],
      } as SaveSubSchedulesInput);

      setStatusMessage(result.message);

      if (result.ok) {
        setSubSchedules((current) => [newSubScheduleDraft, ...current]);
        setBaselineSubSchedules((current) => [newSubScheduleDraft, ...current]);
        setSelectedSubScheduleId(newSubScheduleDraft.id);
        setNewSubScheduleDraft(null);
        router.refresh();
      }
    });
  }

  function handleMonthChange(delta: number) {
    const nextMonth = shiftMonthKey(snapshot.month, delta);
    router.push(`/sub-schedules?month=${nextMonth}`, { scroll: false });
  }

  function handleAddEmployeeRow() {
    if (!employeeToAddId) {
      return;
    }

    setAddedEmployeeIds((current) =>
      current.includes(employeeToAddId) ? current : [...current, employeeToAddId],
    );
    setEmployeeToAddId("");
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

  function handleSaveAssignments() {
    if (!activeSubSchedule) {
      return;
    }

    startAssignmentSaveTransition(async () => {
      const result = await saveSubScheduleAssignments({
        subScheduleId: activeSubSchedule.id,
        updates: assignmentUpdates,
      } as SaveSubScheduleAssignmentsInput);

      setAssignmentMessage(result.message);

      if (result.ok) {
        setEditorCell(null);
        router.refresh();
      }
    });
  }

  return (
    <section className="panel-frame">
      <div className="panel-heading panel-heading--split">
        <h1 className="panel-title">Sub-Schedules</h1>
        <div className="metrics-month-nav month-pager">
          <button
            type="button"
            className="ghost-button month-pager__button"
            onClick={() => handleMonthChange(-1)}
            aria-label="Previous month"
          >
            ‹
          </button>
          <strong className="month-pager__label">{formatMonthLabel(snapshot.month)}</strong>
          <button
            type="button"
            className="ghost-button month-pager__button"
            onClick={() => handleMonthChange(1)}
            aria-label="Next month"
          >
            ›
          </button>
        </div>
      </div>

      <section className="metrics-section subschedule-builder-section">
        <div className="metrics-section__header">
          <div className="metrics-section__title-group">
            <h2 className="metrics-section__title">Sub-Schedule</h2>
            <p className="toolbar-status">
              Summary codes project onto the main schedule automatically.
            </p>
          </div>
        </div>

        {subSchedules.length === 0 ? (
          <div className="empty-state empty-state--action">
            <strong>No sub-schedules yet.</strong>
            <span>Add one to start planning outage or event staffing.</span>
            <button type="button" className="icon-button" onClick={openNewSubScheduleModal} aria-label="Add sub-schedule">
              <PlusIcon />
            </button>
          </div>
        ) : activeSubSchedule ? (
          <div className="workspace-toolbar workspace-toolbar--scheduler subschedule-selector-toolbar">
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

            <div className="subschedule-selector-toolbar__actions">
              <button type="button" className="icon-button" onClick={openNewSubScheduleModal} aria-label="Add sub-schedule">
                <PlusIcon />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => {
                  setStatusMessage("");
                  setIsSettingsModalOpen(true);
                }}
                aria-label="Sub-schedule settings"
              >
                <GearIcon />
              </button>
            </div>

            <div className="toolbar-status-wrap">
              {activeSubScheduleIssues.length > 0 ? (
                <p className="toolbar-status">{activeSubScheduleIssues[0]}</p>
              ) : dirtySubScheduleIds.has(activeSubSchedule.id) ? (
                <p className="toolbar-status">This sub-schedule has unsaved settings.</p>
              ) : statusMessage ? (
                <p className="toolbar-status">{statusMessage}</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>

      <section className="metrics-section">
        <div className="metrics-section__header">
          <div className="metrics-section__title-group">
            <h2 className="metrics-section__title">Monthly Builder</h2>
            {activeSubSchedule && selectedSummaryTimeCode ? (
              <p className="toolbar-status">
                Building {activeSubSchedule.name}. Main schedule will show {selectedSummaryTimeCode.code} for assigned cells.
              </p>
            ) : null}
          </div>
        </div>

        {activeSubSchedule ? (
          <>
            <div className="workspace-toolbar workspace-toolbar--scheduler subschedule-builder-toolbar">
              <label className="field">
                <span>Add employee</span>
                <div className="subschedule-add-employee">
                  <select
                    value={employeeToAddId}
                    onChange={(event) => setEmployeeToAddId(event.target.value)}
                    disabled={!isPersistedActiveSubSchedule || activeSubSchedule.isArchived || availableEmployeesToAdd.length === 0}
                  >
                    <option value="">Select employee</option>
                    {availableEmployeesToAdd.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={handleAddEmployeeRow}
                    disabled={!isPersistedActiveSubSchedule || activeSubSchedule.isArchived || !employeeToAddId}
                  >
                    Add
                  </button>
                </div>
              </label>

              <div className="toolbar-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={handleSaveAssignments}
                  disabled={!isPersistedActiveSubSchedule || activeSubSchedule.isArchived || isSavingAssignments || !hasAssignmentChanges}
                >
                  {isSavingAssignments ? "Saving..." : "Save assignments"}
                </button>
              </div>

              <div className="toolbar-status-wrap">
                {!isPersistedActiveSubSchedule ? (
                  <p className="toolbar-status">Save this new sub-schedule definition before staffing it.</p>
                ) : activeSubSchedule.isArchived ? (
                  <p className="toolbar-status">Archived sub-schedules stay visible for history but cannot be edited.</p>
                ) : activeSubSchedule.competencyIds.length === 0 ? (
                  <p className="toolbar-status">Assign competencies to this sub-schedule first, then staff its monthly builder.</p>
                ) : assignmentMessage ? (
                  <p className="toolbar-status">{assignmentMessage}</p>
                ) : null}
              </div>
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

                {rowEntries.length === 0 ? (
                  <div
                    className="empty-state sticky-column"
                    style={{ gridColumn: `1 / span ${monthDays.length + 1}` }}
                  >
                    <strong>No employees added yet.</strong>
                    <span>Add a worker to start building this sub-schedule.</span>
                  </div>
                ) : (
                  rowEntries.flatMap((rowEntry) => {
                    if (rowEntry.kind === "overtime") {
                      const visibleDateSet = new Set(rowEntry.dates);
                      const competency = rowEntry.selection.competencyId ? competencyMap[rowEntry.selection.competencyId] : null;
                      const timeCode = rowEntry.selection.timeCodeId ? timeCodeMap[rowEntry.selection.timeCodeId] : null;
                      const colorToken = timeCode?.colorToken ?? competency?.colorToken ?? "";

                      return [
                        <div key={`sub-row-${rowEntry.rowId}`} className="employee-cell sticky-column">
                          <div className="employee-cell__main">
                            <strong>Overtime Available</strong>
                            <span>{rowEntry.title}</span>
                          </div>
                        </div>,
                        ...monthDays.map((day) => {
                          const isVisible = visibleDateSet.has(day.date);

                          return (
                            <div
                              key={`sub-cell-${rowEntry.rowId}-${day.date}`}
                              className={`shift-cell shift-cell--${isVisible ? "day" : "off"} ${
                                day.isWeekend ? "shift-cell--weekend" : ""
                              } ${isVisible && colorToken ? `legend-pill--${colorToken.toLowerCase()}` : ""} ${
                                isVisible && colorToken ? "shift-cell--coded" : ""
                              } ${isVisible ? "shift-cell--overtime-available" : ""}`}
                            >
                              <button
                                type="button"
                                className={`shift-cell-button ${
                                  isVisible && colorToken ? `legend-pill--${colorToken.toLowerCase()}` : ""
                                }`}
                                disabled
                                title={isVisible ? rowEntry.title : undefined}
                              >
                                {isVisible ? getCellCode(rowEntry.selection, competencyMap, timeCodeMap) : ""}
                              </button>
                            </div>
                          );
                        }),
                      ];
                    }

                    const employee = employeeMap[rowEntry.employeeId];
                    const homeSchedule = employee ? getScheduleById(snapshot, employee.scheduleId) : null;

                    if (!employee || !homeSchedule) {
                      return [];
                    }

                    return [
                      <div key={`sub-row-${rowEntry.employeeId}`} className="employee-cell sticky-column">
                        <div className="employee-cell__main">
                          <strong>{employee.name}</strong>
                          <span>{homeSchedule.name}</span>
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
                              title={selection.notes ?? undefined}
                              onClick={() => setEditorCell({ employeeId: employee.id, date: day.date })}
                            >
                              {getCellCode(selection, competencyMap, timeCodeMap)}
                              {selection.notes ? <span className="shift-cell__note-indicator" aria-hidden="true" /> : null}
                            </button>
                          </div>
                        );
                      }),
                    ];
                  })
                )}
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

      {isSettingsModalOpen && activeSubSchedule ? (
        <SubScheduleDefinitionModal
          title="Sub-schedule settings"
          context="Update the selected sub-schedule definition."
          subSchedule={activeSubSchedule}
          summaryTimeCodes={projectedSummaryTimeCodes}
          issues={activeSubScheduleIssues}
          statusMessage={statusMessage}
          isSaving={isSavingDefinitions}
          saveLabel="Save settings"
          onUpdate={(updater) => updateSubSchedule(activeSubSchedule.id, updater)}
          onSave={() => handleSaveDefinitions({ closeOnSuccess: true })}
          onRevert={handleRevertActiveSubSchedule}
          onClose={() => setIsSettingsModalOpen(false)}
        />
      ) : null}

      {newSubScheduleDraft ? (
        <SubScheduleDefinitionModal
          title="Add sub-schedule"
          context="Create a new sub-schedule definition before staffing it."
          subSchedule={newSubScheduleDraft}
          summaryTimeCodes={projectedSummaryTimeCodes}
          issues={getSubScheduleIssues(newSubScheduleDraft)}
          statusMessage={statusMessage}
          isSaving={isSavingDefinitions}
          saveLabel="Create sub-schedule"
          onUpdate={(updater) => setNewSubScheduleDraft((current) => (current ? updater(current) : current))}
          onSave={handleCreateSubSchedule}
          onClose={() => setNewSubScheduleDraft(null)}
        />
      ) : null}

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
    </section>
  );
}
