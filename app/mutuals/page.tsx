import { Suspense } from "react";

import { MutualsPanel } from "@/components/mutuals-panel";
import { LoadingCardList, LoadingMonthNav, LoadingPanelFrame, LoadingToolbarFields } from "@/components/workspace-loading";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireAppSession } from "@/lib/auth";
import { getMutualsSnapshot } from "@/lib/data";
import { formatMonthLabel, getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

async function MutualsBoard({
  session,
  month,
}: {
  session: Awaited<ReturnType<typeof requireAppSession>>;
  month: string;
}) {
  const snapshot = await getMutualsSnapshot(month, session);
  return <MutualsPanel snapshot={snapshot} viewer={session} />;
}

function MutualsBoardFallback({
  month,
  viewer,
}: {
  month: string;
  viewer: Awaited<ReturnType<typeof requireAppSession>>;
}) {
  return (
    <LoadingPanelFrame title="Mutuals">
      <LoadingToolbarFields
        className="workspace-toolbar workspace-toolbar--personnel-page"
        fields={[
          { label: "Month", value: formatMonthLabel(month) },
          { label: "Viewer", value: viewer.displayName },
          { label: "Status", value: "Loading mutual board..." },
        ]}
      />
      <section className="metrics-section mutuals-section">
        <div className="metrics-section__header">
          <div className="metrics-section__title-group">
            <h2 className="metrics-section__title">Post Mutual Shifts</h2>
          </div>
        </div>
        <div className="metrics-card">
          <LoadingToolbarFields
            className="workspace-toolbar workspace-toolbar--personnel-page"
            fields={[
              { label: "Post As", value: viewer.displayName },
              { label: "Post Month", value: formatMonthLabel(month) },
            ]}
          />
        </div>
      </section>
      <section className="metrics-section mutuals-section">
        <div className="metrics-section__header">
          <div className="metrics-section__title-group">
            <h2 className="metrics-section__title">Open Mutuals</h2>
          </div>
          <LoadingMonthNav monthLabel={formatMonthLabel(month)} />
        </div>
        <LoadingCardList cards={3} />
      </section>
    </LoadingPanelFrame>
  );
}

export default async function MutualsPage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string }>;
}) {
  const session = await requireAppSession(["admin", "leader", "worker"]);
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const currentMonth = getCurrentMonthKey("America/Edmonton");
  const month =
    resolvedSearchParams?.month && /^\d{4}-\d{2}$/.test(resolvedSearchParams.month)
      ? resolvedSearchParams.month
      : currentMonth;

  return (
    <WorkspaceShell viewer={session}>
      <Suspense key={month} fallback={<MutualsBoardFallback month={month} viewer={session} />}>
        <MutualsBoard session={session} month={month} />
      </Suspense>
    </WorkspaceShell>
  );
}
