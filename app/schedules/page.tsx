import { SchedulesPanel } from "@/components/schedules-panel";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireAppSession } from "@/lib/auth";
import { getSchedulesSnapshot } from "@/lib/data";
import { getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

export default async function SchedulesPage() {
  const session = await requireAppSession(["admin"]);
  const month = getCurrentMonthKey("America/Edmonton");
  const snapshot = await getSchedulesSnapshot(month);

  return (
    <WorkspaceShell viewer={session}>
      <SchedulesPanel snapshot={snapshot} />
    </WorkspaceShell>
  );
}
