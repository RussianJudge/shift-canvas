import Link from "next/link";

import { WorkspaceShellFrame } from "@/components/workspace-shell-frame";
import { requireAppSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function NotificationSettingsPage() {
  const session = await requireAppSession(["admin", "leader", "worker"]);

  return (
    <WorkspaceShellFrame viewer={session}>
      <section className="panel-frame">
        <div className="panel-heading panel-heading--simple">
          <div>
            <p className="panel-eyebrow">Notifications</p>
            <h1 className="panel-title">Notification Settings</h1>
          </div>
          <Link href="/notifications" className="ghost-button">
            View all
          </Link>
        </div>

        <div className="empty-state">
          <strong>Notification settings are not connected yet.</strong>
          <span>Delivery preferences and alert categories can be added here when the notification backend is introduced.</span>
        </div>
      </section>
    </WorkspaceShellFrame>
  );
}
