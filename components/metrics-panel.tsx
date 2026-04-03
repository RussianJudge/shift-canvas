"use client";

import { useMemo, useState } from "react";

import {
  formatMonthLabel,
  getEmployeeMap,
} from "@/lib/scheduling";
import type { Competency, SchedulerSnapshot } from "@/lib/types";

type TeamCompetencyMetric = {
  competencyId: string;
  code: string;
  colorToken: string;
  qualifiedPeople: number;
};

type TeamMetric = {
  scheduleId: string;
  scheduleName: string;
  competencyMetrics: TeamCompetencyMetric[];
  overtimeShifts: number;
  overtimeWorkers: number;
  topCompetencyCode: string | null;
  topOvertimePeople: Array<{
    employeeId: string;
    employeeName: string;
    claimedShifts: number;
  }>;
};

type TransferProjection = {
  competencyId: string;
  code: string;
  colorToken: string;
  sourceCount: number;
  targetCount: number;
  nextSourceCount: number;
  nextTargetCount: number;
  included: boolean;
  improvesTarget: boolean;
};

type TransferSuggestion = {
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  sourceScheduleName: string;
  targetScheduleName: string;
  score: number;
  matchedCompetencyIds: string[];
  projections: TransferProjection[];
};

function getTeamMetrics(snapshot: SchedulerSnapshot): TeamMetric[] {
  const employeeMap = getEmployeeMap(snapshot.schedules);

  return snapshot.schedules.map((schedule) => {
    const competencyMetrics = snapshot.competencies
      .map((competency) => ({
        competencyId: competency.id,
        code: competency.code,
        colorToken: competency.colorToken,
        qualifiedPeople: schedule.employees.filter((employee) =>
          employee.competencyIds.includes(competency.id),
        ).length,
      }))
      .sort((left, right) => right.qualifiedPeople - left.qualifiedPeople || left.code.localeCompare(right.code));

    const borrowedClaims = snapshot.overtimeClaims.filter((claim) => {
      if (claim.scheduleId !== schedule.id) {
        return false;
      }

      const claimEmployee = employeeMap[claim.employeeId];
      return Boolean(claimEmployee && claimEmployee.scheduleId !== schedule.id);
    });

    const overtimeCounts = borrowedClaims.reduce<Record<string, number>>((counts, claim) => {
      counts[claim.competencyId] = (counts[claim.competencyId] ?? 0) + 1;
      return counts;
    }, {});

    const topOvertimeCompetencyId =
      Object.entries(overtimeCounts).sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;

    const topCompetencyCode =
      snapshot.competencies.find((competency) => competency.id === topOvertimeCompetencyId)?.code ??
      null;

    const overtimePeopleCounts = borrowedClaims.reduce<Record<string, number>>((counts, claim) => {
      counts[claim.employeeId] = (counts[claim.employeeId] ?? 0) + 1;
      return counts;
    }, {});

    const topOvertimePeople = Object.entries(overtimePeopleCounts)
      .map(([employeeId, claimedShifts]) => ({
        employeeId,
        employeeName: employeeMap[employeeId]?.name ?? employeeId,
        claimedShifts,
      }))
      .sort(
        (left, right) =>
          right.claimedShifts - left.claimedShifts ||
          left.employeeName.localeCompare(right.employeeName),
      )
      .slice(0, 3);

    return {
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      competencyMetrics,
      overtimeShifts: borrowedClaims.length,
      overtimeWorkers: new Set(borrowedClaims.map((claim) => claim.employeeId)).size,
      topCompetencyCode,
      topOvertimePeople,
    };
  });
}

function buildQualifiedCountMap(snapshot: SchedulerSnapshot) {
  return Object.fromEntries(
    snapshot.schedules.map((schedule) => [
      schedule.id,
      Object.fromEntries(
        snapshot.competencies.map((competency) => [
          competency.id,
          schedule.employees.filter((employee) => employee.competencyIds.includes(competency.id)).length,
        ]),
      ),
    ]),
  ) as Record<string, Record<string, number>>;
}

function getBestTransferSuggestion({
  snapshot,
  sourceScheduleId,
  targetScheduleId,
  selectedCompetencyIds,
}: {
  snapshot: SchedulerSnapshot;
  sourceScheduleId: string;
  targetScheduleId: string;
  selectedCompetencyIds: string[];
}) {
  if (
    !sourceScheduleId ||
    !targetScheduleId ||
    sourceScheduleId === targetScheduleId ||
    selectedCompetencyIds.length === 0
  ) {
    return null;
  }

  const sourceSchedule = snapshot.schedules.find((schedule) => schedule.id === sourceScheduleId);
  const targetSchedule = snapshot.schedules.find((schedule) => schedule.id === targetScheduleId);

  if (!sourceSchedule || !targetSchedule) {
    return null;
  }

  const competencyMap = Object.fromEntries(snapshot.competencies.map((competency) => [competency.id, competency])) as Record<
    string,
    Competency
  >;
  const qualifiedCountMap = buildQualifiedCountMap(snapshot);
  let bestSuggestion: TransferSuggestion | null = null;

  for (const employee of sourceSchedule.employees) {
    const matchedCompetencyIds = selectedCompetencyIds.filter((competencyId) =>
      employee.competencyIds.includes(competencyId),
    );

    if (matchedCompetencyIds.length === 0) {
      continue;
    }

    const projections = selectedCompetencyIds
      .map((competencyId) => {
        const competency = competencyMap[competencyId];

        if (!competency) {
          return null;
        }

        const sourceCount = qualifiedCountMap[sourceScheduleId]?.[competencyId] ?? 0;
        const targetCount = qualifiedCountMap[targetScheduleId]?.[competencyId] ?? 0;
        const included = matchedCompetencyIds.includes(competencyId);
        const nextSourceCount = sourceCount - Number(included);
        const nextTargetCount = targetCount + Number(included);

        return {
          competencyId,
          code: competency.code,
          colorToken: competency.colorToken,
          sourceCount,
          targetCount,
          nextSourceCount,
          nextTargetCount,
          included,
          improvesTarget: included && nextTargetCount > targetCount,
        } satisfies TransferProjection;
      })
      .filter((projection): projection is TransferProjection => Boolean(projection));

    const score =
      projections.reduce((total, projection) => {
        if (!projection.included) {
          return total;
        }

        const targetNeedWeight =
          projection.targetCount === 0 ? 2.6 : 1.6 / (projection.targetCount + 1);
        const balanceWeight = projection.targetCount < projection.sourceCount ? 0.9 : 0.2;
        const sourcePenalty =
          projection.sourceCount <= 1 ? 2.4 : 0.8 / projection.sourceCount;
        const overswingPenalty =
          projection.nextSourceCount < projection.targetCount ? 0.45 : 0;

        return total + targetNeedWeight + balanceWeight - sourcePenalty - overswingPenalty;
      }, 0) + matchedCompetencyIds.length * 0.35;

    if (
      !bestSuggestion ||
      score > bestSuggestion.score ||
      (Math.abs(score - bestSuggestion.score) < 0.001 &&
        matchedCompetencyIds.length > bestSuggestion.matchedCompetencyIds.length) ||
      (Math.abs(score - bestSuggestion.score) < 0.001 &&
        matchedCompetencyIds.length === bestSuggestion.matchedCompetencyIds.length &&
        employee.name.localeCompare(bestSuggestion.employeeName) < 0)
    ) {
      bestSuggestion = {
        employeeId: employee.id,
        employeeName: employee.name,
        employeeRole: employee.role,
        sourceScheduleName: sourceSchedule.name,
        targetScheduleName: targetSchedule.name,
        score,
        matchedCompetencyIds,
        projections,
      };
    }
  }

  return bestSuggestion;
}

export function MetricsPanel({ snapshot }: { snapshot: SchedulerSnapshot }) {
  const teamMetrics = useMemo(() => getTeamMetrics(snapshot), [snapshot]);
  const maxQualifiedPeople = Math.max(
    1,
    ...teamMetrics.flatMap((team) => team.competencyMetrics.map((metric) => metric.qualifiedPeople)),
  );
  const maxOvertimeShifts = Math.max(1, ...teamMetrics.map((team) => team.overtimeShifts));
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [sourceScheduleId, setSourceScheduleId] = useState(snapshot.schedules[0]?.id ?? "");
  const [targetScheduleId, setTargetScheduleId] = useState(snapshot.schedules[1]?.id ?? snapshot.schedules[0]?.id ?? "");
  const [selectedTransferCompetencyIds, setSelectedTransferCompetencyIds] = useState<string[]>([]);
  const [transferSuggestion, setTransferSuggestion] = useState<TransferSuggestion | null>(null);
  const [transferMessage, setTransferMessage] = useState("");

  function toggleTransferCompetency(competencyId: string) {
    setSelectedTransferCompetencyIds((current) =>
      current.includes(competencyId)
        ? current.filter((id) => id !== competencyId)
        : [...current, competencyId],
    );
    setTransferSuggestion(null);
    setTransferMessage("");
  }

  function handleCalculateTransfer() {
    if (!sourceScheduleId || !targetScheduleId || sourceScheduleId === targetScheduleId) {
      setTransferSuggestion(null);
      setTransferMessage("Choose two different shifts to calculate a transfer.");
      return;
    }

    if (selectedTransferCompetencyIds.length === 0) {
      setTransferSuggestion(null);
      setTransferMessage("Pick at least one competency to include.");
      return;
    }

    const suggestion = getBestTransferSuggestion({
      snapshot,
      sourceScheduleId,
      targetScheduleId,
      selectedCompetencyIds: selectedTransferCompetencyIds,
    });

    if (!suggestion) {
      setTransferSuggestion(null);
      setTransferMessage("No single-person transfer fit was found for that mix.");
      return;
    }

    setTransferSuggestion(suggestion);
    setTransferMessage("");
  }

  return (
    <section className="panel-frame">
      <div className="panel-heading panel-heading--simple">
        <h1 className="panel-title">Metrics</h1>
      </div>

      <div className="workspace-toolbar workspace-toolbar--metrics">
        <div className="field field--static">
          <span>Month</span>
          <strong>{formatMonthLabel(snapshot.month)}</strong>
        </div>
      </div>

      <div className="metrics-grid">
        <section className="metrics-section">
          <div className="metrics-section__header">
            <h2 className="metrics-section__title">Competencies By Team</h2>
            <button
              type="button"
              className="ghost-button"
              onClick={() => setIsTransferModalOpen(true)}
            >
              Shift Transfer
            </button>
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
        </section>

        <section className="metrics-section">
          <div className="metrics-section__header">
            <h2 className="metrics-section__title">Overtime Incurred By Team</h2>
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
                  {team.topOvertimePeople.length > 0 ? (
                    <div className="metrics-top-list__rows">
                      {team.topOvertimePeople.map((person) => (
                        <div key={person.employeeId} className="metrics-top-list__row">
                          <span>{person.employeeName}</span>
                          <strong>{person.claimedShifts}</strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="metrics-top-list__empty">No overtime claims this month</span>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>

      {isTransferModalOpen ? (
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
                  Pick a source shift, target shift, and the competencies to include. This calculates the best single-person transfer only.
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
                    setTransferSuggestion(null);
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
                    setTransferSuggestion(null);
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
                      className={`legend-pill legend-pill--${competency.colorToken.toLowerCase()} ${
                        isSelected ? "legend-pill--selected" : ""
                      }`}
                      onClick={() => toggleTransferCompetency(competency.id)}
                    >
                      {competency.code}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="metrics-transfer-actions">
              <button type="button" className="primary-button" onClick={handleCalculateTransfer}>
                Calculate best fit
              </button>
            </div>

            {transferMessage ? <p className="toolbar-status">{transferMessage}</p> : null}

            {transferSuggestion ? (
              <section className="metrics-transfer-result">
                <div className="metrics-transfer-result__header">
                  <div>
                    <p className="metrics-card__eyebrow">
                      Shift {transferSuggestion.sourceScheduleName} to Shift {transferSuggestion.targetScheduleName}
                    </p>
                    <h3 className="metrics-card__title">{transferSuggestion.employeeName}</h3>
                  </div>
                  <div className="metrics-card__stats">
                    <span>{transferSuggestion.employeeRole}</span>
                    <span>{transferSuggestion.matchedCompetencyIds.length} matched competency{transferSuggestion.matchedCompetencyIds.length === 1 ? "" : "ies"}</span>
                  </div>
                </div>

                <div className="metrics-transfer-pill-row">
                  {transferSuggestion.projections.filter((projection) => projection.included).map((projection) => (
                    <span
                      key={projection.competencyId}
                      className={`legend-pill legend-pill--${projection.colorToken.toLowerCase()}`}
                    >
                      {projection.code}
                    </span>
                  ))}
                </div>

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
                        Shift {transferSuggestion.sourceScheduleName}: {projection.sourceCount} to {projection.nextSourceCount}
                      </p>
                      <p>
                        Shift {transferSuggestion.targetScheduleName}: {projection.targetCount} to {projection.nextTargetCount}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </section>
        </div>
      ) : null}
    </section>
  );
}
