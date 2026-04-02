import { MetricsPanel } from "@/components/metrics-panel";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireAppSession } from "@/lib/auth";
import { getSchedulerSnapshot } from "@/lib/data";
import { getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

export default async function MetricsPage() {
  const session = await requireAppSession(["admin"]);
  const month = getCurrentMonthKey("America/Edmonton");
  const snapshot = await getSchedulerSnapshot(month);

  return (
    <WorkspaceShell viewer={session}>
      <MetricsPanel snapshot={snapshot} />
    </WorkspaceShell>
  );
}
