"use client";

import { useMemo, useState, useTransition } from "react";

import { savePersonnel } from "@/app/actions";
import type { PersonnelUpdate, SavePersonnelInput, SchedulerSnapshot } from "@/lib/types";

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
  const [deletedEmployeeIds, setDeletedEmployeeIds] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [isSaving, startSaveTransition] = useTransition();

  const baselineMap = useMemo(
    () => new Map(baselineEmployees.map((employee) => [employee.id, normalizeEmployee(employee)])),
    [baselineEmployees],
  );

  const dirtyUpdates = employees
    .map((employee) => normalizeEmployee(employee))
    .filter((employee) => JSON.stringify(baselineMap.get(employee.employeeId)) !== JSON.stringify(employee));

  function updateEmployee(employeeId: string, updater: (employee: EditableEmployee) => EditableEmployee) {
    setEmployees((current) =>
      current.map((employee) => (employee.id === employeeId ? updater(employee) : employee)),
    );
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
      const result = await savePersonnel({
        updates: dirtyUpdates,
        deletedEmployeeIds,
      } as SavePersonnelInput);
      setStatusMessage(result.message);

      if (result.ok) {
        setBaselineEmployees(employees.map((employee) => ({ ...employee, competencyIds: [...employee.competencyIds] })));
        setDeletedEmployeeIds([]);
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
      setStatusMessage("Add a schedule and a production unit first.");
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
    setStatusMessage("");
  }

  function handleRemoveEmployee(employeeId: string) {
    setEmployees((current) => current.filter((employee) => employee.id !== employeeId));

    if (baselineMap.has(employeeId)) {
      setDeletedEmployeeIds((current) => [...current, employeeId]);
    }

    setStatusMessage("");
  }

  return (
    <section className="panel-frame">
      <div className="panel-heading panel-heading--simple">
        <h1 className="panel-title">Personnel</h1>
      </div>

      <div className="workspace-toolbar workspace-toolbar--actions">
        <div className="planner-actions">
          <button type="button" className="ghost-button" onClick={handleAddEmployee}>
            Add employee
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={handleSave}
            disabled={isSaving || (dirtyUpdates.length === 0 && deletedEmployeeIds.length === 0)}
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
              <th>Name</th>
              <th>Role</th>
              <th>Shift</th>
              <th>Production unit</th>
              <th>Competencies</th>
              <th />
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
                    onChange={(event) =>
                      updateEmployee(employee.id, (current) => ({
                        ...current,
                        scheduleId: event.target.value,
                      }))
                    }
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
                    onChange={(event) =>
                      updateEmployee(employee.id, (current) => ({
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
                  <div className="table-pills table-pills--editable">
                    {snapshot.competencies.map((competency) => {
                      const isSelected = employee.competencyIds.includes(competency.id);

                      return (
                        <button
                          type="button"
                          key={competency.id}
                          onClick={() => toggleCompetency(employee.id, competency.id)}
                          className={`legend-pill legend-pill--${competency.colorToken.toLowerCase()} ${
                            isSelected ? "legend-pill--selected" : "legend-pill--muted"
                          }`}
                          title={competency.label}
                        >
                          {competency.code}
                        </button>
                      );
                    })}
                  </div>
                </td>
                <td className="table-actions-cell">
                  <button
                    type="button"
                    className="table-action table-action--danger"
                    onClick={() => handleRemoveEmployee(employee.id)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {employees.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <div className="empty-state">
                    <strong>No employees yet.</strong>
                    <span>Add an employee to start staffing the shifts.</span>
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
