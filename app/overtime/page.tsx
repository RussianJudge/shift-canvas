import { OvertimePanel } from "@/components/overtime-panel";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireAppSession } from "@/lib/auth";
import { getOvertimeMonths, getSchedulerSnapshot } from "@/lib/data";
import { getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

export default async function OvertimePage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string }>;
}) {
  const session = await requireAppSession(["admin", "leader"]);
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
  const scopedSnapshot =
    session.role === "leader" && session.scheduleId
      ? {
          ...snapshot,
          schedules: snapshot.schedules.filter((schedule) => schedule.id === session.scheduleId),
          overtimeClaims: snapshot.overtimeClaims.filter((claim) => claim.scheduleId === session.scheduleId),
          completedSets: snapshot.completedSets.filter((entry) => entry.scheduleId === session.scheduleId),
        }
      : snapshot;

  return (
    <WorkspaceShell viewer={session}>
      <OvertimePanel snapshot={scopedSnapshot} availableMonths={availableMonths} />
    </WorkspaceShell>
  );
}
