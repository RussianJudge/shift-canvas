import { Suspense } from "react";

import { ProfilePanel } from "@/components/profile-panel";
import { LoadingPanelFrame, LoadingProfileCards } from "@/components/workspace-loading";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireAppSession } from "@/lib/auth";
import { getProfileSnapshot } from "@/lib/data";

export const dynamic = "force-dynamic";

async function ProfileBoard({ session }: { session: Awaited<ReturnType<typeof requireAppSession>> }) {
  const snapshot = await getProfileSnapshot(session);
  return <ProfilePanel snapshot={snapshot} />;
}

function ProfileBoardFallback() {
  return (
    <LoadingPanelFrame title="My Profile">
      <LoadingProfileCards />
    </LoadingPanelFrame>
  );
}

export default async function ProfilePage() {
  const session = await requireAppSession(["worker"]);

  return (
    <WorkspaceShell viewer={session}>
      <Suspense fallback={<ProfileBoardFallback />}>
        <ProfileBoard session={session} />
      </Suspense>
    </WorkspaceShell>
  );
}
