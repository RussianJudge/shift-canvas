import { Suspense } from "react";

import { SubSchedulesPanel } from "@/components/sub-schedules-panel";
import { LoadingCardList, LoadingMonthNav, LoadingPanelFrame, LoadingTable, LoadingToolbarWithActions } from "@/components/workspace-loading";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireAppSession } from "@/lib/auth";
import { getSubSchedulesSnapshot } from "@/lib/data";
import { formatMonthLabel, getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

function isMonthKey(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}$/.test(value));
}

async function SubSchedulesBoard({
  session,
  month,
}: {
  session: Awaited<ReturnType<typeof requireAppSession>>;
  month: string;
}) {
  const snapshot = await getSubSchedulesSnapshot(month, session);
  return <SubSchedulesPanel snapshot={snapshot} />;
}

function SubSchedulesBoardFallback({ month }: { month: string }) {
  return (
    <LoadingPanelFrame
      title="Sub-Schedules"
      headingAside={<LoadingMonthNav monthLabel={formatMonthLabel(month)} />}
    >
      <section className="metrics-section subschedule-builder-section">
        <div className="metrics-section__header">
          <div className="metrics-section__title-group">
            <h2 className="metrics-section__title">Definitions</h2>
          </div>
        </div>
        <LoadingToolbarWithActions
          fields={[
            { label: "Month", value: formatMonthLabel(month) },
            { label: "Status", value: "Loading definitions..." },
          ]}
        />
        <LoadingTable columns={["Name", "Summary Code", "Status"]} rows={4} />
      </section>

      <section className="metrics-section">
        <div className="metrics-section__header">
          <div className="metrics-section__title-group">
            <h2 className="metrics-section__title">Monthly Builder</h2>
          </div>
        </div>
        <LoadingCardList cards={2} />
      </section>
    </LoadingPanelFrame>
  );
}

export default async function SubSchedulesPage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string }>;
}) {
  const session = await requireAppSession(["admin", "leader"]);
  const currentMonth = getCurrentMonthKey("America/Edmonton");
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const month = isMonthKey(resolvedSearchParams?.month) ? resolvedSearchParams!.month! : currentMonth;

  return (
    <WorkspaceShell viewer={session}>
      <Suspense key={month} fallback={<SubSchedulesBoardFallback month={month} />}>
        <SubSchedulesBoard session={session} month={month} />
      </Suspense>
    </WorkspaceShell>
  );
}
