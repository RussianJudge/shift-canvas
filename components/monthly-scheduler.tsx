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
  getTimeCodeMap,
  shiftForDate,
} from "@/lib/scheduling";
import type { Competency, Employee, Schedule, SchedulerSnapshot, ShiftKind, TimeCode } from "@/lib/types";

const STORAGE_KEY = "shift-canvas-drafts";
type AssignmentSelection = { competencyId: string | null; timeCodeId: string | null };
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
};

type CoverageSummary = {
  filledCells: number;
  requiredCells: number;
  assignedPeople: number;
  requiredStaff: number;
  hasOvertime: boolean;
  isUnderstaffed: boolean;
};

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
  employee: Pick<Employee, "id" | "competencyIds">,
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

function getSetDays(
  schedule: Schedule | null,
  monthDays: Array<{ date: string }>,
  anchorDate: string | null,
) {
  if (!schedule || !anchorDate) {
    return [];
  }

  const anchorIndex = monthDays.findIndex((day) => day.date === anchorDate);

  if (anchorIndex === -1 || shiftForDate(schedule, anchorDate) === "OFF") {
    return [];
  }

  let startIndex = anchorIndex;
  let endIndex = anchorIndex;

  while (startIndex > 0 && shiftForDate(schedule, monthDays[startIndex - 1].date) !== "OFF") {
    startIndex -= 1;
  }

  while (
    endIndex < monthDays.length - 1 &&
    shiftForDate(schedule, monthDays[endIndex + 1].date) !== "OFF"
  ) {
    endIndex += 1;
  }

  return monthDays.slice(startIndex, endIndex + 1);
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
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);
  const [selectedSetAnchorDate, setSelectedSetAnchorDate] = useState<string | null>(null);
  const [dragRange, setDragRange] = useState<DragRange | null>(null);
  const [isDraftHydrated, setIsDraftHydrated] = useState(false);
  const [isMonthLoading, startMonthTransition] = useTransition();
  const [isSaving, startSaveTransition] = useTransition();
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  const competencyMap = useMemo(() => getCompetencyMap(snapshot.competencies), [snapshot.competencies]);
  const timeCodeMap = useMemo(() => getTimeCodeMap(snapshot.timeCodes), [snapshot.timeCodes]);
  const employeeMap = useMemo(() => getEmployeeMap(snapshot.schedules), [snapshot.schedules]);
  const monthDays = useMemo(() => getMonthDays(currentMonth), [currentMonth]);
  const activeSchedule = getScheduleById(snapshot, selectedScheduleId);
  const selectedSetDays = useMemo(
    () => getSetDays(activeSchedule, monthDays, selectedSetAnchorDate),
    [activeSchedule, monthDays, selectedSetAnchorDate],
  );
  const competencyCoverage = useMemo(() => {
    return snapshot.competencies.reduce<Record<string, CoverageSummary>>((map, competency) => {
      let filledCells = 0;
      let hasOvertime = false;

      for (const employee of activeSchedule.employees) {
        for (const day of selectedSetDays) {
          const shiftKind = shiftForDate(activeSchedule, day.date);
          const selection = getCellCompetency(employee, day, shiftKind, draftAssignments);

          if (selection.competencyId === competency.id) {
            filledCells += 1;
          }
        }
      }

      for (const claim of snapshot.overtimeClaims) {
        const claimEmployee = employeeMap[claim.employeeId];

        if (
          claim.scheduleId === activeSchedule.id &&
          claim.competencyId === competency.id &&
          selectedSetDays.some((day) => day.date === claim.date) &&
          claimEmployee?.scheduleId !== activeSchedule.id
        ) {
          filledCells += 1;
          hasOvertime = true;
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
      };

      return map;
    }, {});
  }, [activeSchedule, draftAssignments, employeeMap, selectedSetDays, snapshot.competencies, snapshot.overtimeClaims]);
  const displayEmployees = useMemo<DisplayEmployee[]>(() => {
    const baseRows = activeSchedule.employees.map((employee) => ({
      rowId: `base:${employee.id}`,
      sourceEmployeeId: employee.id,
      name: employee.name,
      role: employee.role,
      competencyIds: employee.competencyIds,
    }));

    const overtimeRows = snapshot.overtimeClaims
      .filter((claim) => claim.scheduleId === activeSchedule.id)
      .map((claim) => employeeMap[claim.employeeId])
      .filter((employee): employee is Employee => Boolean(employee) && employee.scheduleId !== activeSchedule.id)
      .reduce<DisplayEmployee[]>((rows, employee) => {
        if (rows.some((row) => row.sourceEmployeeId === employee.id)) {
          return rows;
        }

        const homeSchedule = getScheduleById(snapshot, employee.scheduleId);

        rows.push({
          rowId: `ot:${activeSchedule.id}:${employee.id}`,
          sourceEmployeeId: employee.id,
          name: employee.name,
          role: `${employee.role} · OT from ${homeSchedule.name}`,
          competencyIds: employee.competencyIds,
        });

        return rows;
      }, []);

    return [...baseRows, ...overtimeRows];
  }, [activeSchedule, employeeMap, snapshot, snapshot.overtimeClaims]);

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

  const visibleEmployees = displayEmployees.filter((employee) => {
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
    if (!selectedSetAnchorDate || monthDays.some((day) => day.date === selectedSetAnchorDate)) {
      return;
    }

    setSelectedSetAnchorDate(null);
  }, [monthDays, selectedSetAnchorDate]);

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
              nextAssignments[createAssignmentKey(dragRange.employeeId, date)] = {
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
  }, [dragRange, monthDays]);

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

  function handleAssignmentChange(employeeId: string, date: string, selection: AssignmentSelection) {
    const key = createAssignmentKey(employeeId, date);

    startTransition(() => {
      setDraftAssignments((current) => ({
        ...current,
        [key]: selection,
      }));
      setStatusMessage("Draft updated locally");
    });
  }

  function handleCellPointerDown(
    employeeId: string,
    date: string,
    dayIndex: number,
    selection: AssignmentSelection,
  ) {
    setSelectedCell({ employeeId, date });
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
      setDragRange(null);
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

      <section className="set-builder" aria-label="Set builder">
        <div className="set-builder-heading">
          <div>
            <h2 className="set-builder-title">Set Builder</h2>
            <p className="set-builder-context">
              {selectedSetDays.length > 0
                ? `${activeSchedule.name} set · ${formatShortDate(selectedSetDays[0].date)} - ${formatShortDate(selectedSetDays[selectedSetDays.length - 1].date)}`
                : "Click a worked day in the top row to inspect this set"}
            </p>
          </div>
        </div>

        <div className="set-builder-pills">
          {snapshot.competencies.map((competency) => {
            const coverage = competencyCoverage[competency.id];

            return (
              <div
                key={competency.id}
                className={`set-builder-pill legend-pill legend-pill--${competency.colorToken.toLowerCase()} ${
                  coverage?.isUnderstaffed ? "set-builder-pill--understaffed" : ""
                } ${coverage?.hasOvertime ? "set-builder-pill--overtime" : ""} ${
                  !coverage?.isUnderstaffed && selectedSetDays.length > 0 ? "set-builder-pill--filled" : ""
                } ${
                  selectedSetDays.length === 0 ? "set-builder-pill--disabled" : ""
                }`}
                title={`${competency.label} · ${coverage?.filledCells ?? 0}/${coverage?.requiredCells ?? 0} cells filled in this set`}
              >
                <strong>{getCompactCode(competency.code)}</strong>
                <span>{formatStaffCount(coverage?.assignedPeople ?? 0)}/{coverage?.requiredStaff ?? competency.requiredStaff}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="schedule-wrap" aria-label="Monthly schedule grid">
        <div className="schedule-grid" style={{ gridTemplateColumns: gridColumns }}>
          <div className="employee-header sticky-column">
            <span>{formatMonthLabel(currentMonth)}</span>
            <strong>Employees</strong>
          </div>

          {monthDays.map((day) => (
            <div
              key={day.date}
              className={`day-header ${day.isWeekend ? "day-header--weekend" : ""} ${
                selectedSetAnchorDate === day.date ? "day-header--set-anchor" : ""
              } ${
                selectedSetDays.some((setDay) => setDay.date === day.date) ? "day-header--set" : ""
              }`}
              title={`${day.dayName} ${day.date}`}
              onClick={() => setSelectedSetAnchorDate(day.date)}
            >
              <span>{day.dayName.slice(0, 1)}</span>
              <strong>{day.dayNumber}</strong>
            </div>
          ))}

          {visibleEmployees.map((employee) => (
            <EmployeeRow
              key={employee.rowId}
              employee={employee}
              schedule={activeSchedule}
              monthDays={monthDays}
              assignments={draftAssignments}
              competencyMap={competencyMap}
              timeCodeMap={timeCodeMap}
              timeCodes={snapshot.timeCodes}
              selectedCell={selectedCell}
              dragRange={dragRange}
              onCellPointerDown={handleCellPointerDown}
              onDragHover={handleDragHover}
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
  timeCodeMap,
  timeCodes,
  selectedCell,
  dragRange,
  onCellPointerDown,
  onDragHover,
  onAssignmentChange,
}: {
  employee: DisplayEmployee;
  schedule: Schedule;
  monthDays: Array<{ date: string; dayNumber: number; dayName: string; isWeekend: boolean }>;
  assignments: Record<string, AssignmentSelection>;
  competencyMap: Record<string, Competency>;
  timeCodeMap: Record<string, TimeCode>;
  timeCodes: TimeCode[];
  selectedCell: SelectedCell | null;
  dragRange: DragRange | null;
  onCellPointerDown: (
    employeeId: string,
    date: string,
    dayIndex: number,
    selection: AssignmentSelection,
  ) => void;
  onDragHover: (employeeId: string, dayIndex: number) => void;
  onAssignmentChange: (
    employeeId: string,
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

      {monthDays.map((day, dayIndex) => {
        const shiftKind = shiftForDate(schedule, day.date);
        const selection = getCellCompetency(
          { id: employee.sourceEmployeeId, competencyIds: employee.competencyIds },
          day,
          shiftKind,
          assignments,
        );
        const availableCompetencies = employee.competencyIds
          .map((competencyId) => competencyMap[competencyId])
          .filter(isCompetency);
        const activeCompetency = selection.competencyId ? competencyMap[selection.competencyId] : null;
        const activeTimeCode = selection.timeCodeId ? timeCodeMap[selection.timeCodeId] : null;
        const activeColorToken = activeTimeCode?.colorToken ?? activeCompetency?.colorToken ?? "";
        const isSelected =
          selectedCell?.employeeId === employee.sourceEmployeeId && selectedCell.date === day.date;
        const isInDragRange =
          dragRange?.employeeId === employee.sourceEmployeeId &&
          dayIndex >= Math.min(dragRange.startIndex, dragRange.currentIndex) &&
          dayIndex <= Math.max(dragRange.startIndex, dragRange.currentIndex);

        return (
          <div
            key={`${employee.rowId}-${day.date}`}
            className={`shift-cell shift-cell--${getShiftTone(shiftKind)} ${
              day.isWeekend ? "shift-cell--weekend" : ""
            } ${activeColorToken ? `legend-pill--${activeColorToken.toLowerCase()}` : ""} ${
              activeColorToken ? "shift-cell--coded" : ""
            } ${isSelected ? "shift-cell--selected" : ""} ${
              isInDragRange ? "shift-cell--range" : ""
            }`}
            onPointerDown={(event) => {
              if (event.button !== 0) {
                return;
              }

              onCellPointerDown(employee.sourceEmployeeId, day.date, dayIndex, selection);
            }}
            onPointerEnter={(event) => {
              if (dragRange && event.buttons === 1) {
                onDragHover(employee.sourceEmployeeId, dayIndex);
              }
            }}
          >
            <select
              className={`assignment-select ${
                activeColorToken ? `legend-pill--${activeColorToken.toLowerCase()}` : ""
              }`}
              value={encodeAssignmentValue(selection)}
              aria-label={`${employee.name} ${day.date} assignment`}
              onChange={(event) =>
                onAssignmentChange(employee.sourceEmployeeId, day.date, decodeAssignmentValue(event.target.value))
              }
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
