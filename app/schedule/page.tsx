import { Suspense } from "react";

import { MonthlyScheduler } from "@/components/monthly-scheduler";
import { ScheduleRouteLoading } from "@/components/route-loading";
import { WorkspaceShellFrame } from "@/components/workspace-shell-frame";
import { canManageWorkspace, requireAppSession } from "@/lib/auth";
import { getSchedulerSnapshot, getUserSchedulePins } from "@/lib/data";
import { scopeScheduleSnapshot } from "@/lib/role-scopes";
import { getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

function isMonthKey(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}$/.test(value));
}

/** Streams the expensive month snapshot after the workspace shell is already visible. */
async function ScheduleBoard({
  session,
  month,
  initialSelectedScheduleId,
}: {
  session: Awaited<ReturnType<typeof requireAppSession>>;
  month: string;
  initialSelectedScheduleId: string | null;
}) {
  const [snapshot, initialPinnedEmployeesBySchedule] = await Promise.all([
    getSchedulerSnapshot(month, session),
    getUserSchedulePins(session.email),
  ]);

  return (
    <MonthlyScheduler
      initialSnapshot={scopeScheduleSnapshot(snapshot, session)}
      initialPinnedEmployeesBySchedule={initialPinnedEmployeesBySchedule}
      canEdit={canManageWorkspace(session)}
      canManageSetBuilder={session.role !== "worker"}
      canSwitchSchedule={true}
      forcedScheduleId={null}
      initialSelectedScheduleId={initialSelectedScheduleId}
    />
  );
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string; schedule?: string }>;
}) {
  const session = await requireAppSession(["admin", "leader", "worker"]);
  const currentMonth = getCurrentMonthKey("America/Edmonton");
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const month = isMonthKey(resolvedSearchParams?.month) ? resolvedSearchParams!.month! : currentMonth;
  const initialSelectedScheduleId = resolvedSearchParams?.schedule?.trim() || session.scheduleId || null;

  return (
    <WorkspaceShellFrame viewer={session}>
      <Suspense key={month} fallback={<ScheduleRouteLoading month={month} />}>
        <ScheduleBoard
          session={session}
          month={month}
          initialSelectedScheduleId={initialSelectedScheduleId}
        />
      </Suspense>
    </WorkspaceShellFrame>
  );
}
