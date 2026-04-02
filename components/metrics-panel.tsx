import {
  buildAssignmentIndex,
  formatMonthLabel,
  getEmployeeMap,
  getMonthDays,
} from "@/lib/scheduling";
import type { SchedulerSnapshot } from "@/lib/types";

type TeamCompetencyMetric = {
  competencyId: string;
  code: string;
  colorToken: string;
  assignedShifts: number;
};

type TeamMetric = {
  scheduleId: string;
  scheduleName: string;
  competencyMetrics: TeamCompetencyMetric[];
  overtimeShifts: number;
  overtimeWorkers: number;
  topCompetencyCode: string | null;
};

function getTeamMetrics(snapshot: SchedulerSnapshot): TeamMetric[] {
  const monthDays = getMonthDays(snapshot.month);
  const assignmentIndex = buildAssignmentIndex(snapshot.assignments);
  const employeeMap = getEmployeeMap(snapshot.schedules);

  return snapshot.schedules.map((schedule) => {
    const competencyCounts = new Map<string, number>();

    for (const employee of schedule.employees) {
      for (const day of monthDays) {
        const selection = assignmentIndex[`${employee.id}:${day.date}`];

        if (selection?.competencyId) {
          competencyCounts.set(
            selection.competencyId,
            (competencyCounts.get(selection.competencyId) ?? 0) + 1,
          );
        }
      }
    }

    for (const claim of snapshot.overtimeClaims) {
      if (claim.scheduleId !== schedule.id) {
        continue;
      }

      const claimEmployee = employeeMap[claim.employeeId];

      if (!claimEmployee || claimEmployee.scheduleId === schedule.id) {
        continue;
      }

      competencyCounts.set(
        claim.competencyId,
        (competencyCounts.get(claim.competencyId) ?? 0) + 1,
      );
    }

    const competencyMetrics = snapshot.competencies
      .map((competency) => ({
        competencyId: competency.id,
        code: competency.code,
        colorToken: competency.colorToken,
        assignedShifts: competencyCounts.get(competency.id) ?? 0,
      }))
      .filter((metric) => metric.assignedShifts > 0)
      .sort((left, right) => right.assignedShifts - left.assignedShifts || left.code.localeCompare(right.code));

    const borrowedClaims = snapshot.overtimeClaims.filter((claim) => {
      if (claim.scheduleId !== schedule.id) {
        return false;
      }

      const claimEmployee = employeeMap[claim.employeeId];
      return Boolean(claimEmployee && claimEmployee.scheduleId !== schedule.id);
    });

    const topCompetencyCode =
      competencyMetrics[0]?.code ??
      snapshot.competencies.find((competency) => competency.id === borrowedClaims[0]?.competencyId)?.code ??
      null;

    return {
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      competencyMetrics,
      overtimeShifts: borrowedClaims.length,
      overtimeWorkers: new Set(borrowedClaims.map((claim) => claim.employeeId)).size,
      topCompetencyCode,
    };
  });
}

export function MetricsPanel({ snapshot }: { snapshot: SchedulerSnapshot }) {
  const teamMetrics = getTeamMetrics(snapshot);
  const maxAssignedShifts = Math.max(
    1,
    ...teamMetrics.flatMap((team) => team.competencyMetrics.map((metric) => metric.assignedShifts)),
  );
  const maxOvertimeShifts = Math.max(1, ...teamMetrics.map((team) => team.overtimeShifts));

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
          </div>

          <div className="metrics-team-list">
            {teamMetrics.map((team) => (
              <article key={team.scheduleId} className="metrics-card">
                <div className="metrics-card__header">
                  <div>
                    <p className="metrics-card__eyebrow">Shift {team.scheduleName}</p>
                    <h3 className="metrics-card__title">Competency load</h3>
                  </div>
                </div>

                {team.competencyMetrics.length > 0 ? (
                  <div className="metrics-bars">
                    {team.competencyMetrics.map((metric) => (
                      <div key={metric.competencyId} className="metrics-bar-row">
                        <div className="metrics-bar-row__label">
                          <span className={`legend-pill legend-pill--${metric.colorToken.toLowerCase()}`}>
                            {metric.code}
                          </span>
                          <strong>{metric.assignedShifts}</strong>
                        </div>
                        <div className="metrics-bar-track">
                          <span
                            className={`metrics-bar-fill metrics-bar-fill--${metric.colorToken.toLowerCase()}`}
                            style={{
                              width: `${Math.max(8, (metric.assignedShifts / maxAssignedShifts) * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <strong>No competency assignments yet.</strong>
                    <span>This shift has no competency-coded cells in the current month.</span>
                  </div>
                )}
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
                    <h3 className="metrics-card__title">{team.overtimeShifts} overtime shift{team.overtimeShifts === 1 ? "" : "s"}</h3>
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
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
