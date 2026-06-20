"use client";

import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

import { AppDateSelector } from "@/components/app-date-selector";
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
import { formatMonthLabel } from "@/lib/scheduling";
import type { Competency, OvertimeClaim, Schedule, SchedulerSnapshot, StoredAssignment } from "@/lib/types";

type MetricsSettingsTeamOption = Pick<Schedule, "id" | "name">;
type MetricsSettingsCompetencyOption = Pick<Competency, "id" | "code" | "label" | "colorToken">;
type MetricsSettingsContextValue = {
  includedTeamIds: Set<string>;
  includedCompetencyIds: Set<string>;
  hasTeamFilter: boolean;
  hasCompetencyFilter: boolean;
  registerSettingsOptions: (input: {
    schedules: MetricsSettingsTeamOption[];
    competencies: MetricsSettingsCompetencyOption[];
  }) => void;
};

const EMPTY_METRICS_SETTINGS: MetricsSettingsContextValue = {
  includedTeamIds: new Set<string>(),
  includedCompetencyIds: new Set<string>(),
  hasTeamFilter: false,
  hasCompetencyFilter: false,
  registerSettingsOptions: () => {},
};
const MetricsSettingsContext = createContext<MetricsSettingsContextValue>(EMPTY_METRICS_SETTINGS);

function areMetricOptionsEqual<T extends { id: string }>(left: T[], right: T[]) {
  return left.length === right.length && left.every((entry, index) => entry.id === right[index]?.id);
}

function areIdArraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 8.25a3.75 3.75 0 1 1 0 7.5a3.75 3.75 0 0 1 0-7.5Z" />
      <path d="M19.5 12a7.46 7.46 0 0 0-.15-1.5l2.1-1.62l-2-3.46l-2.48 1a7.6 7.6 0 0 0-2.6-1.5L14 2.25h-4l-.38 2.67a7.6 7.6 0 0 0-2.6 1.5l-2.48-1l-2 3.46l2.1 1.62a7.4 7.4 0 0 0 0 3l-2.1 1.62l2 3.46l2.48-1a7.6 7.6 0 0 0 2.6 1.5l.38 2.67h4l.38-2.67a7.6 7.6 0 0 0 2.6-1.5l2.48 1l2-3.46l-2.1-1.62c.1-.49.15-.99.15-1.5Z" />
    </svg>
  );
}

function useMetricsSettings(snapshot: SchedulerSnapshot) {
  const settings = useContext(MetricsSettingsContext);
  const { registerSettingsOptions } = settings;

  useEffect(() => {
    registerSettingsOptions({
      schedules: snapshot.schedules.map((schedule) => ({
        id: schedule.id,
        name: schedule.name,
      })),
      competencies: snapshot.competencies.map((competency) => ({
        id: competency.id,
        code: competency.code,
        label: competency.label,
        colorToken: competency.colorToken,
      })),
    });
  }, [registerSettingsOptions, snapshot.competencies, snapshot.schedules]);

  return settings;
}

function filterTeamMetricsBySettings<T extends { scheduleId: string }>(
  teamMetrics: T[],
  includedTeamIds: Set<string>,
  includedCompetencyIds: Set<string>,
  hasTeamFilter: boolean,
  hasCompetencyFilter: boolean,
): T[] {
  return teamMetrics
    .filter((team) => !hasTeamFilter || includedTeamIds.has(team.scheduleId))
    .map((team) => {
      const nextTeam = { ...team } as T & {
        competencyMetrics?: Array<{ competencyId: string }>;
        shiftFragilityMetrics?: Array<{ competencyId: string }>;
        topOvertimeCompetencies?: Array<{ competencyId: string }>;
      };

      if (Array.isArray(nextTeam.competencyMetrics)) {
        nextTeam.competencyMetrics = hasCompetencyFilter
          ? nextTeam.competencyMetrics.filter((metric) => includedCompetencyIds.has(metric.competencyId))
          : nextTeam.competencyMetrics;
      }

      if (Array.isArray(nextTeam.shiftFragilityMetrics)) {
        nextTeam.shiftFragilityMetrics = hasCompetencyFilter
          ? nextTeam.shiftFragilityMetrics.filter((metric) => includedCompetencyIds.has(metric.competencyId))
          : nextTeam.shiftFragilityMetrics;
      }

      if (Array.isArray(nextTeam.topOvertimeCompetencies)) {
        nextTeam.topOvertimeCompetencies = hasCompetencyFilter
          ? nextTeam.topOvertimeCompetencies.filter((metric) => includedCompetencyIds.has(metric.competencyId))
          : nextTeam.topOvertimeCompetencies;
      }

      return nextTeam;
    });
}

export function MetricsPageFrame({
  month,
  children,
}: {
  month: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [teamOptions, setTeamOptions] = useState<MetricsSettingsTeamOption[]>([]);
  const [competencyOptions, setCompetencyOptions] = useState<MetricsSettingsCompetencyOption[]>([]);
  const [includedTeamIds, setIncludedTeamIds] = useState<string[] | null>(null);
  const [includedCompetencyIds, setIncludedCompetencyIds] = useState<string[] | null>(null);
  const effectiveIncludedTeamIds = useMemo(
    () => new Set(includedTeamIds ?? teamOptions.map((team) => team.id)),
    [includedTeamIds, teamOptions],
  );
  const effectiveIncludedCompetencyIds = useMemo(
    () => new Set(includedCompetencyIds ?? competencyOptions.map((competency) => competency.id)),
    [competencyOptions, includedCompetencyIds],
  );
  const registerSettingsOptions = useCallback<MetricsSettingsContextValue["registerSettingsOptions"]>(
    ({ schedules, competencies }) => {
      setTeamOptions((current) => (areMetricOptionsEqual(current, schedules) ? current : schedules));
      setCompetencyOptions((current) => (areMetricOptionsEqual(current, competencies) ? current : competencies));
      setIncludedTeamIds((current) =>
        current === null
          ? current
          : (() => {
              const nextIds = current.filter((teamId) => schedules.some((schedule) => schedule.id === teamId));
              return areIdArraysEqual(current, nextIds) ? current : nextIds;
            })(),
      );
      setIncludedCompetencyIds((current) =>
        current === null
          ? current
          : (() => {
              const nextIds = current.filter((competencyId) =>
                competencies.some((competency) => competency.id === competencyId),
              );
              return areIdArraysEqual(current, nextIds) ? current : nextIds;
            })(),
      );
    },
    [],
  );
  const metricsSettings = useMemo<MetricsSettingsContextValue>(
    () => ({
      includedTeamIds: effectiveIncludedTeamIds,
      includedCompetencyIds: effectiveIncludedCompetencyIds,
      hasTeamFilter: includedTeamIds !== null,
      hasCompetencyFilter: includedCompetencyIds !== null,
      registerSettingsOptions,
    }),
    [
      effectiveIncludedCompetencyIds,
      effectiveIncludedTeamIds,
      includedCompetencyIds,
      includedTeamIds,
      registerSettingsOptions,
    ],
  );

  function navigateMonth(nextMonth: string) {
    router.push(`/metrics?month=${nextMonth}`, { scroll: false });
  }

  function toggleTeam(teamId: string) {
    setIncludedTeamIds((current) => {
      const allIds = teamOptions.map((team) => team.id);
      const nextIds = new Set(current ?? allIds);

      if (nextIds.has(teamId)) {
        nextIds.delete(teamId);
      } else {
        nextIds.add(teamId);
      }

      return allIds.filter((id) => nextIds.has(id));
    });
  }

  function toggleCompetency(competencyId: string) {
    setIncludedCompetencyIds((current) => {
      const allIds = competencyOptions.map((competency) => competency.id);
      const nextIds = new Set(current ?? allIds);

      if (nextIds.has(competencyId)) {
        nextIds.delete(competencyId);
      } else {
        nextIds.add(competencyId);
      }

      return allIds.filter((id) => nextIds.has(id));
    });
  }

  return (
    <MetricsSettingsContext.Provider value={metricsSettings}>
      <section className="panel-frame">
        <div className="panel-heading panel-heading--split">
          <div className="metrics-page-title">
            <h1 className="panel-title">Metrics</h1>
            <button
              type="button"
              className="ghost-button icon-button metrics-settings-button"
              onClick={() => setIsSettingsOpen(true)}
              aria-label="Metrics settings"
              title="Metrics settings"
            >
              <SettingsIcon />
            </button>
          </div>
          <AppDateSelector
            mode="month"
            value={month}
            label="Metrics month"
            className="metrics-month-pager"
            onChange={navigateMonth}
          />
        </div>

        <div className="metrics-grid">{children}</div>

        {isSettingsOpen && typeof document !== "undefined"
          ? createPortal(
              <div className="assignment-modal-backdrop" onClick={() => setIsSettingsOpen(false)}>
                <section
                  className="assignment-modal metrics-settings-modal"
                  aria-label="Metrics settings"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="assignment-modal__header">
                    <div>
                      <h2 className="assignment-modal__title">Metrics settings</h2>
                      <p className="assignment-modal__context">
                        Choose which teams and competencies are included in the Metrics cards.
                      </p>
                    </div>
                    <button type="button" className="ghost-button" onClick={() => setIsSettingsOpen(false)}>
                      Close
                    </button>
                  </div>

                  {teamOptions.length === 0 && competencyOptions.length === 0 ? (
                    <p className="metrics-top-list__empty">Metrics settings will be available once the page data loads.</p>
                  ) : (
                    <>
                      <div className="assignment-modal__group">
                        <div className="metrics-settings-modal__group-heading">
                          <span className="assignment-modal__label">Included teams</span>
                          <button type="button" className="ghost-button" onClick={() => setIncludedTeamIds(null)}>
                            Select all
                          </button>
                        </div>
                        <div className="metrics-settings-modal__options">
                          {teamOptions.map((team) => {
                            const isSelected = effectiveIncludedTeamIds.has(team.id);

                            return (
                              <button
                                key={team.id}
                                type="button"
                                className={`metrics-settings-option ${isSelected ? "metrics-settings-option--active" : ""}`}
                                aria-pressed={isSelected}
                                onClick={() => toggleTeam(team.id)}
                              >
                                <span>{isSelected ? "Included" : "Hidden"}</span>
                                <strong>Shift {team.name}</strong>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="assignment-modal__group">
                        <div className="metrics-settings-modal__group-heading">
                          <span className="assignment-modal__label">Included competencies</span>
                          <button type="button" className="ghost-button" onClick={() => setIncludedCompetencyIds(null)}>
                            Select all
                          </button>
                        </div>
                        <div className="metrics-settings-modal__options">
                          {competencyOptions.map((competency) => {
                            const isSelected = effectiveIncludedCompetencyIds.has(competency.id);

                            return (
                              <button
                                key={competency.id}
                                type="button"
                                className={`metrics-settings-option ${isSelected ? "metrics-settings-option--active" : ""}`}
                                aria-pressed={isSelected}
                                onClick={() => toggleCompetency(competency.id)}
                              >
                                <span className={`legend-pill legend-pill--${competency.colorToken.toLowerCase()}`}>
                                  {competency.code}
                                </span>
                                <strong>{competency.label}</strong>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  )}
                </section>
              </div>,
              document.body,
            )
          : null}
      </section>
    </MetricsSettingsContext.Provider>
  );
}

export function MetricsCompetenciesSection({ snapshot }: { snapshot: SchedulerSnapshot }) {
  const { includedTeamIds, includedCompetencyIds, hasTeamFilter, hasCompetencyFilter } = useMetricsSettings(snapshot);
  const metricsAnchorDate = useMemo(() => getMetricsAnchorDate(snapshot.month), [snapshot.month]);
  const allTeamMetrics = useMemo(
    () => getTeamMetrics(snapshot, [], [], metricsAnchorDate),
    [metricsAnchorDate, snapshot],
  );
  const teamMetrics = useMemo(
    () =>
      filterTeamMetricsBySettings(
        allTeamMetrics,
        includedTeamIds,
        includedCompetencyIds,
        hasTeamFilter,
        hasCompetencyFilter,
      ),
    [allTeamMetrics, hasCompetencyFilter, hasTeamFilter, includedCompetencyIds, includedTeamIds],
  );
  const maxQualifiedPeople = Math.max(
    1,
    ...teamMetrics.flatMap((team) => team.competencyMetrics.map((metric) => metric.qualifiedPeople)),
  );
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [sourceScheduleId, setSourceScheduleId] = useState(snapshot.schedules[0]?.id ?? "");
  const [targetScheduleId, setTargetScheduleId] = useState(snapshot.schedules[1]?.id ?? snapshot.schedules[0]?.id ?? "");
  const [selectedTransferCompetencyIds, setSelectedTransferCompetencyIds] = useState<string[]>([]);
  const [areTransferCompetenciesCollapsed, setAreTransferCompetenciesCollapsed] = useState(false);
  const [transferSuggestions, setTransferSuggestions] = useState<TransferSuggestion[]>([]);
  const [selectedTransferSuggestionIndex, setSelectedTransferSuggestionIndex] = useState(0);
  const [transferMessage, setTransferMessage] = useState("");
  const [selectedCompetencyModal, setSelectedCompetencyModal] = useState<{
    scheduleId: string;
    competencyId: string;
  } | null>(null);
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
    setAreTransferCompetenciesCollapsed(true);

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
  const selectedCompetencyTeam = selectedCompetencyModal
    ? teamMetrics.find((team) => team.scheduleId === selectedCompetencyModal.scheduleId) ?? null
    : null;
  const selectedCompetencyMetric = selectedCompetencyTeam && selectedCompetencyModal
    ? selectedCompetencyTeam.competencyMetrics.find(
        (metric) => metric.competencyId === selectedCompetencyModal.competencyId,
      ) ?? null
    : null;

  return (
    <section className="metrics-section">
      <div className="metrics-section__header">
        <div className="metrics-section__title-group">
          <h2 className="metrics-section__title">Competencies By Team</h2>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              setAreTransferCompetenciesCollapsed(false);
              setIsTransferModalOpen(true);
            }}
          >
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
                <button
                  key={metric.competencyId}
                  type="button"
                  className="metrics-bar-row metrics-bar-row--interactive"
                  onClick={() =>
                    setSelectedCompetencyModal({
                      scheduleId: team.scheduleId,
                      competencyId: metric.competencyId,
                    })
                  }
                >
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
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>

      {selectedCompetencyTeam && selectedCompetencyMetric && typeof document !== "undefined"
        ? createPortal(
            <div className="assignment-modal-backdrop" onClick={() => setSelectedCompetencyModal(null)}>
              <section
                className="assignment-modal metrics-competency-modal"
                aria-label="Qualified staff list"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="assignment-modal__header">
                  <div>
                    <h2 className="assignment-modal__title">
                      Shift {selectedCompetencyTeam.scheduleName} · {selectedCompetencyMetric.code}
                    </h2>
                    <p className="assignment-modal__context">
                      All workers on this team who are qualified for the selected competency.
                    </p>
                  </div>
                  <button type="button" className="ghost-button" onClick={() => setSelectedCompetencyModal(null)}>
                    Close
                  </button>
                </div>

                <div className="overtime-eligibility-modal__summary">
                  <div className="overtime-eligibility-modal__summary-row">
                    <span>Qualified staff</span>
                    <strong>
                      {selectedCompetencyMetric.qualifiedPeople} worker
                      {selectedCompetencyMetric.qualifiedPeople === 1 ? "" : "s"}
                    </strong>
                  </div>
                </div>

                {selectedCompetencyMetric.qualifiedEmployees.length > 0 ? (
                  <div className="metrics-competency-modal__list">
                    {selectedCompetencyMetric.qualifiedEmployees.map((employee) => (
                      <div key={employee.employeeId} className="metrics-competency-modal__row">
                        <strong>{employee.employeeName}</strong>
                        <span>{employee.employeeRole}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="metrics-top-list__empty">No qualified workers on this team.</p>
                )}
              </section>
            </div>,
            document.body,
          )
        : null}

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

                <div className="metrics-transfer-modal__body">
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

                  <div className="assignment-modal__group metrics-transfer-competency-group">
                    <div className="metrics-transfer-competency-header">
                      <div>
                        <span className="assignment-modal__label">Include competencies</span>
                        <p className="metrics-transfer-competency-summary">
                          {selectedTransferCompetencyIds.length} selected
                        </p>
                      </div>
                      <button
                        type="button"
                        className="ghost-button metrics-transfer-competency-toggle"
                        onClick={() => setAreTransferCompetenciesCollapsed((current) => !current)}
                      >
                        {areTransferCompetenciesCollapsed ? "Show" : "Hide"}
                      </button>
                    </div>

                    {!areTransferCompetenciesCollapsed ? (
                      <div className="assignment-modal__options metrics-transfer-competency-options">
                        {snapshot.competencies.map((competency) => {
                          const isSelected = selectedTransferCompetencyIds.includes(competency.id);

                          return (
                            <button
                              key={competency.id}
                              type="button"
                              className={`metrics-transfer-competency-option ${
                                isSelected ? "metrics-transfer-competency-option--active" : ""
                              }`}
                              aria-pressed={isSelected}
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
                    ) : null}
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
                              Shift {transferSuggestion.sourceScheduleName} → Shift{" "}
                              {transferSuggestion.targetScheduleName}
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
                </div>
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
  const { includedTeamIds, includedCompetencyIds, hasTeamFilter, hasCompetencyFilter } = useMetricsSettings(snapshot);
  const [overtimeWindow, setOvertimeWindow] = useState<OvertimeWindow>("30d");
  const [selectedOvertimeTeamId, setSelectedOvertimeTeamId] = useState<string | null>(null);
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
  const settingsFilteredEntries = useMemo(
    () =>
      filteredEntries.filter(
        (entry) =>
          (!hasTeamFilter || includedTeamIds.has(entry.scheduleId)) &&
          (!hasCompetencyFilter || !entry.competencyId || includedCompetencyIds.has(entry.competencyId)),
      ),
    [filteredEntries, hasCompetencyFilter, hasTeamFilter, includedCompetencyIds, includedTeamIds],
  );
  const allTeamMetrics = useMemo(
    () => getTeamMetrics(snapshot, settingsFilteredEntries, [], metricsAnchorDate),
    [metricsAnchorDate, settingsFilteredEntries, snapshot],
  );
  const teamMetrics = useMemo(
    () =>
      filterTeamMetricsBySettings(
        allTeamMetrics,
        includedTeamIds,
        includedCompetencyIds,
        hasTeamFilter,
        hasCompetencyFilter,
      ),
    [allTeamMetrics, hasCompetencyFilter, hasTeamFilter, includedCompetencyIds, includedTeamIds],
  );
  const maxOvertimeShifts = Math.max(1, ...teamMetrics.map((team) => team.overtimeShifts));
  const selectedOvertimeTeam = useMemo(
    () => teamMetrics.find((team) => team.scheduleId === selectedOvertimeTeamId) ?? null,
    [selectedOvertimeTeamId, teamMetrics],
  );

  useEffect(() => {
    if (selectedOvertimeTeamId && !selectedOvertimeTeam) {
      setSelectedOvertimeTeamId(null);
    }
  }, [selectedOvertimeTeam, selectedOvertimeTeamId]);

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
          <article
            key={`${team.scheduleId}-overtime`}
            className="metrics-card metrics-card--interactive"
            onClick={() => setSelectedOvertimeTeamId(team.scheduleId)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setSelectedOvertimeTeamId(team.scheduleId);
              }
            }}
            role="button"
            tabIndex={0}
            aria-label={`Open overtime personnel list for shift ${team.scheduleName}`}
          >
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

      {selectedOvertimeTeam && typeof document !== "undefined"
        ? createPortal(
            <div className="assignment-modal-backdrop" onClick={() => setSelectedOvertimeTeamId(null)}>
              <section
                className="assignment-modal metrics-overtime-modal"
                aria-label="Overtime personnel list"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="assignment-modal__header">
                  <div>
                    <h2 className="assignment-modal__title">Shift {selectedOvertimeTeam.scheduleName} overtime</h2>
                    <p className="assignment-modal__context">
                      All workers with overtime on this card in the selected {overtimeWindow.toUpperCase()} window.
                    </p>
                  </div>
                  <button type="button" className="ghost-button" onClick={() => setSelectedOvertimeTeamId(null)}>
                    Close
                  </button>
                </div>

                <div className="overtime-eligibility-modal__summary">
                  <div className="overtime-eligibility-modal__summary-row">
                    <span>Total overtime shifts</span>
                    <strong>
                      {selectedOvertimeTeam.overtimeShifts} shift{selectedOvertimeTeam.overtimeShifts === 1 ? "" : "s"}
                    </strong>
                  </div>
                  <div className="overtime-eligibility-modal__summary-row">
                    <span>Total workers</span>
                    <strong>
                      {selectedOvertimeTeam.overtimeWorkers} worker{selectedOvertimeTeam.overtimeWorkers === 1 ? "" : "s"}
                    </strong>
                  </div>
                </div>

                {selectedOvertimeTeam.allOvertimePeople.length > 0 ? (
                  <div className="metrics-overtime-modal__list">
                    {selectedOvertimeTeam.allOvertimePeople.map((person) => (
                      <div key={person.employeeId} className="metrics-overtime-modal__row">
                        <strong>{person.employeeName}</strong>
                        <span>
                          {person.claimedShifts} overtime shift{person.claimedShifts === 1 ? "" : "s"}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="metrics-top-list__empty">No overtime workers in this time window.</p>
                )}
              </section>
            </div>,
            document.body,
          )
        : null}
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
  const { includedTeamIds, hasTeamFilter } = useMetricsSettings(snapshot);
  const allTeamFatigueMetrics = useMemo(
    () =>
      getTeamFatigueMetrics({
        snapshot,
        assignmentHistory,
        overtimeHistory,
        month: snapshot.month,
      }),
    [assignmentHistory, overtimeHistory, snapshot],
  );
  const teamFatigueMetrics = useMemo(
    () =>
      hasTeamFilter
        ? allTeamFatigueMetrics.filter((team) => includedTeamIds.has(team.scheduleId))
        : allTeamFatigueMetrics,
    [allTeamFatigueMetrics, hasTeamFilter, includedTeamIds],
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
  const { includedTeamIds, includedCompetencyIds, hasTeamFilter, hasCompetencyFilter } = useMetricsSettings(snapshot);
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
  const settingsFilteredEntries = useMemo(
    () =>
      filteredEntries.filter(
        (entry) =>
          (!hasTeamFilter || includedTeamIds.has(entry.scheduleId)) &&
          (!hasCompetencyFilter || !entry.competencyId || includedCompetencyIds.has(entry.competencyId)),
      ),
    [filteredEntries, hasCompetencyFilter, hasTeamFilter, includedCompetencyIds, includedTeamIds],
  );
  const allTeamMetrics = useMemo(
    () => getTeamMetrics(snapshot, [], settingsFilteredEntries, metricsAnchorDate),
    [metricsAnchorDate, settingsFilteredEntries, snapshot],
  );
  const teamMetrics = useMemo(
    () =>
      filterTeamMetricsBySettings(
        allTeamMetrics,
        includedTeamIds,
        includedCompetencyIds,
        hasTeamFilter,
        hasCompetencyFilter,
      ),
    [allTeamMetrics, hasCompetencyFilter, hasTeamFilter, includedCompetencyIds, includedTeamIds],
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
  const { includedTeamIds, hasTeamFilter } = useMetricsSettings(snapshot);
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
  const allTeamTimeCodeMetrics = useMemo(
    () => getTeamTimeCodeMetrics(snapshot, filteredAssignmentHistory, selectedTimeCodeId),
    [filteredAssignmentHistory, selectedTimeCodeId, snapshot],
  );
  const teamTimeCodeMetrics = useMemo(
    () =>
      hasTeamFilter
        ? allTeamTimeCodeMetrics.filter((team) => includedTeamIds.has(team.scheduleId))
        : allTeamTimeCodeMetrics,
    [allTeamTimeCodeMetrics, hasTeamFilter, includedTeamIds],
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
