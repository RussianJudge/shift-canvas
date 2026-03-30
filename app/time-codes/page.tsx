import { TimeCodesPanel } from "@/components/time-codes-panel";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getSchedulerSnapshot } from "@/lib/data";
import { getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

export default async function TimeCodesPage() {
  const month = getCurrentMonthKey("America/Edmonton");
  const snapshot = await getSchedulerSnapshot(month);

  return (
    <WorkspaceShell>
      <TimeCodesPanel snapshot={snapshot} />
    </WorkspaceShell>
  );
}
