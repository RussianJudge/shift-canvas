import { TimeCodesPanel } from "@/components/time-codes-panel";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireAppSession } from "@/lib/auth";
import { getTimeCodesSnapshot } from "@/lib/data";
import { getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

export default async function TimeCodesPage() {
  const session = await requireAppSession(["admin"]);
  const month = getCurrentMonthKey("America/Edmonton");
  const snapshot = await getTimeCodesSnapshot(month, session);

  return (
    <WorkspaceShell viewer={session}>
      <TimeCodesPanel snapshot={snapshot} />
    </WorkspaceShell>
  );
}
