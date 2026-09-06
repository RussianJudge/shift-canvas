"use client";

import { useMemo, useState, useTransition } from "react";

import { saveSchedules } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { SaveSchedulesInput, ScheduleUpdate, SchedulerSnapshot } from "@/lib/types";

type EditableSchedule = {
  id: string;
  name: string;
  startDate: string;
  dayShiftDays: number;
  nightShiftDays: number;
  offDays: number;
  isActive: boolean;
  employeeCount: number;
};

function RemoveScheduleModal({
  scheduleName,
  onCancel,
  onConfirm,
}: {
  scheduleName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (typeof document === "undefined") {
    return null;
  }

  return (
    <Modal
      open
      onClose={onCancel}
      eyebrow="Shifts"
      title="Remove shift?"
      description={`Remove ${scheduleName}? This change will not save until you click Save.`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Remove shift
          </Button>
        </>
      }
    />
  );
}

function AddShiftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function RevertIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
    </svg>
  );
}

/** Clones editable shift rows so the save baseline stays immutable. */
function cloneSchedules(schedules: EditableSchedule[]) {
  return schedules.map((schedule) => ({ ...schedule }));
}

/** Converts one editable shift row into the backend save payload shape. */
function normalizeSchedule(schedule: EditableSchedule): ScheduleUpdate {
  return {
    scheduleId: schedule.id,
    name: schedule.name.trim(),
    startDate: schedule.startDate,
    dayShiftDays: schedule.dayShiftDays,
    nightShiftDays: schedule.nightShiftDays,
    offDays: schedule.offDays,
    isActive: schedule.isActive,
  };
}

/** Returns any validation issues that make a shift pattern invalid to save. */
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

/** Compact summary string used to read the pattern at a glance in the table. */
function formatCycleSummary(schedule: EditableSchedule) {
  return `${schedule.dayShiftDays}D / ${schedule.nightShiftDays}N / ${schedule.offDays}O`;
}

/** Editor for the reusable shift patterns that drive the entire scheduler. */
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
        isActive: schedule.isActive,
        employeeCount: schedule.employees.length,
      })),
    [snapshot],
  );

  const [schedules, setSchedules] = useState(initialSchedules);
  const [baselineSchedules, setBaselineSchedules] = useState(initialSchedules);
  const [deletedScheduleIds, setDeletedScheduleIds] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [pendingRemoveScheduleId, setPendingRemoveScheduleId] = useState<string | null>(null);
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
  const pendingRemoveSchedule = pendingRemoveScheduleId
    ? schedules.find((schedule) => schedule.id === pendingRemoveScheduleId) ?? null
    : null;

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
      isActive: true,
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

    setPendingRemoveScheduleId(scheduleId);
  }

  function handleConfirmRemoveSchedule() {
    if (!pendingRemoveSchedule) {
      setPendingRemoveScheduleId(null);
      return;
    }

    const scheduleId = pendingRemoveSchedule.id;

    setSchedules((current) => current.filter((entry) => entry.id !== scheduleId));

    if (baselineMap.has(scheduleId)) {
      setDeletedScheduleIds((current) => [...current, scheduleId]);
    }

    setPendingRemoveScheduleId(null);
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
    setPendingRemoveScheduleId(null);
    setStatusMessage("Changes reverted.");
  }

  return (
    <>
    <section className="panel-frame">
      <div className="panel-heading panel-heading--simple">
        <h1 className="panel-title">Shifts</h1>
      </div>

      <div className="shifts-toolbar">
        {/* These were icon-only. The labels match the other admin pages and
            make Save and Revert legible without a tooltip; the icons and
            handlers are unchanged. */}
        <div className="shifts-toolbar__actions">
          <Button variant="secondary" onClick={handleAddSchedule}>
            <AddShiftIcon />
            Add shift
          </Button>
          <Button
            variant="secondary"
            onClick={handleRevert}
            disabled={isSaving || !hasChanges}
          >
            <RevertIcon />
            Revert
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            loading={isSaving}
            disabled={!hasChanges || hasValidationErrors}
          >
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      <p className="shifts-status" role="status" aria-live="polite">
        {hasValidationErrors ? "Fix highlighted shifts before saving." : statusMessage}
      </p>

      <div className="personnel-table-wrap shifts-table-wrap">
        <table className="personnel-table shifts-table">
          <thead>
            <tr>
              <th className="shift-col-name">Name</th>
              <th className="shift-col-date">Start date</th>
              <th className="shift-col-num">Day on</th>
              <th className="shift-col-num">Night on</th>
              <th className="shift-col-num">Off days</th>
              <th className="shift-col-cycle">Cycle</th>
              <th className="shift-col-count">Employees</th>
              <th className="shift-col-status">Status</th>
              <th className="shift-col-actions">
                <span className="sr-only">Actions</span>
              </th>
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
                <td className="shift-col-count">{schedule.employeeCount}</td>
                <td>
                  <span className={`legend-pill ${schedule.isActive ? "legend-pill--teal" : "legend-pill--slate"}`}>
                    {schedule.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td>
                  <div className="table-actions-cell">
                    {invalidScheduleIds.has(schedule.id) ? (
                      <p className="row-issue">{getScheduleIssues(schedule).join(" · ")}</p>
                    ) : null}
                    <Button
                      variant="subtle"
                      size="sm"
                      className="shifts-remove"
                      onClick={() => handleRemoveSchedule(schedule.id)}
                      disabled={schedule.employeeCount > 0}
                      title={
                        schedule.employeeCount > 0
                          ? "Move employees off this shift before deleting it."
                          : "Remove shift"
                      }
                    >
                      Remove
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {schedules.length === 0 ? (
              <tr>
                <td colSpan={9}>
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

    {pendingRemoveSchedule ? (
      <RemoveScheduleModal
        scheduleName={pendingRemoveSchedule.name}
        onCancel={() => setPendingRemoveScheduleId(null)}
        onConfirm={handleConfirmRemoveSchedule}
      />
    ) : null}
    </>
  );
}
