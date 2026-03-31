import { OvertimePanel } from "@/components/overtime-panel";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getSchedulerSnapshot } from "@/lib/data";
import { getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

export default async function OvertimePage() {
  const month = getCurrentMonthKey("America/Edmonton");
  const snapshot = await getSchedulerSnapshot(month);

  return (
    <WorkspaceShell>
      <OvertimePanel snapshot={snapshot} />
    </WorkspaceShell>
  );
}
