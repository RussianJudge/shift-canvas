"use client";

import { useMemo, useState, useTransition } from "react";

import { saveSchedules } from "@/app/actions";
import { REQUIRED_SHIFT_CODES } from "@/lib/types";
import type { SaveSchedulesInput, ScheduleUpdate, SchedulerSnapshot } from "@/lib/types";

type EditableSchedule = {
  id: string;
  name: string;
  startDate: string;
  dayShiftDays: number;
  nightShiftDays: number;
  offDays: number;
  employeeCount: number;
};

function normalizeSchedule(schedule: EditableSchedule): ScheduleUpdate {
  return {
    scheduleId: schedule.id,
    name: schedule.name.trim(),
    startDate: schedule.startDate,
    dayShiftDays: schedule.dayShiftDays,
    nightShiftDays: schedule.nightShiftDays,
    offDays: schedule.offDays,
  };
}

function createShiftTemplate(code: string): EditableSchedule {
  const startDates: Record<string, string> = {
    "601": "2026-01-01",
    "602": "2026-01-04",
    "603": "2026-01-07",
    "604": "2026-01-10",
  };

  return {
    id: `schedule-${code}`,
    name: code,
    startDate: startDates[code] ?? new Date().toISOString().slice(0, 10),
    dayShiftDays: 3,
    nightShiftDays: 3,
    offDays: 6,
    employeeCount: 0,
  };
}

export function SchedulesPanel({
  snapshot,
}: {
  snapshot: SchedulerSnapshot;
}) {
  const initialSchedules = useMemo<EditableSchedule[]>(
    () => {
      const existing = new Map(
        snapshot.schedules.map((schedule) => [
          schedule.name,
          {
            id: schedule.id,
            name: schedule.name,
            startDate: schedule.startDate,
            dayShiftDays: schedule.dayShiftDays,
            nightShiftDays: schedule.nightShiftDays,
            offDays: schedule.offDays,
            employeeCount: schedule.employees.length,
          },
        ]),
      );

      return REQUIRED_SHIFT_CODES.map((code) => existing.get(code) ?? createShiftTemplate(code));
    },
    [snapshot],
  );

  const [schedules, setSchedules] = useState(initialSchedules);
  const [baselineSchedules, setBaselineSchedules] = useState(initialSchedules);
  const [statusMessage, setStatusMessage] = useState(
    "These four shared shifts define the rotation pattern for every employee across the site.",
  );
  const [isSaving, startSaveTransition] = useTransition();

  const baselineMap = useMemo(
    () => new Map(baselineSchedules.map((schedule) => [schedule.id, normalizeSchedule(schedule)])),
    [baselineSchedules],
  );

  const dirtyUpdates = schedules
    .map((schedule) => normalizeSchedule(schedule))
    .filter(
      (schedule) => JSON.stringify(baselineMap.get(schedule.scheduleId)) !== JSON.stringify(schedule),
    );

  function updateSchedule(
    scheduleId: string,
    updater: (schedule: EditableSchedule) => EditableSchedule,
  ) {
    setSchedules((current) =>
      current.map((schedule) => (schedule.id === scheduleId ? updater(schedule) : schedule)),
    );
  }

  function handleSave() {
    startSaveTransition(async () => {
      const result = await saveSchedules({ updates: dirtyUpdates } as SaveSchedulesInput);
      setStatusMessage(result.message);

      if (result.ok) {
        setBaselineSchedules(schedules.map((schedule) => ({ ...schedule })));
      }
    });
  }

  return (
    <section className="panel-frame">
      <div className="panel-heading">
        <div>
          <span className="panel-eyebrow">Schedules</span>
          <h1 className="panel-title">Shared shift patterns</h1>
        </div>
        <p className="panel-copy">
          Shift patterns do not carry production-unit data anymore. They only define the four shared
          rotations 601, 602, 603, and 604. The start date is the first day shift in the cycle.
        </p>
      </div>

      <div className="workspace-toolbar workspace-toolbar--personnel">
        <div className="workspace-copy workspace-copy--full">
          <strong>{statusMessage}</strong>
          <p>Personnel can be distributed across these four shifts from the Personnel page.</p>
        </div>
        <div className="planner-actions">
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
        <div className="summary-stat">
          <span>Total shifts</span>
          <strong>{schedules.length}</strong>
        </div>
        <div className="summary-stat">
          <span>Pattern length</span>
          <strong>
            {Math.max(
              ...schedules.map((schedule) => schedule.dayShiftDays + schedule.nightShiftDays + schedule.offDays),
            )}
          </strong>
        </div>
        <div className="summary-stat">
          <span>Employees linked</span>
          <strong>{schedules.reduce((total, schedule) => total + schedule.employeeCount, 0)}</strong>
        </div>
        <div className="summary-stat">
          <span>Pending edits</span>
          <strong>{dirtyUpdates.length}</strong>
        </div>
      </div>

      <div className="personnel-table-wrap">
        <table className="personnel-table">
          <thead>
            <tr>
              <th>Shift</th>
              <th>Start date</th>
              <th>Day on</th>
              <th>Night on</th>
              <th>Off days</th>
              <th>Employees</th>
            </tr>
          </thead>
          <tbody>
            {schedules.map((schedule) => (
              <tr key={schedule.id}>
                <td>
                  <span className="table-code">{schedule.name}</span>
                </td>
                <td>
                  <input
                    className="table-input"
                    type="date"
                    value={schedule.startDate}
                    onChange={(event) =>
                      updateSchedule(schedule.id, (current) => ({
                        ...current,
                        startDate: event.target.value,
                      }))
                    }
                  />
                </td>
                <td>
                  <input
                    className="table-input"
                    type="number"
                    min="0"
                    value={schedule.dayShiftDays}
                    onChange={(event) =>
                      updateSchedule(schedule.id, (current) => ({
                        ...current,
                        dayShiftDays: Number(event.target.value || 0),
                      }))
                    }
                  />
                </td>
                <td>
                  <input
                    className="table-input"
                    type="number"
                    min="0"
                    value={schedule.nightShiftDays}
                    onChange={(event) =>
                      updateSchedule(schedule.id, (current) => ({
                        ...current,
                        nightShiftDays: Number(event.target.value || 0),
                      }))
                    }
                  />
                </td>
                <td>
                  <input
                    className="table-input"
                    type="number"
                    min="0"
                    value={schedule.offDays}
                    onChange={(event) =>
                      updateSchedule(schedule.id, (current) => ({
                        ...current,
                        offDays: Number(event.target.value || 0),
                      }))
                    }
                  />
                </td>
                <td>{schedule.employeeCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
