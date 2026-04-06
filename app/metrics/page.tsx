import { MetricsPanel } from "@/components/metrics-panel";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireAppSession } from "@/lib/auth";
import { getMetricsOvertimeHistory, getSchedulerSnapshot } from "@/lib/data";
import { getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

function getCurrentDateKey(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default async function MetricsPage() {
  const session = await requireAppSession(["admin"]);
  const month = getCurrentMonthKey("America/Edmonton");
  const today = getCurrentDateKey("America/Edmonton");
  const snapshot = await getSchedulerSnapshot(month);
  const overtimeHistory = await getMetricsOvertimeHistory(today);

  return (
    <WorkspaceShell viewer={session}>
      <MetricsPanel snapshot={snapshot} overtimeHistory={overtimeHistory} today={today} />
    </WorkspaceShell>
  );
}
