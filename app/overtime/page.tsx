import { Suspense } from "react";

import { OvertimePanel } from "@/components/overtime-panel";
import { OvertimeRouteLoading } from "@/components/route-loading";
import { WorkspaceShellFrame } from "@/components/workspace-shell-frame";
import { requireAppSession } from "@/lib/auth";
import { getFutureOvertimeClaimsForEmployee, getOvertimeBoardSnapshot, getOvertimeMonths } from "@/lib/data";
import { getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

function getCurrentDateKey(timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "2026";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";

  return `${year}-${month}-${day}`;
}

/** Streams the expensive overtime board after the workspace chrome is already visible. */
async function OvertimeBoard({
  session,
  requestedMonth,
  currentMonth,
  currentDate,
}: {
  session: Awaited<ReturnType<typeof requireAppSession>>;
  requestedMonth?: string;
  currentMonth: string;
  currentDate: string;
}) {
  const [availableMonths, futureOvertimeClaims] = await Promise.all([
    getOvertimeMonths(currentMonth, session),
    getFutureOvertimeClaimsForEmployee(session.employeeId, currentDate, session),
  ]);
  const month =
    requestedMonth && availableMonths.includes(requestedMonth)
      ? requestedMonth
      : availableMonths.includes(currentMonth)
      ? currentMonth
      : availableMonths[0] ?? currentMonth;
  const snapshot = await getOvertimeBoardSnapshot(month, session);

  return (
    <OvertimePanel
      snapshot={snapshot}
      availableMonths={availableMonths}
      viewer={session}
      futureOvertimeClaims={futureOvertimeClaims}
    />
  );
}

export default async function OvertimePage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string }>;
}) {
  const session = await requireAppSession(["admin", "leader", "worker"]);
  const currentMonth = getCurrentMonthKey("America/Edmonton");
  const currentDate = getCurrentDateKey("America/Edmonton");
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
          currentDate={currentDate}
        />
      </Suspense>
    </WorkspaceShellFrame>
  );
}
