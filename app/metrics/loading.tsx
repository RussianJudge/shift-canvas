import { MetricsRouteLoading } from "@/components/route-loading";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireAppSession } from "@/lib/auth";
import { getCurrentMonthKey } from "@/lib/scheduling";

export default async function Loading() {
  const session = await requireAppSession(["admin", "leader"]);
  const month = getCurrentMonthKey("America/Edmonton");

  return (
    <WorkspaceShell viewer={session}>
      <MetricsRouteLoading month={month} />
    </WorkspaceShell>
  );
}
