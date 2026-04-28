import { Suspense } from "react";

import { SchedulesPanel } from "@/components/schedules-panel";
import { LoadingPanelFrame, LoadingTable, LoadingToolbarWithActions } from "@/components/workspace-loading";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireAppSession } from "@/lib/auth";
import { getSchedulesSnapshot } from "@/lib/data";
import { formatMonthLabel, getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

async function SchedulesBoard({
  session,
  month,
}: {
  session: Awaited<ReturnType<typeof requireAppSession>>;
  month: string;
}) {
  const snapshot = await getSchedulesSnapshot(month, session);
  return <SchedulesPanel snapshot={snapshot} />;
}

function SchedulesBoardFallback({ month }: { month: string }) {
  return (
    <LoadingPanelFrame
      title="Shifts"
      toolbar={
        <LoadingToolbarWithActions
          fields={[
            { label: "Month", value: formatMonthLabel(month) },
            { label: "Status", value: "Loading shift patterns..." },
          ]}
        />
      }
    >
      <LoadingTable columns={["Name", "Start date", "Pattern", "Employees", "Actions"]} rows={5} />
    </LoadingPanelFrame>
  );
}

export default async function SchedulesPage() {
  const session = await requireAppSession(["admin"]);
  const month = getCurrentMonthKey("America/Edmonton");

  return (
    <WorkspaceShell viewer={session}>
      <Suspense key={month} fallback={<SchedulesBoardFallback month={month} />}>
        <SchedulesBoard session={session} month={month} />
      </Suspense>
    </WorkspaceShell>
  );
}
