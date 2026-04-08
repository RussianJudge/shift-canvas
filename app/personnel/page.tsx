import { PersonnelPanel } from "@/components/personnel-panel";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireAppSession } from "@/lib/auth";
import { getPersonnelSnapshot } from "@/lib/data";
import { getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

export default async function PersonnelPage() {
  const session = await requireAppSession(["admin", "leader"]);
  const month = getCurrentMonthKey("America/Edmonton");
  const snapshot = await getPersonnelSnapshot(month, session);

  return (
    <WorkspaceShell viewer={session}>
      <PersonnelPanel snapshot={snapshot} />
    </WorkspaceShell>
  );
}
