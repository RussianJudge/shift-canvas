"use client";

import type { ChangeEvent } from "react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";

import { savePersonnel } from "@/app/actions";
import { createAccountInvite, linkExistingAccountToEmployee } from "@/app/auth-actions";
import { formatEmployeeDisplayName, splitEmployeeDisplayName } from "@/lib/employee-names";
import type { AppRole, AppSession, PersonnelUpdate, SavePersonnelInput, SchedulerSnapshot } from "@/lib/types";

/**
 * Personnel editor with inline row editing and CSV import.
 *
 * This screen is intentionally stateful because admins often stage multiple row
 * edits, imports, adds, and removals before committing everything in one save.
 */
type EditableEmployee = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  /** Empty string means the employee is active but not assigned to a shift yet. */
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

type PendingAccountLink = {
  email: string;
  employeeId: string;
  employeeName: string;
  existingDisplayName: string;
  role: AppRole;
  firstName: string;
  lastName: string;
};

type CompetencyCleanupImpact = {
  id: string;
  type: "Primary schedule" | "Sub-schedule" | "Overtime claim";
  date: string;
  targetLabel: string;
  competencyLabel: string;
};

type PendingCompetencyRemoval = {
  employeeId: string;
  employeeName: string;
  competencyId: string;
  competencyLabel: string;
  impacts: CompetencyCleanupImpact[];
};

const PERSONNEL_AUTO_SAVE_DEBOUNCE_MS = 2500;

/** Creates the unsaved row shown at the top of the table before add/save. */
function createDraftEmployee() {
  return {
    id: `emp-${crypto.randomUUID().slice(0, 8)}`,
    firstName: "",
    lastName: "",
    email: "",
    role: "Operator",
    scheduleId: "",
    competencyIds: [],
  };
}

function formatShortDate(isoDate: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

function RemoveEmployeeModal({
  employeeName,
  onCancel,
  onConfirm,
}: {
  employeeName: string;
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
        aria-label="Remove employee confirmation"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="assignment-modal__header">
          <div>
            <span className="assignment-modal__eyebrow">Personnel</span>
            <h2 className="assignment-modal__title">Remove employee?</h2>
            <p className="assignment-modal__context">
              Remove {employeeName} from Personnel? This change will save automatically after confirmation.
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
            Remove employee
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function CompetencyCleanupWarningModal({
  removal,
  onCancel,
  onConfirm,
}: {
  removal: PendingCompetencyRemoval;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="assignment-modal-backdrop" onClick={onCancel}>
      <section
        className="assignment-modal personnel-cleanup-modal"
        aria-label="Removed competency cleanup warning"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="assignment-modal__header">
          <div>
            <span className="assignment-modal__eyebrow">Personnel</span>
            <h2 className="assignment-modal__title">Remove competency?</h2>
            <p className="assignment-modal__context">
              Removing {removal.competencyLabel} from {removal.employeeName} will delete the following saved
              shifts or overtime records.
            </p>
          </div>
          <button type="button" className="ghost-button" onClick={onCancel}>
            Close
          </button>
        </div>

        <div className="personnel-cleanup-modal__list">
          {removal.impacts.map((impact) => (
            <div key={impact.id} className="personnel-cleanup-modal__row">
              <div>
                <strong>{impact.type}</strong>
                <span>{impact.targetLabel}</span>
              </div>
              <div>
                <strong>{impact.competencyLabel}</strong>
                <span>{formatShortDate(impact.date)}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="assignment-modal__footer">
          <button type="button" className="ghost-button" onClick={onCancel}>
            Keep competency
          </button>
          <button type="button" className="table-action table-action--danger" onClick={onConfirm}>
            Remove and delete listed records
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function LinkExistingAccountModal({
  pendingLink,
  isSubmitting,
  onCancel,
  onConfirm,
}: {
  pendingLink: PendingAccountLink;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="assignment-modal-backdrop" onClick={isSubmitting ? undefined : onCancel}>
      <section
        className="assignment-modal mutual-modal"
        aria-label="Link existing account confirmation"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="assignment-modal__header">
          <div>
            <span className="assignment-modal__eyebrow">Personnel</span>
            <h2 className="assignment-modal__title">Link existing account?</h2>
            <p className="assignment-modal__context">
              {pendingLink.existingDisplayName || pendingLink.email} already has an account for {pendingLink.email}.
              Link that account to {pendingLink.employeeName} and assign the {pendingLink.role} role?
            </p>
          </div>
          <button type="button" className="ghost-button" onClick={onCancel} disabled={isSubmitting}>
            Close
          </button>
        </div>

        <div className="assignment-modal__footer">
          <button type="button" className="ghost-button" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={onConfirm} disabled={isSubmitting}>
            {isSubmitting ? "Linking..." : "Link account"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

/** Keeps UI sorting/search/display consistent while the editor stores split names. */
function getEditableEmployeeDisplayName(employee: Pick<EditableEmployee, "firstName" | "lastName">) {
  return formatEmployeeDisplayName({
    firstName: employee.firstName,
    lastName: employee.lastName,
  });
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

/** Accept both `Last, First` and `First Last` when matching people during imports. */
function createEmployeeLookupKeys(employee: Pick<EditableEmployee, "firstName" | "lastName">) {
  const variants = new Set<string>();
  const displayName = getEditableEmployeeDisplayName(employee);
  const naturalName = `${employee.firstName} ${employee.lastName}`.trim();

  [displayName, naturalName].forEach((value) => {
    for (const variant of createLookupVariants(value)) {
      variants.add(variant);
    }
  });

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
    firstName: employee.firstName.trim(),
    lastName: employee.lastName.trim(),
    email: employee.email.trim().toLowerCase(),
    role: employee.role.trim() || "Operator",
    scheduleId: employee.scheduleId,
    competencyIds: [...employee.competencyIds].sort(),
  };
}

type EmployeeFieldIssues = {
  firstName?: string;
  lastName?: string;
  email?: string;
  scheduleId?: string;
};

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Returns column-specific validation messages so each warning can sit under its input. */
function getEmployeeFieldIssues(employee: EditableEmployee): EmployeeFieldIssues {
  const issues: EmployeeFieldIssues = {};

  if (!employee.firstName.trim()) {
    issues.firstName = "First name required";
  }

  if (!employee.lastName.trim()) {
    issues.lastName = "Last name required";
  }

  if (!employee.email.trim()) {
    issues.email = "Email required";
  } else if (!isValidEmail(employee.email)) {
    issues.email = "Enter a valid email";
  }

  return issues;
}

/** Flattens field-level validation back into a simple list for save gating logic. */
function getEmployeeIssues(employee: EditableEmployee) {
  return Object.values(getEmployeeFieldIssues(employee));
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 8.25a3.75 3.75 0 1 1 0 7.5a3.75 3.75 0 0 1 0-7.5Z" />
      <path d="M19.5 12a7.46 7.46 0 0 0-.15-1.5l2.1-1.62l-2-3.46l-2.48 1a7.6 7.6 0 0 0-2.6-1.5L14 2.25h-4l-.38 2.67a7.6 7.6 0 0 0-2.6 1.5l-2.48-1l-2 3.46l2.1 1.62a7.4 7.4 0 0 0 0 3l-2.1 1.62l2 3.46l2.48-1a7.6 7.6 0 0 0 2.6 1.5l.38 2.67h4l.38-2.67a7.6 7.6 0 0 0 2.6-1.5l2.48 1l2-3.46l-2.1-1.62c.1-.49.15-.99.15-1.5Z" />
    </svg>
  );
}

function EmployeeSettingsModal({
  employee,
  emailIssue,
  inviteRole,
  canInviteElevatedRoles,
  inviteLink,
  statusMessage,
  isBusy,
  onEmailChange,
  onInviteRoleChange,
  onSendInvite,
  onCopyLink,
  onRemove,
  onClose,
}: {
  employee: EditableEmployee;
  emailIssue?: string;
  inviteRole: AppRole;
  canInviteElevatedRoles: boolean;
  inviteLink: string;
  statusMessage: string;
  isBusy: boolean;
  onEmailChange: (next: string) => void;
  onInviteRoleChange: (next: AppRole) => void;
  onSendInvite: () => void;
  onCopyLink: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  return createPortal(
    <div className="assignment-modal-backdrop" onClick={isBusy ? undefined : onClose}>
      <section className="assignment-modal mutual-modal" onClick={(event) => event.stopPropagation()}>
        <div className="assignment-modal__header">
          <div>
            <span className="assignment-modal__eyebrow">Personnel</span>
            <h2 className="assignment-modal__title">{getEditableEmployeeDisplayName(employee)}</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onClose} disabled={isBusy}>
            Close
          </button>
        </div>

        <div className="modal-form-grid">
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={employee.email}
              placeholder="email@company.com"
              disabled={isBusy}
              onChange={(event) => onEmailChange(event.target.value)}
            />
            {emailIssue ? <p className="row-issue">{emailIssue}</p> : null}
          </label>

          <label className="field">
            <span>Invite as</span>
            <select
              value={inviteRole}
              disabled={isBusy || !canInviteElevatedRoles}
              onChange={(event) => onInviteRoleChange(event.target.value as AppRole)}
            >
              <option value="worker">Worker</option>
              {canInviteElevatedRoles ? <option value="leader">Leader</option> : null}
              {canInviteElevatedRoles ? <option value="admin">Admin</option> : null}
            </select>
          </label>
        </div>

        <div className="assignment-modal__footer">
          <button
            type="button"
            className="ghost-button"
            onClick={onSendInvite}
            disabled={isBusy || !employee.email.trim() || Boolean(emailIssue)}
          >
            {isBusy ? "Working..." : inviteLink ? "Resend sign-up link" : "Send sign-up link"}
          </button>
          {inviteLink ? (
            <button type="button" className="ghost-button" onClick={onCopyLink} disabled={isBusy}>
              Copy link
            </button>
          ) : null}
        </div>

        {inviteLink ? (
          <label className="field invite-builder__link">
            <span>Sign-up link</span>
            <input readOnly value={inviteLink} onFocus={(event) => event.currentTarget.select()} />
          </label>
        ) : null}

        {statusMessage ? <p className="toolbar-status">{statusMessage}</p> : null}

        <div className="assignment-modal__danger-zone">
          <div>
            <strong>Remove employee</strong>
            <span>Removes {getEditableEmployeeDisplayName(employee)} from Personnel.</span>
          </div>
          <button
            type="button"
            className="table-action table-action--danger"
            onClick={onRemove}
            disabled={isBusy}
          >
            Remove
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function AddEmployeeModal({
  employee,
  fieldIssues,
  schedules,
  sendInvite,
  inviteRole,
  canInviteElevatedRoles,
  isSaving,
  onChange,
  onSendInviteChange,
  onInviteRoleChange,
  onClose,
  onSubmit,
}: {
  employee: EditableEmployee;
  fieldIssues: EmployeeFieldIssues;
  schedules: SchedulerSnapshot["schedules"];
  sendInvite: boolean;
  inviteRole: AppRole;
  canInviteElevatedRoles: boolean;
  isSaving: boolean;
  onChange: (updater: (employee: EditableEmployee) => EditableEmployee) => void;
  onSendInviteChange: (next: boolean) => void;
  onInviteRoleChange: (next: AppRole) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const issues = Object.values(fieldIssues).filter(Boolean);

  return createPortal(
    <div className="assignment-modal-backdrop" onClick={onClose}>
      <section className="assignment-modal mutual-modal" onClick={(event) => event.stopPropagation()}>
        <div className="assignment-modal__header">
          <div>
            <span className="assignment-modal__eyebrow">Personnel</span>
            <h2 className="assignment-modal__title">Add an employee</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onClose} disabled={isSaving}>
            Close
          </button>
        </div>

        <div className="modal-form-grid">
          <label className="field">
            <span>First name</span>
            <input
              value={employee.firstName}
              disabled={isSaving}
              onChange={(event) => onChange((current) => ({ ...current, firstName: event.target.value }))}
            />
            {fieldIssues.firstName ? <p className="row-issue">{fieldIssues.firstName}</p> : null}
          </label>

          <label className="field">
            <span>Last name</span>
            <input
              value={employee.lastName}
              disabled={isSaving}
              onChange={(event) => onChange((current) => ({ ...current, lastName: event.target.value }))}
            />
            {fieldIssues.lastName ? <p className="row-issue">{fieldIssues.lastName}</p> : null}
          </label>

          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={employee.email}
              disabled={isSaving}
              onChange={(event) => onChange((current) => ({ ...current, email: event.target.value }))}
            />
            {fieldIssues.email ? <p className="row-issue">{fieldIssues.email}</p> : null}
          </label>

          <label className="field">
            <span>Role title</span>
            <input
              value={employee.role}
              placeholder="Operator"
              disabled={isSaving}
              onChange={(event) => onChange((current) => ({ ...current, role: event.target.value }))}
            />
          </label>

          <label className="field">
            <span>Shift</span>
            <select
              value={employee.scheduleId}
              disabled={isSaving}
              onChange={(event) => onChange((current) => ({ ...current, scheduleId: event.target.value }))}
            >
              <option value="">Unassigned</option>
              {schedules.map((schedule) => (
                <option key={schedule.id} value={schedule.id}>
                  {schedule.name}
                </option>
              ))}
            </select>
            {fieldIssues.scheduleId ? <p className="row-issue">{fieldIssues.scheduleId}</p> : null}
          </label>

          <label className="subschedule-status-toggle">
            <input
              type="checkbox"
              checked={sendInvite}
              disabled={isSaving}
              onChange={(event) => onSendInviteChange(event.target.checked)}
            />
            <span>Send an account invite to this email</span>
          </label>

          {sendInvite ? (
            <label className="field">
              <span>Invite as</span>
              <select
                value={inviteRole}
                disabled={isSaving || !canInviteElevatedRoles}
                onChange={(event) => onInviteRoleChange(event.target.value as AppRole)}
              >
                <option value="worker">Worker</option>
                {canInviteElevatedRoles ? <option value="leader">Leader</option> : null}
                {canInviteElevatedRoles ? <option value="admin">Admin</option> : null}
              </select>
            </label>
          ) : null}
        </div>

        {issues.length > 0 ? <p className="toolbar-status">{issues[0]}</p> : null}

        <div className="assignment-modal__footer">
          <button type="button" className="ghost-button" onClick={onClose} disabled={isSaving}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={onSubmit}
            disabled={isSaving || issues.length > 0}
          >
            {isSaving ? "Saving..." : sendInvite ? "Add and invite" : "Add employee"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export function PersonnelPanel({
  snapshot,
  viewer,
}: {
  snapshot: SchedulerSnapshot;
  viewer: AppSession;
}) {
  const csvInputRef = useRef<HTMLInputElement>(null);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const lastPersonnelSaveSignatureRef = useRef("");
  const initialEmployees = useMemo<EditableEmployee[]>(
    () =>
      [
        ...snapshot.schedules.flatMap((schedule) =>
          schedule.employees.map((employee) => ({
            id: employee.id,
            firstName: employee.firstName,
            lastName: employee.lastName,
            email: employee.email ?? "",
            role: employee.role || "Operator",
            scheduleId: employee.scheduleId,
            competencyIds: employee.competencyIds,
          })),
        ),
        ...(snapshot.unassignedEmployees ?? []).map((employee) => ({
          id: employee.id,
          firstName: employee.firstName,
          lastName: employee.lastName,
          email: employee.email ?? "",
          role: employee.role || "Operator",
          scheduleId: "",
          competencyIds: employee.competencyIds,
        })),
      ],
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
  const [sendInviteOnAdd, setSendInviteOnAdd] = useState(true);
  const [inviteRoleOnAdd, setInviteRoleOnAdd] = useState<AppRole>("worker");
  const [pendingRemoveEmployeeId, setPendingRemoveEmployeeId] = useState<string | null>(null);
  const [settingsEmployeeId, setSettingsEmployeeId] = useState<string | null>(null);
  const [settingsInviteRole, setSettingsInviteRole] = useState<AppRole>("worker");
  const [settingsInviteLink, setSettingsInviteLink] = useState("");
  const [settingsStatusMessage, setSettingsStatusMessage] = useState("");
  const [pendingCompetencyRemoval, setPendingCompetencyRemoval] = useState<PendingCompetencyRemoval | null>(null);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [pendingAccountLink, setPendingAccountLink] = useState<PendingAccountLink | null>(null);
  const [isSaving, startSaveTransition] = useTransition();
  const [isLinkingExistingAccount, startLinkAccountTransition] = useTransition();
  const canInviteAdmin = viewer.role === "admin";
  const scheduleNameById = useMemo(
    () => Object.fromEntries(snapshot.schedules.map((schedule) => [schedule.id, schedule.name])),
    [snapshot.schedules],
  );
  const subScheduleNameById = useMemo(
    () => Object.fromEntries(snapshot.subSchedules.map((subSchedule) => [subSchedule.id, subSchedule.name])),
    [snapshot.subSchedules],
  );
  const competencyLabelById = useMemo(
    () =>
      Object.fromEntries(
        snapshot.competencies.map((competency) => [
          competency.id,
          `${competency.code}${competency.label && competency.label !== competency.code ? ` · ${competency.label}` : ""}`,
        ]),
      ),
    [snapshot.competencies],
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
        "email",
        "email_address",
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

  const dirtyUpdates = useMemo(
    () =>
      employees
        .map((employee) => normalizeEmployee(employee))
        .filter((employee) => JSON.stringify(baselineMap.get(employee.employeeId)) !== JSON.stringify(employee)),
    [baselineMap, employees],
  );
  const hasChanges = dirtyUpdates.length > 0 || deletedEmployeeIds.length > 0;
  const personnelSaveSignature = useMemo(
    () => JSON.stringify({ updates: dirtyUpdates, deletedEmployeeIds }),
    [deletedEmployeeIds, dirtyUpdates],
  );

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
    setPendingRemoveEmployeeId(null);
    setPendingCompetencyRemoval(null);
    setShowActionsMenu(false);
    setPendingAccountLink(null);
    lastPersonnelSaveSignatureRef.current = "";
  }, [initialEmployees]);


  useEffect(() => {
    if (!showActionsMenu) {
      return undefined;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!actionsMenuRef.current?.contains(event.target as Node)) {
        setShowActionsMenu(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setShowActionsMenu(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [showActionsMenu]);

  const hasValidationErrors = invalidEmployeeIds.size > 0;
  const draftEmployeeFieldIssues = draftEmployee ? getEmployeeFieldIssues(draftEmployee) : {};
  const settingsEmployee = settingsEmployeeId
    ? employees.find((employee) => employee.id === settingsEmployeeId) ?? null
    : null;
  const pendingRemoveEmployee = pendingRemoveEmployeeId
    ? employees.find((employee) => employee.id === pendingRemoveEmployeeId) ?? null
    : null;

  const visibleEmployees = useMemo(() => {
    const query = search.trim().toLowerCase();

    return [...employees]
      .filter((employee) => {
        if (
          selectedScheduleFilter !== "all" &&
          (selectedScheduleFilter === "unassigned" ? employee.scheduleId : employee.scheduleId !== selectedScheduleFilter)
        ) {
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

        return `${employee.firstName} ${employee.lastName} ${getEditableEmployeeDisplayName(employee)} ${employee.email} ${employee.role} ${scheduleNameById[employee.scheduleId] ?? ""}`
          .toLowerCase()
          .includes(query);
      })
      .sort(
        (left, right) =>
          (scheduleNameById[left.scheduleId] ?? "").localeCompare(scheduleNameById[right.scheduleId] ?? "") ||
          left.lastName.localeCompare(right.lastName) ||
          left.firstName.localeCompare(right.firstName),
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

  function getCompetencyRemovalImpacts(employeeId: string, competencyId: string) {
    const competencyLabel = competencyLabelById[competencyId] ?? "Removed competency";
    const mainScheduleImpacts = snapshot.assignments
      .filter((assignment) => assignment.employeeId === employeeId && assignment.competencyId === competencyId)
      .map<CompetencyCleanupImpact>((assignment) => ({
        id: `main:${assignment.scheduleId}:${assignment.date}:${assignment.competencyId}`,
        type: "Primary schedule",
        date: assignment.date,
        targetLabel: assignment.scheduleId ? `Shift ${scheduleNameById[assignment.scheduleId] ?? assignment.scheduleId}` : "Main schedule",
        competencyLabel,
      }));
    const subScheduleImpacts = snapshot.subScheduleAssignments
      .filter((assignment) => assignment.employeeId === employeeId && assignment.competencyId === competencyId)
      .map<CompetencyCleanupImpact>((assignment) => ({
        id: `sub:${assignment.subScheduleId}:${assignment.date}:${assignment.competencyId}`,
        type: "Sub-schedule",
        date: assignment.date,
        targetLabel: subScheduleNameById[assignment.subScheduleId] ?? "Sub-schedule",
        competencyLabel,
      }));
    const overtimeImpacts = snapshot.overtimeClaims
      .filter((claim) => claim.employeeId === employeeId && claim.competencyId === competencyId)
      .map<CompetencyCleanupImpact>((claim) => ({
        id: `ot:${claim.id}`,
        type: "Overtime claim",
        date: claim.date,
        targetLabel: claim.subScheduleId
          ? subScheduleNameById[claim.subScheduleId] ?? "Sub-schedule"
          : claim.scheduleId
            ? `Shift ${scheduleNameById[claim.scheduleId] ?? claim.scheduleId}`
            : "Overtime",
        competencyLabel,
      }));

    return [...mainScheduleImpacts, ...subScheduleImpacts, ...overtimeImpacts].sort(
      (left, right) => left.date.localeCompare(right.date) || left.type.localeCompare(right.type),
    );
  }

  function toggleCompetency(employeeId: string, competencyId: string) {
    const employee = employees.find((entry) => entry.id === employeeId);

    if (!employee) {
      return;
    }

    const isSelected = employee.competencyIds.includes(competencyId);

    if (isSelected) {
      const impacts = getCompetencyRemovalImpacts(employeeId, competencyId);

      if (impacts.length > 0) {
        setPendingCompetencyRemoval({
          employeeId,
          employeeName: getEditableEmployeeDisplayName(employee),
          competencyId,
          competencyLabel: competencyLabelById[competencyId] ?? "Removed competency",
          impacts,
        });
        return;
      }
    }

    updateEmployee(employeeId, (current) => ({
      ...current,
      competencyIds: isSelected
        ? current.competencyIds.filter((id) => id !== competencyId)
        : [...current.competencyIds, competencyId],
    }));
  }

  function confirmCompetencyRemoval() {
    if (!pendingCompetencyRemoval) {
      return;
    }

    const { employeeId, competencyId } = pendingCompetencyRemoval;

    setPendingCompetencyRemoval(null);
    updateEmployee(employeeId, (employee) => ({
      ...employee,
      competencyIds: employee.competencyIds.filter((id) => id !== competencyId),
    }));
  }

  useEffect(() => {
    if (!hasChanges) {
      return;
    }

    if (
      hasValidationErrors ||
      isSaving ||
      personnelSaveSignature === lastPersonnelSaveSignatureRef.current
    ) {
      return;
    }

    const employeeSnapshot = cloneEmployees(employees);
    const updates = dirtyUpdates;
    const employeeIdsToDelete = [...deletedEmployeeIds];
    const signature = personnelSaveSignature;

    const timer = window.setTimeout(() => {
      lastPersonnelSaveSignatureRef.current = signature;
      setStatusMessage("Saving personnel changes automatically...");

      startSaveTransition(async () => {
        const result = await savePersonnel({
          updates,
          deletedEmployeeIds: employeeIdsToDelete,
        } as SavePersonnelInput);

        setStatusMessage(result.ok ? "Personnel changes saved automatically." : result.message);

        if (result.ok) {
          setBaselineEmployees(employeeSnapshot);
          setDeletedEmployeeIds([]);
        } else {
          lastPersonnelSaveSignatureRef.current = "";
        }
      });
    }, PERSONNEL_AUTO_SAVE_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [
    deletedEmployeeIds,
    dirtyUpdates,
    employees,
    hasChanges,
    hasValidationErrors,
    isSaving,
    personnelSaveSignature,
    startSaveTransition,
  ]);

  function handleAddEmployee() {
    setShowActionsMenu(false);
    setDraftEmployee((current) => current ?? createDraftEmployee());
    setStatusMessage("");
  }

  /**
   * Saves the employee before inviting rather than letting autosave get to it.
   * `createAccountInvite` resolves the employee row by id and refuses when it
   * is missing, so the invite cannot be fired until the insert has landed.
   */
  function handleCreateEmployee() {
    if (!draftEmployee) {
      return;
    }

    const issues = getEmployeeIssues(draftEmployee);

    if (issues.length > 0) {
      setStatusMessage("Complete the new employee before adding them.");
      return;
    }

    const newEmployee = { ...draftEmployee };
    const shouldInvite = sendInviteOnAdd;
    const inviteRole = inviteRoleOnAdd;

    startSaveTransition(async () => {
      const saveResult = await savePersonnel({
        updates: [normalizeEmployee(newEmployee)],
        deletedEmployeeIds: [],
      } as SavePersonnelInput);

      if (!saveResult.ok) {
        setStatusMessage(saveResult.message);
        return;
      }

      setEmployees((current) => [{ ...newEmployee }, ...current]);
      setBaselineEmployees((current) => [{ ...newEmployee }, ...current]);
      setDraftEmployee(null);

      if (!shouldInvite) {
        setStatusMessage("Employee added.");
        return;
      }

      const inviteResult = await createAccountInvite({
        email: newEmployee.email,
        firstName: newEmployee.firstName,
        lastName: newEmployee.lastName,
        role: inviteRole,
        employeeId: newEmployee.id,
      });

      /**
       * An account already exists on that address, so it has to be linked to the
       * new employee rather than invited again.
       */
      if (
        !inviteResult.ok &&
        "requiresAccountLink" in inviteResult &&
        inviteResult.requiresAccountLink
      ) {
        setPendingAccountLink({
          email: newEmployee.email.trim().toLowerCase(),
          employeeId: newEmployee.id,
          employeeName: getEditableEmployeeDisplayName(newEmployee),
          existingDisplayName:
            ("existingDisplayName" in inviteResult && inviteResult.existingDisplayName) ||
            newEmployee.email.trim().toLowerCase(),
          role: inviteRole,
          firstName: newEmployee.firstName,
          lastName: newEmployee.lastName,
        });
        setStatusMessage("Employee added. An account already uses that email — link it to continue.");
        return;
      }

      setStatusMessage(
        inviteResult.ok
          ? "Employee added and account invite sent."
          : `Employee added, but the invite could not be sent: ${inviteResult.message}`,
      );
    });
  }

  async function handleCsvImport(event: ChangeEvent<HTMLInputElement>) {
    setShowActionsMenu(false);
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
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
      nextEmployees.flatMap((employee, index) =>
        createEmployeeLookupKeys(employee).map((key) => [key, index] as const),
      ),
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
      const csvEmail = pickCsvValue(row, ["email", "email_address"]);
      const resolvedCsvName =
        csvName ||
        (csvFirstName || csvLastName
          ? formatEmployeeDisplayName({
              firstName: csvFirstName,
              lastName: csvLastName,
            })
          : "");
      const resolvedCsvNameParts = resolvedCsvName
        ? splitEmployeeDisplayName(resolvedCsvName)
        : {
            firstName: "",
            lastName: "",
          };
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
      const existingNameMatchIndex =
        resolvedCsvName
          ? createEmployeeLookupKeys(resolvedCsvNameParts)
              .map((key) => indexByName.get(key))
              .find((index): index is number => index !== undefined)
          : undefined;
      const matchedIndex = matchedIndexById ?? existingNameMatchIndex;
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
        firstName: resolvedCsvNameParts.firstName || existing?.firstName || "New",
        lastName: resolvedCsvNameParts.lastName || existing?.lastName || "Employee",
        email: csvEmail.toLowerCase() || existing?.email || "",
        role: csvRole || existing?.role || "Operator",
        scheduleId: resolvedScheduleId || existing?.scheduleId || "",
        competencyIds:
          resolvedCompetencyIds.length > 0
            ? [...new Set(resolvedCompetencyIds)]
            : existing?.competencyIds ?? [],
      };

      if (matchedIndex === undefined) {
        nextEmployees.push(nextEmployee);
        const nextIndex = nextEmployees.length - 1;
        indexById.set(nextEmployee.id, nextIndex);
        createEmployeeLookupKeys(nextEmployee).forEach((key) => indexByName.set(key, nextIndex));
      } else {
        nextEmployees[matchedIndex] = nextEmployee;
        indexById.set(nextEmployee.id, matchedIndex);
        createEmployeeLookupKeys(nextEmployee).forEach((key) => indexByName.set(key, matchedIndex));
      }

      restoredIds.add(nextEmployee.id);
      importedCount += 1;

      previewRows.push({
        key: nextEmployee.id,
        name: getEditableEmployeeDisplayName(nextEmployee),
        role: nextEmployee.role,
        shiftName: scheduleNameById[nextEmployee.scheduleId] ?? "No shift assigned",
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

  /**
   * The employee has to exist in the database before an invite can reference it,
   * so a freshly typed email is saved first rather than left to autosave.
   */
  function handleSendSettingsInvite(employee: EditableEmployee) {
    startSaveTransition(async () => {
      setSettingsStatusMessage("");

      if (JSON.stringify(baselineMap.get(employee.id)) !== JSON.stringify(normalizeEmployee(employee))) {
        const saveResult = await savePersonnel({
          updates: [normalizeEmployee(employee)],
          deletedEmployeeIds: [],
        } as SavePersonnelInput);

        if (!saveResult.ok) {
          setSettingsStatusMessage(saveResult.message);
          return;
        }

        setBaselineEmployees((current) =>
          current.map((entry) => (entry.id === employee.id ? { ...employee } : entry)),
        );
      }

      const result = await createAccountInvite({
        email: employee.email,
        firstName: employee.firstName,
        lastName: employee.lastName,
        role: settingsInviteRole,
        employeeId: employee.id,
      });

      if (!result.ok && "requiresAccountLink" in result && result.requiresAccountLink) {
        setPendingAccountLink({
          email: employee.email.trim().toLowerCase(),
          employeeId: employee.id,
          employeeName: getEditableEmployeeDisplayName(employee),
          existingDisplayName:
            ("existingDisplayName" in result && result.existingDisplayName) || employee.email.trim().toLowerCase(),
          role: settingsInviteRole,
          firstName: employee.firstName,
          lastName: employee.lastName,
        });
        setSettingsEmployeeId(null);
        setStatusMessage("An account already uses that email — link it to continue.");
        return;
      }

      setSettingsStatusMessage(result.message);
      setSettingsInviteLink(result.ok && "inviteUrl" in result && result.inviteUrl ? result.inviteUrl : "");
    });
  }

  async function handleCopySettingsInviteLink() {
    if (!settingsInviteLink) {
      return;
    }

    try {
      await navigator.clipboard.writeText(settingsInviteLink);
      setSettingsStatusMessage("Sign-up link copied to clipboard.");
    } catch {
      setSettingsStatusMessage("Could not copy automatically. Select the link and copy it manually.");
    }
  }

  function handleConfirmRemoveEmployee() {
    if (!pendingRemoveEmployee) {
      setPendingRemoveEmployeeId(null);
      return;
    }

    const employeeId = pendingRemoveEmployee.id;
    const employeeName = getEditableEmployeeDisplayName(pendingRemoveEmployee);

    setEmployees((current) => current.filter((employee) => employee.id !== employeeId));

    if (baselineMap.has(employeeId)) {
      setDeletedEmployeeIds((current) => [...current, employeeId]);
    }

    setPendingRemoveEmployeeId(null);
    setStatusMessage(`${employeeName} removed. Autosave will run shortly.`);
  }

  function handleConfirmLinkExistingAccount() {
    if (!pendingAccountLink) {
      return;
    }

    startLinkAccountTransition(async () => {
      const result = await linkExistingAccountToEmployee({
        email: pendingAccountLink.email,
        firstName: pendingAccountLink.firstName,
        lastName: pendingAccountLink.lastName,
        role: pendingAccountLink.role,
        employeeId: pendingAccountLink.employeeId,
      });

      setStatusMessage(result.message);

      if (result.ok) {
        setPendingAccountLink(null);
      }
    });
  }


  return (
    <>
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
            <option value="unassigned">Unassigned</option>
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

        <div className="planner-actions personnel-toolbar-actions">
          <div className="personnel-actions-menu" ref={actionsMenuRef}>
            <button
              type="button"
              className="ghost-button"
              aria-haspopup="menu"
              aria-expanded={showActionsMenu}
              onClick={() => setShowActionsMenu((current) => !current)}
            >
              Actions
            </button>
            {showActionsMenu ? (
              <div className="personnel-actions-menu__panel" role="menu" aria-label="Personnel actions">
                <button
                  type="button"
                  className="ghost-button personnel-actions-menu__item"
                  onClick={handleAddEmployee}
                >
                  Add employee
                </button>
                <button
                  type="button"
                  className="ghost-button personnel-actions-menu__item"
                  onClick={() => {
                    setShowActionsMenu(false);
                    csvInputRef.current?.click();
                  }}
                >
                  Import CSV
                </button>
              </div>
            ) : null}
          </div>
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
            <p className="toolbar-status">Fix highlighted rows before autosave can continue.</p>
          ) : isSaving ? (
            <p className="toolbar-status">Saving personnel changes automatically...</p>
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
              <th className="column-name">First Name</th>
              <th className="column-name">Last Name</th>
              <th className="column-shift">Shift</th>
              <th className="column-competencies">Competencies</th>
              <th className="column-actions" />
            </tr>
          </thead>
          <tbody>
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
                  {(() => {
                    const fieldIssues = getEmployeeFieldIssues(entry.value);

                    return (
                      <>
                  <td className="column-name">
                    <div className="table-input-stack">
                      <input
                        className="table-input"
                        value={entry.value.firstName}
                        onChange={(event) =>
                          updateEmployee(entry.value.id, (current) => ({
                            ...current,
                            firstName: event.target.value,
                          }))
                        }
                      />
                      {fieldIssues.firstName ? <p className="row-issue">{fieldIssues.firstName}</p> : null}
                    </div>
                  </td>
                  <td className="column-name">
                    <div className="table-input-stack">
                      <input
                        className="table-input"
                        value={entry.value.lastName}
                        onChange={(event) =>
                          updateEmployee(entry.value.id, (current) => ({
                            ...current,
                            lastName: event.target.value,
                          }))
                        }
                      />
                      {fieldIssues.lastName ? <p className="row-issue">{fieldIssues.lastName}</p> : null}
                    </div>
                  </td>
                  <td className="column-shift">
                    <div className="table-input-stack">
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
                        <option value="">No shift assigned</option>
                        {snapshot.schedules.map((schedule) => (
                          <option key={schedule.id} value={schedule.id}>
                            {schedule.name}
                          </option>
                        ))}
                      </select>
                      {fieldIssues.scheduleId ? <p className="row-issue">{fieldIssues.scheduleId}</p> : null}
                    </div>
                  </td>
                  <td className="column-competencies">
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
                  <td className="column-actions">
                    <div className="table-actions-cell">
                      {canInviteAdmin ? (
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Settings for ${getEditableEmployeeDisplayName(entry.value)}`}
                          title="Employee settings"
                          onClick={() => setSettingsEmployeeId(entry.value.id)}
                        >
                          <SettingsIcon />
                        </button>
                      ) : null}
                    </div>
                  </td>
                      </>
                    );
                  })()}
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

    {draftEmployee ? (
      <AddEmployeeModal
        employee={draftEmployee}
        fieldIssues={draftEmployeeFieldIssues}
        schedules={snapshot.schedules}
        sendInvite={sendInviteOnAdd}
        inviteRole={inviteRoleOnAdd}
        canInviteElevatedRoles={canInviteAdmin}
        isSaving={isSaving}
        onChange={(updater) => setDraftEmployee((current) => (current ? updater(current) : current))}
        onSendInviteChange={setSendInviteOnAdd}
        onInviteRoleChange={setInviteRoleOnAdd}
        onClose={() => setDraftEmployee(null)}
        onSubmit={handleCreateEmployee}
      />
    ) : null}
    {settingsEmployee ? (
      <EmployeeSettingsModal
        employee={settingsEmployee}
        emailIssue={getEmployeeFieldIssues(settingsEmployee).email}
        inviteRole={settingsInviteRole}
        canInviteElevatedRoles={canInviteAdmin}
        inviteLink={settingsInviteLink}
        statusMessage={settingsStatusMessage}
        isBusy={isSaving}
        onEmailChange={(next) =>
          updateEmployee(settingsEmployee.id, (current) => ({ ...current, email: next }))
        }
        onInviteRoleChange={setSettingsInviteRole}
        onSendInvite={() => handleSendSettingsInvite(settingsEmployee)}
        onCopyLink={handleCopySettingsInviteLink}
        onRemove={() => {
          setSettingsEmployeeId(null);
          setPendingRemoveEmployeeId(settingsEmployee.id);
        }}
        onClose={() => {
          setSettingsEmployeeId(null);
          setSettingsInviteLink("");
          setSettingsStatusMessage("");
        }}
      />
    ) : null}
    {pendingRemoveEmployee ? (
      <RemoveEmployeeModal
        employeeName={getEditableEmployeeDisplayName(pendingRemoveEmployee)}
        onCancel={() => setPendingRemoveEmployeeId(null)}
        onConfirm={handleConfirmRemoveEmployee}
      />
    ) : null}
    {pendingCompetencyRemoval ? (
      <CompetencyCleanupWarningModal
        removal={pendingCompetencyRemoval}
        onCancel={() => setPendingCompetencyRemoval(null)}
        onConfirm={confirmCompetencyRemoval}
      />
    ) : null}
    {pendingAccountLink ? (
      <LinkExistingAccountModal
        pendingLink={pendingAccountLink}
        isSubmitting={isLinkingExistingAccount}
        onCancel={() => setPendingAccountLink(null)}
        onConfirm={handleConfirmLinkExistingAccount}
      />
    ) : null}
    </>
  );
}
