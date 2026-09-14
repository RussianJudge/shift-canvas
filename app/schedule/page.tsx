import { Suspense } from "react";

import { AllShiftsGrid } from "@/components/all-shifts-grid";
import { MonthlyScheduler } from "@/components/monthly-scheduler";
import { ScheduleRouteLoading } from "@/components/route-loading";
import { ScheduleContextSelector } from "@/components/schedule-context-selector";
import { SubSchedulesPanel } from "@/components/sub-schedules-panel";
import { WorkspaceShellFrame } from "@/components/workspace-shell-frame";
import { canManageWorkspace, requireAppSession } from "@/lib/auth";
import { getScheduleEmployeeOrder, getSchedulePageSnapshot, getSubSchedulesSnapshot } from "@/lib/data";
import { scopeScheduleSnapshot } from "@/lib/role-scopes";
import { resolveScheduleContext } from "@/lib/schedule-context";
import { getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

function isMonthKey(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}$/.test(value));
}

/** Streams the expensive month snapshot after the workspace shell is already visible. */
async function ScheduleBoard({
  session,
  month,
  scheduleParam,
  autoCreate,
}: {
  session: Awaited<ReturnType<typeof requireAppSession>>;
  month: string;
  scheduleParam: string | null;
  autoCreate: boolean;
}) {
  const [snapshot, initialScheduleEmployeeOrderBySchedule] = await Promise.all([
    getSchedulePageSnapshot(month, session, scheduleParam),
    getScheduleEmployeeOrder(session),
  ]);

  // The loader already scoped sub_schedules to the viewer's company, site and
  // business area, so this list is what they may reach. Workers may reach none
  // of it: /sub-schedules has always been admin-and-leader only, and putting
  // the selector on a page workers can open must not widen that.
  const canManageSubSchedules = session.role !== "worker";
  const selectableSubSchedules = canManageSubSchedules ? snapshot.subSchedules : [];
  const context = resolveScheduleContext({
    param: scheduleParam,
    viewer: session,
    accessibleSubScheduleIds: selectableSubSchedules.map((subSchedule) => subSchedule.id),
    fallbackScheduleId: session.scheduleId,
  });

  if (context.kind === "sub") {
    const subScheduleSnapshot = await getSubSchedulesSnapshot(month, session);

    return (
      <SubSchedulesPanel
        snapshot={subScheduleSnapshot}
        initialSelectedSubScheduleId={context.subScheduleId}
        autoCreate={autoCreate}
        scheduleContextSelector={
          // Keyed because the panel renders it beside static siblings: React
          // treats an element created in another component as an unvalidated
          // list child and warns without one.
          <ScheduleContextSelector
            key="schedule-context-selector"
            month={month}
            context={context}
            schedules={snapshot.schedules}
            subSchedules={selectableSubSchedules}
            canManageSubSchedules={canManageSubSchedules}
          />
        }
      />
    );
  }

  if (context.kind === "all") {
    return (
      <AllShiftsGrid
        snapshot={scopeScheduleSnapshot({ ...snapshot, subSchedules: selectableSubSchedules }, session)}
        month={month}
      />
    );
  }

  return (
    <MonthlyScheduler
      initialSnapshot={scopeScheduleSnapshot({ ...snapshot, subSchedules: selectableSubSchedules }, session)}
      initialScheduleEmployeeOrderBySchedule={initialScheduleEmployeeOrderBySchedule}
      canEdit={canManageWorkspace(session)}
      canManageSetBuilder={session.role !== "worker"}
      canManageSubSchedules={canManageSubSchedules}
      canSwitchSchedule={true}
      forcedScheduleId={null}
      initialSelectedScheduleId={snapshot.selectedScheduleId ?? context.scheduleId}
    />
  );
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string; schedule?: string; new?: string }>;
}) {
  const session = await requireAppSession(["admin", "leader", "worker"]);
  const currentMonth = getCurrentMonthKey("America/Edmonton");
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const month = isMonthKey(resolvedSearchParams?.month) ? resolvedSearchParams!.month! : currentMonth;
  // Kept raw: the context is resolved and authorised inside the board, where
  // the scoped sub-schedule list is available.
  const scheduleParam = resolvedSearchParams?.schedule?.trim() || session.scheduleId || null;
  const autoCreate = resolvedSearchParams?.new === "1";

  return (
    <WorkspaceShellFrame viewer={session}>
      <Suspense key={`${month}:${scheduleParam ?? ""}`} fallback={<ScheduleRouteLoading month={month} />}>
        <ScheduleBoard session={session} month={month} scheduleParam={scheduleParam} autoCreate={autoCreate} />
      </Suspense>
    </WorkspaceShellFrame>
  );
}
