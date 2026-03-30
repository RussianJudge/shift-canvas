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
import type { Competency, Employee, Schedule, SchedulerSnapshot, ShiftKind } from "@/lib/types";

const STORAGE_KEY = "shift-canvas-drafts";

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

function stripMonthEntries(assignments: Record<string, string | null>, monthKey: string) {
  return Object.fromEntries(
    Object.entries(assignments).filter((entry) => !entry[0].includes(`:${monthKey}-`)),
  );
}

function pickMonthEntries(assignments: Record<string, string | null>, monthKey: string) {
  return Object.fromEntries(
    Object.entries(assignments).filter((entry) => entry[0].includes(`:${monthKey}-`)),
  );
}

function getCellCompetency(
  employee: Employee,
  day: { date: string },
  assignments: Record<string, string | null>,
) {
  const key = createAssignmentKey(employee.id, day.date);

  if (key in assignments) {
    return assignments[key];
  }

  return getSuggestedCompetencyId(employee, day.date);
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
  const [isDraftHydrated, setIsDraftHydrated] = useState(false);
  const [isMonthLoading, startMonthTransition] = useTransition();
  const [isSaving, startSaveTransition] = useTransition();
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  const competencyMap = useMemo(() => getCompetencyMap(snapshot.competencies), [snapshot.competencies]);
  const employeeMap = useMemo(() => getEmployeeMap(snapshot.schedules), [snapshot.schedules]);
  const monthDays = useMemo(() => getMonthDays(currentMonth), [currentMonth]);
  const activeSchedule = getScheduleById(snapshot, selectedScheduleId);
  const unitById = useMemo(
    () => new Map(snapshot.productionUnits.map((unit) => [unit.id, unit])),
    [snapshot.productionUnits],
  );

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

  const dirtyUpdates = Object.entries(draftAssignments).flatMap(([key, competencyId]) => {
    const baseline = baselineAssignments[key] ?? null;

    if (baseline === competencyId) {
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
        competencyId,
        notes: null,
        shiftKind: shiftForDate(employeeSchedule, date),
      },
    ];
  });

  const gridColumns = `10.5rem repeat(${monthDays.length}, minmax(2.45rem, 1fr))`;

  useEffect(() => {
    const savedDrafts = window.localStorage.getItem(STORAGE_KEY);

    if (savedDrafts) {
      try {
        const parsed = JSON.parse(savedDrafts) as Record<string, string | null>;
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

  function handleAssignmentChange(employee: Employee, date: string, competencyId: string) {
    const key = createAssignmentKey(employee.id, date);
    const nextValue = competencyId || null;

    startTransition(() => {
      setDraftAssignments((current) => ({
        ...current,
        [key]: nextValue,
      }));
      setStatusMessage("Draft updated locally");
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
        setBaselineAssignments({ ...draftAssignments });
      }
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
          <button
            type="button"
            className="primary-button"
            onClick={handleSave}
            disabled={isSaving || dirtyUpdates.length === 0}
          >
            {isSaving ? "Saving..." : `Save ${dirtyUpdates.length || ""}`.trim()}
          </button>
        </div>
      </div>

      <div className="workspace-toolbar">
        <label className="field">
          <span>Pattern</span>
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
            placeholder="Find operator or lead"
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
              unitName={unitById.get(employee.unitId)?.name ?? "Unassigned unit"}
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
  unitName,
  onAssignmentChange,
}: {
  employee: Employee;
  schedule: Schedule;
  monthDays: Array<{ date: string; dayNumber: number; dayName: string; isWeekend: boolean }>;
  assignments: Record<string, string | null>;
  competencyMap: Record<string, Competency>;
  unitName: string;
  onAssignmentChange: (employee: Employee, date: string, competencyId: string) => void;
}) {
  return (
    <>
      <div className="employee-cell sticky-column">
        <strong>{employee.name}</strong>
        <span>{employee.role}</span>
        <small>{unitName}</small>
      </div>

      {monthDays.map((day) => {
        const shiftKind = shiftForDate(schedule, day.date);
        const selectedCompetencyId = getCellCompetency(employee, day, assignments);
        const availableCompetencies = employee.competencyIds
          .map((competencyId) => competencyMap[competencyId])
          .filter(isCompetency);

        function handleCycle(clear = false) {
          if (clear) {
            onAssignmentChange(employee, day.date, "");
            return;
          }

          if (availableCompetencies.length === 0) {
            return;
          }

          const currentIndex = availableCompetencies.findIndex(
            (competency) => competency.id === selectedCompetencyId,
          );
          const nextCompetency =
            currentIndex >= 0
              ? availableCompetencies[(currentIndex + 1) % availableCompetencies.length]
              : availableCompetencies[0];

          onAssignmentChange(employee, day.date, nextCompetency.id);
        }

        return (
          <div
            key={`${employee.id}-${day.date}`}
            className={`shift-cell shift-cell--${getShiftTone(shiftKind)} ${
              day.isWeekend ? "shift-cell--weekend" : ""
            }`}
          >
            <span className="shift-label">{shiftKind === "OFF" ? "O" : shiftKind.slice(0, 1)}</span>

            {shiftKind === "OFF" ? (
              <p className="off-copy">Off</p>
            ) : (
              <button
                type="button"
                className="assignment-chip"
                title={`${employee.name} ${day.date}. Click to cycle competency, shift-click to clear.`}
                onClick={(event) => handleCycle(event.shiftKey)}
                disabled={availableCompetencies.length === 0}
              >
                <span className="assignment-chip__value">
                  {selectedCompetencyId ? getCompactCode(competencyMap[selectedCompetencyId]?.code ?? "Set") : "Set"}
                </span>
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}
