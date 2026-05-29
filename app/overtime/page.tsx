import { Suspense } from "react";

import { OvertimePanel } from "@/components/overtime-panel";
import { OvertimeRouteLoading } from "@/components/route-loading";
import { WorkspaceShellFrame } from "@/components/workspace-shell-frame";
import { requireAppSession } from "@/lib/auth";
import { getOvertimeBoardSnapshot, getOvertimeMonths } from "@/lib/data";
import { getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

/** Streams the expensive overtime board after the workspace chrome is already visible. */
async function OvertimeBoard({
  session,
  requestedMonth,
  currentMonth,
  initialFilters,
}: {
  session: Awaited<ReturnType<typeof requireAppSession>>;
  requestedMonth?: string;
  currentMonth: string;
  initialFilters?: {
    targetKey?: string;
    assignmentFilter?: string;
    availabilityFilter?: string;
    claimingEmployeeId?: string;
  };
}) {
  const optimisticMonth = requestedMonth ?? currentMonth;
  const availableMonthsPromise = getOvertimeMonths(currentMonth, session);
  const optimisticSnapshotPromise = getOvertimeBoardSnapshot(optimisticMonth, session);
  const availableMonths = await availableMonthsPromise;
  const month =
    requestedMonth && availableMonths.includes(requestedMonth)
      ? requestedMonth
      : availableMonths.includes(currentMonth)
      ? currentMonth
      : availableMonths[0] ?? currentMonth;
  const snapshot =
    month === optimisticMonth
      ? await optimisticSnapshotPromise
      : await getOvertimeBoardSnapshot(month, session);

  return (
    <OvertimePanel
      snapshot={snapshot}
      availableMonths={availableMonths}
      viewer={session}
      initialFilters={initialFilters}
    />
  );
}

export default async function OvertimePage({
  searchParams,
}: {
  searchParams?: Promise<{
    month?: string;
    target?: string;
    assignment?: string;
    availability?: string;
    claimAs?: string;
  }>;
}) {
  const session = await requireAppSession(["admin", "leader", "worker"]);
  const currentMonth = getCurrentMonthKey("America/Edmonton");
  const resolvedSearchParams = searchParams ? await searchParams : undefined;

  return (
    <WorkspaceShellFrame viewer={session}>
      <Suspense
        key={resolvedSearchParams?.month ?? currentMonth}
        fallback={<OvertimeRouteLoading viewer={session} month={currentMonth} />}
      >
        <OvertimeBoard
          session={session}
          requestedMonth={resolvedSearchParams?.month}
          currentMonth={currentMonth}
          initialFilters={{
            targetKey: resolvedSearchParams?.target,
            assignmentFilter: resolvedSearchParams?.assignment,
            availabilityFilter: resolvedSearchParams?.availability,
            claimingEmployeeId: resolvedSearchParams?.claimAs,
          }}
        />
      </Suspense>
    </WorkspaceShellFrame>
  );
}
