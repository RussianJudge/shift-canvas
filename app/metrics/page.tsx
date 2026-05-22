import { Suspense } from "react";

import {
  MetricsCompetenciesSection,
  MetricsFatigueSection,
  MetricsFragilitySection,
  MetricsOvertimeSection,
  MetricsPageFrame,
  MetricsTimeCodeSection,
} from "@/components/metrics-streamed-sections";
import { LoadingMetricsSection } from "@/components/workspace-loading";
import { WorkspaceShellFrame } from "@/components/workspace-shell-frame";
import { requireAppSession } from "@/lib/auth";
import { getMetricsAssignmentHistory, getMetricsOvertimeHistory, getMetricsSnapshot } from "@/lib/data";
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

async function MetricsCompetenciesSectionContent({
  snapshotPromise,
}: {
  snapshotPromise: ReturnType<typeof getMetricsSnapshot>;
}) {
  const snapshot = await snapshotPromise;
  return <MetricsCompetenciesSection snapshot={snapshot} />;
}

async function MetricsOvertimeSectionContent({
  snapshotPromise,
  overtimeHistoryPromise,
  assignmentHistoryPromise,
}: {
  snapshotPromise: ReturnType<typeof getMetricsSnapshot>;
  overtimeHistoryPromise: ReturnType<typeof getMetricsOvertimeHistory>;
  assignmentHistoryPromise: ReturnType<typeof getMetricsAssignmentHistory>;
}) {
  const [snapshot, overtimeHistory, assignmentHistory] = await Promise.all([
    snapshotPromise,
    overtimeHistoryPromise,
    assignmentHistoryPromise,
  ]);

  return (
    <MetricsOvertimeSection
      snapshot={snapshot}
      overtimeHistory={overtimeHistory}
      assignmentHistory={assignmentHistory}
    />
  );
}

async function MetricsFatigueSectionContent({
  snapshotPromise,
  overtimeHistoryPromise,
  assignmentHistoryPromise,
}: {
  snapshotPromise: ReturnType<typeof getMetricsSnapshot>;
  overtimeHistoryPromise: ReturnType<typeof getMetricsOvertimeHistory>;
  assignmentHistoryPromise: ReturnType<typeof getMetricsAssignmentHistory>;
}) {
  const [snapshot, overtimeHistory, assignmentHistory] = await Promise.all([
    snapshotPromise,
    overtimeHistoryPromise,
    assignmentHistoryPromise,
  ]);

  return (
    <MetricsFatigueSection
      snapshot={snapshot}
      overtimeHistory={overtimeHistory}
      assignmentHistory={assignmentHistory}
    />
  );
}

async function MetricsFragilitySectionContent({
  snapshotPromise,
  overtimeHistoryPromise,
  assignmentHistoryPromise,
}: {
  snapshotPromise: ReturnType<typeof getMetricsSnapshot>;
  overtimeHistoryPromise: ReturnType<typeof getMetricsOvertimeHistory>;
  assignmentHistoryPromise: ReturnType<typeof getMetricsAssignmentHistory>;
}) {
  const [snapshot, overtimeHistory, assignmentHistory] = await Promise.all([
    snapshotPromise,
    overtimeHistoryPromise,
    assignmentHistoryPromise,
  ]);

  return (
    <MetricsFragilitySection
      snapshot={snapshot}
      overtimeHistory={overtimeHistory}
      assignmentHistory={assignmentHistory}
    />
  );
}

async function MetricsTimeCodeSectionContent({
  snapshotPromise,
  assignmentHistoryPromise,
}: {
  snapshotPromise: ReturnType<typeof getMetricsSnapshot>;
  assignmentHistoryPromise: ReturnType<typeof getMetricsAssignmentHistory>;
}) {
  const [snapshot, assignmentHistory] = await Promise.all([snapshotPromise, assignmentHistoryPromise]);

  return <MetricsTimeCodeSection snapshot={snapshot} assignmentHistory={assignmentHistory} />;
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
  const snapshotPromise = getMetricsSnapshot(month, session);
  const overtimeHistoryPromise = getMetricsOvertimeHistory(metricsHistoryEnd, session);
  const assignmentHistoryPromise = getMetricsAssignmentHistory(metricsHistoryEnd, session);

  return (
    <WorkspaceShellFrame viewer={session}>
      <MetricsPageFrame month={month}>
        <Suspense fallback={<LoadingMetricsSection showWindowToggle={false} />}>
          <MetricsCompetenciesSectionContent snapshotPromise={snapshotPromise} />
        </Suspense>
        <Suspense fallback={<LoadingMetricsSection />}>
          <MetricsOvertimeSectionContent
            snapshotPromise={snapshotPromise}
            overtimeHistoryPromise={overtimeHistoryPromise}
            assignmentHistoryPromise={assignmentHistoryPromise}
          />
        </Suspense>
        <Suspense fallback={<LoadingMetricsSection showWindowToggle={false} />}>
          <MetricsFatigueSectionContent
            snapshotPromise={snapshotPromise}
            overtimeHistoryPromise={overtimeHistoryPromise}
            assignmentHistoryPromise={assignmentHistoryPromise}
          />
        </Suspense>
        <Suspense fallback={<LoadingMetricsSection />}>
          <MetricsFragilitySectionContent
            snapshotPromise={snapshotPromise}
            overtimeHistoryPromise={overtimeHistoryPromise}
            assignmentHistoryPromise={assignmentHistoryPromise}
          />
        </Suspense>
        <Suspense fallback={<LoadingMetricsSection showInlineField={true} />}>
          <MetricsTimeCodeSectionContent
            snapshotPromise={snapshotPromise}
            assignmentHistoryPromise={assignmentHistoryPromise}
          />
        </Suspense>
      </MetricsPageFrame>
    </WorkspaceShellFrame>
  );
}
