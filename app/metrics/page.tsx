import { Suspense } from "react";

import { MetricsPanel } from "@/components/metrics-panel";
import { LoadingMetricsGrid, LoadingMonthNav, LoadingPanelFrame } from "@/components/workspace-loading";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireAppSession } from "@/lib/auth";
import { getMetricsAssignmentHistory, getMetricsOvertimeHistory, getSchedulerSnapshot } from "@/lib/data";
import { formatMonthLabel, getCurrentMonthKey } from "@/lib/scheduling";

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

async function MetricsBoard({
  session,
  month,
}: {
  session: Awaited<ReturnType<typeof requireAppSession>>;
  month: string;
}) {
  const metricsHistoryEnd = getMonthEndDateKey(month);
  const [snapshot, overtimeHistory, assignmentHistory] = await Promise.all([
    getSchedulerSnapshot(month, session),
    getMetricsOvertimeHistory(metricsHistoryEnd, session),
    getMetricsAssignmentHistory(metricsHistoryEnd, session),
  ]);

  return (
    <MetricsPanel
      snapshot={snapshot}
      overtimeHistory={overtimeHistory}
      assignmentHistory={assignmentHistory}
    />
  );
}

function MetricsBoardFallback({ month }: { month: string }) {
  return (
    <LoadingPanelFrame title="Metrics" headingAside={<LoadingMonthNav monthLabel={formatMonthLabel(month)} />}>
      <LoadingMetricsGrid />
    </LoadingPanelFrame>
  );
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

  return (
    <WorkspaceShell viewer={session}>
      <Suspense key={month} fallback={<MetricsBoardFallback month={month} />}>
        <MetricsBoard session={session} month={month} />
      </Suspense>
    </WorkspaceShell>
  );
}
