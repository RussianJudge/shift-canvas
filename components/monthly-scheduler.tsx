"use client";

import type { CSSProperties } from "react";
import { useDeferredValue, useEffect, useMemo, useState, useTransition, startTransition } from "react";
import { useRouter } from "next/navigation";

import { saveAssignments, setScheduleSetCompletion } from "@/app/actions";
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
  overtimeDates?: string[];
  overtimeCompetencyByDate?: Record<string, string>;
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

function getDefaultSelection(_shiftKind: ShiftKind, _timeCodes: TimeCode[]): AssignmentSelection {
  return {
    competencyId: null,
    timeCodeId: null,
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

function AssignmentModal({
  selectedEmployee,
  selectedDate,
  shiftKind,
  selection,
  competencies,
  timeCodes,
  onApply,
  onClose,
}: {
  selectedEmployee: DisplayEmployee | null;
  selectedDate: string | null;
  shiftKind: ShiftKind;
  selection: AssignmentSelection;
  competencies: Competency[];
  timeCodes: TimeCode[];
  onApply: (selection: AssignmentSelection) => void;
  onClose: () => void;
}) {
  if (!selectedEmployee || !selectedDate) {
    return null;
  }

  return (
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
                onClick={() =>
                  onApply({
                    competencyId: null,
                    timeCodeId: timeCode.id,
                  })
                }
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
                onClick={() =>
                  onApply({
                    competencyId: competency.id,
                    timeCodeId: null,
                  })
                }
              >
                {getCompactCode(competency.code)}
              </button>
            ))}
          </div>
        </div>

        <div className="assignment-modal__footer">
          <button
            type="button"
            className="ghost-button"
            onClick={() =>
              onApply(getDefaultSelection(shiftKind, timeCodes))
            }
          >
            Clear assignment
          </button>
        </div>
      </section>
    </div>
  );
}

export function MonthlyScheduler({
  initialSnapshot,
  canEdit,
  canManageSetBuilder,
  canSwitchSchedule,
  forcedScheduleId,
}: {
  initialSnapshot: SchedulerSnapshot;
  canEdit: boolean;
  canManageSetBuilder: boolean;
  canSwitchSchedule: boolean;
  forcedScheduleId: string | null;
}) {
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
  const [dragRange, setDragRange] = useState<DragRange | null>(null);
  const [isDraftHydrated, setIsDraftHydrated] = useState(false);
  const [isMonthLoading, startMonthTransition] = useTransition();
  const [isSaving, startSaveTransition] = useTransition();
  const [isUpdatingSetCompletion, startSetCompletionTransition] = useTransition();
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  const competencyMap = useMemo(() => getCompetencyMap(snapshot.competencies), [snapshot.competencies]);
  const timeCodeMap = useMemo(() => getTimeCodeMap(snapshot.timeCodes), [snapshot.timeCodes]);
  const employeeMap = useMemo(() => getEmployeeMap(snapshot.schedules), [snapshot.schedules]);
  const monthDays = useMemo(() => getMonthDays(currentMonth), [currentMonth]);
  const extendedMonthDays = useMemo(() => getExtendedMonthDays(currentMonth), [currentMonth]);
  const activeSchedule = getScheduleById(snapshot, selectedScheduleId);
  const selectedSetDays = useMemo(
    () => getWorkedSetDays(activeSchedule, extendedMonthDays, selectedSetAnchorDate),
    [activeSchedule, extendedMonthDays, selectedSetAnchorDate],
  );
  const completedSetDates = useMemo(
    () => getCompletedSetDatesForMonth(snapshot.completedSets, activeSchedule.id, monthDays),
    [activeSchedule.id, monthDays, snapshot.completedSets],
  );
  const isSelectedSetComplete =
    selectedSetDays.length > 0
      ? isCompletedSetRange(
          snapshot.completedSets,
          activeSchedule.id,
          selectedSetDays[0].date,
          selectedSetDays[selectedSetDays.length - 1].date,
        )
      : false;
  const competencyCoverage = useMemo(() => {
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
    if (selectedSetDays.length === 0) {
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
  const displayEmployees = useMemo<DisplayEmployee[]>(() => {
    const baseRows = activeSchedule.employees.map((employee) => ({
      rowId: `base:${employee.id}`,
      sourceEmployeeId: employee.id,
      name: employee.name,
      role: employee.role,
      competencyIds: employee.competencyIds,
    }));

    const overtimeRows = Object.values(
      snapshot.overtimeClaims
        .filter((claim) => claim.scheduleId === activeSchedule.id)
        .reduce<Record<string, DisplayEmployee>>((rows, claim) => {
          const employee = employeeMap[claim.employeeId];

          if (!employee || employee.scheduleId === activeSchedule.id) {
            return rows;
          }

          const homeSchedule = getScheduleById(snapshot, employee.scheduleId);
          const existingDates = rows[employee.id]?.overtimeDates ?? [];
          const existingCompetencies = rows[employee.id]?.overtimeCompetencyByDate ?? {};

          rows[employee.id] = {
            rowId: `ot:${activeSchedule.id}:${employee.id}`,
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

    return [...baseRows, ...overtimeRows];
  }, [activeSchedule, employeeMap, snapshot, snapshot.overtimeClaims]);

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

  const dirtyUpdates = Array.from(
    new Set([...Object.keys(baselineAssignments), ...Object.keys(draftAssignments)]),
  ).flatMap((key) => {
    const [employeeId, date] = key.split(":");
    const employee = employeeMap[employeeId];
    const employeeSchedule = employee ? getScheduleById(snapshot, employee.scheduleId) : null;

    if (!employee || !employeeSchedule) {
      return [];
    }

    const shiftKind = shiftForDate(employeeSchedule, date);
    const baseline = baselineAssignments[key] ?? { competencyId: null, timeCodeId: null };
    const draft = draftAssignments[key] ?? { competencyId: null, timeCodeId: null };

    if (
      baseline.competencyId === draft.competencyId &&
      baseline.timeCodeId === draft.timeCodeId
    ) {
      return [];
    }

    return [
      {
        employeeId,
        date,
        competencyId: draft.competencyId,
        timeCodeId: draft.timeCodeId,
        notes: null,
        shiftKind,
      },
    ];
  });
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
      : { competencyId: null, timeCodeId: null };
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
                defaultSelection.timeCodeId === dragRange.selection.timeCodeId
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
      defaultSelection.timeCodeId === selection.timeCodeId;

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
      setCurrentMonth((current) => {
        const nextMonth = addMonths(current, delta);
        router.push(`/schedule?month=${nextMonth}`, { scroll: false });
        return nextMonth;
      });
      setStatusMessage("Changing month");
    });
  }

  function handleSave() {
    if (!canEdit) {
      return;
    }

    startSaveTransition(async () => {
      const result = await saveAssignments({ scheduleId: activeSchedule.id, updates: dirtyUpdates });

      setStatusMessage(result.message);

      if (result.ok) {
        setBaselineAssignments(cloneAssignments(draftAssignments));
      }
    });
  }

  function handleRevert() {
    if (!canEdit) {
      return;
    }

    startTransition(() => {
      setDraftAssignments(cloneAssignments(baselineAssignments));
      setDragRange(null);
      setEditorCell(null);
      setStatusMessage("Changes reverted.");
    });
  }

  function handleSetCompletion() {
    if (!canEdit || !canManageSetBuilder || selectedSetDays.length === 0) {
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

  return (
    <section
      className="panel-frame"
      style={{ "--team-accent": getScheduleAccent(activeSchedule.id) } as CSSProperties}
    >
      <div className="panel-heading panel-heading--split">
        <h1 className="panel-title">Schedule</h1>
        <div className="planner-actions">
          <div className="planner-actions__row planner-actions__row--month">
            <span className="month-indicator">{formatMonthLabel(currentMonth)}</span>
          </div>
          <div className="planner-actions__row planner-actions__row--nav">
            <button type="button" className="ghost-button" onClick={() => handleMonthChange(-1)}>
              Previous month
            </button>
            <button type="button" className="ghost-button" onClick={() => handleMonthChange(1)}>
              Next month
            </button>
          </div>
          {canEdit ? (
            <div className="planner-actions__row planner-actions__row--save">
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
          ) : null}
        </div>
      </div>

      <div className="workspace-toolbar">
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

      {canManageSetBuilder ? (
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
          <div className="set-builder-actions">
            <button
              type="button"
              className={`ghost-button ${isSelectedSetComplete ? "ghost-button--active" : ""}`}
              onClick={handleSetCompletion}
              disabled={selectedSetDays.length === 0 || isUpdatingSetCompletion}
            >
              {isUpdatingSetCompletion
                ? isSelectedSetComplete
                  ? "Reopening..."
                  : "Completing..."
                : isSelectedSetComplete
                ? "Set Complete"
                : "Mark Set Complete"}
            </button>
            <div className="set-builder-legend">
              <span className="set-builder-legend__item">Filled</span>
              <span className="set-builder-legend__item set-builder-legend__item--under">Understaffed</span>
              <span className="set-builder-legend__item set-builder-legend__item--ot">Overtime</span>
            </div>
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
                disabled={selectedSetDays.length === 0}
              >
                <strong>{getCompactCode(competency.code)}</strong>
                <span>{formatStaffCount(coverage?.assignedPeople ?? 0)}/{coverage?.requiredStaff ?? competency.requiredStaff}</span>
              </button>
            );
          })}
        </div>
      </section>
      ) : null}

      <section className="schedule-wrap" aria-label="Monthly schedule grid">
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
                  canManageSetBuilder
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
              canEdit={canEdit}
              onCellPointerDown={handleCellPointerDown}
              onDragHover={handleDragHover}
              onCellClick={(cell) => {
                if (!canEdit) {
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

      {canEdit ? (
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
  onCellPointerDown,
  onDragHover,
  onCellClick,
}: {
  employee: DisplayEmployee;
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

  return (
    <>
      <div className="employee-cell sticky-column">
        <strong title={employee.name}>
          <span className="employee-name-full">{employee.name}</span>
          <span className="employee-name-compact">{getCompactEmployeeName(employee.name)}</span>
        </strong>
        <span>{employee.role}</span>
      </div>

      {monthDays.map((day, dayIndex) => {
        const isOvertimeCell = !overtimeDateSet || overtimeDateSet.has(day.date);
        const isLockedCell = completedSetDates.has(day.date);
        const shiftKind = isOvertimeCell ? shiftForDate(schedule, day.date) : "OFF";
        const selection = isOvertimeCell
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
              }
            : selection;
        const activeCompetency = effectiveSelection.competencyId ? competencyMap[effectiveSelection.competencyId] : null;
        const activeTimeCode = effectiveSelection.timeCodeId ? timeCodeMap[effectiveSelection.timeCodeId] : null;
        const activeColorToken = activeTimeCode?.colorToken ?? activeCompetency?.colorToken ?? "";
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
            }`}
            onPointerDown={(event) => {
              if (event.button !== 0 || !canEdit || !isOvertimeCell || isLockedCell) {
                return;
              }

              onCellPointerDown(employee.sourceEmployeeId, day.date, dayIndex, effectiveSelection);
            }}
            onPointerEnter={(event) => {
              if (canEdit && isOvertimeCell && !isLockedCell && dragRange && event.buttons === 1) {
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
                if (!canEdit || !isOvertimeCell || isLockedCell) {
                  return;
                }

                onCellClick({ employeeId: employee.sourceEmployeeId, date: day.date });
              }}
              disabled={!canEdit || !isOvertimeCell || isLockedCell}
              aria-label={`${employee.name} ${day.date} assignment`}
            >
              {getSelectionCode(effectiveSelection, competencyMap, timeCodeMap)}
            </button>
          </div>
        );
      })}
    </>
  );
}
