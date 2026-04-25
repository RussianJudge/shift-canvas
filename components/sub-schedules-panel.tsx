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
  shiftMonthKey,
} from "@/lib/scheduling";
import type {
  Competency,
  Employee,
  SaveSubScheduleAssignmentsInput,
  SaveSubSchedulesInput,
  SchedulerSnapshot,
  SubScheduleAssignmentUpdate,
  SubScheduleUpdate,
} from "@/lib/types";

type EditableSubSchedule = {
  id: string;
  name: string;
  summaryTimeCodeId: string;
  isArchived: boolean;
};

type SubScheduleCellSelection = {
  competencyId: string | null;
  notes: string | null;
};

type EditorCell = {
  employeeId: string;
  date: string;
};

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
    const baseline = baselineSelections[key] ?? { competencyId: null, notes: null };
    const draft = draftSelections[key] ?? { competencyId: null, notes: null };

    if (
      baseline.competencyId === draft.competencyId &&
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

function getCellCode(
  selection: SubScheduleCellSelection,
  competencyMap: Record<string, Competency>,
) {
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
  onApply,
  onClear,
  onClose,
}: {
  employee: Employee | null;
  date: string | null;
  selection: SubScheduleCellSelection;
  competencies: Competency[];
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

/** Dedicated planner for overlay schedules that project summary codes back home. */
export function SubSchedulesPanel({
  snapshot,
}: {
  snapshot: SchedulerSnapshot;
}) {
  const router = useRouter();
  const monthDays = useMemo(() => getMonthDays(snapshot.month), [snapshot.month]);
  const competencyMap = useMemo(() => getCompetencyMap(snapshot.competencies), [snapshot.competencies]);
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
  const [addedEmployeeIds, setAddedEmployeeIds] = useState<string[]>([]);
  const [employeeToAddId, setEmployeeToAddId] = useState("");
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
          .filter(([, selection]) => selection.competencyId || selection.notes)
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
          notes: null,
        }
      : { competencyId: null, notes: null };
  const editorCompetencies = editorEmployee
    ? editorEmployee.competencyIds
        .map((competencyId) => competencyMap[competencyId])
        .filter((competency): competency is Competency => Boolean(competency))
    : [];
  const selectedSummaryTimeCode = activeSubSchedule
    ? snapshot.timeCodes.find((timeCode) => timeCode.id === activeSubSchedule.summaryTimeCodeId) ?? null
    : null;

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
    };

    setSubSchedules((current) => [nextSubSchedule, ...current]);
    setSelectedSubScheduleId(nextSubSchedule.id);
    setStatusMessage("");
  }

  function handleSaveDefinitions() {
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
        router.refresh();
      }
    });
  }

  function handleRevertDefinitions() {
    setSubSchedules(cloneSubSchedules(baselineSubSchedules));
    setStatusMessage("Changes reverted.");
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

      if (!selection.competencyId && !(selection.notes?.trim().length ?? 0)) {
        delete nextSelections[key];
        return nextSelections;
      }

      nextSelections[key] = {
        competencyId: selection.competencyId,
        notes: selection.notes?.trim() ? selection.notes.trim() : null,
      };

      return nextSelections;
    });
    setAssignmentMessage("Draft updated locally.");
  }

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
        <div className="metrics-month-nav">
          <div className="metrics-month-nav__current">
            <strong>{formatMonthLabel(snapshot.month)}</strong>
          </div>
          <div className="metrics-month-nav__actions">
            <button type="button" className="ghost-button" onClick={() => handleMonthChange(-1)}>
              Prev month
            </button>
            <button type="button" className="ghost-button" onClick={() => handleMonthChange(1)}>
              Next month
            </button>
          </div>
        </div>
      </div>

      <section className="metrics-section">
        <div className="metrics-section__header">
          <div className="metrics-section__title-group">
            <h2 className="metrics-section__title">Definitions</h2>
            <p className="toolbar-status">
              Summary codes project onto the main schedule automatically.
            </p>
          </div>
        </div>

        <div className="workspace-toolbar workspace-toolbar--actions">
          <div className="planner-actions">
            <button type="button" className="ghost-button" onClick={handleAddSubSchedule}>
              Add sub-schedule
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={handleRevertDefinitions}
              disabled={isSavingDefinitions || !hasDefinitionChanges}
            >
              Revert
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={handleSaveDefinitions}
              disabled={isSavingDefinitions || !hasDefinitionChanges || invalidSubScheduleIds.size > 0}
            >
              {isSavingDefinitions ? "Saving..." : "Save"}
            </button>
          </div>
          <div className="toolbar-status-wrap">
            {statusMessage ? <p className="toolbar-status">{statusMessage}</p> : null}
          </div>
        </div>

        <div className="personnel-table-wrap">
          <table className="personnel-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Summary Code</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {subSchedules.map((subSchedule) => (
                <tr
                  key={subSchedule.id}
                  className={`${dirtySubScheduleIds.has(subSchedule.id) ? "table-row--dirty" : ""} ${
                    invalidSubScheduleIds.has(subSchedule.id) ? "table-row--invalid" : ""
                  } ${selectedSubScheduleId === subSchedule.id ? "table-row--selected" : ""}`}
                  onClick={() => setSelectedSubScheduleId(subSchedule.id)}
                >
                  <td>
                    <input
                      className="table-input"
                      value={subSchedule.name}
                      onChange={(event) =>
                        updateSubSchedule(subSchedule.id, (current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                    />
                  </td>
                  <td>
                    <select
                      className="table-select"
                      value={subSchedule.summaryTimeCodeId}
                      onChange={(event) =>
                        updateSubSchedule(subSchedule.id, (current) => ({
                          ...current,
                          summaryTimeCodeId: event.target.value,
                        }))
                      }
                    >
                      <option value="">Select summary code</option>
                      {projectedSummaryTimeCodes.map((timeCode) => (
                        <option key={timeCode.id} value={timeCode.id}>
                          {timeCode.code} · {timeCode.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <label className="subschedule-status-toggle">
                      <input
                        type="checkbox"
                        checked={subSchedule.isArchived}
                        onChange={(event) =>
                          updateSubSchedule(subSchedule.id, (current) => ({
                            ...current,
                            isArchived: event.target.checked,
                          }))
                        }
                      />
                      <span>{subSchedule.isArchived ? "Archived" : "Active"}</span>
                    </label>
                  </td>
                </tr>
              ))}
              {subSchedules.length === 0 ? (
                <tr>
                  <td colSpan={3}>
                    <div className="empty-state">
                      <strong>No sub-schedules yet.</strong>
                      <span>Add one to start planning outage or event staffing.</span>
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="metrics-section">
        <div className="metrics-section__header">
          <div className="metrics-section__title-group">
            <h2 className="metrics-section__title">Monthly Builder</h2>
            {activeSubSchedule && selectedSummaryTimeCode ? (
              <p className="toolbar-status">
                Main schedule will show {selectedSummaryTimeCode.code} for assigned cells.
              </p>
            ) : null}
          </div>
        </div>

        {activeSubSchedule ? (
          <>
            <div className="workspace-toolbar workspace-toolbar--scheduler">
              <label className="field">
                <span>Sub-schedule</span>
                <select
                  value={selectedSubScheduleId}
                  onChange={(event) => setSelectedSubScheduleId(event.target.value)}
                >
                  {subSchedules.map((subSchedule) => (
                    <option key={subSchedule.id} value={subSchedule.id}>
                      {subSchedule.name} {subSchedule.isArchived ? "· Archived" : ""}
                    </option>
                  ))}
                </select>
              </label>

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

                {rowEmployeeIds.length === 0 ? (
                  <div
                    className="empty-state sticky-column"
                    style={{ gridColumn: `1 / span ${monthDays.length + 1}` }}
                  >
                    <strong>No employees added yet.</strong>
                    <span>Add a worker to start building this sub-schedule.</span>
                  </div>
                ) : (
                  rowEmployeeIds.flatMap((employeeId) => {
                    const employee = employeeMap[employeeId];
                    const homeSchedule = employee ? getScheduleById(snapshot, employee.scheduleId) : null;

                    if (!employee || !homeSchedule) {
                      return [];
                    }

                    return [
                      <div key={`sub-row-${employeeId}`} className="employee-cell sticky-column">
                        <div className="employee-cell__main">
                          <strong>{employee.name}</strong>
                          <span>{homeSchedule.name}</span>
                        </div>
                      </div>,
                      ...monthDays.map((day) => {
                        const key = createSubScheduleCellKey(employee.id, day.date);
                        const selection = draftAssignmentSelections[key] ?? {
                          competencyId: null,
                          notes: null,
                        };
                        const competency = selection.competencyId
                          ? competencyMap[selection.competencyId]
                          : null;
                        const colorToken = competency?.colorToken ?? "";

                        return (
                          <div
                            key={`sub-cell-${employee.id}-${day.date}`}
                            className={`shift-cell shift-cell--day ${day.isWeekend ? "shift-cell--weekend" : ""} ${
                              colorToken ? `legend-pill--${colorToken.toLowerCase()}` : ""
                            } ${colorToken ? "shift-cell--coded" : ""} ${
                              selection.notes ? "shift-cell--has-note" : ""
                            }`}
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
                              {getCellCode(selection, competencyMap)}
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

      {activeSubSchedule && isPersistedActiveSubSchedule && !activeSubSchedule.isArchived ? (
        <SubScheduleCellModal
          employee={editorEmployee}
          date={editorCell?.date ?? null}
          selection={editorSelection}
          competencies={editorCompetencies}
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
