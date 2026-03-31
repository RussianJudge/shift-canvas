"use client";

import { useMemo, useState, useTransition } from "react";

import { saveSchedules } from "@/app/actions";
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

function cloneSchedules(schedules: EditableSchedule[]) {
  return schedules.map((schedule) => ({ ...schedule }));
}

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

function getScheduleIssues(schedule: EditableSchedule) {
  const issues: string[] = [];

  if (!schedule.name.trim()) {
    issues.push("Name required");
  }

  if (!schedule.startDate) {
    issues.push("Start date required");
  }

  if (schedule.dayShiftDays + schedule.nightShiftDays + schedule.offDays <= 0) {
    issues.push("Cycle must be at least 1 day");
  }

  return issues;
}

function formatCycleSummary(schedule: EditableSchedule) {
  return `${schedule.dayShiftDays}D / ${schedule.nightShiftDays}N / ${schedule.offDays}O`;
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
  const [deletedScheduleIds, setDeletedScheduleIds] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [isSaving, startSaveTransition] = useTransition();

  const baselineMap = useMemo(
    () => new Map(baselineSchedules.map((schedule) => [schedule.id, normalizeSchedule(schedule)])),
    [baselineSchedules],
  );

  const dirtyScheduleIds = useMemo(
    () =>
      new Set(
        schedules
          .map((schedule) => normalizeSchedule(schedule))
          .filter(
            (schedule) => JSON.stringify(baselineMap.get(schedule.scheduleId)) !== JSON.stringify(schedule),
          )
          .map((schedule) => schedule.scheduleId),
      ),
    [baselineMap, schedules],
  );
  const invalidScheduleIds = useMemo(
    () =>
      new Set(schedules.filter((schedule) => getScheduleIssues(schedule).length > 0).map((schedule) => schedule.id)),
    [schedules],
  );

  const dirtyUpdates = schedules
    .map((schedule) => normalizeSchedule(schedule))
    .filter(
      (schedule) => JSON.stringify(baselineMap.get(schedule.scheduleId)) !== JSON.stringify(schedule),
    );
  const hasChanges = dirtyUpdates.length > 0 || deletedScheduleIds.length > 0;
  const hasValidationErrors = invalidScheduleIds.size > 0;

  function updateSchedule(
    scheduleId: string,
    updater: (schedule: EditableSchedule) => EditableSchedule,
  ) {
    setSchedules((current) =>
      current.map((schedule) => (schedule.id === scheduleId ? updater(schedule) : schedule)),
    );
  }

  function handleAddSchedule() {
    const nextSchedule: EditableSchedule = {
      id: `schedule-${crypto.randomUUID().slice(0, 8)}`,
      name: "New Shift",
      startDate: new Date().toISOString().slice(0, 10),
      dayShiftDays: 3,
      nightShiftDays: 3,
      offDays: 6,
      employeeCount: 0,
    };

    setSchedules((current) => [nextSchedule, ...current]);
    setStatusMessage("");
  }

  function handleRemoveSchedule(scheduleId: string) {
    const schedule = schedules.find((entry) => entry.id === scheduleId);

    if (!schedule) {
      return;
    }

    if (schedule.employeeCount > 0) {
      setStatusMessage(`Move ${schedule.employeeCount} employee${schedule.employeeCount === 1 ? "" : "s"} off ${schedule.name} before deleting it.`);
      return;
    }

    if (!window.confirm(`Remove ${schedule.name}?`)) {
      return;
    }

    setSchedules((current) => current.filter((entry) => entry.id !== scheduleId));

    if (baselineMap.has(scheduleId)) {
      setDeletedScheduleIds((current) => [...current, scheduleId]);
    }

    setStatusMessage("");
  }

  function handleSave() {
    if (hasValidationErrors) {
      setStatusMessage("Fix the highlighted shifts before saving.");
      return;
    }

    startSaveTransition(async () => {
      const result = await saveSchedules({
        updates: dirtyUpdates,
        deletedScheduleIds,
      } as SaveSchedulesInput);
      setStatusMessage(result.message);

      if (result.ok) {
        setBaselineSchedules(cloneSchedules(schedules));
        setDeletedScheduleIds([]);
      }
    });
  }

  function handleRevert() {
    setSchedules(cloneSchedules(baselineSchedules));
    setDeletedScheduleIds([]);
    setStatusMessage("Changes reverted.");
  }

  return (
    <section className="panel-frame">
      <div className="panel-heading panel-heading--simple">
        <h1 className="panel-title">Shifts</h1>
      </div>

      <div className="workspace-toolbar workspace-toolbar--actions">
        <div className="planner-actions">
          <button type="button" className="ghost-button" onClick={handleAddSchedule}>
            Add shift
          </button>
          <button type="button" className="ghost-button" onClick={handleRevert} disabled={isSaving || !hasChanges}>
            Revert
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={handleSave}
            disabled={isSaving || !hasChanges || hasValidationErrors}
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
        <div className="toolbar-status-wrap">
          {hasValidationErrors ? (
            <p className="toolbar-status">Fix highlighted shifts before saving.</p>
          ) : statusMessage ? (
            <p className="toolbar-status">{statusMessage}</p>
          ) : null}
        </div>
      </div>

      <div className="personnel-table-wrap">
        <table className="personnel-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Start date</th>
              <th>Day on</th>
              <th>Night on</th>
              <th>Off days</th>
              <th>Cycle</th>
              <th>Employees</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {schedules.map((schedule) => (
              <tr
                key={schedule.id}
                className={`${dirtyScheduleIds.has(schedule.id) ? "table-row--dirty" : ""} ${
                  invalidScheduleIds.has(schedule.id) ? "table-row--invalid" : ""
                }`}
              >
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
                <td>
                  <div className="table-meta">
                    <strong>{formatCycleSummary(schedule)}</strong>
                    <span>{schedule.dayShiftDays + schedule.nightShiftDays + schedule.offDays} day cycle</span>
                  </div>
                </td>
                <td>{schedule.employeeCount}</td>
                <td className="table-actions-cell">
                  {invalidScheduleIds.has(schedule.id) ? (
                    <p className="row-issue">{getScheduleIssues(schedule).join(" · ")}</p>
                  ) : null}
                  <button
                    type="button"
                    className="table-action table-action--danger"
                    onClick={() => handleRemoveSchedule(schedule.id)}
                    disabled={schedule.employeeCount > 0}
                    title={
                      schedule.employeeCount > 0
                        ? "Move employees off this shift before deleting it."
                        : "Remove shift"
                    }
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {schedules.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <div className="empty-state">
                    <strong>No shifts yet.</strong>
                    <span>Add a shift to start building rotations.</span>
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
