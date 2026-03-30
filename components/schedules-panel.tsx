"use client";

import { useMemo, useState, useTransition } from "react";

import { saveSchedules } from "@/app/actions";
import type { SaveSchedulesInput, ScheduleUpdate, SchedulerSnapshot } from "@/lib/types";

type EditableSchedule = {
  id: string;
  name: string;
  unitId: string;
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
    unitId: schedule.unitId,
    startDate: schedule.startDate,
    dayShiftDays: schedule.dayShiftDays,
    nightShiftDays: schedule.nightShiftDays,
    offDays: schedule.offDays,
  };
}

export function SchedulesPanel({
  snapshot,
}: {
  snapshot: SchedulerSnapshot;
}) {
  const initialSchedules = useMemo<EditableSchedule[]>(
    () =>
      snapshot.schedules.map((schedule) => ({
        id: schedule.id,
        name: schedule.name,
        unitId: schedule.unitId,
        startDate: schedule.startDate,
        dayShiftDays: schedule.dayShiftDays,
        nightShiftDays: schedule.nightShiftDays,
        offDays: schedule.offDays,
        employeeCount: schedule.employees.length,
      })),
    [snapshot],
  );

  const [schedules, setSchedules] = useState(initialSchedules);
  const [baselineSchedules, setBaselineSchedules] = useState(initialSchedules);
  const [statusMessage, setStatusMessage] = useState(
    "Create schedules and define how many day shifts, night shifts, and off days they repeat through.",
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

  function handleAddSchedule() {
    const defaultUnit = snapshot.productionUnits[0];

    if (!defaultUnit) {
      setStatusMessage("Add a production unit first, then create schedules here.");
      return;
    }

    const nextSchedule: EditableSchedule = {
      id: `schedule-${crypto.randomUUID().slice(0, 8)}`,
      name: "New Schedule",
      unitId: defaultUnit.id,
      startDate: new Date().toISOString().slice(0, 10),
      dayShiftDays: 3,
      nightShiftDays: 3,
      offDays: 6,
      employeeCount: 0,
    };

    setSchedules((current) => [nextSchedule, ...current]);
    setStatusMessage("New schedule row added. Set the pattern and save when ready.");
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
          <h1 className="panel-title">Shift pattern setup</h1>
        </div>
        <p className="panel-copy">
          Each schedule defines a production unit, a start date, and the repeating counts for day
          shifts, night shifts, and off days.
        </p>
      </div>

      <div className="workspace-toolbar workspace-toolbar--personnel">
        <div className="workspace-copy workspace-copy--full">
          <strong>{statusMessage}</strong>
          <p>Personnel are assigned to schedules on the Personnel page.</p>
        </div>
        <div className="planner-actions">
          <button type="button" className="ghost-button" onClick={handleAddSchedule}>
            Add schedule
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
        <div className="summary-stat">
          <span>Total schedules</span>
          <strong>{schedules.length}</strong>
        </div>
        <div className="summary-stat">
          <span>Production units</span>
          <strong>{snapshot.productionUnits.length}</strong>
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
              <th>Schedule name</th>
              <th>Production unit</th>
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
                  <input
                    className="table-input"
                    value={schedule.name}
                    onChange={(event) =>
                      updateSchedule(schedule.id, (current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                  />
                </td>
                <td>
                  <select
                    className="table-select"
                    value={schedule.unitId}
                    onChange={(event) =>
                      updateSchedule(schedule.id, (current) => ({
                        ...current,
                        unitId: event.target.value,
                      }))
                    }
                  >
                    {snapshot.productionUnits.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </select>
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
