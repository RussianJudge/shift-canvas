"use client";

import type { CSSProperties } from "react";
import { useDeferredValue, useEffect, useMemo, useState, useTransition, startTransition } from "react";

import { saveAssignments } from "@/app/actions";
import {
  buildAssignmentIndex,
  createAssignmentKey,
  formatMonthLabel,
  getCompetencyMap,
  getEmployeeMap,
  getMonthDays,
  getScheduleById,
  getSuggestedCompetencyId,
  shiftForDate,
} from "@/lib/scheduling";
import type { Competency, Employee, Schedule, SchedulerSnapshot, ShiftKind, TimeCode } from "@/lib/types";

const STORAGE_KEY = "shift-canvas-drafts";
type AssignmentSelection = { competencyId: string | null; timeCodeId: string | null };

function isMonthKey(value: string) {
  return /^\d{4}-\d{2}$/.test(value);
}

function addMonths(monthKey: string, delta: number) {
  const [year, month] = monthKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1 + delta, 1));
  const nextYear = next.getUTCFullYear();
  const nextMonth = String(next.getUTCMonth() + 1).padStart(2, "0");

  return `${nextYear}-${nextMonth}`;
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

function getCellCompetency(
  employee: Employee,
  day: { date: string },
  shiftKind: ShiftKind,
  assignments: Record<string, AssignmentSelection>,
) {
  const key = createAssignmentKey(employee.id, day.date);

  if (key in assignments) {
    return assignments[key];
  }

  if (shiftKind === "OFF") {
    return {
      competencyId: null,
      timeCodeId: null,
    };
  }

  return {
    competencyId: getSuggestedCompetencyId(employee, day.date),
    timeCodeId: null,
  };
}

function isCompetency(competency: Competency | undefined): competency is Competency {
  return Boolean(competency);
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

function getScheduleAccent(scheduleId: string) {
  const accents = ["#f97316", "#0f766e", "#2563eb", "#be123c", "#7c3aed", "#4d7c0f"];
  let hash = 0;

  for (const character of scheduleId) {
    hash = (hash + character.charCodeAt(0)) % accents.length;
  }

  return accents[hash];
}

function encodeAssignmentValue(selection: AssignmentSelection) {
  if (selection.timeCodeId) {
    return `time:${selection.timeCodeId}`;
  }

  if (selection.competencyId) {
    return `competency:${selection.competencyId}`;
  }

  return "";
}

function decodeAssignmentValue(value: string) {
  if (value.startsWith("time:")) {
    return {
      competencyId: null,
      timeCodeId: value.replace("time:", ""),
    };
  }

  if (value.startsWith("competency:")) {
    return {
      competencyId: value.replace("competency:", ""),
      timeCodeId: null,
    };
  }

  return {
    competencyId: null,
    timeCodeId: null,
  };
}

function cloneAssignments(assignments: Record<string, AssignmentSelection>) {
  return Object.fromEntries(
    Object.entries(assignments).map(([key, selection]) => [key, { ...selection }]),
  );
}

export function MonthlyScheduler({
  initialSnapshot,
}: {
  initialSnapshot: SchedulerSnapshot;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [currentMonth, setCurrentMonth] = useState(initialSnapshot.month);
  const [selectedScheduleId, setSelectedScheduleId] = useState(
    initialSnapshot.schedules[0]?.id ?? "",
  );
  const [search, setSearch] = useState("");
  const [baselineAssignments, setBaselineAssignments] = useState(() =>
    buildAssignmentIndex(initialSnapshot.assignments),
  );
  const [draftAssignments, setDraftAssignments] = useState(() =>
    buildAssignmentIndex(initialSnapshot.assignments),
  );
  const [statusMessage, setStatusMessage] = useState("");
  const [dragSelection, setDragSelection] = useState<AssignmentSelection | null>(null);
  const [isDraftHydrated, setIsDraftHydrated] = useState(false);
  const [isMonthLoading, startMonthTransition] = useTransition();
  const [isSaving, startSaveTransition] = useTransition();
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  const competencyMap = useMemo(() => getCompetencyMap(snapshot.competencies), [snapshot.competencies]);
  const employeeMap = useMemo(() => getEmployeeMap(snapshot.schedules), [snapshot.schedules]);
  const monthDays = useMemo(() => getMonthDays(currentMonth), [currentMonth]);
  const activeSchedule = getScheduleById(snapshot, selectedScheduleId);

  if (!activeSchedule) {
    return (
      <section className="panel-frame">
        <div className="panel-heading">
          <h1 className="panel-title">Schedule</h1>
        </div>

        <div className="workspace-toolbar workspace-toolbar--personnel">
          <p className="toolbar-status">No schedules available.</p>
        </div>
      </section>
    );
  }

  const visibleEmployees = activeSchedule.employees.filter((employee) => {
    if (!deferredSearch) {
      return true;
    }

    return `${employee.name} ${employee.role}`.toLowerCase().includes(deferredSearch);
  });

  const dirtyUpdates = Object.entries(draftAssignments).flatMap(([key, selection]) => {
    const baseline = baselineAssignments[key] ?? { competencyId: null, timeCodeId: null };

    if (
      baseline.competencyId === selection.competencyId &&
      baseline.timeCodeId === selection.timeCodeId
    ) {
      return [];
    }

    const [employeeId, date] = key.split(":");
    const employee = employeeMap[employeeId];
    const employeeSchedule = employee ? getScheduleById(snapshot, employee.scheduleId) : null;

    if (!employee || !employeeSchedule) {
      return [];
    }

    return [
      {
        employeeId,
        date,
        competencyId: selection.competencyId,
        timeCodeId: selection.timeCodeId,
        notes: null,
        shiftKind: shiftForDate(employeeSchedule, date),
      },
    ];
  });
  const hasChanges = dirtyUpdates.length > 0;

  const gridColumns = `10.5rem repeat(${monthDays.length}, minmax(2.45rem, 1fr))`;

  useEffect(() => {
    const savedDrafts = window.localStorage.getItem(STORAGE_KEY);

    if (savedDrafts) {
      try {
        const parsed = JSON.parse(savedDrafts) as Record<string, AssignmentSelection>;
        setDraftAssignments((current) => ({ ...current, ...parsed }));
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }

    setIsDraftHydrated(true);
  }, []);

  useEffect(() => {
    if (!isDraftHydrated) {
      return;
    }

    const timer = window.setTimeout(() => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draftAssignments));
    }, 160);

    return () => window.clearTimeout(timer);
  }, [draftAssignments, isDraftHydrated]);

  useEffect(() => {
    function handlePointerUp() {
      setDragSelection(null);
    }

    window.addEventListener("pointerup", handlePointerUp);

    return () => window.removeEventListener("pointerup", handlePointerUp);
  }, []);

  useEffect(() => {
    if (currentMonth === snapshot.month || !isMonthKey(currentMonth)) {
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    setStatusMessage(`Loading ${formatMonthLabel(currentMonth)}`);

    fetch(`/api/scheduler?month=${currentMonth}`, { signal: controller.signal })
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
            nextSnapshot.schedules.some((schedule) => schedule.id === current)
              ? current
              : nextSnapshot.schedules[0]?.id ?? "",
          );
          setBaselineAssignments((current) => ({
            ...stripMonthEntries(current, currentMonth),
            ...incomingMonthAssignments,
          }));
          setDraftAssignments((current) => ({
            ...stripMonthEntries(current, currentMonth),
            ...incomingMonthAssignments,
            ...pickMonthEntries(current, currentMonth),
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

  function handleAssignmentChange(
    employee: Employee,
    date: string,
    selection: AssignmentSelection,
  ) {
    const key = createAssignmentKey(employee.id, date);

    startTransition(() => {
      setDraftAssignments((current) => ({
        ...current,
        [key]: selection,
      }));
      setStatusMessage("Draft updated locally");
    });
  }

  function handleDragStart(selection: AssignmentSelection) {
    setDragSelection(selection);
  }

  function handleDragApply(employee: Employee, date: string) {
    if (!dragSelection) {
      return;
    }

    handleAssignmentChange(employee, date, dragSelection);
  }

  function handleMonthChange(delta: number) {
    startMonthTransition(() => {
      setCurrentMonth((current) => addMonths(current, delta));
      setStatusMessage("Changing month");
    });
  }

  function handleSave() {
    startSaveTransition(async () => {
      const result = await saveAssignments({ updates: dirtyUpdates });

      setStatusMessage(result.message);

      if (result.ok) {
        setBaselineAssignments(cloneAssignments(draftAssignments));
      }
    });
  }

  function handleRevert() {
    startTransition(() => {
      setDraftAssignments(cloneAssignments(baselineAssignments));
      setDragSelection(null);
      setStatusMessage("Changes reverted.");
    });
  }

  return (
    <section
      className="panel-frame"
      style={{ "--team-accent": getScheduleAccent(activeSchedule.id) } as CSSProperties}
    >
      <div className="panel-heading panel-heading--split">
        <h1 className="panel-title">Schedule</h1>
        <div className="planner-actions">
          <span className="month-indicator">{formatMonthLabel(currentMonth)}</span>
          <button type="button" className="ghost-button" onClick={() => handleMonthChange(-1)}>
            Previous month
          </button>
          <button type="button" className="ghost-button" onClick={() => handleMonthChange(1)}>
            Next month
          </button>
          <button type="button" className="ghost-button" onClick={handleRevert} disabled={isSaving || !hasChanges}>
            Revert
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={handleSave}
            disabled={isSaving || !hasChanges}
          >
            {isSaving ? "Saving..." : `Save ${dirtyUpdates.length || ""}`.trim()}
          </button>
        </div>
      </div>

      <div className="workspace-toolbar">
        <label className="field">
          <span>Shift</span>
          <select
            value={selectedScheduleId}
            onChange={(event) => setSelectedScheduleId(event.target.value)}
          >
            {snapshot.schedules.map((schedule) => (
              <option key={schedule.id} value={schedule.id}>
                {schedule.name}
              </option>
            ))}
          </select>
        </label>

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

      <section className="schedule-wrap" aria-label="Monthly schedule grid">
        <div className="schedule-grid" style={{ gridTemplateColumns: gridColumns }}>
          <div className="employee-header sticky-column">
            <span>{formatMonthLabel(currentMonth)}</span>
            <strong>Employees</strong>
          </div>

          {monthDays.map((day) => (
            <div
              key={day.date}
              className={`day-header ${day.isWeekend ? "day-header--weekend" : ""}`}
              title={`${day.dayName} ${day.date}`}
            >
              <span>{day.dayName.slice(0, 1)}</span>
              <strong>{day.dayNumber}</strong>
            </div>
          ))}

          {visibleEmployees.map((employee) => (
            <EmployeeRow
              key={employee.id}
              employee={employee}
              schedule={activeSchedule}
              monthDays={monthDays}
              assignments={draftAssignments}
              competencyMap={competencyMap}
              timeCodes={snapshot.timeCodes}
              dragSelection={dragSelection}
              onDragStart={handleDragStart}
              onDragApply={handleDragApply}
              onAssignmentChange={handleAssignmentChange}
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
    </section>
  );
}

function EmployeeRow({
  employee,
  schedule,
  monthDays,
  assignments,
  competencyMap,
  timeCodes,
  dragSelection,
  onDragStart,
  onDragApply,
  onAssignmentChange,
}: {
  employee: Employee;
  schedule: Schedule;
  monthDays: Array<{ date: string; dayNumber: number; dayName: string; isWeekend: boolean }>;
  assignments: Record<string, AssignmentSelection>;
  competencyMap: Record<string, Competency>;
  timeCodes: TimeCode[];
  dragSelection: AssignmentSelection | null;
  onDragStart: (selection: AssignmentSelection) => void;
  onDragApply: (employee: Employee, date: string) => void;
  onAssignmentChange: (
    employee: Employee,
    date: string,
    selection: AssignmentSelection,
  ) => void;
}) {
  return (
    <>
      <div className="employee-cell sticky-column">
        <strong>{employee.name}</strong>
        <span>{employee.role}</span>
      </div>

      {monthDays.map((day) => {
        const shiftKind = shiftForDate(schedule, day.date);
        const selection = getCellCompetency(employee, day, shiftKind, assignments);
        const availableCompetencies = employee.competencyIds
          .map((competencyId) => competencyMap[competencyId])
          .filter(isCompetency);

        return (
          <div
            key={`${employee.id}-${day.date}`}
            className={`shift-cell shift-cell--${getShiftTone(shiftKind)} ${
              day.isWeekend ? "shift-cell--weekend" : ""
            }`}
            onPointerEnter={(event) => {
              if (dragSelection && event.buttons === 1) {
                onDragApply(employee, day.date);
              }
            }}
          >
            <span className="shift-label">{shiftKind === "OFF" ? "O" : shiftKind.slice(0, 1)}</span>
            <select
              className="assignment-select"
              value={encodeAssignmentValue(selection)}
              aria-label={`${employee.name} ${day.date} assignment`}
              onPointerDown={(event) => {
                if (event.button !== 0) {
                  return;
                }

                onDragStart(selection);
              }}
              onChange={(event) => onAssignmentChange(employee, day.date, decodeAssignmentValue(event.target.value))}
            >
              <option value="">{shiftKind === "OFF" ? "Off" : ""}</option>
              <optgroup label="Time codes">
                {timeCodes.map((timeCode) => (
                  <option key={timeCode.id} value={`time:${timeCode.id}`}>
                    {timeCode.code}
                  </option>
                ))}
              </optgroup>
              {availableCompetencies.length > 0 ? (
                <optgroup label="Competencies">
                  {availableCompetencies.map((competency) => (
                    <option key={competency.id} value={`competency:${competency.id}`}>
                      {getCompactCode(competency.code)}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </div>
        );
      })}
    </>
  );
}
