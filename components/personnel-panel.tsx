"use client";

import { useMemo, useState, useTransition } from "react";

import { savePersonnel } from "@/app/actions";
import type { PersonnelUpdate, ScheduleCode, SchedulerSnapshot } from "@/lib/types";

type EditableEmployee = {
  id: string;
  name: string;
  role: string;
  teamId: string;
  scheduleCode: ScheduleCode;
  rotationAnchor: number;
  competencyIds: string[];
};

function normalizeEmployee(employee: EditableEmployee): PersonnelUpdate {
  return {
    employeeId: employee.id,
    name: employee.name.trim(),
    role: employee.role.trim(),
    teamId: employee.teamId,
    scheduleCode: employee.scheduleCode,
    rotationAnchor: employee.rotationAnchor,
    competencyIds: [...employee.competencyIds].sort(),
  };
}

export function PersonnelPanel({
  snapshot,
}: {
  snapshot: SchedulerSnapshot;
}) {
  const initialEmployees = useMemo<EditableEmployee[]>(
    () =>
      snapshot.teams.flatMap((team) =>
        team.employees.map((employee) => ({
          id: employee.id,
          name: employee.name,
          role: employee.role,
          teamId: employee.teamId,
          scheduleCode: employee.scheduleCode,
          rotationAnchor: employee.rotationAnchor,
          competencyIds: employee.competencyIds,
        })),
      ),
    [snapshot],
  );

  const [employees, setEmployees] = useState(initialEmployees);
  const [baselineEmployees, setBaselineEmployees] = useState(initialEmployees);
  const [statusMessage, setStatusMessage] = useState("Edit people, teams, and post coverage here.");
  const [isSaving, startSaveTransition] = useTransition();

  const baselineMap = useMemo(
    () => new Map(baselineEmployees.map((employee) => [employee.id, normalizeEmployee(employee)])),
    [baselineEmployees],
  );

  const dirtyUpdates = employees
    .map((employee) => normalizeEmployee(employee))
    .filter((employee) => JSON.stringify(baselineMap.get(employee.employeeId)) !== JSON.stringify(employee));

  function getTeam(teamId: string) {
    return snapshot.teams.find((team) => team.id === teamId) ?? snapshot.teams[0];
  }

  function getUnitName(teamId: string) {
    const team = getTeam(teamId);
    return snapshot.productionUnits.find((unit) => unit.id === team.unitId)?.name ?? "Unassigned";
  }

  function getUnitCompetencies(teamId: string) {
    const team = getTeam(teamId);
    return snapshot.competencies.filter((competency) => competency.unitId === team.unitId);
  }

  function updateEmployee(employeeId: string, updater: (employee: EditableEmployee) => EditableEmployee) {
    setEmployees((current) =>
      current.map((employee) => (employee.id === employeeId ? updater(employee) : employee)),
    );
  }

  function handleTeamChange(employeeId: string, teamId: string) {
    updateEmployee(employeeId, (employee) => {
      const validCompetencyIds = new Set(getUnitCompetencies(teamId).map((competency) => competency.id));

      return {
        ...employee,
        teamId,
        competencyIds: employee.competencyIds.filter((competencyId) => validCompetencyIds.has(competencyId)),
      };
    });
  }

  function toggleCompetency(employeeId: string, competencyId: string) {
    updateEmployee(employeeId, (employee) => {
      const isSelected = employee.competencyIds.includes(competencyId);

      return {
        ...employee,
        competencyIds: isSelected
          ? employee.competencyIds.filter((id) => id !== competencyId)
          : [...employee.competencyIds, competencyId],
      };
    });
  }

  function handleSave() {
    startSaveTransition(async () => {
      const result = await savePersonnel({ updates: dirtyUpdates });
      setStatusMessage(result.message);

      if (result.ok) {
        setBaselineEmployees(employees.map((employee) => ({ ...employee, competencyIds: [...employee.competencyIds] })));
      }
    });
  }

  return (
    <section className="panel-frame">
      <div className="panel-heading">
        <div>
          <span className="panel-eyebrow">Personnel</span>
          <h1 className="panel-title">People and competency coverage</h1>
        </div>
        <p className="panel-copy">
          Update names, roles, rotation codes, team placement, and post qualifications before they
          flow into the monthly schedule.
        </p>
      </div>

      <div className="workspace-toolbar workspace-toolbar--personnel">
        <div className="workspace-copy workspace-copy--full">
          <strong>{statusMessage}</strong>
          <p>Changing a team automatically narrows available competencies to that production unit.</p>
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
          <span>Total employees</span>
          <strong>{employees.length}</strong>
        </div>
        <div className="summary-stat">
          <span>Teams</span>
          <strong>{snapshot.teams.length}</strong>
        </div>
        <div className="summary-stat">
          <span>Production units</span>
          <strong>{snapshot.productionUnits.length}</strong>
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
              <th>Name</th>
              <th>Role</th>
              <th>Team</th>
              <th>Unit</th>
              <th>Rotation</th>
              <th>Competencies</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((employee) => (
              <tr key={employee.id}>
                <td>
                  <input
                    className="table-input"
                    value={employee.name}
                    onChange={(event) =>
                      updateEmployee(employee.id, (current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                  />
                </td>
                <td>
                  <input
                    className="table-input"
                    value={employee.role}
                    onChange={(event) =>
                      updateEmployee(employee.id, (current) => ({
                        ...current,
                        role: event.target.value,
                      }))
                    }
                  />
                </td>
                <td>
                  <select
                    className="table-select"
                    value={employee.teamId}
                    onChange={(event) => handleTeamChange(employee.id, event.target.value)}
                  >
                    {snapshot.teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>{getUnitName(employee.teamId)}</td>
                <td>
                  <select
                    className="table-select"
                    value={employee.scheduleCode}
                    onChange={(event) =>
                      updateEmployee(employee.id, (current) => ({
                        ...current,
                        scheduleCode: event.target.value as ScheduleCode,
                      }))
                    }
                  >
                    <option value="601">601</option>
                    <option value="602">602</option>
                    <option value="603">603</option>
                    <option value="604">604</option>
                  </select>
                </td>
                <td>
                  <div className="table-pills table-pills--editable">
                    {getUnitCompetencies(employee.teamId).map((competency) => {
                      const isSelected = employee.competencyIds.includes(competency.id);

                      return (
                        <button
                          type="button"
                          key={competency.id}
                          onClick={() => toggleCompetency(employee.id, competency.id)}
                          className={`legend-pill legend-pill--${competency.colorToken.toLowerCase()} ${
                            isSelected ? "legend-pill--selected" : "legend-pill--muted"
                          }`}
                        >
                          {competency.code}
                        </button>
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
