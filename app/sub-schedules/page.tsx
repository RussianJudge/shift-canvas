import { SubSchedulesPanel } from "@/components/sub-schedules-panel";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireAppSession } from "@/lib/auth";
import { getSchedulerSnapshot } from "@/lib/data";
import { getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

function isMonthKey(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}$/.test(value));
}

export default async function SubSchedulesPage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string }>;
}) {
  const session = await requireAppSession(["admin", "leader"]);
  const currentMonth = getCurrentMonthKey("America/Edmonton");
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const month = isMonthKey(resolvedSearchParams?.month) ? resolvedSearchParams!.month! : currentMonth;
  const snapshot = await getSchedulerSnapshot(month, session);

  return (
    <WorkspaceShell viewer={session}>
      <SubSchedulesPanel snapshot={snapshot} />
    </WorkspaceShell>
  );
}
