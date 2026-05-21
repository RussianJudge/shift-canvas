import { ScheduleRouteLoading } from "@/components/route-loading";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireAppSession } from "@/lib/auth";
import { getCurrentMonthKey } from "@/lib/scheduling";

export default async function Loading() {
  const session = await requireAppSession(["admin", "leader", "worker"]);
  const month = getCurrentMonthKey("America/Edmonton");

  return (
    <WorkspaceShell viewer={session}>
      <ScheduleRouteLoading month={month} />
    </WorkspaceShell>
  );
}
