import { MonthlyScheduler } from "@/components/monthly-scheduler";
import { WorkspaceShell } from "@/components/workspace-shell";
import { canManageWorkspace, requireAppSession } from "@/lib/auth";
import { getSchedulerSnapshot } from "@/lib/data";
import { scopeScheduleSnapshot } from "@/lib/role-scopes";
import { getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

function isMonthKey(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}$/.test(value));
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string }>;
}) {
  const session = await requireAppSession(["admin", "leader", "worker"]);
  const currentMonth = getCurrentMonthKey("America/Edmonton");
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const month = isMonthKey(resolvedSearchParams?.month) ? resolvedSearchParams!.month! : currentMonth;
  const snapshot = scopeScheduleSnapshot(await getSchedulerSnapshot(month), session);

  return (
    <WorkspaceShell viewer={session}>
      <MonthlyScheduler
        initialSnapshot={snapshot}
        canEdit={canManageWorkspace(session)}
        canManageSetBuilder={session.role !== "worker"}
        canSwitchSchedule={true}
        forcedScheduleId={null}
      />
    </WorkspaceShell>
  );
}
