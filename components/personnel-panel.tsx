"use client";

import type { ChangeEvent } from "react";
import { useMemo, useRef, useState, useTransition } from "react";

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

type CsvImportRow = Record<string, string>;

function normalizeCsvHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeLookupValue(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseCsvText(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let isQuoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (character === '"') {
      if (isQuoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        isQuoted = !isQuoted;
      }

      continue;
    }

    if (!isQuoted && character === ",") {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if (!isQuoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") {
        index += 1;
      }

      row.push(cell.trim());
      cell = "";

      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    cell += character;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
  }

  if (row.some((value) => value.length > 0)) {
    rows.push(row);
  }

  return rows;
}

function buildCsvObjects(text: string): CsvImportRow[] {
  const rows = parseCsvText(text);

  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0].map(normalizeCsvHeader);

  return rows.slice(1).map((values) =>
    headers.reduce<CsvImportRow>((entry, header, index) => {
      if (header) {
        entry[header] = values[index]?.trim() ?? "";
      }

      return entry;
    }, {}),
  );
}

function pickCsvValue(row: CsvImportRow, aliases: string[]) {
  for (const alias of aliases) {
    const value = row[alias];

    if (value) {
      return value.trim();
    }
  }

  return "";
}

function splitCompetencyValues(value: string) {
  return value
    .split(/[,;|/]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function cloneEmployees(employees: EditableEmployee[]) {
  return employees.map((employee) => ({
    ...employee,
    competencyIds: [...employee.competencyIds],
  }));
}

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
  const csvInputRef = useRef<HTMLInputElement>(null);
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
  const defaultSchedule =
    [...snapshot.schedules]
      .sort((left, right) => left.employees.length - right.employees.length || left.name.localeCompare(right.name))[0] ??
    snapshot.schedules[0];
  const defaultUnit = snapshot.productionUnits[0];

  const baselineMap = useMemo(
    () => new Map(baselineEmployees.map((employee) => [employee.id, normalizeEmployee(employee)])),
    [baselineEmployees],
  );
  const scheduleIdByLookup = useMemo(() => {
    const entries = snapshot.schedules.flatMap((schedule) => [
      [normalizeLookupValue(schedule.id), schedule.id] as const,
      [normalizeLookupValue(schedule.name), schedule.id] as const,
    ]);

    return new Map(entries);
  }, [snapshot.schedules]);
  const competencyIdByLookup = useMemo(() => {
    const entries = snapshot.competencies.flatMap((competency) => [
      [normalizeLookupValue(competency.id), competency.id] as const,
      [normalizeLookupValue(competency.code), competency.id] as const,
      [normalizeLookupValue(competency.label), competency.id] as const,
    ]);

    return new Map(entries);
  }, [snapshot.competencies]);

  const dirtyUpdates = employees
    .map((employee) => normalizeEmployee(employee))
    .filter((employee) => JSON.stringify(baselineMap.get(employee.employeeId)) !== JSON.stringify(employee));
  const hasChanges = dirtyUpdates.length > 0 || deletedEmployeeIds.length > 0;

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
        setBaselineEmployees(cloneEmployees(employees));
        setDeletedEmployeeIds([]);
      }
    });
  }

  function handleRevert() {
    setEmployees(cloneEmployees(baselineEmployees));
    setDeletedEmployeeIds([]);
    setStatusMessage("Changes reverted.");
  }

  function handleAddEmployee() {
    if (!defaultSchedule || !defaultUnit) {
      setStatusMessage("Complete setup first.");
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

  async function handleCsvImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!defaultSchedule || !defaultUnit) {
      setStatusMessage("Complete setup first.");
      return;
    }

    const csvRows = buildCsvObjects(await file.text());

    if (csvRows.length === 0) {
      setStatusMessage("CSV import needs a header row and at least one employee.");
      return;
    }

    const nextEmployees = cloneEmployees(employees);
    const indexById = new Map(nextEmployees.map((employee, index) => [employee.id, index]));
    const indexByName = new Map(
      nextEmployees.map((employee, index) => [normalizeLookupValue(employee.name), index]),
    );
    const restoredIds = new Set<string>();
    const unknownSchedules = new Set<string>();
    const unknownCompetencies = new Set<string>();
    let importedCount = 0;
    let skippedCount = 0;

    for (const row of csvRows) {
      const csvId = pickCsvValue(row, ["id", "employee_id", "personnel_id"]);
      const csvName = pickCsvValue(row, ["name", "full_name", "employee", "employee_name"]);
      const csvRole = pickCsvValue(row, ["role", "role_title", "title", "position"]);
      const csvShift = pickCsvValue(row, ["shift", "schedule", "shift_code", "schedule_code", "pattern"]);
      const csvCompetencies = pickCsvValue(row, [
        "competencies",
        "competency",
        "posts",
        "post",
        "skills",
        "qualifications",
      ]);

      if (!csvName && !csvId) {
        skippedCount += 1;
        continue;
      }

      const matchedIndexById = csvId ? indexById.get(csvId) : undefined;
      const matchedIndexByName = csvName ? indexByName.get(normalizeLookupValue(csvName)) : undefined;
      const matchedIndex = matchedIndexById ?? matchedIndexByName;
      const existing = matchedIndex === undefined ? null : nextEmployees[matchedIndex];
      const resolvedScheduleId = csvShift
        ? scheduleIdByLookup.get(normalizeLookupValue(csvShift)) ?? ""
        : "";

      if (csvShift && !resolvedScheduleId) {
        unknownSchedules.add(csvShift);
      }

      const resolvedCompetencyIds = splitCompetencyValues(csvCompetencies).flatMap((value) => {
        const competencyId = competencyIdByLookup.get(normalizeLookupValue(value));

        if (!competencyId) {
          unknownCompetencies.add(value);
          return [];
        }

        return competencyId;
      });

      const nextEmployee: EditableEmployee = {
        id: existing?.id ?? (csvId || `emp-${crypto.randomUUID().slice(0, 8)}`),
        name: csvName || existing?.name || "New Employee",
        role: csvRole || existing?.role || "Operator",
        scheduleId: resolvedScheduleId || existing?.scheduleId || defaultSchedule.id,
        unitId: existing?.unitId || defaultUnit.id,
        competencyIds:
          resolvedCompetencyIds.length > 0
            ? [...new Set(resolvedCompetencyIds)]
            : existing?.competencyIds ?? [],
      };

      if (matchedIndex === undefined) {
        nextEmployees.push(nextEmployee);
        const nextIndex = nextEmployees.length - 1;
        indexById.set(nextEmployee.id, nextIndex);
        indexByName.set(normalizeLookupValue(nextEmployee.name), nextIndex);
      } else {
        nextEmployees[matchedIndex] = nextEmployee;
        indexById.set(nextEmployee.id, matchedIndex);
        indexByName.set(normalizeLookupValue(nextEmployee.name), matchedIndex);
      }

      restoredIds.add(nextEmployee.id);
      importedCount += 1;
    }

    setEmployees(nextEmployees);
    setDeletedEmployeeIds((current) => current.filter((employeeId) => !restoredIds.has(employeeId)));

    const details = [
      importedCount > 0 ? `Imported ${importedCount} employee${importedCount === 1 ? "" : "s"}.` : "",
      skippedCount > 0 ? `Skipped ${skippedCount} blank row${skippedCount === 1 ? "" : "s"}.` : "",
      unknownSchedules.size > 0 ? `Unknown shifts: ${[...unknownSchedules].slice(0, 3).join(", ")}.` : "",
      unknownCompetencies.size > 0
        ? `Unknown competencies: ${[...unknownCompetencies].slice(0, 3).join(", ")}.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");

    setStatusMessage(details || "CSV import completed.");
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
          <button type="button" className="ghost-button" onClick={() => csvInputRef.current?.click()}>
            Import CSV
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
        <input
          ref={csvInputRef}
          className="sr-only"
          type="file"
          accept=".csv,text/csv"
          onChange={handleCsvImport}
        />
        {statusMessage ? <p className="toolbar-status">{statusMessage}</p> : null}
      </div>

      <div className="personnel-table-wrap">
        <table className="personnel-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th className="column-shift">Shift</th>
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
                <td className="column-shift">
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
                <td colSpan={5}>
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
