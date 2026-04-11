import { MetricsPanel } from "@/components/metrics-panel";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireAppSession } from "@/lib/auth";
import { getMetricsAssignmentHistory, getMetricsOvertimeHistory, getSchedulerSnapshot } from "@/lib/data";
import { getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

/** Accepts only canonical `YYYY-MM` month keys from the URL. */
function resolveMetricsMonth(month: string | undefined, fallbackMonth: string) {
  return month && /^\d{4}-\d{2}$/.test(month) ? month : fallbackMonth;
}

/** Returns the last calendar day inside the selected metrics month. */
function getMonthEndDateKey(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const monthEnd = new Date(Date.UTC(year, monthNumber, 0));
  return monthEnd.toISOString().slice(0, 10);
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
  const metricsHistoryEnd = getMonthEndDateKey(month);
  const snapshot = await getSchedulerSnapshot(month, session);
  const overtimeHistory = await getMetricsOvertimeHistory(metricsHistoryEnd, session);
  const assignmentHistory = await getMetricsAssignmentHistory(metricsHistoryEnd, session);

  return (
    <WorkspaceShell viewer={session}>
      <MetricsPanel
        snapshot={snapshot}
        overtimeHistory={overtimeHistory}
        assignmentHistory={assignmentHistory}
      />
    </WorkspaceShell>
  );
}
