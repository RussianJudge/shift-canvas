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
  const [initialAdminScope, initialNotifications] = await Promise.all([
    loadAdminScope(viewer),
    getNotificationsForViewer(viewer, { unreadOnly: true, limit: 5 }),
  ]);

  return (
    <WorkspaceShell
      viewer={viewer}
      initialAdminScope={initialAdminScope}
      initialNotifications={initialNotifications}
    >
      {children}
    </WorkspaceShell>
  );
}
