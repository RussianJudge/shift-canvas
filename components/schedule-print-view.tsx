import { Fragment } from "react";

import { parseMutualAssignmentNote } from "@/lib/mutuals";
import {
  buildAssignmentIndex,
  createAssignmentKey,
  formatMonthLabel,
  getCompetencyMap,
  getEmployeeMap,
  getMonthDays,
  getScheduleById,
  getTimeCodeMap,
  shiftForDate,
} from "@/lib/scheduling";
import type {
  Competency,
  Employee,
  Schedule,
  SchedulerSnapshot,
  ShiftKind,
  TimeCode,
} from "@/lib/types";

type AssignmentSelection = { competencyId: string | null; timeCodeId: string | null };

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

function getShiftTone(shift: ShiftKind) {
  if (shift === "DAY") {
    return "day";
  }

  if (shift === "NIGHT") {
    return "night";
  }

  return "off";
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

function getSelectionForCell(
  employeeId: string,
  date: string,
  assignments: Record<string, AssignmentSelection>,
) {
  const key = createAssignmentKey(employeeId, date);

  return assignments[key] ?? {
    competencyId: null,
    timeCodeId: null,
  };
}

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

function PrintScheduleSheet({
  schedule,
  monthKey,
  assignments,
  competencyMap,
  timeCodeMap,
  employees,
}: {
  schedule: Schedule;
  monthKey: string;
  assignments: Record<string, AssignmentSelection>;
  competencyMap: Record<string, Competency>;
  timeCodeMap: Record<string, TimeCode>;
  employees: DisplayEmployee[];
}) {
  const monthDays = getMonthDays(monthKey);
  const gridColumns = `9rem repeat(${monthDays.length}, minmax(2.2rem, 1fr))`;

  return (
    <section className="print-schedule-sheet">
      <header className="print-schedule-sheet__header">
        <div>
          <span className="print-schedule-sheet__eyebrow">{formatMonthLabel(monthKey)}</span>
          <h2 className="print-schedule-sheet__title">Shift {schedule.name}</h2>
        </div>
      </header>

      <div className="print-schedule-grid" style={{ gridTemplateColumns: gridColumns }}>
        <div className="employee-header print-cell">
          <span>{formatMonthLabel(monthKey)}</span>
          <strong>Employees</strong>
        </div>

        {monthDays.map((day) => (
          <div
            key={`print-header-${schedule.id}-${day.date}`}
            className={`day-header print-cell ${day.isWeekend ? "day-header--weekend" : ""}`}
          >
            <span>{day.dayName.slice(0, 1)}</span>
            <strong>{day.dayNumber}</strong>
          </div>
        ))}

        {employees.map((employee) => {
          const overtimeDateSet = employee.overtimeDates ? new Set(employee.overtimeDates) : null;
          const mutualDateSet = employee.mutualDates ? new Set(employee.mutualDates) : null;

          return (
            <Fragment key={`print-${schedule.id}-${employee.rowId}`}>
              <div className="employee-cell print-cell">
                <div className="employee-cell__main">
                  <strong>{employee.name}</strong>
                </div>
              </div>

              {monthDays.map((day) => {
                const isBorrowedCellVisible =
                  (!overtimeDateSet || overtimeDateSet.has(day.date)) &&
                  (!mutualDateSet || mutualDateSet.has(day.date));
                const shiftKind = isBorrowedCellVisible ? shiftForDate(schedule, day.date) : "OFF";
                const selection = isBorrowedCellVisible
                  ? getSelectionForCell(employee.sourceEmployeeId, day.date, assignments)
                  : {
                      competencyId: null,
                      timeCodeId: null,
                    };
                const overtimeClaimCompetencyId =
                  !selection.competencyId && !selection.timeCodeId
                    ? employee.overtimeCompetencyByDate?.[day.date] ?? null
                    : null;
                const effectiveSelection = overtimeClaimCompetencyId
                  ? { competencyId: overtimeClaimCompetencyId, timeCodeId: null }
                  : selection;
                const activeCompetency = effectiveSelection.competencyId
                  ? competencyMap[effectiveSelection.competencyId]
                  : null;
                const activeTimeCode = effectiveSelection.timeCodeId
                  ? timeCodeMap[effectiveSelection.timeCodeId]
                  : null;
                const activeColorToken = activeTimeCode?.colorToken ?? activeCompetency?.colorToken ?? "";
                const selectionCode = isBorrowedCellVisible
                  ? getSelectionCode(effectiveSelection, competencyMap, timeCodeMap)
                  : "";

                return (
                  <div
                    key={`print-cell-${schedule.id}-${employee.rowId}-${day.date}`}
                  className={`shift-cell print-cell shift-cell--${getShiftTone(shiftKind)} ${
                    day.isWeekend ? "shift-cell--weekend" : ""
                  } ${activeColorToken ? `legend-pill--${activeColorToken.toLowerCase()}` : ""} ${
                    activeColorToken ? "shift-cell--coded" : ""
                  } ${selectionCode ? "" : "shift-cell--blank"
                  }`}
                >
                    {selectionCode}
                  </div>
                );
              })}
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}

export function SchedulePrintView({
  snapshot,
  monthKey,
  pinnedEmployeesBySchedule,
}: {
  snapshot: SchedulerSnapshot;
  monthKey: string;
  pinnedEmployeesBySchedule: Record<string, string[]>;
}) {
  const assignments = buildAssignmentIndex(snapshot.assignments);
  const competencyMap = getCompetencyMap(snapshot.competencies);
  const timeCodeMap = getTimeCodeMap(snapshot.timeCodes);
  const employeeMap = getEmployeeMap(snapshot.schedules);

  return (
    <section className="print-preview-stack">
      {snapshot.schedules.map((schedule) => (
        <PrintScheduleSheet
          key={`print-sheet-${schedule.id}`}
          schedule={schedule}
          monthKey={monthKey}
          assignments={assignments}
          competencyMap={competencyMap}
          timeCodeMap={timeCodeMap}
          employees={buildDisplayEmployeesForSchedule({
            schedule,
            snapshot,
            employeeMap,
            currentMonth: monthKey,
            pinnedEmployeesBySchedule,
          })}
        />
      ))}
    </section>
  );
}
