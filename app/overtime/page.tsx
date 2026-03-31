import { OvertimePanel } from "@/components/overtime-panel";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getOvertimeMonths, getSchedulerSnapshot } from "@/lib/data";
import { getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

export default async function OvertimePage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string }>;
}) {
  const currentMonth = getCurrentMonthKey("America/Edmonton");
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const availableMonths = await getOvertimeMonths(currentMonth);
  const month =
    resolvedSearchParams?.month && availableMonths.includes(resolvedSearchParams.month)
      ? resolvedSearchParams.month
      : availableMonths.includes(currentMonth)
      ? currentMonth
      : availableMonths[0] ?? currentMonth;
  const snapshot = await getSchedulerSnapshot(month);

  return (
    <WorkspaceShell>
      <OvertimePanel snapshot={snapshot} availableMonths={availableMonths} />
    </WorkspaceShell>
  );
}
