"use client";

import { useMemo, useState, useTransition } from "react";

import { saveCompetencies } from "@/app/actions";
import type { CompetencyUpdate, SaveCompetenciesInput, SchedulerSnapshot } from "@/lib/types";

const COLOR_TOKENS = ["amber", "teal", "violet", "rose", "blue", "lime", "orange", "slate"];

type EditableCompetency = {
  id: string;
  code: string;
  label: string;
  colorToken: string;
  requiredStaff: number;
};

function cloneCompetencies(competencies: EditableCompetency[]) {
  return competencies.map((competency) => ({ ...competency }));
}

function normalizeCompetency(competency: EditableCompetency): CompetencyUpdate {
  return {
    competencyId: competency.id,
    code: competency.code.trim(),
    label: competency.label.trim(),
    colorToken: competency.colorToken,
    requiredStaff: competency.requiredStaff,
  };
}

export function CompetenciesPanel({
  snapshot,
}: {
  snapshot: SchedulerSnapshot;
}) {
  const initialCompetencies = useMemo<EditableCompetency[]>(
    () =>
      snapshot.competencies.map((competency) => ({
        id: competency.id,
        code: competency.code,
        label: competency.label,
        colorToken: competency.colorToken,
        requiredStaff: competency.requiredStaff,
      })),
    [snapshot.competencies],
  );

  const [competencies, setCompetencies] = useState(initialCompetencies);
  const [baselineCompetencies, setBaselineCompetencies] = useState(initialCompetencies);
  const [deletedCompetencyIds, setDeletedCompetencyIds] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [isSaving, startSaveTransition] = useTransition();

  const baselineMap = useMemo(
    () => new Map(baselineCompetencies.map((competency) => [competency.id, normalizeCompetency(competency)])),
    [baselineCompetencies],
  );

  const dirtyUpdates = competencies
    .map((competency) => normalizeCompetency(competency))
    .filter(
      (competency) =>
        JSON.stringify(baselineMap.get(competency.competencyId)) !== JSON.stringify(competency),
    );
  const hasChanges = dirtyUpdates.length > 0 || deletedCompetencyIds.length > 0;

  function updateCompetency(
    competencyId: string,
    updater: (competency: EditableCompetency) => EditableCompetency,
  ) {
    setCompetencies((current) =>
      current.map((competency) => (competency.id === competencyId ? updater(competency) : competency)),
    );
  }

  function handleAddCompetency() {
    const nextCompetency: EditableCompetency = {
      id: `comp-${crypto.randomUUID().slice(0, 8)}`,
      code: "Post 99",
      label: "New competency",
      colorToken: "slate",
      requiredStaff: 1,
    };

    setCompetencies((current) => [nextCompetency, ...current]);
    setStatusMessage("");
  }

  function handleRemoveCompetency(competencyId: string) {
    setCompetencies((current) => current.filter((competency) => competency.id !== competencyId));

    if (baselineMap.has(competencyId)) {
      setDeletedCompetencyIds((current) => [...current, competencyId]);
    }

    setStatusMessage("");
  }

  function handleSave() {
    startSaveTransition(async () => {
      const result = await saveCompetencies({
        updates: dirtyUpdates,
        deletedCompetencyIds,
      } as SaveCompetenciesInput);
      setStatusMessage(result.message);

      if (result.ok) {
        setBaselineCompetencies(cloneCompetencies(competencies));
        setDeletedCompetencyIds([]);
      }
    });
  }

  function handleRevert() {
    setCompetencies(cloneCompetencies(baselineCompetencies));
    setDeletedCompetencyIds([]);
    setStatusMessage("Changes reverted.");
  }

  return (
    <section className="panel-frame">
      <div className="panel-heading panel-heading--simple">
        <h1 className="panel-title">Competencies</h1>
      </div>

      <div className="workspace-toolbar workspace-toolbar--actions">
        <div className="planner-actions">
          <button type="button" className="ghost-button" onClick={handleAddCompetency}>
            Add competency
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
              <th>Staff required</th>
              <th>Color</th>
              <th>Preview</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {competencies.map((competency) => (
              <tr key={competency.id}>
                <td>
                  <input
                    className="table-input"
                    value={competency.code}
                    onChange={(event) =>
                      updateCompetency(competency.id, (current) => ({
                        ...current,
                        code: event.target.value,
                      }))
                    }
                  />
                </td>
                <td>
                  <input
                    className="table-input"
                    value={competency.label}
                    onChange={(event) =>
                      updateCompetency(competency.id, (current) => ({
                        ...current,
                        label: event.target.value,
                      }))
                    }
                  />
                </td>
                <td>
                  <input
                    className="table-input"
                    type="number"
                    min="0"
                    value={competency.requiredStaff}
                    onChange={(event) =>
                      updateCompetency(competency.id, (current) => ({
                        ...current,
                        requiredStaff: Number(event.target.value || 0),
                      }))
                    }
                  />
                </td>
                <td>
                  <select
                    className="table-select"
                    value={competency.colorToken}
                    onChange={(event) =>
                      updateCompetency(competency.id, (current) => ({
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
                  <span className={`legend-pill legend-pill--${competency.colorToken.toLowerCase()}`}>
                    {competency.code}
                  </span>
                </td>
                <td className="table-actions-cell">
                  <button
                    type="button"
                    className="table-action table-action--danger"
                    onClick={() => handleRemoveCompetency(competency.id)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {competencies.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <div className="empty-state">
                    <strong>No competencies yet.</strong>
                    <span>Add a competency to populate the schedule options.</span>
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
