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
}: {
  session: Awaited<ReturnType<typeof requireAppSession>>;
  requestedMonth?: string;
  currentMonth: string;
}) {
  const availableMonths = await getOvertimeMonths(currentMonth, session);
  const month =
    requestedMonth && availableMonths.includes(requestedMonth)
      ? requestedMonth
      : availableMonths.includes(currentMonth)
      ? currentMonth
      : availableMonths[0] ?? currentMonth;
  const snapshot = await getOvertimeBoardSnapshot(month, session);

  return <OvertimePanel snapshot={snapshot} availableMonths={availableMonths} viewer={session} />;
}

export default async function OvertimePage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string }>;
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
        />
      </Suspense>
    </WorkspaceShellFrame>
  );
}
