"use client";

import type { ChangeEvent } from "react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { savePersonnel } from "@/app/actions";
import { formatEmployeeDisplayName } from "@/lib/employee-names";
import type { PersonnelUpdate, SavePersonnelInput, SchedulerSnapshot } from "@/lib/types";

/**
 * Personnel editor with inline row editing and CSV import.
 *
 * This screen is intentionally stateful because admins often stage multiple row
 * edits, imports, adds, and removals before committing everything in one save.
 */
type EditableEmployee = {
  id: string;
  name: string;
  role: string;
  scheduleId: string;
  competencyIds: string[];
};

type CsvImportRow = Record<string, string>;

type CsvPreviewRow = {
  key: string;
  name: string;
  role: string;
  shiftName: string;
  action: "Add" | "Update" | "Skip";
  notes: string[];
};

type PendingCsvImport = {
  employees: EditableEmployee[];
  deletedEmployeeIds: string[];
  rows: CsvPreviewRow[];
  summary: string;
};

/** Creates the unsaved row shown at the top of the table before add/save. */
function createDraftEmployee() {
  return {
    id: `emp-${crypto.randomUUID().slice(0, 8)}`,
    name: "",
    role: "",
    scheduleId: "",
    competencyIds: [],
  };
}

/** Normalizes CSV headers so import accepts a wide range of spreadsheet exports. */
function normalizeCsvHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Normalizes a human-readable lookup value while keeping spaces intact. */
function normalizeLookupValue(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Normalizes a lookup value into a compact punctuation-free token. */
function normalizeCompactLookupValue(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Generates several equivalent lookup keys so CSV imports are forgiving. */
function createLookupVariants(value: string) {
  const variants = new Set<string>();
  const normalized = normalizeLookupValue(value);
  const compact = normalizeCompactLookupValue(value);

  if (normalized) {
    variants.add(normalized);
  }

  if (compact) {
    variants.add(compact);
  }

  return variants;
}

/** Builds all schedule aliases that a CSV import is allowed to match. */
function createScheduleLookupKeys(schedule: SchedulerSnapshot["schedules"][number]) {
  const variants = new Set<string>();
  const idSuffix = schedule.id.replace(/^schedule-/, "");

  [schedule.id, schedule.name, idSuffix, `shift ${schedule.name}`, `shift ${idSuffix}`].forEach((value) => {
    for (const variant of createLookupVariants(value)) {
      variants.add(variant);
    }
  });

  return [...variants];
}

/** Builds the accepted aliases for a competency during CSV import matching. */
function createCompetencyLookupKeys(competency: SchedulerSnapshot["competencies"][number]) {
  const variants = new Set<string>();
  const numericCode = competency.code.match(/^\d+$/)?.[0] ?? "";

  [competency.id, competency.code, competency.label].forEach((value) => {
    for (const variant of createLookupVariants(value)) {
      variants.add(variant);
    }
  });

  if (numericCode) {
    [`post ${numericCode}`, `p${numericCode}`].forEach((value) => {
      for (const variant of createLookupVariants(value)) {
        variants.add(variant);
      }
    });
  }

  return [...variants];
}

/** Minimal CSV parser that supports quoted cells for spreadsheet imports. */
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

/** Returns the first non-empty CSV value from a set of possible header aliases. */
function pickCsvValue(row: CsvImportRow, aliases: string[]) {
  for (const alias of aliases) {
    const value = row[alias];

    if (value) {
      return value.trim();
    }
  }

  return "";
}

/** Splits a combined competency cell like `Lead|1|12` into separate values. */
function splitCompetencyValues(value: string) {
  return value
    .split(/[,;|/]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Interprets spreadsheet-style truthy cells in matrix competency imports. */
function isTruthyCsvCell(value: string) {
  const normalized = value.trim().toLowerCase();

  return normalized === "yes" || normalized === "y" || normalized === "true" || normalized === "1" || normalized === "x";
}

/** Deep-clones editable employees so baseline state can be restored safely. */
function cloneEmployees(employees: EditableEmployee[]) {
  return employees.map((employee) => ({
    ...employee,
    competencyIds: [...employee.competencyIds],
  }));
}

/** Normalizes UI row state into the payload expected by the save action. */
function normalizeEmployee(employee: EditableEmployee): PersonnelUpdate {
  return {
    employeeId: employee.id,
    name: employee.name.trim(),
    role: employee.role.trim(),
    scheduleId: employee.scheduleId,
    competencyIds: [...employee.competencyIds].sort(),
  };
}

/** Returns the required-field issues that block save/add for a row. */
function getEmployeeIssues(employee: EditableEmployee) {
  const issues: string[] = [];

  if (!employee.name.trim()) {
    issues.push("Name required");
  }

  if (!employee.role.trim()) {
    issues.push("Role required");
  }

  if (!employee.scheduleId) {
    issues.push("Shift required");
  }

  return issues;
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
          competencyIds: employee.competencyIds,
        })),
      ),
    [snapshot],
  );

  const [employees, setEmployees] = useState(initialEmployees);
  const [baselineEmployees, setBaselineEmployees] = useState(initialEmployees);
  const [deletedEmployeeIds, setDeletedEmployeeIds] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [search, setSearch] = useState("");
  const [selectedScheduleFilter, setSelectedScheduleFilter] = useState("all");
  const [selectedCompetencyFilter, setSelectedCompetencyFilter] = useState("all");
  const [pendingCsvImport, setPendingCsvImport] = useState<PendingCsvImport | null>(null);
  const [draftEmployee, setDraftEmployee] = useState<EditableEmployee | null>(null);
  const [isSaving, startSaveTransition] = useTransition();
  const defaultSchedule =
    [...snapshot.schedules]
      .sort((left, right) => left.employees.length - right.employees.length || left.name.localeCompare(right.name))[0] ??
    snapshot.schedules[0];

  const scheduleNameById = useMemo(
    () => Object.fromEntries(snapshot.schedules.map((schedule) => [schedule.id, schedule.name])),
    [snapshot.schedules],
  );
  const baselineMap = useMemo(
    () => new Map(baselineEmployees.map((employee) => [employee.id, normalizeEmployee(employee)])),
    [baselineEmployees],
  );
  const dirtyEmployeeIds = useMemo(
    () =>
      new Set(
        employees
          .map((employee) => normalizeEmployee(employee))
          .filter((employee) => JSON.stringify(baselineMap.get(employee.employeeId)) !== JSON.stringify(employee))
          .map((employee) => employee.employeeId),
      ),
    [baselineMap, employees],
  );
  const invalidEmployeeIds = useMemo(
    () =>
      new Set(
        employees
          .filter((employee) => getEmployeeIssues(employee).length > 0)
          .map((employee) => employee.id),
      ),
    [employees],
  );
  const scheduleIdByLookup = useMemo(() => {
    const entries = snapshot.schedules.flatMap((schedule) =>
      createScheduleLookupKeys(schedule).map((key) => [key, schedule.id] as const),
    );

    return new Map(entries);
  }, [snapshot.schedules]);
  const competencyIdByLookup = useMemo(() => {
    const entries = snapshot.competencies.flatMap((competency) =>
      createCompetencyLookupKeys(competency).map((key) => [key, competency.id] as const),
    );

    return new Map(entries);
  }, [snapshot.competencies]);
  const csvReservedColumns = useMemo(
    () =>
      new Set([
        "id",
        "employee_id",
        "personnel_id",
        "name",
        "full_name",
        "first_name",
        "last_name",
        "employee",
        "employee_name",
        "role",
        "role_title",
        "title",
        "position",
        "shift",
        "schedule",
        "shift_code",
        "schedule_code",
        "pattern",
        "competencies",
        "competency",
        "posts",
        "post",
        "skills",
        "qualifications",
      ]),
    [],
  );

  const dirtyUpdates = employees
    .map((employee) => normalizeEmployee(employee))
    .filter((employee) => JSON.stringify(baselineMap.get(employee.employeeId)) !== JSON.stringify(employee));
  const hasChanges = dirtyUpdates.length > 0 || deletedEmployeeIds.length > 0;

  useEffect(() => {
    setEmployees(cloneEmployees(initialEmployees));
    setBaselineEmployees(cloneEmployees(initialEmployees));
    setDeletedEmployeeIds([]);
    setStatusMessage("");
    setSearch("");
    setSelectedScheduleFilter("all");
    setSelectedCompetencyFilter("all");
    setPendingCsvImport(null);
    setDraftEmployee(null);
  }, [initialEmployees]);
  const hasValidationErrors = invalidEmployeeIds.size > 0;
  const draftEmployeeIssues = draftEmployee ? getEmployeeIssues(draftEmployee) : [];

  const visibleEmployees = useMemo(() => {
    const query = search.trim().toLowerCase();

    return [...employees]
      .filter((employee) => {
        if (selectedScheduleFilter !== "all" && employee.scheduleId !== selectedScheduleFilter) {
          return false;
        }

        if (
          selectedCompetencyFilter !== "all" &&
          !employee.competencyIds.includes(selectedCompetencyFilter)
        ) {
          return false;
        }

        if (!query) {
          return true;
        }

        return `${employee.name} ${employee.role} ${scheduleNameById[employee.scheduleId] ?? ""}`
          .toLowerCase()
          .includes(query);
      })
      .sort(
        (left, right) =>
          (scheduleNameById[left.scheduleId] ?? "").localeCompare(scheduleNameById[right.scheduleId] ?? "") ||
          left.name.localeCompare(right.name),
      );
  }, [employees, scheduleNameById, search, selectedCompetencyFilter, selectedScheduleFilter]);

  const groupedEmployees = useMemo(() => {
    return visibleEmployees.reduce<Array<{ type: "group"; label: string } | { type: "employee"; value: EditableEmployee }>>(
      (rows, employee, index) => {
        const currentScheduleName = scheduleNameById[employee.scheduleId] ?? "Unassigned";
        const previousScheduleName =
          index > 0 ? scheduleNameById[visibleEmployees[index - 1].scheduleId] ?? "Unassigned" : null;

        if (currentScheduleName !== previousScheduleName) {
          rows.push({ type: "group", label: currentScheduleName });
        }

        rows.push({ type: "employee", value: employee });
        return rows;
      },
      [],
    );
  }, [scheduleNameById, visibleEmployees]);

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
    if (hasValidationErrors) {
      setStatusMessage("Fix the highlighted personnel rows before saving.");
      return;
    }

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
    setPendingCsvImport(null);
    setDraftEmployee(null);
    setStatusMessage("Changes reverted.");
  }

  function handleAddEmployee() {
    if (!defaultSchedule) {
      setStatusMessage("Complete setup first.");
      return;
    }

    setDraftEmployee((current) => current ?? createDraftEmployee());
    setStatusMessage("");
  }

  function handleCreateEmployee() {
    if (!draftEmployee) {
      return;
    }

    const issues = getEmployeeIssues(draftEmployee);

    if (issues.length > 0) {
      setStatusMessage("Complete the new employee row before adding it.");
      return;
    }

    setEmployees((current) => [{ ...draftEmployee }, ...current]);
    setDraftEmployee(null);
    setStatusMessage("Employee added to the table. Save when you're ready.");
  }

  async function handleCsvImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!defaultSchedule) {
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
    const previewRows: CsvPreviewRow[] = [];
    const unknownSchedules = new Set<string>();
    const unknownCompetencies = new Set<string>();
    let importedCount = 0;
    let skippedCount = 0;

    for (const row of csvRows) {
      const csvId = pickCsvValue(row, ["id", "employee_id", "personnel_id"]);
      const csvName = pickCsvValue(row, ["name", "full_name", "employee", "employee_name"]);
      const csvFirstName = pickCsvValue(row, ["first_name", "first"]);
      const csvLastName = pickCsvValue(row, ["last_name", "last", "surname"]);
      const resolvedCsvName =
        csvName ||
        (csvFirstName || csvLastName
          ? formatEmployeeDisplayName({
              firstName: csvFirstName,
              lastName: csvLastName,
            })
          : "");
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
      const matrixCompetencyIds = Object.entries(row).flatMap(([header, value]) => {
        if (csvReservedColumns.has(header) || !isTruthyCsvCell(value)) {
          return [];
        }

        const competencyId = competencyIdByLookup.get(normalizeLookupValue(header));

        if (!competencyId) {
          unknownCompetencies.add(header);
          return [];
        }

        return competencyId;
      });

      if (!resolvedCsvName && !csvId) {
        skippedCount += 1;
        previewRows.push({
          key: `skip-${previewRows.length}`,
          name: "(blank row)",
          role: "",
          shiftName: "",
          action: "Skip",
          notes: ["Missing employee name or id"],
        });
        continue;
      }

      const matchedIndexById = csvId ? indexById.get(csvId) : undefined;
      const matchedIndexByName = resolvedCsvName ? indexByName.get(normalizeLookupValue(resolvedCsvName)) : undefined;
      const matchedIndex = matchedIndexById ?? matchedIndexByName;
      const existing = matchedIndex === undefined ? null : nextEmployees[matchedIndex];
      const resolvedScheduleId = csvShift
        ? scheduleIdByLookup.get(normalizeLookupValue(csvShift)) ?? ""
        : "";

      const notes: string[] = [];

      if (csvShift && !resolvedScheduleId) {
        unknownSchedules.add(csvShift);
        notes.push(`Unknown shift "${csvShift}"`);
      }

      const listedCompetencyIds = splitCompetencyValues(csvCompetencies).flatMap((value) => {
        const competencyId = competencyIdByLookup.get(normalizeLookupValue(value));

        if (!competencyId) {
          unknownCompetencies.add(value);
          return [];
        }

        return competencyId;
      });
      const resolvedCompetencyIds = [...new Set([...matrixCompetencyIds, ...listedCompetencyIds])];

      if ((csvCompetencies || matrixCompetencyIds.length > 0) && resolvedCompetencyIds.length === 0) {
        notes.push("No valid competencies matched");
      }

      const nextEmployee: EditableEmployee = {
        id: existing?.id ?? (csvId || `emp-${crypto.randomUUID().slice(0, 8)}`),
        name: resolvedCsvName || existing?.name || "New Employee",
        role: csvRole || existing?.role || "Operator",
        scheduleId: resolvedScheduleId || existing?.scheduleId || defaultSchedule.id,
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

      previewRows.push({
        key: nextEmployee.id,
        name: nextEmployee.name,
        role: nextEmployee.role,
        shiftName: scheduleNameById[nextEmployee.scheduleId] ?? nextEmployee.scheduleId,
        action: existing ? "Update" : "Add",
        notes,
      });
    }

    const details = [
      importedCount > 0 ? `${importedCount} row${importedCount === 1 ? "" : "s"} ready` : "",
      skippedCount > 0 ? `${skippedCount} skipped` : "",
      unknownSchedules.size > 0 ? `Unknown shifts: ${[...unknownSchedules].slice(0, 3).join(", ")}` : "",
      unknownCompetencies.size > 0
        ? `Unknown competencies: ${[...unknownCompetencies].slice(0, 3).join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join(" · ");

    setPendingCsvImport({
      employees: nextEmployees,
      deletedEmployeeIds: deletedEmployeeIds.filter((employeeId) => !restoredIds.has(employeeId)),
      rows: previewRows,
      summary: details || "CSV import ready to apply.",
    });
    setStatusMessage("Review the CSV preview, then apply it.");
  }

  function applyPendingImport() {
    if (!pendingCsvImport) {
      return;
    }

    setEmployees(pendingCsvImport.employees);
    setDeletedEmployeeIds(pendingCsvImport.deletedEmployeeIds);
    setStatusMessage(pendingCsvImport.summary);
    setPendingCsvImport(null);
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

      <div className="workspace-toolbar workspace-toolbar--personnel-page">
        <label className="field">
          <span>Search</span>
          <input
            type="search"
            placeholder="Enter employee name"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        <label className="field">
          <span>Shift</span>
          <select
            value={selectedScheduleFilter}
            onChange={(event) => setSelectedScheduleFilter(event.target.value)}
          >
            <option value="all">All shifts</option>
            {snapshot.schedules.map((schedule) => (
              <option key={schedule.id} value={schedule.id}>
                {schedule.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Competency</span>
          <select
            value={selectedCompetencyFilter}
            onChange={(event) => setSelectedCompetencyFilter(event.target.value)}
          >
            <option value="all">All competencies</option>
            {snapshot.competencies.map((competency) => (
              <option key={competency.id} value={competency.id}>
                {competency.code}
              </option>
            ))}
          </select>
        </label>

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
            disabled={isSaving || !hasChanges || hasValidationErrors}
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

        <div className="toolbar-status-wrap">
          {hasValidationErrors ? (
            <p className="toolbar-status">Fix highlighted rows before saving.</p>
          ) : statusMessage ? (
            <p className="toolbar-status">{statusMessage}</p>
          ) : null}
        </div>
      </div>

      {pendingCsvImport ? (
        <section className="import-preview">
          <div className="import-preview__header">
            <div>
              <strong>CSV Preview</strong>
              <p>{pendingCsvImport.summary}</p>
            </div>
            <div className="planner-actions">
              <button type="button" className="ghost-button" onClick={() => setPendingCsvImport(null)}>
                Cancel import
              </button>
              <button type="button" className="primary-button" onClick={applyPendingImport}>
                Apply import
              </button>
            </div>
          </div>
          <div className="import-preview__rows">
            {pendingCsvImport.rows.slice(0, 10).map((row) => (
              <div key={row.key} className="import-preview__row">
                <strong>{row.name}</strong>
                <span>{row.action}</span>
                <span>{row.shiftName || "No shift"}</span>
                <span>{row.notes.join(" · ") || row.role}</span>
              </div>
            ))}
            {pendingCsvImport.rows.length > 10 ? (
              <p className="toolbar-status">Showing 10 of {pendingCsvImport.rows.length} preview rows.</p>
            ) : null}
          </div>
        </section>
      ) : null}

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
            {draftEmployee ? (
              <tr className="table-row--draft">
                <td>
                  <input
                    className="table-input"
                    placeholder="Enter name"
                    value={draftEmployee.name}
                    onChange={(event) =>
                      setDraftEmployee((current) =>
                        current
                          ? {
                              ...current,
                              name: event.target.value,
                            }
                          : current,
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    className="table-input"
                    placeholder="Enter role"
                    value={draftEmployee.role}
                    onChange={(event) =>
                      setDraftEmployee((current) =>
                        current
                          ? {
                              ...current,
                              role: event.target.value,
                            }
                          : current,
                      )
                    }
                  />
                </td>
                <td className="column-shift">
                  <select
                    className="table-select"
                    value={draftEmployee.scheduleId}
                    onChange={(event) =>
                      setDraftEmployee((current) =>
                        current
                          ? {
                              ...current,
                              scheduleId: event.target.value,
                            }
                          : current,
                      )
                    }
                  >
                    <option value="">Select shift</option>
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
                      const isSelected = draftEmployee.competencyIds.includes(competency.id);

                      return (
                        <button
                          type="button"
                          key={competency.id}
                          onClick={() =>
                            setDraftEmployee((current) =>
                              current
                                ? {
                                    ...current,
                                    competencyIds: isSelected
                                      ? current.competencyIds.filter((id) => id !== competency.id)
                                      : [...current.competencyIds, competency.id],
                                  }
                                : current,
                            )
                          }
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
                <td>
                  <div className="table-actions-cell">
                    {draftEmployeeIssues.length > 0 ? (
                      <p className="row-issue">{draftEmployeeIssues.join(" · ")}</p>
                    ) : null}
                    <div className="table-actions-inline">
                      <button
                        type="button"
                        className="table-action"
                        onClick={() => setDraftEmployee(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="table-action table-action--confirm"
                        onClick={handleCreateEmployee}
                        disabled={draftEmployeeIssues.length > 0}
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            ) : null}
            {groupedEmployees.map((entry) =>
              entry.type === "group" ? (
                <tr key={`group-${entry.label}`} className="table-group-row">
                  <td colSpan={5}>{entry.label}</td>
                </tr>
              ) : (
                <tr
                  key={entry.value.id}
                  className={`${dirtyEmployeeIds.has(entry.value.id) ? "table-row--dirty" : ""} ${
                    invalidEmployeeIds.has(entry.value.id) ? "table-row--invalid" : ""
                  }`}
                >
                  <td>
                    <input
                      className="table-input"
                      value={entry.value.name}
                      onChange={(event) =>
                        updateEmployee(entry.value.id, (current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="table-input"
                      value={entry.value.role}
                      onChange={(event) =>
                        updateEmployee(entry.value.id, (current) => ({
                          ...current,
                          role: event.target.value,
                        }))
                      }
                    />
                  </td>
                  <td className="column-shift">
                    <select
                      className="table-select"
                      value={entry.value.scheduleId}
                      onChange={(event) =>
                        updateEmployee(entry.value.id, (current) => ({
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
                        const isSelected = entry.value.competencyIds.includes(competency.id);

                        return (
                          <button
                            type="button"
                            key={competency.id}
                            onClick={() => toggleCompetency(entry.value.id, competency.id)}
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
                  <td>
                    <div className="table-actions-cell">
                      {invalidEmployeeIds.has(entry.value.id) ? (
                        <p className="row-issue">{getEmployeeIssues(entry.value).join(" · ")}</p>
                      ) : null}
                      <button
                        type="button"
                        className="table-action table-action--danger"
                        onClick={() => handleRemoveEmployee(entry.value.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ),
            )}
            {groupedEmployees.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <div className="empty-state">
                    <strong>No employees matched that filter.</strong>
                    <span>Try a different search term, shift, or competency filter.</span>
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
