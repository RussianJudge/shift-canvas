import { redirect } from "next/navigation";

import { ProfilePanel } from "@/components/profile-panel";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireAppSession } from "@/lib/auth";
import { getPersonnelSnapshot } from "@/lib/data";
import { getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await requireAppSession(["worker"]);

  if (!session.employeeId) {
    redirect("/schedule");
  }

  const month = getCurrentMonthKey("America/Edmonton");
  const snapshot = await getPersonnelSnapshot(month);

  return (
    <WorkspaceShell viewer={session}>
      <ProfilePanel snapshot={snapshot} employeeId={session.employeeId} />
    </WorkspaceShell>
  );
}
