"use client";

import type { CSSProperties } from "react";
import { useDeferredValue, useEffect, useState, useTransition, startTransition } from "react";

import { saveAssignments } from "@/app/actions";
import {
  buildAssignmentIndex,
  countShiftCoverage,
  createAssignmentKey,
  formatMonthLabel,
  getCompetencyMap,
  getEmployeeMap,
  getMonthDays,
  getSuggestedCompetencyId,
  getTeamById,
  shiftForDate,
} from "@/lib/scheduling";
import type { Competency, Employee, SchedulerSnapshot, ShiftKind } from "@/lib/types";

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
  return code
    .replace("Post ", "P")
    .replace("Dock ", "D")
    .replace(/\s+/g, "");
}

function getTeamAccent(teamId: string) {
  const accents = ["#f97316", "#0f766e", "#2563eb", "#be123c", "#7c3aed", "#4d7c0f"];
  let hash = 0;

  for (const character of teamId) {
    hash = (hash + character.charCodeAt(0)) % accents.length;
  }

  return accents[hash];
}

function SummaryStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="summary-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CompetencyPill({ competency }: { competency: Competency }) {
  return (
    <span className={`legend-pill legend-pill--${competency.colorToken.toLowerCase()}`}>
      {competency.code}
    </span>
  );
}

export function MonthlyScheduler({
  initialSnapshot,
}: {
  initialSnapshot: SchedulerSnapshot;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [currentMonth, setCurrentMonth] = useState(initialSnapshot.month);
  const [selectedTeamId, setSelectedTeamId] = useState(initialSnapshot.teams[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [baselineAssignments, setBaselineAssignments] = useState(() =>
    buildAssignmentIndex(initialSnapshot.assignments),
  );
  const [draftAssignments, setDraftAssignments] = useState(() =>
    buildAssignmentIndex(initialSnapshot.assignments),
  );
  const [statusMessage, setStatusMessage] = useState("Drafting locally");
  const [isDraftHydrated, setIsDraftHydrated] = useState(false);
  const [isMonthLoading, startMonthTransition] = useTransition();
  const [isSaving, startSaveTransition] = useTransition();
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  const competencyMap = getCompetencyMap(snapshot.competencies);
  const employeeMap = getEmployeeMap(snapshot.teams);
  const monthDays = getMonthDays(currentMonth);
  const activeTeam = getTeamById(snapshot, selectedTeamId);

  const visibleEmployees = activeTeam.employees.filter((employee) => {
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

    if (!employee) {
      return [];
    }

    return [
      {
        employeeId,
        date,
        competencyId,
        notes: null,
        shiftKind: shiftForDate(employee.scheduleCode, date, employee.rotationAnchor),
      },
    ];
  });

  const coverage = countShiftCoverage(activeTeam, monthDays, draftAssignments);
  const activeUnit = snapshot.productionUnits.find((unit) => unit.id === activeTeam.unitId);
  const teamCompetencies = snapshot.competencies.filter(
    (competency) => competency.unitId === activeTeam.unitId,
  );
  const gridColumns = `12rem repeat(${monthDays.length}, minmax(0, 1fr))`;

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
          setSelectedTeamId((current) =>
            nextSnapshot.teams.some((team) => team.id === current) ? current : nextSnapshot.teams[0]?.id ?? "",
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
      style={{ "--team-accent": getTeamAccent(activeTeam.id) } as CSSProperties}
    >
      <div className="panel-heading panel-heading--schedule">
        <div className="planner-actions">
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

      <div className="summary-row">
        <SummaryStat label="Month" value={formatMonthLabel(currentMonth)} />
        <SummaryStat label="Team" value={activeTeam.name} />
        <SummaryStat label="Production unit" value={activeUnit?.name ?? "Unassigned"} />
        <SummaryStat label="Day shifts" value={String(coverage.dayShiftCount)} />
        <SummaryStat label="Night shifts" value={String(coverage.nightShiftCount)} />
        <SummaryStat label="Pending edits" value={String(dirtyUpdates.length)} />
      </div>

      <div className="workspace-toolbar">
        <label className="field">
          <span>Team</span>
          <select value={selectedTeamId} onChange={(event) => setSelectedTeamId(event.target.value)}>
            {snapshot.teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
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

        <div className="workspace-copy">
          <strong>{activeUnit?.name ?? activeTeam.name}</strong>
          <p>
            {isMonthLoading
              ? "Loading next month..."
              : `${statusMessage}. Click a shift cell to cycle posts, shift-click to clear.`}
          </p>
        </div>
      </div>

      <div className="legend-row">
        {teamCompetencies.map((competency) => (
          <CompetencyPill key={competency.id} competency={competency} />
        ))}
      </div>

      <section className="schedule-wrap" aria-label="Monthly schedule grid">
        <div className="schedule-grid" style={{ gridTemplateColumns: gridColumns }}>
          <div className="employee-header sticky-column">
            <span>Employee</span>
            <strong>{activeTeam.name}</strong>
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
              monthDays={monthDays}
              assignments={draftAssignments}
              competencyMap={competencyMap}
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
  monthDays,
  assignments,
  competencyMap,
  onAssignmentChange,
}: {
  employee: Employee;
  monthDays: Array<{ date: string; dayNumber: number; dayName: string; isWeekend: boolean }>;
  assignments: Record<string, string | null>;
  competencyMap: Record<string, Competency>;
  onAssignmentChange: (employee: Employee, date: string, competencyId: string) => void;
}) {
  return (
    <>
      <div className="employee-cell sticky-column">
        <strong>{employee.name}</strong>
        <span>{employee.role}</span>
        <small>{employee.scheduleCode}</small>
      </div>

      {monthDays.map((day) => {
        const shiftKind = shiftForDate(employee.scheduleCode, day.date, employee.rotationAnchor);
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
                <span className="sr-only">
                  Assign competency for {employee.name} on {day.date}
                </span>
                <span className="assignment-chip__value">
                  {selectedCompetencyId
                    ? getCompactCode(competencyMap[selectedCompetencyId]?.code ?? "Set")
                    : "Set"}
                </span>
                <span className="assignment-chip__hint">
                  {selectedCompetencyId
                    ? competencyMap[selectedCompetencyId]?.label ?? "Assigned"
                    : "Unassigned"}
                </span>
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}
