import { SchedulesPanel } from "@/components/schedules-panel";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getSchedulesSnapshot } from "@/lib/data";
import { getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

export default async function SchedulesPage() {
  const month = getCurrentMonthKey("America/Edmonton");
  const snapshot = await getSchedulesSnapshot(month);

  return (
    <WorkspaceShell>
      <SchedulesPanel snapshot={snapshot} />
    </WorkspaceShell>
  );
}
