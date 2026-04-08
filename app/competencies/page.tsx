import { CompetenciesPanel } from "@/components/competencies-panel";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireAppSession } from "@/lib/auth";
import { getCompetenciesSnapshot } from "@/lib/data";
import { getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

export default async function CompetenciesPage() {
  const session = await requireAppSession(["admin"]);
  const month = getCurrentMonthKey("America/Edmonton");
  const snapshot = await getCompetenciesSnapshot(month, session);

  return (
    <WorkspaceShell viewer={session}>
      <CompetenciesPanel snapshot={snapshot} />
    </WorkspaceShell>
  );
}
