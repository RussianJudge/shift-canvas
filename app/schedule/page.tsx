import { Suspense } from "react";
import { cookies } from "next/headers";

import { AllShiftsGrid } from "@/components/all-shifts-grid";
import { PersonalScheduleView } from "@/components/personal-schedule-view";
import { ScheduleScopeToggle } from "@/components/schedule-scope-toggle";
import { MonthlyScheduler } from "@/components/monthly-scheduler";
import { ScheduleRouteLoading } from "@/components/route-loading";
import { ScheduleContextSelector } from "@/components/schedule-context-selector";
import { SubSchedulesPanel } from "@/components/sub-schedules-panel";
import { WorkspaceShellFrame } from "@/components/workspace-shell-frame";
import { canManageWorkspace, requireAppSession } from "@/lib/auth";
import { getScheduleEmployeeOrder, getSchedulePageSnapshot, getSubSchedulesSnapshot } from "@/lib/data";
import { scopeScheduleSnapshot } from "@/lib/role-scopes";
import { resolveScheduleContext } from "@/lib/schedule-context";
import {
  SCHEDULE_SCOPE_COOKIE,
  resolveScheduleScope,
  type ScheduleScope,
} from "@/lib/schedule-scope";
import { getCurrentDateKey, getCurrentMonthKey } from "@/lib/scheduling";

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
  scope,
}: {
  session: Awaited<ReturnType<typeof requireAppSession>>;
  month: string;
  scheduleParam: string | null;
  autoCreate: boolean;
  scope: ScheduleScope;
}) {
  /**
   * My schedule is always the viewer's own crew, never whichever one they were
   * last browsing. Without this, switching to My schedule after looking at
   * another crew would filter their own rows out of a snapshot that never
   * contained them, and the view would read as an empty month.
   */
  const effectiveScheduleParam = scope === "mine" ? session.scheduleId : scheduleParam;
  const [snapshot, initialScheduleEmployeeOrderBySchedule] = await Promise.all([
    getSchedulePageSnapshot(month, session, effectiveScheduleParam),
    getScheduleEmployeeOrder(session),
  ]);

  // The loader already scoped sub_schedules to the viewer's company, site and
  // business area, so this list is what they may reach. Workers may reach none
  // of it: /sub-schedules has always been admin-and-leader only, and putting
  // the selector on a page workers can open must not widen that.
  const canManageSubSchedules = session.role !== "worker";
  const selectableSubSchedules = canManageSubSchedules ? snapshot.subSchedules : [];
  const context = resolveScheduleContext({
    param: effectiveScheduleParam,
    viewer: session,
    accessibleSubScheduleIds: selectableSubSchedules.map((subSchedule) => subSchedule.id),
    fallbackScheduleId: session.scheduleId,
  });

  // Keyed for the same reason as the context selector: an element created here
  // and rendered beside static siblings is an unvalidated list child otherwise.
  const scopeToggle = (
    <ScheduleScopeToggle key="schedule-scope" scope={scope} month={month} schedule={scheduleParam} />
  );

  // My schedule reads the same rows the team grid renders, so sub-schedule and
  // away-overtime projections carry over without a second data path.
  if (scope === "mine") {
    const scopedSnapshot = scopeScheduleSnapshot(
      { ...snapshot, subSchedules: selectableSubSchedules },
      session,
    );

    return (
      <PersonalScheduleView
        employeeId={session.employeeId}
        scheduleId={scopedSnapshot.selectedScheduleId ?? session.scheduleId ?? ""}
        month={month}
        assignments={scopedSnapshot.assignments}
        projectedAssignments={scopedSnapshot.projectedAssignments}
        competencies={scopedSnapshot.competencies}
        timeCodes={scopedSnapshot.timeCodes}
        location={[session.siteName, session.businessAreaName].filter(Boolean).join(" · ") || null}
        canViewTeam
        scheduleParam={scheduleParam}
        initialToday={getCurrentDateKey("America/Edmonton")}
        scopeToggle={scopeToggle}
      />
    );
  }

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
      scopeToggle={scopeToggle}
    />
  );
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string; schedule?: string; new?: string; scope?: string }>;
}) {
  const session = await requireAppSession(["admin", "leader", "worker"]);
  const currentMonth = getCurrentMonthKey("America/Edmonton");
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const month = isMonthKey(resolvedSearchParams?.month) ? resolvedSearchParams!.month! : currentMonth;
  const cookieStore = await cookies();
  const scope = resolveScheduleScope({
    param: resolvedSearchParams?.scope,
    stored: cookieStore.get(SCHEDULE_SCOPE_COOKIE)?.value,
    role: session.role,
  });
  // Kept raw: the context is resolved and authorised inside the board, where
  // the scoped sub-schedule list is available.
  const scheduleParam = resolvedSearchParams?.schedule?.trim() || session.scheduleId || null;
  const autoCreate = resolvedSearchParams?.new === "1";

  return (
    <WorkspaceShellFrame viewer={session}>
      <Suspense
        key={`${month}:${scheduleParam ?? ""}:${scope}`}
        fallback={<ScheduleRouteLoading month={month} />}
      >
        <ScheduleBoard
          session={session}
          month={month}
          scheduleParam={scheduleParam}
          autoCreate={autoCreate}
          scope={scope}
        />
      </Suspense>
    </WorkspaceShellFrame>
  );
}
