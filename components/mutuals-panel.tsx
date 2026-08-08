"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";

import {
  acceptMutualApplication,
  approveMutualPosting,
  rejectMutualPosting,
  applyToMutualPosting,
  cancelAcceptedMutual,
  createMutualPosting,
  saveMutualSettings,
  withdrawMutualApplication,
  withdrawMutualPosting,
} from "@/app/actions";
import { AppDateSelector } from "@/components/app-date-selector";
import {
  formatMonthLabel,
  getEmployeeMap,
  getMonthDays,
  shiftForDate,
} from "@/lib/scheduling";
import type { AppSession, MutualSettings, MutualShiftPosting, MutualsSnapshot, ShiftKind } from "@/lib/types";

function getCurrentUtcMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

function getCurrentUtcYearMonthOptions() {
  const currentYear = Number.parseInt(new Date().toISOString().slice(0, 4), 10);

  return Array.from({ length: 12 }, (_, index) => {
    const month = `${index + 1}`.padStart(2, "0");
    return `${currentYear}-${month}`;
  });
}

function getCurrentUtcFutureYearMonthOptions() {
  const currentMonth = getCurrentUtcMonthKey();

  return getCurrentUtcYearMonthOptions().filter((month) => month >= currentMonth);
}

function formatYearLabel(monthKey: string) {
  return monthKey.slice(0, 4);
}

/** Formats a mutual date chip using the short month/day style used throughout the app. */
function formatShortDate(isoDate: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

/** Turns a shift kind into the one-letter badge shown in mutual date pills. */
function getShiftBadgeLabel(shiftKind: ShiftKind) {
  return shiftKind === "DAY" ? "D" : shiftKind === "NIGHT" ? "N" : "O";
}

/** Human-friendly label used on mutual posting and application status pills. */
function getStatusLabel(status: MutualShiftPosting["status"]) {
  switch (status) {
    case "pending_leader_approval":
      return "Pending approval";
    case "accepted":
      return "Live";
    case "withdrawn":
      return "Withdrawn";
    case "cancelled":
      return "Cancelled";
    case "rejected":
      return "Rejected";
    default:
      return "Open";
  }
}

function getLeaderApprovalLabel({
  scheduleName,
  approvedAt,
  approvedByName,
}: {
  scheduleName: string;
  approvedAt: string | null;
  approvedByName: string | null;
}) {
  return approvedAt
    ? `Shift ${scheduleName} approved${approvedByName ? ` by ${approvedByName}` : ""}`
    : `Shift ${scheduleName} pending`;
}

/** Reusable date grid used for both posting and applying to mutual swaps. */
function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 8.25a3.75 3.75 0 1 1 0 7.5a3.75 3.75 0 0 1 0-7.5Z" />
      <path d="M19.5 12a7.46 7.46 0 0 0-.15-1.5l2.1-1.62l-2-3.46l-2.48 1a7.6 7.6 0 0 0-2.6-1.5L14 2.25h-4l-.38 2.67a7.6 7.6 0 0 0-2.6 1.5l-2.48-1l-2 3.46l2.1 1.62a7.4 7.4 0 0 0 0 3l-2.1 1.62l2 3.46l2.48-1a7.6 7.6 0 0 0 2.6 1.5l.38 2.67h4l.38-2.67a7.6 7.6 0 0 0 2.6-1.5l2.48 1l2-3.46l-2.1-1.62c.1-.49.15-.99.15-1.5Z" />
    </svg>
  );
}

function MutualSettingsModal({
  settings,
  isSaving,
  onChange,
  onClose,
  onSave,
}: {
  settings: MutualSettings;
  isSaving: boolean;
  onChange: (updater: (settings: MutualSettings) => MutualSettings) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return createPortal(
    <div className="assignment-modal-backdrop" onClick={onClose}>
      <section className="assignment-modal mutual-modal" onClick={(event) => event.stopPropagation()}>
        <div className="assignment-modal__header">
          <div>
            <span className="assignment-modal__eyebrow">Mutual settings</span>
            <h2 className="assignment-modal__title">Rules for this business area</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onClose} disabled={isSaving}>
            Close
          </button>
        </div>

        <div className="modal-form-grid">
          <label className="field">
            <span>Max shifts per posting</span>
            <input
              type="number"
              min={1}
              placeholder="No limit"
              value={settings.maxShiftsPerPosting ?? ""}
              disabled={isSaving}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  maxShiftsPerPosting: event.target.value === "" ? null : Number(event.target.value),
                }))
              }
            />
          </label>

          <label className="field">
            <span>Post up to this many months ahead</span>
            <input
              type="number"
              min={1}
              value={settings.postingHorizonMonths}
              disabled={isSaving}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  postingHorizonMonths: Number(event.target.value),
                }))
              }
            />
          </label>

          <label className="subschedule-status-toggle">
            <input
              type="checkbox"
              checked={settings.requireLeaderApproval}
              disabled={isSaving}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  requireLeaderApproval: event.target.checked,
                }))
              }
            />
            <span>Require leader approval before a mutual takes effect</span>
          </label>
        </div>

        <div className="assignment-modal__footer">
          <button type="button" className="ghost-button" onClick={onClose} disabled={isSaving}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={onSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save settings"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function MutualDatePicker({
  title,
  dates,
  selectedDates,
  onToggle,
  helper,
}: {
  title: string;
  dates: Array<{ date: string; shiftKind: ShiftKind }>;
  selectedDates: string[];
  onToggle: (date: string) => void;
  helper?: string;
}) {
  return (
    <div className="mutual-picker">
      <div className="mutual-picker__header">
        <strong>{title}</strong>
        {helper ? <span>{helper}</span> : null}
      </div>
      <div className="mutual-picker__grid">
        {dates.map((entry) => {
          const isSelected = selectedDates.includes(entry.date);

          return (
            <button
              key={entry.date}
              type="button"
              className={`mutual-date-pill ${isSelected ? "mutual-date-pill--selected" : ""}`}
              onClick={() => onToggle(entry.date)}
            >
              <strong>{formatShortDate(entry.date)}</strong>
              <span>{getShiftBadgeLabel(entry.shiftKind)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Modal used when a user offers their own shifts against an existing mutual.
 *
 * The picker shows every date the applicant is working, including ones the
 * poster also works, so day/night shifts can be swapped between them.
 */
function MutualApplyModal({
  viewer,
  snapshot,
  posting,
  selectedEmployeeId,
  selectedDates,
  onEmployeeChange,
  onToggleDate,
  onClose,
  onSubmit,
  isSubmitting,
}: {
  viewer: AppSession;
  snapshot: MutualsSnapshot;
  posting: MutualShiftPosting;
  selectedEmployeeId: string;
  selectedDates: string[];
  onEmployeeChange: (employeeId: string) => void;
  onToggleDate: (date: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}) {
  if (typeof document === "undefined") {
    return null;
  }

  const employeeMap = getEmployeeMap(snapshot.schedules);
  const employee = employeeMap[selectedEmployeeId];
  const monthOptions = useMemo(
    () => getCurrentUtcYearMonthOptions(),
    [],
  );
  const [offerMonth, setOfferMonth] = useState(monthOptions[0] ?? getCurrentUtcMonthKey());
  const schedule = employee ? snapshot.schedules.find((entry) => entry.id === employee.scheduleId) ?? null : null;
  const availableDates =
    employee && schedule
      ? getMonthDays(offerMonth)
          .filter((day) => shiftForDate(schedule, day.date) !== "OFF")
          .map((day) => ({ date: day.date, shiftKind: shiftForDate(schedule, day.date) }))
      : [];

  useEffect(() => {
    setOfferMonth((current) => (monthOptions.includes(current) ? current : monthOptions[0] ?? getCurrentUtcMonthKey()));
  }, [monthOptions]);

  return createPortal(
    <div className="assignment-modal-backdrop" onClick={onClose}>
      <section className="assignment-modal mutual-modal" onClick={(event) => event.stopPropagation()}>
        <div className="assignment-modal__header">
          <div>
            <h2 className="assignment-modal__title">Apply To Mutual</h2>
            <p className="assignment-modal__context">
              Match {posting.ownerEmployeeName}'s {posting.dates.length} posted shift{posting.dates.length === 1 ? "" : "s"} with your own dates.
            </p>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
        </div>

        {viewer.role === "worker" ? (
          <div className="field field--static">
            <span>Apply As</span>
            <strong>{employee?.name ?? viewer.displayName}</strong>
          </div>
        ) : (
          <label className="field">
            <span>Apply As</span>
            <select value={selectedEmployeeId} onChange={(event) => onEmployeeChange(event.target.value)}>
              {snapshot.schedules
                .flatMap((schedule) => schedule.employees)
                .filter((entry) => entry.id !== posting.ownerEmployeeId && entry.scheduleId !== posting.ownerScheduleId)
                .sort((left, right) => left.name.localeCompare(right.name))
                .map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
            </select>
          </label>
        )}

        <label className="field">
          <span>Offer Month</span>
          <select value={offerMonth} onChange={(event) => setOfferMonth(event.target.value)}>
            {monthOptions.map((month) => (
              <option key={month} value={month}>
                {formatMonthLabel(month)}
              </option>
            ))}
          </select>
        </label>

        <MutualDatePicker
          title="Offered shifts"
          dates={availableDates}
          selectedDates={selectedDates}
          onToggle={onToggleDate}
          helper={`${selectedDates.length}/${posting.dates.length} selected`}
        />

        <div className="metrics-transfer-actions">
          <button type="button" className="primary-button" onClick={onSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Submitting..." : "Submit application"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function MutualPostModal({
  viewer,
  allEmployees,
  selectedPostingEmployee,
  selectedPostingEmployeeId,
  postingMonth,
  postingMonthOptions,
  postingShiftDates,
  postingDates,
  canPostForOthers,
  onEmployeeChange,
  onMonthChange,
  onToggleDate,
  onClose,
  onSubmit,
  isSubmitting,
}: {
  viewer: AppSession;
  allEmployees: Array<{ id: string; name: string }>;
  selectedPostingEmployee: { name: string; scheduleId: string } | null;
  selectedPostingEmployeeId: string;
  postingMonth: string;
  postingMonthOptions: string[];
  postingShiftDates: Array<{ date: string; shiftKind: ShiftKind }>;
  postingDates: string[];
  canPostForOthers: boolean;
  onEmployeeChange: (employeeId: string) => void;
  onMonthChange: (month: string) => void;
  onToggleDate: (date: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}) {
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="assignment-modal-backdrop" onClick={onClose}>
      <section className="assignment-modal mutual-modal" onClick={(event) => event.stopPropagation()}>
        <div className="assignment-modal__header">
          <div>
            <h2 className="assignment-modal__title">Create Post Mutual</h2>
            <p className="assignment-modal__context">
              Choose the worker and shifts you want to place on the mutual board.
            </p>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
        </div>

        {viewer.role === "worker" ? (
          <div className="field field--static">
            <span>Post As</span>
            <strong>{selectedPostingEmployee?.name ?? viewer.displayName}</strong>
          </div>
        ) : canPostForOthers ? (
          <label className="field">
            <span>Post As</span>
            <select
              value={selectedPostingEmployeeId}
              onChange={(event) => onEmployeeChange(event.target.value)}
            >
              {allEmployees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="field field--static">
            <span>Post As</span>
            <strong>{selectedPostingEmployee?.name ?? viewer.displayName}</strong>
          </div>
        )}

        <label className="field">
          <span>Post Month</span>
          <select value={postingMonth} onChange={(event) => onMonthChange(event.target.value)}>
            {postingMonthOptions.map((month) => (
              <option key={month} value={month}>
                {formatMonthLabel(month)}
              </option>
            ))}
          </select>
        </label>

        <MutualDatePicker
          title="Shifts to swap"
          dates={postingShiftDates}
          selectedDates={postingDates}
          onToggle={onToggleDate}
          helper={selectedPostingEmployee ? `${postingDates.length} selected` : undefined}
        />

        <div className="metrics-transfer-actions">
          <button type="button" className="primary-button" onClick={onSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Posting..." : "Post mutual"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function CancelAcceptedMutualModal({
  posting,
  onCancel,
  onConfirm,
  isSubmitting,
}: {
  posting: MutualShiftPosting;
  onCancel: () => void;
  onConfirm: () => void;
  isSubmitting: boolean;
}) {
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="assignment-modal-backdrop" onClick={onCancel}>
      <section className="assignment-modal mutual-modal" onClick={(event) => event.stopPropagation()}>
        <div className="assignment-modal__header">
          <div>
            <h2 className="assignment-modal__title">Cancel accepted mutual?</h2>
            <p className="assignment-modal__context">
              Cancel this accepted mutual for {posting.ownerEmployeeName}? This will restore the original schedule cells.
            </p>
          </div>
          <button type="button" className="ghost-button" onClick={onCancel} disabled={isSubmitting}>
            Close
          </button>
        </div>

        <div className="mutual-date-summary">
          {posting.dates.map((date, index) => (
            <span key={date} className="mutual-date-chip">
              {formatShortDate(date)} · {getShiftBadgeLabel(posting.shiftKinds[index] ?? "OFF")}
            </span>
          ))}
        </div>

        <div className="assignment-modal__footer">
          <button type="button" className="ghost-button" onClick={onCancel} disabled={isSubmitting}>
            Keep mutual
          </button>
          <button type="button" className="primary-button" onClick={onConfirm} disabled={isSubmitting}>
            {isSubmitting ? "Cancelling..." : "Cancel mutual"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

/**
 * Main mutual-shift workspace.
 *
 * This component renders the full swap lifecycle in one place:
 * - create open mutual posts
 * - browse and apply to existing posts
 * - accept offers
 * - review accepted and closed history
 */
export function MutualsPanel({
  snapshot,
  viewer,
}: {
  snapshot: MutualsSnapshot;
  viewer: AppSession;
}) {
  const canPostForOthers = viewer.role === "admin" || viewer.role === "leader";
  /**
   * The server provides the initial month snapshot, then the panel owns later
   * month switches so the postings board can refresh without remounting the
   * whole page or resetting the posting builder.
   */
  const [viewSnapshot, setViewSnapshot] = useState(snapshot);
  const [viewMonth, setViewMonth] = useState(snapshot.month);
  const employeeMap = useMemo(() => getEmployeeMap(snapshot.schedules), [snapshot.schedules]);
  const viewerEmployee = useMemo(
    () => (viewer.employeeId ? employeeMap[viewer.employeeId] ?? null : null),
    [employeeMap, viewer.employeeId],
  );
  const effectiveViewerScheduleId = viewerEmployee?.scheduleId ?? viewer.scheduleId ?? null;
  const allEmployees = useMemo(
    () =>
      snapshot.schedules
        .flatMap((schedule) => schedule.employees)
        .sort((left, right) => left.name.localeCompare(right.name)),
    [snapshot.schedules],
  );
  const [statusMessage, setStatusMessage] = useState("");
  const [search, setSearch] = useState("");
  const [selectedPostingEmployeeId, setSelectedPostingEmployeeId] = useState(
    canPostForOthers ? allEmployees[0]?.id ?? "" : viewer.employeeId ?? "",
  );
  const postingMonthOptions = useMemo(
    () => getCurrentUtcYearMonthOptions(),
    [],
  );
  const [postingMonth, setPostingMonth] = useState(postingMonthOptions[0] ?? getCurrentUtcMonthKey());
  const [postingDates, setPostingDates] = useState<string[]>([]);
  const [isPostModalOpen, setIsPostModalOpen] = useState(false);
  const [applyPostingId, setApplyPostingId] = useState<string | null>(null);
  const [cancelAcceptedPostingId, setCancelAcceptedPostingId] = useState<string | null>(null);
  const [applicationEmployeeId, setApplicationEmployeeId] = useState(
    viewer.role === "worker" ? viewer.employeeId ?? "" : allEmployees[0]?.id ?? "",
  );
  const [applicationDates, setApplicationDates] = useState<string[]>([]);
  const [isSubmitting, startTransition] = useTransition();
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [draftSettings, setDraftSettings] = useState<MutualSettings>(snapshot.settings);
  const [isMonthLoading, startMonthTransition] = useTransition();

  const selectedPostingEmployee = selectedPostingEmployeeId ? employeeMap[selectedPostingEmployeeId] ?? null : null;
  const selectedPostingSchedule = selectedPostingEmployee
    ? snapshot.schedules.find((entry) => entry.id === selectedPostingEmployee.scheduleId) ?? null
    : null;
  const postingShiftDates =
    selectedPostingEmployee && selectedPostingSchedule
      ? getMonthDays(postingMonth)
          .filter((day) => shiftForDate(selectedPostingSchedule, day.date) !== "OFF")
          .map((day) => ({ date: day.date, shiftKind: shiftForDate(selectedPostingSchedule, day.date) }))
      : [];
  const applyPosting = applyPostingId ? viewSnapshot.postings.find((posting) => posting.id === applyPostingId) ?? null : null;
  const cancelAcceptedPosting = cancelAcceptedPostingId
    ? viewSnapshot.postings.find((posting) => posting.id === cancelAcceptedPostingId) ?? null
    : null;

  const normalizedSearch = search.trim().toLowerCase();
  const searchedPostings = normalizedSearch
    ? viewSnapshot.postings.filter((posting) => {
        const involvedNames = [
          posting.ownerEmployeeName,
          ...posting.applications.map((application) => application.applicantEmployeeName),
        ];
        return involvedNames.some((name) => name?.toLowerCase().includes(normalizedSearch));
      })
    : viewSnapshot.postings;

  const openPostings = searchedPostings.filter((posting) => posting.status === "open");
  const pendingApprovalPostings = searchedPostings.filter((posting) => posting.status === "pending_leader_approval");
  const acceptedPostings = searchedPostings.filter((posting) => posting.status === "accepted");
  const closedPostings = searchedPostings.filter(
    (posting) => !["open", "pending_leader_approval", "accepted"].includes(posting.status),
  );

  useEffect(() => {
    setViewSnapshot(snapshot);
    setViewMonth(snapshot.month);
  }, [snapshot]);

  useEffect(() => {
    setPostingMonth((current) =>
      postingMonthOptions.includes(current) ? current : postingMonthOptions[0] ?? getCurrentUtcMonthKey(),
    );
  }, [postingMonthOptions]);

  useEffect(() => {
    setIsPostModalOpen(false);
  }, [viewMonth]);

  function syncMonthInUrl(nextMonth: string) {
    if (typeof window === "undefined") {
      return;
    }

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("month", nextMonth);
    window.history.replaceState(null, "", nextUrl.toString());
  }

  function loadMutualsMonth(nextMonth: string) {
    startMonthTransition(async () => {
      setStatusMessage(`Loading ${formatYearLabel(nextMonth)} mutuals`);

      try {
        const response = await fetch(`/api/mutuals?month=${nextMonth}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Unable to load mutuals.");
        }

        const nextSnapshot = (await response.json()) as MutualsSnapshot;

        setViewSnapshot(nextSnapshot);
        setViewMonth(nextSnapshot.month);
        syncMonthInUrl(nextSnapshot.month);
        setApplyPostingId((current) =>
          current && nextSnapshot.postings.some((posting) => posting.id === current) ? current : null,
        );
        setStatusMessage(`Loaded ${formatYearLabel(nextSnapshot.month)} mutuals`);
      } catch {
        setStatusMessage("Could not load that year. Staying on your current mutuals view.");
      }
    });
  }

  function togglePostingDate(date: string) {
    setPostingDates((current) =>
      current.includes(date) ? current.filter((entry) => entry !== date) : [...current, date].sort(),
    );
  }

  function toggleApplicationDate(date: string) {
    setApplicationDates((current) =>
      current.includes(date) ? current.filter((entry) => entry !== date) : [...current, date].sort(),
    );
  }

  function resetApplication(postingId: string | null = null) {
    setApplyPostingId(postingId);
    setApplicationDates([]);

    if (postingId) {
      const posting = viewSnapshot.postings.find((entry) => entry.id === postingId);
      const defaultEmployee =
        viewer.role === "worker"
          ? viewer.employeeId ?? ""
          : allEmployees.find(
              (employee) =>
                employee.id !== posting?.ownerEmployeeId &&
                employee.scheduleId !== posting?.ownerScheduleId,
            )?.id ?? "";
      setApplicationEmployeeId(defaultEmployee);
    }
  }

  function handleCreatePosting() {
    if (!selectedPostingEmployeeId) {
      setStatusMessage("Select an employee first.");
      return;
    }

    startTransition(async () => {
      const result = await createMutualPosting({
        employeeId: selectedPostingEmployeeId,
        dates: postingDates,
      });

      setStatusMessage(result.message);

      if (result.ok) {
        setPostingDates([]);
        setIsPostModalOpen(false);
        loadMutualsMonth(viewMonth);
      }
    });
  }

  function handleApply() {
    if (!applyPosting || !applicationEmployeeId) {
      setStatusMessage("Select a mutual posting and employee first.");
      return;
    }

    startTransition(async () => {
      const result = await applyToMutualPosting({
        postingId: applyPosting.id,
        employeeId: applicationEmployeeId,
        dates: applicationDates,
      });

      setStatusMessage(result.message);

      if (result.ok) {
        resetApplication(null);
        loadMutualsMonth(viewMonth);
      }
    });
  }

  function runAction(action: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const result = await action();
      setStatusMessage(result.message);

      if (result.ok) {
        setCancelAcceptedPostingId(null);
        loadMutualsMonth(viewMonth);
      }
    });
  }

  function confirmAction(message: string, action: () => Promise<{ ok: boolean; message: string }>) {
    if (typeof window !== "undefined" && !window.confirm(message)) {
      return;
    }

    runAction(action);
  }

  function handleYearChange(nextMonth: string) {
    loadMutualsMonth(nextMonth);
  }

  return (
    <section className="panel-frame mutuals-page">
      <div className="panel-heading panel-heading--simple mutuals-topbar">
        <h1 className="panel-title">Mutuals</h1>
        <AppDateSelector
          mode="year"
          value={viewMonth}
          label="Mutuals year"
          triggerLabel={formatYearLabel(viewMonth)}
          disabled={isMonthLoading}
          className="mutuals-year-pager"
          onChange={handleYearChange}
        />
        {viewer.role === "admin" ? (
          <button
            type="button"
            className="icon-button"
            onClick={() => {
              setDraftSettings(snapshot.settings);
              setIsSettingsModalOpen(true);
            }}
            aria-label="Mutual settings"
            title="Mutual settings"
          >
            <SettingsIcon />
          </button>
        ) : null}
      </div>

      <div className="workspace-toolbar workspace-toolbar--personnel-page mutuals-search-bar">
        <label className="field">
          <span>Search</span>
          <input
            type="search"
            placeholder="Search by worker name"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>

      {statusMessage ? (
        <div className="workspace-toolbar workspace-toolbar--personnel-page">
          <div className="toolbar-status-wrap">
            <p className="toolbar-status">{statusMessage}</p>
          </div>
        </div>
      ) : null}

      <section className="metrics-section mutuals-section">
        <div className="metrics-section__header">
          <h2 className="metrics-section__title">Open Mutuals</h2>
        </div>

        <div className="mutuals-create-action">
          <button
            type="button"
            className="primary-button"
            onClick={() => setIsPostModalOpen(true)}
            disabled={isSubmitting}
          >
            Create Mutual Posting
          </button>
        </div>

        <div className="metrics-team-list">
          {openPostings.length > 0 ? (
            openPostings.map((posting) => {
              const canCancelPosting =
                viewer.role !== "worker" || viewer.employeeId === posting.ownerEmployeeId;
              const canApplyToPosting =
                viewer.employeeId !== posting.ownerEmployeeId &&
                (viewer.role !== "worker" || viewerEmployee?.scheduleId !== posting.ownerScheduleId);

              return (
                <article key={posting.id} className="metrics-card mutual-card">
                  <div className="metrics-card__header">
                    <div>
                      <p className="metrics-card__eyebrow">Shift {posting.ownerScheduleName}</p>
                      <h3 className="metrics-card__title">{posting.ownerEmployeeName}</h3>
                    </div>
                    <span className="legend-pill legend-pill--slate">{getStatusLabel(posting.status)}</span>
                  </div>

                  <div className="mutual-date-summary">
                    {posting.dates.map((date, index) => (
                      <span key={date} className="mutual-date-chip">
                        {formatShortDate(date)} · {getShiftBadgeLabel(posting.shiftKinds[index] ?? "OFF")}
                      </span>
                    ))}
                  </div>

                  <div className="mutual-card__actions">
                    {canCancelPosting ? (
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() =>
                          confirmAction(
                            `Cancel this open mutual for ${posting.ownerEmployeeName}?`,
                            () => withdrawMutualPosting({ postingId: posting.id }),
                          )
                        }
                        disabled={isSubmitting}
                      >
                        Cancel mutual
                      </button>
                    ) : null}

                    {canApplyToPosting ? (
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => resetApplication(posting.id)}
                        disabled={isSubmitting}
                      >
                        Apply
                      </button>
                    ) : null}
                  </div>

                  <div className="mutual-applications">
                    <strong className="metrics-top-list__title">Applications</strong>
                    {posting.applications.length > 0 ? (
                      posting.applications.map((application) => {
                        const canAccept =
                          application.status === "open" &&
                          (viewer.role === "admin" || viewer.employeeId === posting.ownerEmployeeId);
                        const canWithdraw = viewer.employeeId === application.applicantEmployeeId && application.status === "open";

                        return (
                          <div key={application.id} className="mutual-application-row">
                            <div>
                              <strong>{application.applicantEmployeeName}</strong>
                              <span>
                                Shift {application.applicantScheduleName} ·{" "}
                                {application.dates.map((date, index) => `${formatShortDate(date)} ${getShiftBadgeLabel(application.shiftKinds[index] ?? "OFF")}`).join(", ")}
                              </span>
                            </div>
                            <div className="mutual-application-row__actions">
                              <span className="legend-pill legend-pill--slate">{getStatusLabel(application.status)}</span>
                              {canAccept ? (
                                <button
                                  type="button"
                                  className="primary-button"
                                  onClick={() =>
                                    runAction(() =>
                                      acceptMutualApplication({
                                        postingId: posting.id,
                                        applicationId: application.id,
                                      }),
                                    )
                                  }
                                  disabled={isSubmitting}
                                >
                                  Accept
                                </button>
                              ) : null}
                              {canWithdraw ? (
                                <button
                                  type="button"
                                  className="ghost-button"
                                  onClick={() =>
                                    runAction(() =>
                                      withdrawMutualApplication({
                                        postingId: posting.id,
                                        applicationId: application.id,
                                      }),
                                    )
                                  }
                                  disabled={isSubmitting}
                                >
                                  Delete offer
                                </button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <span className="metrics-top-list__empty">No applications yet.</span>
                    )}
                  </div>
                </article>
              );
            })
          ) : (
            <div className="empty-state">
              <strong>No open mutuals.</strong>
              <span>Post a shift group above to start a mutual swap.</span>
            </div>
          )}
        </div>
      </section>

      <section className="metrics-section mutuals-section">
        <div className="metrics-section__header">
          <h2 className="metrics-section__title">Pending Leader Approval</h2>
        </div>

        <div className="metrics-team-list">
          {pendingApprovalPostings.length > 0 ? (
            pendingApprovalPostings.map((posting) => {
              const acceptedApplication = posting.applications.find((application) => application.id === posting.acceptedApplicationId);
              const canApproveOwner =
                Boolean(acceptedApplication) &&
                !posting.ownerLeaderApprovedAt &&
                (viewer.role === "admin" ||
                  (viewer.role === "leader" && effectiveViewerScheduleId === posting.ownerScheduleId));
              const canApproveApplicant =
                Boolean(acceptedApplication) &&
                !posting.applicantLeaderApprovedAt &&
                (viewer.role === "admin" ||
                  (viewer.role === "leader" && effectiveViewerScheduleId === acceptedApplication?.applicantScheduleId));

              return (
                <article key={posting.id} className="metrics-card mutual-card">
                  <div className="metrics-card__header">
                    <div>
                      <p className="metrics-card__eyebrow">Shift {posting.ownerScheduleName}</p>
                      <h3 className="metrics-card__title">
                        {posting.ownerEmployeeName}
                        {acceptedApplication ? ` ↔ ${acceptedApplication.applicantEmployeeName}` : ""}
                      </h3>
                    </div>
                    <span className="legend-pill legend-pill--amber">Pending approval</span>
                  </div>

                  <div className="mutual-accepted-grid">
                    <div>
                      <strong>{posting.ownerEmployeeName}</strong>
                      <div className="mutual-date-summary">
                        {posting.dates.map((date, index) => (
                          <span key={date} className="mutual-date-chip">
                            {formatShortDate(date)} · {getShiftBadgeLabel(posting.shiftKinds[index] ?? "OFF")}
                          </span>
                        ))}
                      </div>
                    </div>
                    {acceptedApplication ? (
                      <div>
                        <strong>{acceptedApplication.applicantEmployeeName}</strong>
                        <div className="mutual-date-summary">
                          {acceptedApplication.dates.map((date, index) => (
                            <span key={date} className="mutual-date-chip">
                              {formatShortDate(date)} · {getShiftBadgeLabel(acceptedApplication.shiftKinds[index] ?? "OFF")}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="mutual-date-summary">
                    <span className="legend-pill legend-pill--slate">
                      {getLeaderApprovalLabel({
                        scheduleName: posting.ownerScheduleName,
                        approvedAt: posting.ownerLeaderApprovedAt,
                        approvedByName: posting.ownerLeaderApprovedByName,
                      })}
                    </span>
                    {acceptedApplication ? (
                      <span className="legend-pill legend-pill--slate">
                        {getLeaderApprovalLabel({
                          scheduleName: acceptedApplication.applicantScheduleName,
                          approvedAt: posting.applicantLeaderApprovedAt,
                          approvedByName: posting.applicantLeaderApprovedByName,
                        })}
                      </span>
                    ) : null}
                  </div>

                  {canApproveOwner || canApproveApplicant ? (
                    <div className="mutual-card__actions">
                      {canApproveOwner ? (
                        <button
                          type="button"
                          className="primary-button"
                          onClick={() =>
                            runAction(() =>
                              approveMutualPosting({
                                postingId: posting.id,
                                side: "owner",
                              }),
                            )
                          }
                          disabled={isSubmitting}
                        >
                          Approve {posting.ownerScheduleName}
                        </button>
                      ) : null}
                      {canApproveApplicant && acceptedApplication ? (
                        <button
                          type="button"
                          className="primary-button"
                          onClick={() =>
                            runAction(() =>
                              approveMutualPosting({
                                postingId: posting.id,
                                side: "applicant",
                              }),
                            )
                          }
                          disabled={isSubmitting}
                        >
                          Approve {acceptedApplication.applicantScheduleName}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="ghost-button mutual-reject-button"
                        onClick={() =>
                          confirmAction(
                            "Reject this mutual and cancel the swap? This cannot be undone.",
                            () => rejectMutualPosting({ postingId: posting.id }),
                          )
                        }
                        disabled={isSubmitting}
                      >
                        Reject
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            })
          ) : (
            <div className="empty-state">
              <strong>No mutuals waiting on leaders.</strong>
              <span>Employee-accepted swaps will appear here until both shift leaders approve them.</span>
            </div>
          )}
        </div>
      </section>

      <section className="metrics-section mutuals-section">
        <div className="metrics-section__header">
          <h2 className="metrics-section__title">Accepted Mutuals</h2>
        </div>

        <div className="metrics-team-list">
          {acceptedPostings.length > 0 ? (
            acceptedPostings.map((posting) => {
              const acceptedApplication = posting.applications.find((application) => application.id === posting.acceptedApplicationId);

              return (
                <article key={posting.id} className="metrics-card mutual-card">
                  <div className="metrics-card__header">
                    <div>
                      <p className="metrics-card__eyebrow">Shift {posting.ownerScheduleName}</p>
                      <h3 className="metrics-card__title">
                        {posting.ownerEmployeeName}
                        {acceptedApplication ? ` ↔ ${acceptedApplication.applicantEmployeeName}` : ""}
                      </h3>
                    </div>
                    <span className="legend-pill legend-pill--teal">Live</span>
                  </div>

                  <div className="mutual-accepted-grid">
                    <div>
                      <strong>{posting.ownerEmployeeName}</strong>
                      <div className="mutual-date-summary">
                        {posting.dates.map((date, index) => (
                          <span key={date} className="mutual-date-chip">
                            {formatShortDate(date)} · {getShiftBadgeLabel(posting.shiftKinds[index] ?? "OFF")}
                          </span>
                        ))}
                      </div>
                    </div>
                    {acceptedApplication ? (
                      <div>
                        <strong>{acceptedApplication.applicantEmployeeName}</strong>
                        <div className="mutual-date-summary">
                          {acceptedApplication.dates.map((date, index) => (
                            <span key={date} className="mutual-date-chip">
                              {formatShortDate(date)} · {getShiftBadgeLabel(acceptedApplication.shiftKinds[index] ?? "OFF")}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {viewer.role === "leader" || viewer.role === "admin" ? (
                    <div className="mutual-card__actions">
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => setCancelAcceptedPostingId(posting.id)}
                        disabled={isSubmitting}
                      >
                        Cancel mutual
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            })
          ) : (
            <div className="empty-state">
              <strong>No accepted mutuals.</strong>
              <span>Live swaps will appear here after both shift leaders approve them.</span>
            </div>
          )}
        </div>
      </section>

      <section className="metrics-section mutuals-section">
        <div className="metrics-section__header">
          <h2 className="metrics-section__title">Closed Mutuals</h2>
        </div>

        <div className="metrics-team-list">
          {closedPostings.length > 0 ? (
            closedPostings.map((posting) => (
              <article key={posting.id} className="metrics-card mutual-card mutual-card--closed">
                <div className="metrics-card__header">
                  <div>
                    <p className="metrics-card__eyebrow">Shift {posting.ownerScheduleName}</p>
                    <h3 className="metrics-card__title">{posting.ownerEmployeeName}</h3>
                  </div>
                  <span className="legend-pill legend-pill--slate">{getStatusLabel(posting.status)}</span>
                </div>

                <div className="mutual-date-summary">
                  {posting.dates.map((date, index) => (
                    <span key={date} className="mutual-date-chip">
                      {formatShortDate(date)} · {getShiftBadgeLabel(posting.shiftKinds[index] ?? "OFF")}
                    </span>
                  ))}
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state">
              <strong>No closed mutuals.</strong>
              <span>Leader-cancelled swaps will stay visible here for reference.</span>
            </div>
          )}
        </div>
      </section>

      {applyPosting ? (
        <MutualApplyModal
          viewer={viewer}
          snapshot={viewSnapshot}
          posting={applyPosting}
          selectedEmployeeId={applicationEmployeeId}
          selectedDates={applicationDates}
          onEmployeeChange={(employeeId) => {
            setApplicationEmployeeId(employeeId);
            setApplicationDates([]);
          }}
          onToggleDate={toggleApplicationDate}
          onClose={() => resetApplication(null)}
          onSubmit={handleApply}
          isSubmitting={isSubmitting}
        />
      ) : null}

      {isPostModalOpen ? (
        <MutualPostModal
          viewer={viewer}
          allEmployees={allEmployees}
          selectedPostingEmployee={selectedPostingEmployee}
          selectedPostingEmployeeId={selectedPostingEmployeeId}
          postingMonth={postingMonth}
          postingMonthOptions={postingMonthOptions}
          postingShiftDates={postingShiftDates}
          postingDates={postingDates}
          canPostForOthers={canPostForOthers}
          onEmployeeChange={(employeeId) => {
            setSelectedPostingEmployeeId(employeeId);
            setPostingDates([]);
          }}
          onMonthChange={setPostingMonth}
          onToggleDate={togglePostingDate}
          onClose={() => setIsPostModalOpen(false)}
          onSubmit={handleCreatePosting}
          isSubmitting={isSubmitting}
        />
      ) : null}

      {cancelAcceptedPosting ? (
        <CancelAcceptedMutualModal
          posting={cancelAcceptedPosting}
          onCancel={() => setCancelAcceptedPostingId(null)}
          onConfirm={() => runAction(() => cancelAcceptedMutual({ postingId: cancelAcceptedPosting.id }))}
          isSubmitting={isSubmitting}
        />
      ) : null}

      {isSettingsModalOpen ? (
        <MutualSettingsModal
          settings={draftSettings}
          isSaving={isSubmitting}
          onChange={(updater) => setDraftSettings((current) => updater(current))}
          onClose={() => setIsSettingsModalOpen(false)}
          onSave={() => {
            startTransition(async () => {
              const result = await saveMutualSettings(draftSettings);

              setStatusMessage(result.message);

              if (result.ok) {
                setIsSettingsModalOpen(false);
                loadMutualsMonth(viewMonth);
              }
            });
          }}
        />
      ) : null}
    </section>
  );
}
