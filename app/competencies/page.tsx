import { CompetenciesPanel } from "@/components/competencies-panel";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getCompetenciesSnapshot } from "@/lib/data";
import { getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

export default async function CompetenciesPage() {
  const month = getCurrentMonthKey("America/Edmonton");
  const snapshot = await getCompetenciesSnapshot(month);

  return (
    <WorkspaceShell>
      <CompetenciesPanel snapshot={snapshot} />
    </WorkspaceShell>
  );
}
