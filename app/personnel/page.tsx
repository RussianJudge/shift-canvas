import { PersonnelPanel } from "@/components/personnel-panel";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getPersonnelSnapshot } from "@/lib/data";
import { getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

export default async function PersonnelPage() {
  const month = getCurrentMonthKey("America/Edmonton");
  const snapshot = await getPersonnelSnapshot(month);

  return (
    <WorkspaceShell>
      <PersonnelPanel snapshot={snapshot} />
    </WorkspaceShell>
  );
}
