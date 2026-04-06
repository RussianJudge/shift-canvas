import { MutualsPanel } from "@/components/mutuals-panel";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireAppSession } from "@/lib/auth";
import { getMutualsSnapshot } from "@/lib/data";
import { getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

export default async function MutualsPage() {
  const session = await requireAppSession(["admin", "leader", "worker"]);
  const month = getCurrentMonthKey("America/Edmonton");
  const snapshot = await getMutualsSnapshot(month);

  return (
    <WorkspaceShell viewer={session}>
      <MutualsPanel snapshot={snapshot} viewer={session} />
    </WorkspaceShell>
  );
}
