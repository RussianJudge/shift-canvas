import { ProfilePanel } from "@/components/profile-panel";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireAppSession } from "@/lib/auth";
import { getProfileSnapshot } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await requireAppSession(["worker"]);
  const snapshot = await getProfileSnapshot(session);

  return (
    <WorkspaceShell viewer={session}>
      <ProfilePanel snapshot={snapshot} />
    </WorkspaceShell>
  );
}
