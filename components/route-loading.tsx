import {
  LoadingMetricsGrid,
  LoadingMonthNav,
  LoadingPanelFrame,
} from "@/components/workspace-loading";
import { formatMonthLabel } from "@/lib/scheduling";
import type { AppSession } from "@/lib/types";

export function MetricsRouteLoading({ month }: { month: string }) {
  return (
    <LoadingPanelFrame title="Metrics" headingAside={<LoadingMonthNav monthLabel={formatMonthLabel(month)} />}>
      <LoadingMetricsGrid />
    </LoadingPanelFrame>
  );
}

export function ScheduleRouteLoading({ month }: { month: string }) {
  return (
    <section className="panel-frame">
      <div className="panel-heading panel-heading--split">
        <div className="loading-stack">
          <span className="loading-block loading-block--lg" />
        </div>
        <div className="planner-actions">
          <div className="planner-actions__row planner-actions__row--nav">
            <span className="loading-block loading-block--button" />
            <span className="loading-block loading-block--button" />
          </div>
          <div className="planner-actions__row planner-actions__row--save">
            <span className="loading-block loading-block--button" />
          </div>
        </div>
      </div>

      <div className="workspace-toolbar workspace-toolbar--scheduler">
        <div className="field field--static">
          <span>Month</span>
          <strong>{formatMonthLabel(month)}</strong>
        </div>
        <div className="field field--static">
          <span>Shift</span>
          <strong>Loading...</strong>
        </div>
        <div className="field field--static">
          <span>Search employee</span>
          <strong>Loading roster...</strong>
        </div>
      </div>

      <div className="schedule-scroll-shell">
        <section className="schedule-wrap" aria-label="Monthly schedule grid loading">
          <div
            className="schedule-grid"
            style={{ gridTemplateColumns: "minmax(11rem, 12.5rem) repeat(7, minmax(3.2rem, 1fr))" }}
          >
            <div className="employee-header sticky-column">
              <span>{formatMonthLabel(month)}</span>
              <strong>Employees</strong>
            </div>
            {Array.from({ length: 7 }, (_, index) => (
              <div key={`loading-day-${index}`} className="day-header">
                <span className="loading-block loading-block--sm" />
                <strong className="loading-block loading-block--sm" />
              </div>
            ))}

            {Array.from({ length: 6 }, (_, rowIndex) => (
              <div key={`loading-row-${rowIndex}`} style={{ display: "contents" }}>
                <div className="employee-cell sticky-column">
                  <div className="employee-cell__main">
                    <strong>
                      <span className="loading-block loading-block--md" />
                    </strong>
                  </div>
                </div>
                {Array.from({ length: 7 }, (_, columnIndex) => (
                  <div key={`loading-cell-${rowIndex}-${columnIndex}`} className="shift-cell">
                    <span className="loading-block loading-block--pill" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

export function OvertimeRouteLoading({
  viewer,
  month,
}: {
  viewer: Pick<AppSession, "role" | "displayName">;
  month: string;
}) {
  return (
    <section className="panel-frame">
      <div className="panel-heading panel-heading--simple">
        <h1 className="panel-title">Overtime</h1>
      </div>

      <div className="workspace-toolbar workspace-toolbar--overtime">
        <div className="field field--static">
          <span>Month</span>
          <strong>{formatMonthLabel(month)}</strong>
        </div>
        <div className="field field--static">
          <span>{viewer.role === "worker" ? "Claim As" : "Board status"}</span>
          <strong>{viewer.role === "worker" ? viewer.displayName : "Loading overtime data..."}</strong>
        </div>
        <div className="field field--static">
          <span>Team</span>
          <strong>Loading...</strong>
        </div>
        <div className="field field--static">
          <span>Competency</span>
          <strong>Loading...</strong>
        </div>
      </div>

      <div className="overtime-list overtime-list--loading">
        {Array.from({ length: 3 }, (_, index) => (
          <article key={index} className="overtime-card overtime-card--loading" aria-hidden="true">
            <div className="overtime-group__header">
              <div className="loading-stack">
                <span className="loading-block loading-block--sm" />
                <span className="loading-block loading-block--lg" />
              </div>
              <span className="loading-block loading-block--pill" />
            </div>

            <div className="overtime-option-pills">
              <span className="loading-block loading-block--pill" />
              <span className="loading-block loading-block--pill" />
              <span className="loading-block loading-block--pill" />
            </div>

            <div className="loading-stack">
              <span className="loading-block loading-block--sm" />
              <span className="loading-block loading-block--lg" />
            </div>

            <div className="overtime-card-meta">
              <span className="loading-block loading-block--md" />
              <span className="loading-block loading-block--md" />
            </div>

            <div className="overtime-card-actions">
              <span className="loading-block loading-block--lg" />
              <span className="loading-block loading-block--button" />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
