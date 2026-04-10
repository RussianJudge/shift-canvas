import { MetricsPanel } from "@/components/metrics-panel";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireAppSession } from "@/lib/auth";
import { getMetricsAssignmentHistory, getMetricsOvertimeHistory, getSchedulerSnapshot } from "@/lib/data";
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

/** Accepts only canonical `YYYY-MM` month keys from the URL. */
function resolveMetricsMonth(month: string | undefined, fallbackMonth: string) {
  return month && /^\d{4}-\d{2}$/.test(month) ? month : fallbackMonth;
}

export default async function MetricsPage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string }>;
}) {
  const session = await requireAppSession(["admin", "leader"]);
  const currentMonth = getCurrentMonthKey("America/Edmonton");
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const month = resolveMetricsMonth(resolvedSearchParams?.month, currentMonth);
  const today = getCurrentDateKey("America/Edmonton");
  const snapshot = await getSchedulerSnapshot(month, session);
  const overtimeHistory = await getMetricsOvertimeHistory(today, session);
  const assignmentHistory = await getMetricsAssignmentHistory(today, session);

  return (
    <WorkspaceShell viewer={session}>
      <MetricsPanel
        snapshot={snapshot}
        overtimeHistory={overtimeHistory}
        assignmentHistory={assignmentHistory}
        today={today}
      />
    </WorkspaceShell>
  );
}
