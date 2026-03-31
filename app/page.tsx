import { MonthlyScheduler } from "@/components/monthly-scheduler";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getCurrentMonthKey } from "@/lib/scheduling";
import { getSchedulerSnapshot } from "@/lib/data";

export const dynamic = "force-dynamic";

function isMonthKey(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}$/.test(value));
}

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string }>;
}) {
  const currentMonth = getCurrentMonthKey("America/Edmonton");
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const month = isMonthKey(resolvedSearchParams?.month) ? resolvedSearchParams!.month! : currentMonth;
  const snapshot = await getSchedulerSnapshot(month);

  return (
    <WorkspaceShell>
      <MonthlyScheduler initialSnapshot={snapshot} />
    </WorkspaceShell>
  );
}
