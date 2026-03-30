"use client";

import { useMemo, useState, useTransition } from "react";

import { savePersonnel } from "@/app/actions";
import { REQUIRED_SHIFT_CODES } from "@/lib/types";
import type { PersonnelUpdate, SchedulerSnapshot } from "@/lib/types";

type EditableEmployee = {
  id: string;
  name: string;
  role: string;
  scheduleId: string;
  unitId: string;
  competencyIds: string[];
};

function normalizeEmployee(employee: EditableEmployee): PersonnelUpdate {
  return {
    employeeId: employee.id,
    name: employee.name.trim(),
    role: employee.role.trim(),
    scheduleId: employee.scheduleId,
    unitId: employee.unitId,
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
      snapshot.schedules.flatMap((schedule) =>
        schedule.employees.map((employee) => ({
          id: employee.id,
          name: employee.name,
          role: employee.role,
          scheduleId: employee.scheduleId,
          unitId: employee.unitId,
          competencyIds: employee.competencyIds,
        })),
      ),
    [snapshot],
  );

  const [employees, setEmployees] = useState(initialEmployees);
  const [baselineEmployees, setBaselineEmployees] = useState(initialEmployees);
  const [statusMessage, setStatusMessage] = useState(
    "Every employee belongs to one of the four shared shifts 601-604 and carries their own production unit.",
  );
  const [isSaving, startSaveTransition] = useTransition();

  const baselineMap = useMemo(
    () => new Map(baselineEmployees.map((employee) => [employee.id, normalizeEmployee(employee)])),
    [baselineEmployees],
  );

  const unitById = useMemo(
    () => new Map(snapshot.productionUnits.map((unit) => [unit.id, unit])),
    [snapshot.productionUnits],
  );

  const dirtyUpdates = employees
    .map((employee) => normalizeEmployee(employee))
    .filter((employee) => JSON.stringify(baselineMap.get(employee.employeeId)) !== JSON.stringify(employee));

  function getUnitCompetencies(unitId: string) {
    return snapshot.competencies.filter((competency) => competency.unitId === unitId);
  }

  function updateEmployee(employeeId: string, updater: (employee: EditableEmployee) => EditableEmployee) {
    setEmployees((current) =>
      current.map((employee) => (employee.id === employeeId ? updater(employee) : employee)),
    );
  }

  function handleScheduleChange(employeeId: string, scheduleId: string) {
    updateEmployee(employeeId, (employee) => ({
      ...employee,
      scheduleId,
    }));
  }

  function handleUnitChange(employeeId: string, unitId: string) {
    updateEmployee(employeeId, (employee) => {
      const validCompetencyIds = new Set(getUnitCompetencies(unitId).map((competency) => competency.id));

      return {
        ...employee,
        unitId,
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

  function handleAddEmployee() {
    const defaultSchedule =
      [...snapshot.schedules]
        .sort((left, right) => left.employees.length - right.employees.length || left.name.localeCompare(right.name))[0] ??
      snapshot.schedules[0];
    const defaultUnit = snapshot.productionUnits[0];

    if (!defaultSchedule || !defaultUnit) {
      setStatusMessage("Add at least one shift and one production unit before creating employees.");
      return;
    }

    const nextEmployee: EditableEmployee = {
      id: `emp-${crypto.randomUUID().slice(0, 8)}`,
      name: "New Employee",
      role: "Operator",
      scheduleId: defaultSchedule.id,
      unitId: defaultUnit.id,
      competencyIds: [],
    };

    setEmployees((current) => [nextEmployee, ...current]);
    setStatusMessage(`New employee row added on shift ${defaultSchedule.name}. Edit the unit and competencies, then save.`);
  }

  const shiftCounts = snapshot.schedules.map((schedule) => ({
    name: schedule.name,
    count: employees.filter((employee) => employee.scheduleId === schedule.id).length,
  }));

  const shiftSummary = REQUIRED_SHIFT_CODES.map(
    (code) => `${code}: ${shiftCounts.find((shift) => shift.name === code)?.count ?? 0}`,
  ).join("  |  ");

  return (
    <section className="panel-frame">
      <div className="panel-heading">
        <div>
          <span className="panel-eyebrow">Personnel</span>
          <h1 className="panel-title">People, shifts, and qualifications</h1>
        </div>
        <p className="panel-copy">
          Assign each person to one of the four shared shifts, set their production unit, and keep
          their valid post coverage aligned to that unit.
        </p>
      </div>

      <div className="workspace-toolbar workspace-toolbar--personnel">
        <div className="workspace-copy workspace-copy--full">
          <strong>{statusMessage}</strong>
          <p>{shiftSummary}</p>
        </div>
        <div className="planner-actions">
          <button type="button" className="ghost-button" onClick={handleAddEmployee}>
            Add employee
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
          <span>Total employees</span>
          <strong>{employees.length}</strong>
        </div>
        <div className="summary-stat">
          <span>Shifts</span>
          <strong>{snapshot.schedules.length}</strong>
        </div>
        <div className="summary-stat">
          <span>Production units</span>
          <strong>{snapshot.productionUnits.length}</strong>
        </div>
        <div className="summary-stat">
          <span>Qualified posts</span>
          <strong>{snapshot.competencies.length}</strong>
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
              <th>Shift</th>
              <th>Production unit</th>
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
                    value={employee.scheduleId}
                    onChange={(event) => handleScheduleChange(employee.id, event.target.value)}
                  >
                    {snapshot.schedules.map((schedule) => (
                      <option key={schedule.id} value={schedule.id}>
                        {schedule.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    className="table-select"
                    value={employee.unitId}
                    onChange={(event) => handleUnitChange(employee.id, event.target.value)}
                  >
                    {snapshot.productionUnits.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <div className="table-pills table-pills--editable">
                    {getUnitCompetencies(employee.unitId).map((competency) => {
                      const isSelected = employee.competencyIds.includes(competency.id);

                      return (
                        <button
                          type="button"
                          key={competency.id}
                          onClick={() => toggleCompetency(employee.id, competency.id)}
                          className={`legend-pill legend-pill--${competency.colorToken.toLowerCase()} ${
                            isSelected ? "legend-pill--selected" : "legend-pill--muted"
                          }`}
                          title={`${unitById.get(employee.unitId)?.name ?? "Unit"}: ${competency.label}`}
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
