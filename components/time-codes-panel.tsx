"use client";

import { useMemo, useState, useTransition } from "react";

import { saveTimeCodes } from "@/app/actions";
import type { SaveTimeCodesInput, SchedulerSnapshot, TimeCodeUpdate } from "@/lib/types";

const COLOR_TOKENS = ["amber", "teal", "violet", "rose", "blue", "lime", "orange", "slate"];

type EditableTimeCode = {
  id: string;
  code: string;
  label: string;
  colorToken: string;
};

function cloneTimeCodes(timeCodes: EditableTimeCode[]) {
  return timeCodes.map((timeCode) => ({ ...timeCode }));
}

function normalizeTimeCode(timeCode: EditableTimeCode): TimeCodeUpdate {
  return {
    timeCodeId: timeCode.id,
    code: timeCode.code.trim(),
    label: timeCode.label.trim(),
    colorToken: timeCode.colorToken,
  };
}

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
      })),
    [snapshot.timeCodes],
  );

  const [timeCodes, setTimeCodes] = useState(initialTimeCodes);
  const [baselineTimeCodes, setBaselineTimeCodes] = useState(initialTimeCodes);
  const [deletedTimeCodeIds, setDeletedTimeCodeIds] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [isSaving, startSaveTransition] = useTransition();

  const baselineMap = useMemo(
    () => new Map(baselineTimeCodes.map((timeCode) => [timeCode.id, normalizeTimeCode(timeCode)])),
    [baselineTimeCodes],
  );

  const dirtyUpdates = timeCodes
    .map((timeCode) => normalizeTimeCode(timeCode))
    .filter(
      (timeCode) => JSON.stringify(baselineMap.get(timeCode.timeCodeId)) !== JSON.stringify(timeCode),
    );
  const hasChanges = dirtyUpdates.length > 0 || deletedTimeCodeIds.length > 0;

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
    };

    setTimeCodes((current) => [nextTimeCode, ...current]);
    setStatusMessage("");
  }

  function handleRemoveTimeCode(timeCodeId: string) {
    setTimeCodes((current) => current.filter((timeCode) => timeCode.id !== timeCodeId));

    if (baselineMap.has(timeCodeId)) {
      setDeletedTimeCodeIds((current) => [...current, timeCodeId]);
    }

    setStatusMessage("");
  }

  function handleSave() {
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
            disabled={isSaving || !hasChanges}
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
        {statusMessage ? <p className="toolbar-status">{statusMessage}</p> : null}
      </div>

      <div className="personnel-table-wrap">
        <table className="personnel-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Label</th>
              <th>Color</th>
              <th>Preview</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {timeCodes.map((timeCode) => (
              <tr key={timeCode.id}>
                <td>
                  <input
                    className="table-input"
                    value={timeCode.code}
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
                  <span className={`legend-pill legend-pill--${timeCode.colorToken.toLowerCase()}`}>
                    {timeCode.code}
                  </span>
                </td>
                <td className="table-actions-cell">
                  <button
                    type="button"
                    className="table-action table-action--danger"
                    onClick={() => handleRemoveTimeCode(timeCode.id)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {timeCodes.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <div className="empty-state">
                    <strong>No time codes yet.</strong>
                    <span>Add a code to use it in the schedule grid.</span>
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
