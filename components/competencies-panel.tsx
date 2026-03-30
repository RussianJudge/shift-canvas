"use client";

import { useMemo, useState, useTransition } from "react";

import { saveCompetencies } from "@/app/actions";
import type { CompetencyUpdate, SchedulerSnapshot } from "@/lib/types";

const COLOR_TOKENS = ["amber", "teal", "violet", "rose", "blue", "lime", "orange", "slate"];

type EditableCompetency = {
  id: string;
  unitId: string;
  code: string;
  label: string;
  colorToken: string;
};

function normalizeCompetency(competency: EditableCompetency): CompetencyUpdate {
  return {
    competencyId: competency.id,
    unitId: competency.unitId,
    code: competency.code.trim(),
    label: competency.label.trim(),
    colorToken: competency.colorToken,
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
        unitId: competency.unitId,
        code: competency.code,
        label: competency.label,
        colorToken: competency.colorToken,
      })),
    [snapshot.competencies],
  );

  const [competencies, setCompetencies] = useState(initialCompetencies);
  const [baselineCompetencies, setBaselineCompetencies] = useState(initialCompetencies);
  const [statusMessage, setStatusMessage] = useState(
    "Maintain the post library here. Each competency belongs to one production unit.",
  );
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

  function updateCompetency(
    competencyId: string,
    updater: (competency: EditableCompetency) => EditableCompetency,
  ) {
    setCompetencies((current) =>
      current.map((competency) => (competency.id === competencyId ? updater(competency) : competency)),
    );
  }

  function handleAddCompetency() {
    const defaultUnit = snapshot.productionUnits[0];

    if (!defaultUnit) {
      setStatusMessage("Add a production unit first, then create competencies.");
      return;
    }

    const nextCompetency: EditableCompetency = {
      id: `comp-${crypto.randomUUID().slice(0, 8)}`,
      unitId: defaultUnit.id,
      code: "Post 99",
      label: "New competency",
      colorToken: "slate",
    };

    setCompetencies((current) => [nextCompetency, ...current]);
    setStatusMessage("New competency row added. Edit the post code, label, and unit, then save.");
  }

  function handleSave() {
    startSaveTransition(async () => {
      const result = await saveCompetencies({ updates: dirtyUpdates });
      setStatusMessage(result.message);

      if (result.ok) {
        setBaselineCompetencies(competencies.map((competency) => ({ ...competency })));
      }
    });
  }

  return (
    <section className="panel-frame">
      <div className="panel-heading">
        <div>
          <span className="panel-eyebrow">Competencies</span>
          <h1 className="panel-title">Posts and coverage definitions</h1>
        </div>
        <p className="panel-copy">
          Create and refine the post list used in the calendar. These rows are saved directly to the
          Supabase `competencies` table.
        </p>
      </div>

      <div className="workspace-toolbar workspace-toolbar--personnel">
        <div className="workspace-copy workspace-copy--full">
          <strong>{statusMessage}</strong>
          <p>Calendar cells use the compact code, while personnel and setup screens keep the full label.</p>
        </div>
        <div className="planner-actions">
          <button type="button" className="ghost-button" onClick={handleAddCompetency}>
            Add competency
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
          <span>Total competencies</span>
          <strong>{competencies.length}</strong>
        </div>
        <div className="summary-stat">
          <span>Production units</span>
          <strong>{snapshot.productionUnits.length}</strong>
        </div>
        <div className="summary-stat">
          <span>Color tokens</span>
          <strong>{new Set(competencies.map((competency) => competency.colorToken)).size}</strong>
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
              <th>Code</th>
              <th>Label</th>
              <th>Production unit</th>
              <th>Color</th>
              <th>Preview</th>
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
                  <select
                    className="table-select"
                    value={competency.unitId}
                    onChange={(event) =>
                      updateCompetency(competency.id, (current) => ({
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
