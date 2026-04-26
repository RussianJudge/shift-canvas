import { Suspense } from "react";

import { MonthlyScheduler } from "@/components/monthly-scheduler";
import { WorkspaceShell } from "@/components/workspace-shell";
import { canManageWorkspace, requireAppSession } from "@/lib/auth";
import { getSchedulerSnapshot, getUserSchedulePins } from "@/lib/data";
import { scopeScheduleSnapshot } from "@/lib/role-scopes";
import { formatMonthLabel, getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

function isMonthKey(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}$/.test(value));
}

/** Streams the expensive month snapshot after the workspace shell is already visible. */
async function ScheduleBoard({
  session,
  month,
}: {
  session: Awaited<ReturnType<typeof requireAppSession>>;
  month: string;
}) {
  const [snapshot, initialPinnedEmployeesBySchedule] = await Promise.all([
    getSchedulerSnapshot(month, session),
    getUserSchedulePins(session.email),
  ]);

  return (
    <MonthlyScheduler
      initialSnapshot={scopeScheduleSnapshot(snapshot, session)}
      initialPinnedEmployeesBySchedule={initialPinnedEmployeesBySchedule}
      canEdit={canManageWorkspace(session)}
      canManageSetBuilder={session.role !== "worker"}
      canSwitchSchedule={true}
      forcedScheduleId={null}
    />
  );
}

/** Lightweight placeholder that makes the schedule page feel responsive immediately. */
function ScheduleBoardFallback({ month }: { month: string }) {
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

export default async function SchedulePage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string }>;
}) {
  const session = await requireAppSession(["admin", "leader", "worker"]);
  const currentMonth = getCurrentMonthKey("America/Edmonton");
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const month = isMonthKey(resolvedSearchParams?.month) ? resolvedSearchParams!.month! : currentMonth;

  return (
    <WorkspaceShell viewer={session}>
      <Suspense key={month} fallback={<ScheduleBoardFallback month={month} />}>
        <ScheduleBoard session={session} month={month} />
      </Suspense>
    </WorkspaceShell>
  );
}
