"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";

import { saveTimeCodes } from "@/app/actions";
import type { SaveTimeCodesInput, SchedulerSnapshot, TimeCodeUpdate, TimeCodeUsageMode } from "@/lib/types";

const COLOR_TOKENS = ["amber", "teal", "violet", "rose", "blue", "lime", "orange", "slate"];
const OFF_TIME_CODE_CODES = new Set(["V", "TR", "SB", "OFF", "ILL"]);

type EditableTimeCode = {
  id: string;
  code: string;
  label: string;
  colorToken: string;
  usageMode: TimeCodeUsageMode;
};

function RemoveTimeCodeModal({
  timeCode,
  onCancel,
  onConfirm,
}: {
  timeCode: EditableTimeCode;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="assignment-modal-backdrop" onClick={onCancel}>
      <section
        className="assignment-modal mutual-modal"
        aria-label="Remove time code confirmation"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="assignment-modal__header">
          <div>
            <span className="assignment-modal__eyebrow">Time Codes</span>
            <h2 className="assignment-modal__title">Remove time code?</h2>
            <p className="assignment-modal__context">
              Remove {timeCode.code || "this time code"}? This change will not save until you click Save.
            </p>
          </div>
          <button type="button" className="ghost-button" onClick={onCancel}>
            Close
          </button>
        </div>

        <div className="assignment-modal__footer">
          <button type="button" className="ghost-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="table-action table-action--danger" onClick={onConfirm}>
            Remove time code
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

/** Clones editable rows so revert/save baselines are never mutated in place. */
function cloneTimeCodes(timeCodes: EditableTimeCode[]) {
  return timeCodes.map((timeCode) => ({ ...timeCode }));
}

/** Converts local UI row state into the payload expected by persistence. */
function normalizeTimeCode(timeCode: EditableTimeCode): TimeCodeUpdate {
  return {
    timeCodeId: timeCode.id,
    code: timeCode.code.trim(),
    label: timeCode.label.trim(),
    colorToken: timeCode.colorToken,
    usageMode: timeCode.usageMode,
  };
}

/** Returns field-level validation issues that block a time code from saving. */
function getTimeCodeIssues(timeCode: EditableTimeCode) {
  const issues: string[] = [];

  if (!timeCode.code.trim()) {
    issues.push("Code required");
  }

  if (timeCode.code.trim().length > 5) {
    issues.push("Max 5 characters");
  }

  if (!timeCode.label.trim()) {
    issues.push("Label required");
  }

  return issues;
}

function isOffTimeCode(timeCode: EditableTimeCode) {
  return OFF_TIME_CODE_CODES.has(timeCode.code.trim().toUpperCase());
}

/** CRUD editor for the time codes that can be assigned on the scheduler. */
export function TimeCodesPanel({
  snapshot,
}: {
  snapshot: SchedulerSnapshot;
}) {
  const initialTimeCodes = useMemo<EditableTimeCode[]>(
    () =>
      snapshot.timeCodes.map((timeCode) => ({
        id: timeCode.id,
        code: timeCode.code,
        label: timeCode.label,
        colorToken: timeCode.colorToken,
        usageMode: timeCode.usageMode,
      })),
    [snapshot.timeCodes],
  );

  const [timeCodes, setTimeCodes] = useState(initialTimeCodes);
  const [baselineTimeCodes, setBaselineTimeCodes] = useState(initialTimeCodes);
  const [deletedTimeCodeIds, setDeletedTimeCodeIds] = useState<string[]>([]);
  const [pendingRemoveTimeCodeId, setPendingRemoveTimeCodeId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [isSaving, startSaveTransition] = useTransition();

  useEffect(() => {
    setTimeCodes(cloneTimeCodes(initialTimeCodes));
    setBaselineTimeCodes(cloneTimeCodes(initialTimeCodes));
    setDeletedTimeCodeIds([]);
    setPendingRemoveTimeCodeId(null);
    setStatusMessage("");
  }, [initialTimeCodes]);

  const baselineMap = useMemo(
    () => new Map(baselineTimeCodes.map((timeCode) => [timeCode.id, normalizeTimeCode(timeCode)])),
    [baselineTimeCodes],
  );
  const dirtyTimeCodeIds = useMemo(
    () =>
      new Set(
        timeCodes
          .map((timeCode) => normalizeTimeCode(timeCode))
          .filter(
            (timeCode) => JSON.stringify(baselineMap.get(timeCode.timeCodeId)) !== JSON.stringify(timeCode),
          )
          .map((timeCode) => timeCode.timeCodeId),
      ),
    [baselineMap, timeCodes],
  );
  const invalidTimeCodeIds = useMemo(
    () =>
      new Set(timeCodes.filter((timeCode) => getTimeCodeIssues(timeCode).length > 0).map((timeCode) => timeCode.id)),
    [timeCodes],
  );

  const dirtyUpdates = timeCodes
    .map((timeCode) => normalizeTimeCode(timeCode))
    .filter(
      (timeCode) => JSON.stringify(baselineMap.get(timeCode.timeCodeId)) !== JSON.stringify(timeCode),
    );
  const hasChanges = dirtyUpdates.length > 0 || deletedTimeCodeIds.length > 0;
  const hasValidationErrors = invalidTimeCodeIds.size > 0;
  const pendingRemoveTimeCode = pendingRemoveTimeCodeId
    ? timeCodes.find((timeCode) => timeCode.id === pendingRemoveTimeCodeId) ?? null
    : null;
  const workingTimeCodes = timeCodes.filter((timeCode) => !isOffTimeCode(timeCode));
  const offTimeCodes = timeCodes.filter(isOffTimeCode);

  function updateTimeCode(
    timeCodeId: string,
    updater: (timeCode: EditableTimeCode) => EditableTimeCode,
  ) {
    setTimeCodes((current) =>
      current.map((timeCode) => (timeCode.id === timeCodeId ? updater(timeCode) : timeCode)),
    );
  }

  function handleAddTimeCode() {
    const nextTimeCode: EditableTimeCode = {
      id: `time-${crypto.randomUUID().slice(0, 8)}`,
      code: "NEW",
      label: "New time code",
      colorToken: "slate",
      usageMode: "manual",
    };

    setTimeCodes((current) => [nextTimeCode, ...current]);
    setStatusMessage("");
  }

  function handleRemoveTimeCode(timeCodeId: string) {
    setPendingRemoveTimeCodeId(timeCodeId);
  }

  function handleConfirmRemoveTimeCode() {
    if (!pendingRemoveTimeCode) {
      setPendingRemoveTimeCodeId(null);
      return;
    }

    const timeCodeId = pendingRemoveTimeCode.id;

    setTimeCodes((current) => current.filter((timeCode) => timeCode.id !== timeCodeId));

    if (baselineMap.has(timeCodeId)) {
      setDeletedTimeCodeIds((current) => [...current, timeCodeId]);
    }

    setPendingRemoveTimeCodeId(null);
    setStatusMessage("");
  }

  function handleSave() {
    if (hasValidationErrors) {
      setStatusMessage("Fix the highlighted time codes before saving.");
      return;
    }

    startSaveTransition(async () => {
      const result = await saveTimeCodes({
        updates: dirtyUpdates,
        deletedTimeCodeIds,
      } as SaveTimeCodesInput);
      setStatusMessage(result.message);

      if (result.ok) {
        setBaselineTimeCodes(cloneTimeCodes(timeCodes));
        setDeletedTimeCodeIds([]);
      }
    });
  }

  function handleRevert() {
    setTimeCodes(cloneTimeCodes(baselineTimeCodes));
    setDeletedTimeCodeIds([]);
    setStatusMessage("Changes reverted.");
  }

  function renderTimeCodeRows(groupedTimeCodes: EditableTimeCode[], emptyMessage: string) {
    if (groupedTimeCodes.length === 0) {
      return (
        <tr>
          <td colSpan={6}>
            <div className="empty-state">
              <strong>{emptyMessage}</strong>
              <span>Add or rename a code to place it in this group.</span>
            </div>
          </td>
        </tr>
      );
    }

    return groupedTimeCodes.map((timeCode) => (
      <tr
        key={timeCode.id}
        className={`${dirtyTimeCodeIds.has(timeCode.id) ? "table-row--dirty" : ""} ${
          invalidTimeCodeIds.has(timeCode.id) ? "table-row--invalid" : ""
        }`}
      >
        <td>
          <input
            className="table-input"
            value={timeCode.code}
            maxLength={5}
            onChange={(event) =>
              updateTimeCode(timeCode.id, (current) => ({
                ...current,
                code: event.target.value.toUpperCase(),
              }))
            }
          />
        </td>
        <td>
          <input
            className="table-input"
            value={timeCode.label}
            onChange={(event) =>
              updateTimeCode(timeCode.id, (current) => ({
                ...current,
                label: event.target.value,
              }))
            }
          />
        </td>
        <td>
          <select
            className="table-select"
            value={timeCode.colorToken}
            onChange={(event) =>
              updateTimeCode(timeCode.id, (current) => ({
                ...current,
                colorToken: event.target.value,
              }))
            }
          >
            {COLOR_TOKENS.map((token) => (
              <option key={token} value={token}>
                {token}
              </option>
            ))}
          </select>
        </td>
        <td>
          <select
            className="table-select"
            value={timeCode.usageMode}
            onChange={(event) =>
              updateTimeCode(timeCode.id, (current) => ({
                ...current,
                usageMode: event.target.value as TimeCodeUsageMode,
              }))
            }
          >
            <option value="manual">Manual</option>
            <option value="projected_only">Projected only</option>
            <option value="both">Both</option>
          </select>
        </td>
        <td>
          <span className={`legend-pill legend-pill--${timeCode.colorToken.toLowerCase()}`}>
            {timeCode.code}
          </span>
        </td>
        <td>
          <div className="table-actions-cell">
            {invalidTimeCodeIds.has(timeCode.id) ? (
              <p className="row-issue">{getTimeCodeIssues(timeCode).join(" · ")}</p>
            ) : null}
            <button
              type="button"
              className="table-action table-action--danger"
              onClick={() => handleRemoveTimeCode(timeCode.id)}
            >
              Remove
            </button>
          </div>
        </td>
      </tr>
    ));
  }

  function renderTimeCodeTable(title: string, description: string, groupedTimeCodes: EditableTimeCode[], emptyMessage: string) {
    return (
      <section className="time-code-section">
        <div className="metrics-section__header">
          <div className="metrics-section__title-group">
            <h2 className="metrics-section__title">{title}</h2>
            <p>{description}</p>
          </div>
        </div>

        <div className="personnel-table-wrap">
          <table className="personnel-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Label</th>
                <th>Color</th>
                <th>Usage</th>
                <th>Preview</th>
                <th />
              </tr>
            </thead>
            <tbody>{renderTimeCodeRows(groupedTimeCodes, emptyMessage)}</tbody>
          </table>
        </div>
      </section>
    );
  }

  return (
    <section className="panel-frame">
      <div className="panel-heading panel-heading--simple">
        <h1 className="panel-title">Time Codes</h1>
      </div>

      <div className="workspace-toolbar workspace-toolbar--actions">
        <div className="planner-actions">
          <button type="button" className="ghost-button" onClick={handleAddTimeCode}>
            Add time code
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
            <p className="toolbar-status">Fix the highlighted time codes before saving.</p>
          ) : statusMessage ? (
            <p className="toolbar-status">{statusMessage}</p>
          ) : null}
        </div>
      </div>

      <div className="time-code-sections">
        {renderTimeCodeTable(
          "Working Time Codes",
          "Codes used for worked time, coverage, and active shift tracking.",
          workingTimeCodes,
          "No working time codes yet.",
        )}
        {renderTimeCodeTable(
          "Off Time Codes",
          "V, TR, SB, OFF, and ILL are grouped here as non-working time.",
          offTimeCodes,
          "No off time codes yet.",
        )}
      </div>

      {pendingRemoveTimeCode ? (
        <RemoveTimeCodeModal
          timeCode={pendingRemoveTimeCode}
          onCancel={() => setPendingRemoveTimeCodeId(null)}
          onConfirm={handleConfirmRemoveTimeCode}
        />
      ) : null}
    </section>
  );
}
