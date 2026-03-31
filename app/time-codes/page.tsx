import { TimeCodesPanel } from "@/components/time-codes-panel";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getTimeCodesSnapshot } from "@/lib/data";
import { getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

export default async function TimeCodesPage() {
  const month = getCurrentMonthKey("America/Edmonton");
  const snapshot = await getTimeCodesSnapshot(month);

  return (
    <WorkspaceShell>
      <TimeCodesPanel snapshot={snapshot} />
    </WorkspaceShell>
  );
}
