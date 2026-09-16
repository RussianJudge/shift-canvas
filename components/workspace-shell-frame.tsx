import { WorkspaceShell, type AdminScopePayload } from "@/components/workspace-shell";
import type { AppSession } from "@/lib/types";
import { getAdminScopeOptions, getNotificationsForViewer } from "@/lib/data";

async function loadAdminScope(viewer: AppSession): Promise<AdminScopePayload | null> {
  if (viewer.role !== "admin") {
    return null;
  }

  const { sites, businessAreas } = await getAdminScopeOptions(viewer);

  return {
    companyName: viewer.companyName,
    activeSiteId: viewer.activeSiteId ?? null,
    activeBusinessAreaId: viewer.activeBusinessAreaId ?? null,
    sites,
    businessAreas,
  };
}

export async function WorkspaceShellFrame({
  viewer,
  children,
}: {
  viewer: AppSession;
  children: React.ReactNode;
}) {
  /**
   * One bounded read for the badge, in parallel with the scope lookup.
   *
   * Unread only and capped, because the badge needs a count rather than the
   * list — and an account with no employee record behind it gets nothing, so
   * the badge never appears for someone with no notifications to open.
   */
  const [initialAdminScope, unreadNotifications] = await Promise.all([
    loadAdminScope(viewer),
    getNotificationsForViewer(viewer, { unreadOnly: true, limit: 50 }),
  ]);

  return (
    <WorkspaceShell
      viewer={viewer}
      initialAdminScope={initialAdminScope}
      initialNotifications={unreadNotifications}
    >
      {children}
    </WorkspaceShell>
  );
}
