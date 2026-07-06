"use client";

import { useCallback, useMemo } from "react";

import { AppDateSelector } from "@/components/app-date-selector";
import {
  createAssignmentKey,
  getMonthDays,
  shiftForDate,
} from "@/lib/scheduling";
import type { Competency, SchedulePageSnapshot, ShiftKind, TimeCode } from "@/lib/types";

function getShiftTone(shift: ShiftKind) {
  return shift === "DAY" ? "day" : shift === "NIGHT" ? "night" : "off";
}

function getCompactCode(code: string) {
  if (code.startsWith("Post ")) return code.replace("Post ", "");
  if (code.startsWith("Dock ")) return code.replace("Dock ", "D");
  if (code.startsWith("Pack ")) return code.replace("Pack ", "PK");
  return code.replace(/\s+/g, "");
}

/**
 * Read-only overview that stacks every schedule in one grid, each group led by
 * a divider row naming the shift. Editing stays on the single-shift scheduler.
 */
export function AllShiftsGrid({
  snapshot,
  month,
}: {
  snapshot: SchedulePageSnapshot;
  month: string;
}) {
  const monthDays = useMemo(() => getMonthDays(month), [month]);
  const competencyMap = useMemo(
    () => Object.fromEntries(snapshot.competencies.map((entry) => [entry.id, entry])) as Record<string, Competency>,
    [snapshot.competencies],
  );
  const timeCodeMap = useMemo(
    () => Object.fromEntries(snapshot.timeCodes.map((entry) => [entry.id, entry])) as Record<string, TimeCode>,
    [snapshot.timeCodes],
  );
  const gridColumns = `var(--schedule-name-column-width, 7.75rem) repeat(${monthDays.length}, minmax(var(--schedule-day-column-width, 1.72rem), 1fr))`;

  const goToSchedule = useCallback(
    (scheduleId: string) => {
      window.location.assign(`/schedule?month=${month}&schedule=${scheduleId}`);
    },
    [month],
  );

  return (
    <section className="panel-frame">
      <div className="scheduler-toolbar">
        <AppDateSelector
          mode="month"
          value={month}
          label="Schedule month"
          onChange={(nextMonth) => window.location.assign(`/schedule?month=${nextMonth}&schedule=all`)}
        />
        <label className="field">
          <span>Shift</span>
          <select value="all" onChange={(event) => goToSchedule(event.target.value)}>
            <option value="all">All shifts</option>
            {snapshot.schedules.map((schedule) => (
              <option key={schedule.id} value={schedule.id}>
                {schedule.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="schedule-scroll-shell">
        <section className="schedule-wrap" aria-label="All shifts overview">
          <div className="schedule-grid all-shifts-grid">
            <div className="schedule-grid__header" style={{ gridTemplateColumns: gridColumns }}>
              <div className="employee-header sticky-column">
                <span>All shifts</span>
                <strong>Overview</strong>
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
            </div>

            <div className="schedule-grid__rows">
              {snapshot.schedules.map((schedule) => (
                <div key={schedule.id} className="all-shifts-group">
                  <div className="all-shifts-divider">
                    <span className="all-shifts-divider__label">{schedule.name}</span>
                  </div>

                  {schedule.employees.map((employee) => (
                    <div
                      key={employee.id}
                      className="schedule-grid-row"
                      style={{ gridTemplateColumns: gridColumns }}
                    >
                      <div className="employee-cell sticky-column">
                        <div className="employee-cell__main">
                          <strong>{employee.name}</strong>
                        </div>
                      </div>

                      {monthDays.map((day) => {
                        const shiftKind = shiftForDate(schedule, day.date);
                        const selection =
                          snapshot.assignmentIndex[createAssignmentKey(schedule.id, employee.id, day.date)];
                        const competency = selection?.competencyId ? competencyMap[selection.competencyId] : null;
                        const timeCode = selection?.timeCodeId ? timeCodeMap[selection.timeCodeId] : null;
                        const colorToken = timeCode?.colorToken ?? competency?.colorToken ?? "";
                        const code = timeCode ? timeCode.code : competency ? getCompactCode(competency.code) : "";
                        const hue = colorToken ? colorToken.toLowerCase() : "";

                        return (
                          <div
                            key={day.date}
                            className={`shift-cell shift-cell--${getShiftTone(shiftKind)} ${
                              day.isWeekend ? "shift-cell--weekend" : ""
                            } ${hue ? `legend-pill--${hue} shift-cell--coded` : ""}`}
                          >
                            <span className={`shift-cell-button all-shifts-cell ${hue ? `legend-pill--${hue}` : ""}`}>
                              {code}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
