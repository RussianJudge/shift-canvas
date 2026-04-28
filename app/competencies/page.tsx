import { Suspense } from "react";

import { CompetenciesPanel } from "@/components/competencies-panel";
import { LoadingPanelFrame, LoadingTable, LoadingToolbarWithActions } from "@/components/workspace-loading";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireAppSession } from "@/lib/auth";
import { getCompetenciesSnapshot } from "@/lib/data";
import { formatMonthLabel, getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

async function CompetenciesBoard({
  session,
  month,
}: {
  session: Awaited<ReturnType<typeof requireAppSession>>;
  month: string;
}) {
  const snapshot = await getCompetenciesSnapshot(month, session);
  return <CompetenciesPanel snapshot={snapshot} />;
}

function CompetenciesBoardFallback({ month }: { month: string }) {
  return (
    <LoadingPanelFrame
      title="Competencies"
      toolbar={
        <LoadingToolbarWithActions
          fields={[
            { label: "Month", value: formatMonthLabel(month) },
            { label: "Status", value: "Loading competencies..." },
          ]}
        />
      }
    >
      <LoadingTable columns={["Code", "Label", "Color", "Required", "Qualified", "Actions"]} rows={6} />
    </LoadingPanelFrame>
  );
}

export default async function CompetenciesPage() {
  const session = await requireAppSession(["admin"]);
  const month = getCurrentMonthKey("America/Edmonton");

  return (
    <WorkspaceShell viewer={session}>
      <Suspense key={month} fallback={<CompetenciesBoardFallback month={month} />}>
        <CompetenciesBoard session={session} month={month} />
      </Suspense>
    </WorkspaceShell>
  );
}
