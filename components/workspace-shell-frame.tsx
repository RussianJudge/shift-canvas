import { WorkspaceShell, type AdminScopePayload } from "@/components/workspace-shell";
import type { AppSession } from "@/lib/types";
import { countUnreadNotificationsForViewer, getAdminScopeOptions } from "@/lib/data";

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
   * The badge count is handed over unresolved, so the sidebar and the page
   * below it render while that query is still in flight. It used to be awaited
   * here, outside every Suspense boundary, which meant nothing at all appeared
   * until it came back — not even the loading skeleton built for the wait.
   *
   * The scope lookup is still awaited, but it only queries for admins; every
   * other role resolves immediately without touching the database.
   */
  const unreadCountPromise = countUnreadNotificationsForViewer(viewer);
  const initialAdminScope = await loadAdminScope(viewer);

  return (
    <WorkspaceShell
      viewer={viewer}
      initialAdminScope={initialAdminScope}
      unreadCountPromise={unreadCountPromise}
    >
      {children}
    </WorkspaceShell>
  );
}
