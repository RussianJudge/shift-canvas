"use client";

import { useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

import {
  acceptMutualApplication,
  applyToMutualPosting,
  cancelAcceptedMutual,
  createMutualPosting,
  withdrawMutualApplication,
  withdrawMutualPosting,
} from "@/app/actions";
import {
  formatMonthLabel,
  getEmployeeMap,
  getMonthDays,
  shiftMonthKey,
  shiftForDate,
} from "@/lib/scheduling";
import type { AppSession, MutualShiftPosting, MutualsSnapshot, ShiftKind } from "@/lib/types";

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
    case "accepted":
      return "Accepted";
    case "withdrawn":
      return "Withdrawn";
    case "cancelled":
      return "Cancelled";
    default:
      return "Open";
  }
}

/** Reusable date grid used for both posting and applying to mutual swaps. */
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
 * The available dates are already filtered to the ones the applicant is
 * working while the original poster is off, so the picker only shows dates that
 * could form a valid swap.
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
  const [offerMonth, setOfferMonth] = useState(snapshot.month);
  const schedule = employee ? snapshot.schedules.find((entry) => entry.id === employee.scheduleId) ?? null : null;
  const postingOwner = employeeMap[posting.ownerEmployeeId];
  const postingOwnerSchedule = postingOwner
    ? snapshot.schedules.find((entry) => entry.id === postingOwner.scheduleId) ?? null
    : null;
  const monthOptions = useMemo(
    () => Array.from({ length: 6 }, (_, index) => shiftMonthKey(snapshot.month, index)),
    [snapshot.month],
  );
  const availableDates =
    employee && schedule && postingOwnerSchedule
      ? getMonthDays(offerMonth)
          .filter(
            (day) =>
              shiftForDate(schedule, day.date) !== "OFF" &&
              shiftForDate(postingOwnerSchedule, day.date) === "OFF",
          )
          .map((day) => ({ date: day.date, shiftKind: shiftForDate(schedule, day.date) }))
      : [];

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
                .filter((entry) => entry.id !== posting.ownerEmployeeId)
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
          helper={`${selectedDates.length}/${posting.dates.length} selected · only dates ${posting.ownerEmployeeName} is off`}
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
  const router = useRouter();
  const employeeMap = useMemo(() => getEmployeeMap(snapshot.schedules), [snapshot.schedules]);
  const allEmployees = useMemo(
    () =>
      snapshot.schedules
        .flatMap((schedule) => schedule.employees)
        .sort((left, right) => left.name.localeCompare(right.name)),
    [snapshot.schedules],
  );
  const [statusMessage, setStatusMessage] = useState("");
  const [selectedPostingEmployeeId, setSelectedPostingEmployeeId] = useState(
    viewer.role === "worker" ? viewer.employeeId ?? "" : allEmployees[0]?.id ?? "",
  );
  const [postingMonth, setPostingMonth] = useState(snapshot.month);
  const [postingDates, setPostingDates] = useState<string[]>([]);
  const [applyPostingId, setApplyPostingId] = useState<string | null>(null);
  const [applicationEmployeeId, setApplicationEmployeeId] = useState(
    viewer.role === "worker" ? viewer.employeeId ?? "" : allEmployees[0]?.id ?? "",
  );
  const [applicationDates, setApplicationDates] = useState<string[]>([]);
  const [isSubmitting, startTransition] = useTransition();

  const selectedPostingEmployee = selectedPostingEmployeeId ? employeeMap[selectedPostingEmployeeId] ?? null : null;
  const selectedPostingSchedule = selectedPostingEmployee
    ? snapshot.schedules.find((entry) => entry.id === selectedPostingEmployee.scheduleId) ?? null
    : null;
  const postingMonthOptions = useMemo(
    () => Array.from({ length: 6 }, (_, index) => shiftMonthKey(snapshot.month, index)),
    [snapshot.month],
  );
  const postingShiftDates =
    selectedPostingEmployee && selectedPostingSchedule
      ? getMonthDays(postingMonth)
          .filter((day) => shiftForDate(selectedPostingSchedule, day.date) !== "OFF")
          .map((day) => ({ date: day.date, shiftKind: shiftForDate(selectedPostingSchedule, day.date) }))
      : [];
  const applyPosting = applyPostingId ? snapshot.postings.find((posting) => posting.id === applyPostingId) ?? null : null;

  const openPostings = snapshot.postings.filter((posting) => posting.status === "open");
  const acceptedPostings = snapshot.postings.filter((posting) => posting.status === "accepted");
  const closedPostings = snapshot.postings.filter((posting) => posting.status !== "open" && posting.status !== "accepted");

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
      const posting = snapshot.postings.find((entry) => entry.id === postingId);
      const defaultEmployee =
        viewer.role === "worker"
          ? viewer.employeeId ?? ""
          : allEmployees.find((employee) => employee.id !== posting?.ownerEmployeeId)?.id ?? "";
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
        window.location.reload();
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
        window.location.reload();
      }
    });
  }

  function runAction(action: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const result = await action();
      setStatusMessage(result.message);

      if (result.ok) {
        window.location.reload();
      }
    });
  }

  return (
    <section className="panel-frame mutuals-page">
      <div className="panel-heading panel-heading--simple">
        <h1 className="panel-title">Mutuals</h1>
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
          <h2 className="metrics-section__title">Post Mutual Shifts</h2>
        </div>

        <div className="metrics-card">
          {viewer.role === "worker" ? (
            <div className="field field--static">
              <span>Post As</span>
              <strong>{selectedPostingEmployee?.name ?? viewer.displayName}</strong>
            </div>
          ) : (
            <label className="field">
              <span>Post As</span>
              <select
                value={selectedPostingEmployeeId}
                onChange={(event) => {
                  setSelectedPostingEmployeeId(event.target.value);
                  setPostingDates([]);
                }}
              >
                {allEmployees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="field">
            <span>Post Month</span>
            <select value={postingMonth} onChange={(event) => setPostingMonth(event.target.value)}>
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
            onToggle={togglePostingDate}
            helper={
              selectedPostingSchedule
                ? `${postingDates.length} selected across months · posting from Shift ${selectedPostingSchedule.name}`
                : undefined
            }
          />

          <div className="metrics-transfer-actions">
            <button type="button" className="primary-button" onClick={handleCreatePosting} disabled={isSubmitting}>
              {isSubmitting ? "Posting..." : "Post mutual"}
            </button>
          </div>
        </div>
      </section>

      <section className="metrics-section mutuals-section">
        <div className="metrics-section__header">
          <h2 className="metrics-section__title">Open Mutuals</h2>
          <div className="field field--static">
            <span>Month</span>
            <div className="mutuals-month-nav">
              <strong>{formatMonthLabel(snapshot.month)}</strong>
              <div className="mutuals-month-nav__buttons">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => router.push(`/mutuals?month=${shiftMonthKey(snapshot.month, -1)}`)}
                >
                  Prev month
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => router.push(`/mutuals?month=${shiftMonthKey(snapshot.month, 1)}`)}
                >
                  Next month
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="metrics-team-list">
          {openPostings.length > 0 ? (
            openPostings.map((posting) => {
              const canCancelPosting =
                viewer.role !== "worker" || viewer.employeeId === posting.ownerEmployeeId;
              const canApplyToPosting = viewer.employeeId !== posting.ownerEmployeeId;

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
                        onClick={() => runAction(() => withdrawMutualPosting({ postingId: posting.id }))}
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
                    <span className="legend-pill legend-pill--teal">Accepted</span>
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
                        onClick={() => runAction(() => cancelAcceptedMutual({ postingId: posting.id }))}
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
              <span>Accepted swaps will appear here once the original worker approves an offer.</span>
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
          snapshot={snapshot}
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
    </section>
  );
}
