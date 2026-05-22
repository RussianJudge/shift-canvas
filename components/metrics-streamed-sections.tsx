"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

import {
  type FragilityWindow,
  formatAnchorDateLabel,
  formatFatigueBandLabel,
  formatFragilityScore,
  getMetricsAnchorDate,
  getOvertimeMetricEntries,
  getTeamFatigueMetrics,
  getTeamMetrics,
  getTeamTimeCodeMetrics,
  getTimeCodeWindowStart,
  getTransferSuggestions,
  getWindowStart,
  NORMAL_FATIGUE_CYCLE,
  type OvertimeWindow,
  padMetricPeopleRows,
  padMetricRows,
  type TimeCodeWindow,
  type TransferSuggestion,
} from "@/components/metrics-panel";
import { formatMonthLabel, shiftMonthKey } from "@/lib/scheduling";
import type { OvertimeClaim, SchedulerSnapshot, StoredAssignment } from "@/lib/types";

export function MetricsPageFrame({
  month,
  children,
}: {
  month: string;
  children: ReactNode;
}) {
  const router = useRouter();

  function navigateMonth(delta: number) {
    const nextMonth = shiftMonthKey(month, delta);
    router.push(`/metrics?month=${nextMonth}`, { scroll: false });
  }

  return (
    <section className="panel-frame">
      <div className="panel-heading panel-heading--split">
        <h1 className="panel-title">Metrics</h1>
        <div className="metrics-month-nav">
          <div className="metrics-month-nav__current">
            <strong>{formatMonthLabel(month)}</strong>
          </div>
          <div className="metrics-month-nav__actions">
            <button type="button" className="ghost-button" onClick={() => navigateMonth(-1)}>
              Prev month
            </button>
            <button type="button" className="ghost-button" onClick={() => navigateMonth(1)}>
              Next month
            </button>
          </div>
        </div>
      </div>

      <div className="metrics-grid">{children}</div>
    </section>
  );
}

export function MetricsCompetenciesSection({ snapshot }: { snapshot: SchedulerSnapshot }) {
  const metricsAnchorDate = useMemo(() => getMetricsAnchorDate(snapshot.month), [snapshot.month]);
  const teamMetrics = useMemo(
    () => getTeamMetrics(snapshot, [], [], metricsAnchorDate),
    [metricsAnchorDate, snapshot],
  );
  const maxQualifiedPeople = Math.max(
    1,
    ...teamMetrics.flatMap((team) => team.competencyMetrics.map((metric) => metric.qualifiedPeople)),
  );
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [sourceScheduleId, setSourceScheduleId] = useState(snapshot.schedules[0]?.id ?? "");
  const [targetScheduleId, setTargetScheduleId] = useState(snapshot.schedules[1]?.id ?? snapshot.schedules[0]?.id ?? "");
  const [selectedTransferCompetencyIds, setSelectedTransferCompetencyIds] = useState<string[]>([]);
  const [transferSuggestions, setTransferSuggestions] = useState<TransferSuggestion[]>([]);
  const [selectedTransferSuggestionIndex, setSelectedTransferSuggestionIndex] = useState(0);
  const [transferMessage, setTransferMessage] = useState("");

  useEffect(() => {
    setSourceScheduleId((current) =>
      snapshot.schedules.some((schedule) => schedule.id === current) ? current : snapshot.schedules[0]?.id ?? "",
    );
    setTargetScheduleId((current) => {
      if (snapshot.schedules.some((schedule) => schedule.id === current)) {
        return current;
      }

      return snapshot.schedules[1]?.id ?? snapshot.schedules[0]?.id ?? "";
    });
    setSelectedTransferCompetencyIds((current) =>
      current.filter((competencyId) => snapshot.competencies.some((competency) => competency.id === competencyId)),
    );
    setTransferSuggestions([]);
    setSelectedTransferSuggestionIndex(0);
    setTransferMessage("");
  }, [snapshot]);

  function toggleTransferCompetency(competencyId: string) {
    setSelectedTransferCompetencyIds((current) =>
      current.includes(competencyId)
        ? current.filter((id) => id !== competencyId)
        : [...current, competencyId],
    );
    setTransferSuggestions([]);
    setSelectedTransferSuggestionIndex(0);
    setTransferMessage("");
  }

  function handleCalculateTransfer() {
    if (!sourceScheduleId || !targetScheduleId || sourceScheduleId === targetScheduleId) {
      setTransferSuggestions([]);
      setSelectedTransferSuggestionIndex(0);
      setTransferMessage("Choose two different shifts to calculate a transfer.");
      return;
    }

    if (selectedTransferCompetencyIds.length === 0) {
      setTransferSuggestions([]);
      setSelectedTransferSuggestionIndex(0);
      setTransferMessage("Pick at least one competency to include.");
      return;
    }

    const suggestions = getTransferSuggestions({
      snapshot,
      sourceScheduleId,
      targetScheduleId,
      selectedCompetencyIds: selectedTransferCompetencyIds,
    });

    if (suggestions.length === 0) {
      setTransferSuggestions([]);
      setSelectedTransferSuggestionIndex(0);
      setTransferMessage("No single-person transfer fit was found for that mix.");
      return;
    }

    setTransferSuggestions(suggestions);
    setSelectedTransferSuggestionIndex(0);
    setTransferMessage("");
  }

  const transferSuggestion = transferSuggestions[selectedTransferSuggestionIndex] ?? null;

  return (
    <section className="metrics-section">
      <div className="metrics-section__header">
        <div className="metrics-section__title-group">
          <h2 className="metrics-section__title">Competencies By Team</h2>
          <button type="button" className="ghost-button" onClick={() => setIsTransferModalOpen(true)}>
            Shift Transfer
          </button>
        </div>
      </div>

      <div className="metrics-team-list">
        {teamMetrics.map((team) => (
          <article key={team.scheduleId} className="metrics-card">
            <div className="metrics-card__header">
              <div>
                <p className="metrics-card__eyebrow">Shift {team.scheduleName}</p>
                <h3 className="metrics-card__title">Qualified staff by competency</h3>
              </div>
            </div>

            <div className="metrics-bars">
              {team.competencyMetrics.map((metric) => (
                <div key={metric.competencyId} className="metrics-bar-row">
                  <div className="metrics-bar-row__label">
                    <span className={`legend-pill legend-pill--${metric.colorToken.toLowerCase()}`}>
                      {metric.code}
                    </span>
                    <strong>{metric.qualifiedPeople}</strong>
                  </div>
                  <div className="metrics-bar-track">
                    <span
                      className={`metrics-bar-fill metrics-bar-fill--${metric.colorToken.toLowerCase()}`}
                      style={{
                        width:
                          metric.qualifiedPeople === 0
                            ? "0%"
                            : `${Math.max(8, (metric.qualifiedPeople / maxQualifiedPeople) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>

      {isTransferModalOpen && typeof document !== "undefined"
        ? createPortal(
            <div className="assignment-modal-backdrop" onClick={() => setIsTransferModalOpen(false)}>
              <section
                className="assignment-modal metrics-transfer-modal"
                aria-label="Shift transfer planner"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="assignment-modal__header">
                  <div>
                    <h2 className="assignment-modal__title">Shift Transfer</h2>
                    <p className="assignment-modal__context">
                      Pick a source shift, target shift, and the competencies to include. This calculates the best
                      single-person transfer only.
                    </p>
                  </div>
                  <button type="button" className="ghost-button" onClick={() => setIsTransferModalOpen(false)}>
                    Close
                  </button>
                </div>

                <div className="metrics-transfer-grid">
                  <label className="field">
                    <span>From shift</span>
                    <select
                      value={sourceScheduleId}
                      onChange={(event) => {
                        setSourceScheduleId(event.target.value);
                        setTransferSuggestions([]);
                        setSelectedTransferSuggestionIndex(0);
                        setTransferMessage("");
                      }}
                    >
                      {snapshot.schedules.map((schedule) => (
                        <option key={schedule.id} value={schedule.id}>
                          {schedule.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>To shift</span>
                    <select
                      value={targetScheduleId}
                      onChange={(event) => {
                        setTargetScheduleId(event.target.value);
                        setTransferSuggestions([]);
                        setSelectedTransferSuggestionIndex(0);
                        setTransferMessage("");
                      }}
                    >
                      {snapshot.schedules.map((schedule) => (
                        <option key={schedule.id} value={schedule.id}>
                          {schedule.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="assignment-modal__group">
                  <span className="assignment-modal__label">Include competencies</span>
                  <div className="assignment-modal__options">
                    {snapshot.competencies.map((competency) => {
                      const isSelected = selectedTransferCompetencyIds.includes(competency.id);

                      return (
                        <button
                          key={competency.id}
                          type="button"
                          className={`assignment-modal__option ${isSelected ? "assignment-modal__option--active" : ""}`}
                          onClick={() => toggleTransferCompetency(competency.id)}
                        >
                          <span className={`legend-pill legend-pill--${competency.colorToken.toLowerCase()}`}>
                            {competency.code}
                          </span>
                          <span>{competency.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="assignment-modal__actions">
                  <button type="button" className="primary-button" onClick={handleCalculateTransfer}>
                    Calculate shift transfer
                  </button>
                </div>

                {transferMessage ? <p className="toolbar-status">{transferMessage}</p> : null}

                {transferSuggestions.length > 0 ? (
                  <section className="metrics-transfer-results">
                    <div className="metrics-transfer-results__header">
                      <strong>
                        {transferSuggestions.length} possible transfer{transferSuggestions.length === 1 ? "" : "s"}
                      </strong>
                      {transferSuggestions.length > 1 ? (
                        <label className="field field--compact">
                          <span>Option</span>
                          <select
                            value={selectedTransferSuggestionIndex}
                            onChange={(event) => setSelectedTransferSuggestionIndex(Number(event.target.value))}
                          >
                            {transferSuggestions.map((suggestion, index) => (
                              <option key={`${suggestion.employeeId}-${index}`} value={index}>
                                {index + 1}. {suggestion.employeeName}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                    </div>

                    {transferSuggestion ? (
                      <div className="metrics-transfer-result">
                        <div className="metrics-transfer-result__summary">
                          <div>
                            <span className="metrics-card__eyebrow">Recommended transfer</span>
                            <h3 className="metrics-card__title">{transferSuggestion.employeeName}</h3>
                          </div>
                          <div className="metrics-card__stats">
                            <span>{transferSuggestion.employeeRole || "No role"}</span>
                            <span>Score {transferSuggestion.score.toFixed(2)}</span>
                          </div>
                        </div>

                        <div className="metrics-transfer-pill-row">
                          <span className="metrics-transfer-path">
                            Shift {transferSuggestion.sourceScheduleName} → Shift {transferSuggestion.targetScheduleName}
                          </span>
                        </div>

                        {transferSuggestion.matchedCompetencyIds.length > 0 ? (
                          <div className="metrics-transfer-pill-row">
                            {transferSuggestion.projections
                              .filter((projection) => projection.included)
                              .map((projection) => (
                                <span
                                  key={projection.competencyId}
                                  className={`legend-pill legend-pill--${projection.colorToken.toLowerCase()}`}
                                >
                                  {projection.code}
                                </span>
                              ))}
                          </div>
                        ) : null}

                        <div className="metrics-transfer-projections">
                          {transferSuggestion.projections.map((projection) => (
                            <div key={projection.competencyId} className="metrics-transfer-projection">
                              <div className="metrics-transfer-projection__label">
                                <span className={`legend-pill legend-pill--${projection.colorToken.toLowerCase()}`}>
                                  {projection.code}
                                </span>
                                <strong>{projection.included ? "Included" : "Reference"}</strong>
                              </div>
                              <p>
                                Shift {transferSuggestion.sourceScheduleName}: {projection.sourceCount} to{" "}
                                {projection.nextSourceCount}
                              </p>
                              <p>
                                Shift {transferSuggestion.targetScheduleName}: {projection.targetCount} to{" "}
                                {projection.nextTargetCount}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </section>
                ) : null}
              </section>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}

export function MetricsOvertimeSection({
  snapshot,
  overtimeHistory,
  assignmentHistory,
}: {
  snapshot: SchedulerSnapshot;
  overtimeHistory: OvertimeClaim[];
  assignmentHistory: StoredAssignment[];
}) {
  const [overtimeWindow, setOvertimeWindow] = useState<OvertimeWindow>("30d");
  const metricsAnchorDate = useMemo(() => getMetricsAnchorDate(snapshot.month), [snapshot.month]);
  const filteredOvertimeHistory = useMemo(() => {
    const start = getWindowStart(metricsAnchorDate, overtimeWindow);
    return overtimeHistory.filter((claim) => claim.date >= start && claim.date <= metricsAnchorDate);
  }, [metricsAnchorDate, overtimeHistory, overtimeWindow]);
  const filteredAssignmentHistory = useMemo(() => {
    const start = getWindowStart(metricsAnchorDate, overtimeWindow);
    return assignmentHistory.filter((assignment) => assignment.date >= start && assignment.date <= metricsAnchorDate);
  }, [assignmentHistory, metricsAnchorDate, overtimeWindow]);
  const filteredEntries = useMemo(
    () => getOvertimeMetricEntries(snapshot, filteredOvertimeHistory, filteredAssignmentHistory),
    [filteredAssignmentHistory, filteredOvertimeHistory, snapshot],
  );
  const teamMetrics = useMemo(
    () => getTeamMetrics(snapshot, filteredEntries, [], metricsAnchorDate),
    [filteredEntries, metricsAnchorDate, snapshot],
  );
  const maxOvertimeShifts = Math.max(1, ...teamMetrics.map((team) => team.overtimeShifts));

  return (
    <section className="metrics-section">
      <div className="metrics-section__header">
        <div className="metrics-section__title-group">
          <h2 className="metrics-section__title">Overtime Incurred By Team</h2>
          <p className="toolbar-status">Anchored to {formatAnchorDateLabel(metricsAnchorDate)}</p>
        </div>
        <div className="metrics-window-toggle" aria-label="Overtime time window">
          {(["30d", "90d", "1y", "ytd"] as OvertimeWindow[]).map((window) => (
            <button
              key={window}
              type="button"
              className={`ghost-button ${overtimeWindow === window ? "ghost-button--active" : ""}`}
              onClick={() => setOvertimeWindow(window)}
            >
              {window.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="metrics-team-list">
        {teamMetrics.map((team) => (
          <article key={`${team.scheduleId}-overtime`} className="metrics-card">
            <div className="metrics-card__header">
              <div>
                <p className="metrics-card__eyebrow">Shift {team.scheduleName}</p>
                <h3 className="metrics-card__title">
                  {team.overtimeShifts} overtime shift{team.overtimeShifts === 1 ? "" : "s"}
                </h3>
              </div>
              <div className="metrics-card__stats">
                <span>{team.overtimeWorkers} worker{team.overtimeWorkers === 1 ? "" : "s"}</span>
                <span>{team.topCompetencyCode ? `Top post ${team.topCompetencyCode}` : "No overtime yet"}</span>
              </div>
            </div>

            <div className="metrics-bar-track metrics-bar-track--tall">
              <span
                className="metrics-bar-fill metrics-bar-fill--overtime"
                style={{
                  width: `${team.overtimeShifts === 0 ? 0 : Math.max(10, (team.overtimeShifts / maxOvertimeShifts) * 100)}%`,
                }}
              />
            </div>

            <div className="metrics-top-list">
              <strong className="metrics-top-list__title">Top 3 overtime personnel</strong>
              <div className="metrics-top-list__rows">
                {padMetricPeopleRows(team.topOvertimePeople).map((person, index) => (
                  <div
                    key={person?.employeeId ?? `overtime-empty-${team.scheduleId}-${index}`}
                    className={`metrics-top-list__row ${person ? "" : "metrics-top-list__row--empty"}`}
                  >
                    <span>{person?.employeeName ?? "\u00A0"}</span>
                    <strong>{person ? person.claimedShifts : "\u00A0"}</strong>
                  </div>
                ))}
              </div>
            </div>

            <div className="metrics-top-list">
              <strong className="metrics-top-list__title">Top 3 overtime competencies</strong>
              <div className="metrics-top-list__rows">
                {padMetricRows(team.topOvertimeCompetencies).map((competency, index) => (
                  <div
                    key={competency?.competencyId ?? `overtime-competency-empty-${team.scheduleId}-${index}`}
                    className={`metrics-top-list__row ${competency ? "" : "metrics-top-list__row--empty"}`}
                  >
                    <span>{competency?.code ?? "\u00A0"}</span>
                    <strong>{competency ? competency.claimedShifts : "\u00A0"}</strong>
                  </div>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function MetricsFatigueSection({
  snapshot,
  overtimeHistory,
  assignmentHistory,
}: {
  snapshot: SchedulerSnapshot;
  overtimeHistory: OvertimeClaim[];
  assignmentHistory: StoredAssignment[];
}) {
  const teamFatigueMetrics = useMemo(
    () =>
      getTeamFatigueMetrics({
        snapshot,
        assignmentHistory,
        overtimeHistory,
        month: snapshot.month,
      }),
    [assignmentHistory, overtimeHistory, snapshot],
  );

  return (
    <section className="metrics-section">
      <div className="metrics-section__header">
        <div className="metrics-section__title-group">
          <h2 className="metrics-section__title">Fatigue Potential</h2>
          <p className="toolbar-status">Consecutive shifts worked in {formatMonthLabel(snapshot.month)}</p>
        </div>
      </div>

      <div className="metrics-team-list">
        {teamFatigueMetrics.map((team) => (
          <article key={`${team.scheduleId}-fatigue`} className="metrics-card">
            <div className="metrics-card__header">
              <div>
                <p className="metrics-card__eyebrow">Shift {team.scheduleName}</p>
                <h3 className="metrics-card__title">
                  {team.totalScheduledEmployees} scheduled employee{team.totalScheduledEmployees === 1 ? "" : "s"}
                </h3>
              </div>
              <div className="metrics-card__stats">
                <span>Highest streak {team.highestStreak}</span>
                <span>{team.countAboveNormalCycle} above normal cycle</span>
                <span>Avg {team.averageConsecutiveShifts.toFixed(1)}</span>
              </div>
            </div>

            <div className="metrics-fatigue-bands" aria-label={`Fatigue bands for shift ${team.scheduleName}`}>
              <span className="metrics-fatigue-band metrics-fatigue-band--green">
                Good <strong>{team.greenCount}</strong>
              </span>
              <span className="metrics-fatigue-band metrics-fatigue-band--amber">
                Caution <strong>{team.amberCount}</strong>
              </span>
              <span className="metrics-fatigue-band metrics-fatigue-band--red">
                Warning <strong>{team.redCount}</strong>
              </span>
              <span className="metrics-fatigue-band metrics-fatigue-band--critical">
                Critical <strong>{team.criticalCount}</strong>
              </span>
            </div>

            <div className="metrics-top-list">
              <strong className="metrics-top-list__title">Top 3 fatigue potential</strong>
              <div className="metrics-top-list__rows">
                {padMetricRows(team.topEmployees).map((employee, index) => (
                  <div
                    key={employee?.employeeId ?? `fatigue-empty-${team.scheduleId}-${index}`}
                    className={`metrics-top-list__row metrics-top-list__row--stacked ${
                      employee ? "" : "metrics-top-list__row--empty"
                    }`}
                    title={
                      employee
                        ? `${employee.employeeName}: ${employee.consecutiveShifts} consecutive shifts worked. Normal cycle = ${NORMAL_FATIGUE_CYCLE}. Excess = ${employee.excessOverNormalCycle}. Exposure band = ${formatFatigueBandLabel(employee.band)}.`
                        : undefined
                    }
                  >
                    <span>
                      {employee ? (
                        <>
                          <span className={`metrics-fatigue-dot metrics-fatigue-dot--${employee.band}`} />
                          <span>{employee.employeeName}</span>
                          <small>{formatFatigueBandLabel(employee.band)}</small>
                        </>
                      ) : (
                        "\u00A0"
                      )}
                    </span>
                    <strong>{employee ? employee.consecutiveShifts : "\u00A0"}</strong>
                  </div>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function MetricsFragilitySection({
  snapshot,
  overtimeHistory,
  assignmentHistory,
}: {
  snapshot: SchedulerSnapshot;
  overtimeHistory: OvertimeClaim[];
  assignmentHistory: StoredAssignment[];
}) {
  const [fragilityWindow, setFragilityWindow] = useState<FragilityWindow>("1y");
  const metricsAnchorDate = useMemo(() => getMetricsAnchorDate(snapshot.month), [snapshot.month]);
  const filteredOvertimeHistory = useMemo(() => {
    const start = getWindowStart(metricsAnchorDate, fragilityWindow);
    return overtimeHistory.filter((claim) => claim.date >= start && claim.date <= metricsAnchorDate);
  }, [fragilityWindow, metricsAnchorDate, overtimeHistory]);
  const filteredAssignmentHistory = useMemo(() => {
    const start = getWindowStart(metricsAnchorDate, fragilityWindow);
    return assignmentHistory.filter((assignment) => assignment.date >= start && assignment.date <= metricsAnchorDate);
  }, [assignmentHistory, fragilityWindow, metricsAnchorDate]);
  const filteredEntries = useMemo(
    () => getOvertimeMetricEntries(snapshot, filteredOvertimeHistory, filteredAssignmentHistory),
    [filteredAssignmentHistory, filteredOvertimeHistory, snapshot],
  );
  const teamMetrics = useMemo(
    () => getTeamMetrics(snapshot, [], filteredEntries, metricsAnchorDate),
    [filteredEntries, metricsAnchorDate, snapshot],
  );
  const maxFragilityScore = Math.max(
    1,
    ...teamMetrics.flatMap((team) => team.shiftFragilityMetrics.map((metric) => metric.riskScore)),
  );

  return (
    <section className="metrics-section">
      <div className="metrics-section__header">
        <div className="metrics-section__title-group">
          <h2 className="metrics-section__title">Shift Fragility</h2>
          <p className="toolbar-status">Historical overtime risk, anchored to {formatAnchorDateLabel(metricsAnchorDate)}</p>
        </div>
        <div className="metrics-window-toggle" aria-label="Shift fragility history window">
          {(["30d", "90d", "1y", "ytd"] as FragilityWindow[]).map((window) => (
            <button
              key={window}
              type="button"
              className={`ghost-button ${fragilityWindow === window ? "ghost-button--active" : ""}`}
              onClick={() => setFragilityWindow(window)}
            >
              {window.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="metrics-team-list">
        {teamMetrics.map((team) => {
          const topFragilityScore = team.shiftFragilityMetrics[0]?.riskScore ?? 0;

          return (
            <article key={`${team.scheduleId}-fragility`} className="metrics-card">
              <div className="metrics-card__header">
                <div>
                  <p className="metrics-card__eyebrow">Shift {team.scheduleName}</p>
                  <h3 className="metrics-card__title">
                    {topFragilityScore > 0
                      ? `${formatFragilityScore(topFragilityScore)} risk score`
                      : "No historical fragility"}
                  </h3>
                </div>
                <div className="metrics-card__stats">
                  <span>Recent OT weighted</span>
                  <span>Depth adjusted</span>
                </div>
              </div>

              <div className="metrics-bar-track metrics-bar-track--tall">
                <span
                  className="metrics-bar-fill metrics-bar-fill--fragility"
                  style={{
                    width: `${topFragilityScore === 0 ? 0 : Math.max(10, (topFragilityScore / maxFragilityScore) * 100)}%`,
                  }}
                />
              </div>

              <div className="metrics-top-list">
                <strong className="metrics-top-list__title">Top risk competencies</strong>
                <div className="metrics-top-list__rows">
                  {padMetricRows(team.shiftFragilityMetrics).map((metric, index) => (
                    <div
                      key={metric?.competencyId ?? `fragility-empty-${team.scheduleId}-${index}`}
                      className={`metrics-top-list__row metrics-top-list__row--stacked ${
                        metric ? "" : "metrics-top-list__row--empty"
                      }`}
                    >
                      <span>
                        {metric ? (
                          <>
                            <span className={`legend-pill legend-pill--${metric.colorToken.toLowerCase()}`}>
                              {metric.code}
                            </span>
                            <small>
                              {metric.overtimeClaims} OT · {metric.qualifiedPeople}/{metric.requiredStaff} qualified
                            </small>
                          </>
                        ) : (
                          "\u00A0"
                        )}
                      </span>
                      <strong>{metric ? formatFragilityScore(metric.riskScore) : "\u00A0"}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function MetricsTimeCodeSection({
  snapshot,
  assignmentHistory,
}: {
  snapshot: SchedulerSnapshot;
  assignmentHistory: StoredAssignment[];
}) {
  const [timeCodeWindow, setTimeCodeWindow] = useState<TimeCodeWindow>("30d");
  const [selectedTimeCodeId, setSelectedTimeCodeId] = useState(snapshot.timeCodes[0]?.id ?? "");
  const metricsAnchorDate = useMemo(() => getMetricsAnchorDate(snapshot.month), [snapshot.month]);

  useEffect(() => {
    setSelectedTimeCodeId((current) =>
      snapshot.timeCodes.some((timeCode) => timeCode.id === current) ? current : snapshot.timeCodes[0]?.id ?? "",
    );
  }, [snapshot]);

  const filteredAssignmentHistory = useMemo(() => {
    const start = getTimeCodeWindowStart(metricsAnchorDate, timeCodeWindow);
    return assignmentHistory.filter((assignment) => assignment.date >= start && assignment.date <= metricsAnchorDate);
  }, [assignmentHistory, metricsAnchorDate, timeCodeWindow]);
  const teamTimeCodeMetrics = useMemo(
    () => getTeamTimeCodeMetrics(snapshot, filteredAssignmentHistory, selectedTimeCodeId),
    [filteredAssignmentHistory, selectedTimeCodeId, snapshot],
  );
  const maxTimeCodeShifts = Math.max(1, ...teamTimeCodeMetrics.map((team) => team.entryCount));

  return (
    <section className="metrics-section">
      <div className="metrics-section__header">
        <div className="metrics-section__title-group">
          <h2 className="metrics-section__title">Time Code Usage By Team</h2>
          {snapshot.timeCodes.length > 0 ? (
            <label className="field metrics-field-inline">
              <select value={selectedTimeCodeId} onChange={(event) => setSelectedTimeCodeId(event.target.value)}>
                {snapshot.timeCodes.map((timeCode) => (
                  <option key={timeCode.id} value={timeCode.id}>
                    {timeCode.code} · {timeCode.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <div className="metrics-section__controls">
          <p className="toolbar-status">Anchored to {formatAnchorDateLabel(metricsAnchorDate)}</p>
          <div className="metrics-window-toggle" aria-label="Time code time window">
            {(["30d", "90d", "1y", "ytd"] as TimeCodeWindow[]).map((window) => (
              <button
                key={window}
                type="button"
                className={`ghost-button ${timeCodeWindow === window ? "ghost-button--active" : ""}`}
                onClick={() => setTimeCodeWindow(window)}
              >
                {window.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {snapshot.timeCodes.length === 0 ? (
        <div className="empty-state">
          <strong>No time codes available.</strong>
          <span>Add time codes to start tracking usage by team.</span>
        </div>
      ) : (
        <div className="metrics-team-list">
          {teamTimeCodeMetrics.map((team) => (
            <article key={`${team.scheduleId}-time-code`} className="metrics-card">
              <div className="metrics-card__header">
                <div>
                  <p className="metrics-card__eyebrow">Shift {team.scheduleName}</p>
                  <h3 className="metrics-card__title">
                    {team.entryCount} schedule entr{team.entryCount === 1 ? "y" : "ies"} with this code
                  </h3>
                </div>
                <div className="metrics-card__stats">
                  <span>{team.peopleCount} people</span>
                </div>
              </div>

              <div className="metrics-bar-track metrics-bar-track--tall">
                <span
                  className="metrics-bar-fill metrics-bar-fill--slate"
                  style={{
                    width: `${team.entryCount === 0 ? 0 : Math.max(10, (team.entryCount / maxTimeCodeShifts) * 100)}%`,
                  }}
                />
              </div>

              <div className="metrics-top-list">
                <strong className="metrics-top-list__title">Top 3 personnel</strong>
                <div className="metrics-top-list__rows">
                  {padMetricPeopleRows(team.topPeople).map((person, index) => (
                    <div
                      key={person?.employeeId ?? `time-code-empty-${team.scheduleId}-${index}`}
                      className={`metrics-top-list__row ${person ? "" : "metrics-top-list__row--empty"}`}
                    >
                      <span>{person?.employeeName ?? "\u00A0"}</span>
                      <strong>{person ? person.codedShifts : "\u00A0"}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
