import { Suspense } from "react";

import { OvertimePanel } from "@/components/overtime-panel";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireAppSession } from "@/lib/auth";
import { getOvertimeMonths, getSchedulerSnapshot } from "@/lib/data";
import { formatMonthLabel, getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

/** Streams the expensive overtime board after the workspace chrome is already visible. */
async function OvertimeBoard({
  session,
  requestedMonth,
  currentMonth,
}: {
  session: Awaited<ReturnType<typeof requireAppSession>>;
  requestedMonth?: string;
  currentMonth: string;
}) {
  const availableMonths = await getOvertimeMonths(currentMonth, session);
  const month =
    requestedMonth && availableMonths.includes(requestedMonth)
      ? requestedMonth
      : availableMonths.includes(currentMonth)
      ? currentMonth
      : availableMonths[0] ?? currentMonth;
  const snapshot = await getSchedulerSnapshot(month, session);

  return <OvertimePanel snapshot={snapshot} availableMonths={availableMonths} viewer={session} />;
}

/** Lightweight loading shell shown while the board data streams in. */
function OvertimeBoardFallback({
  viewer,
  currentMonth,
}: {
  viewer: Awaited<ReturnType<typeof requireAppSession>>;
  currentMonth: string;
}) {
  return (
    <section className="panel-frame">
      <div className="panel-heading panel-heading--simple">
        <h1 className="panel-title">Overtime</h1>
      </div>

      <div className="workspace-toolbar workspace-toolbar--overtime">
        <div className="field field--static">
          <span>Month</span>
          <strong>{formatMonthLabel(currentMonth)}</strong>
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

export default async function OvertimePage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string }>;
}) {
  const session = await requireAppSession(["admin", "leader", "worker"]);
  const currentMonth = getCurrentMonthKey("America/Edmonton");
  const resolvedSearchParams = searchParams ? await searchParams : undefined;

  return (
    <WorkspaceShell viewer={session}>
      <Suspense
        key={resolvedSearchParams?.month ?? currentMonth}
        fallback={<OvertimeBoardFallback viewer={session} currentMonth={currentMonth} />}
      >
        <OvertimeBoard
          session={session}
          requestedMonth={resolvedSearchParams?.month}
          currentMonth={currentMonth}
        />
      </Suspense>
    </WorkspaceShell>
  );
}
