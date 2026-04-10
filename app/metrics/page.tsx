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

/** Returns the last calendar day inside a given `YYYY-MM` month key. */
function getMonthEndDateKey(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const monthEnd = new Date(Date.UTC(year, monthNumber, 0));
  return monthEnd.toISOString().slice(0, 10);
}

/**
 * Anchors rolling metrics windows to the selected month when looking backward,
 * but never beyond today's real date when the selected month is current/future.
 */
function getMetricsAnchorDate(month: string, today: string) {
  const monthEnd = getMonthEndDateKey(month);
  return monthEnd < today ? monthEnd : today;
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
  const metricsAnchorDate = getMetricsAnchorDate(month, today);
  const snapshot = await getSchedulerSnapshot(month, session);
  const overtimeHistory = await getMetricsOvertimeHistory(metricsAnchorDate, session);
  const assignmentHistory = await getMetricsAssignmentHistory(metricsAnchorDate, session);

  return (
    <WorkspaceShell viewer={session}>
      <MetricsPanel
        snapshot={snapshot}
        overtimeHistory={overtimeHistory}
        assignmentHistory={assignmentHistory}
        metricsAnchorDate={metricsAnchorDate}
      />
    </WorkspaceShell>
  );
}
