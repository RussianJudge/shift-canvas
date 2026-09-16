import { Suspense } from "react";

import { NotificationsPanel } from "@/components/notifications-panel";
import { LoadingPanelFrame, LoadingTable } from "@/components/workspace-loading";
import { WorkspaceShellFrame } from "@/components/workspace-shell-frame";
import { requireAppSession } from "@/lib/auth";
import { getNotificationsForViewer } from "@/lib/data";
import { getCurrentDateKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

/**
 * Bounded rather than paged: the list is capped at the most recent 100, which
 * is more than anyone reads in a sitting and keeps one query behind the page.
 */
const NOTIFICATION_LIMIT = 100;

async function NotificationsBoard({
  session,
}: {
  session: Awaited<ReturnType<typeof requireAppSession>>;
}) {
  const notifications = await getNotificationsForViewer(session, { limit: NOTIFICATION_LIMIT });

  return (
    <NotificationsPanel
      notifications={notifications}
      initialToday={getCurrentDateKey("America/Edmonton")}
    />
  );
}

export default async function NotificationsPage() {
  const session = await requireAppSession(["admin", "leader", "worker"]);

  return (
    <WorkspaceShellFrame viewer={session}>
      <Suspense
        fallback={
          <LoadingPanelFrame title="Notifications">
            <LoadingTable columns={["Notification", "When"]} rows={4} />
          </LoadingPanelFrame>
        }
      >
        <NotificationsBoard session={session} />
      </Suspense>
    </WorkspaceShellFrame>
  );
}
