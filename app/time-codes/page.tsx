import { Suspense } from "react";

import { TimeCodesPanel } from "@/components/time-codes-panel";
import { LoadingPanelFrame, LoadingTable, LoadingToolbarWithActions } from "@/components/workspace-loading";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireAppSession } from "@/lib/auth";
import { getTimeCodesSnapshot } from "@/lib/data";
import { formatMonthLabel, getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

async function TimeCodesBoard({
  session,
  month,
}: {
  session: Awaited<ReturnType<typeof requireAppSession>>;
  month: string;
}) {
  const snapshot = await getTimeCodesSnapshot(month, session);
  return <TimeCodesPanel snapshot={snapshot} />;
}

function TimeCodesBoardFallback({ month }: { month: string }) {
  return (
    <LoadingPanelFrame
      title="Time Codes"
      toolbar={
        <LoadingToolbarWithActions
          fields={[
            { label: "Month", value: formatMonthLabel(month) },
            { label: "Status", value: "Loading time codes..." },
          ]}
        />
      }
    >
      <LoadingTable columns={["Code", "Label", "Color", "Usage", "Preview", "Actions"]} rows={6} />
    </LoadingPanelFrame>
  );
}

export default async function TimeCodesPage() {
  const session = await requireAppSession(["admin"]);
  const month = getCurrentMonthKey("America/Edmonton");

  return (
    <WorkspaceShell viewer={session}>
      <Suspense key={month} fallback={<TimeCodesBoardFallback month={month} />}>
        <TimeCodesBoard session={session} month={month} />
      </Suspense>
    </WorkspaceShell>
  );
}
