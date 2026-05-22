import { WorkspaceShell, type AdminScopePayload } from "@/components/workspace-shell";
import type { AppSession } from "@/lib/types";
import { getAdminScopeOptions } from "@/lib/data";

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
  const initialAdminScope = await loadAdminScope(viewer);

  return (
    <WorkspaceShell viewer={viewer} initialAdminScope={initialAdminScope}>
      {children}
    </WorkspaceShell>
  );
}
