import Link from "next/link";

import { WorkspaceShellFrame } from "@/components/workspace-shell-frame";
import { requireAppSession } from "@/lib/auth";
import { getNotificationsForViewer } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const session = await requireAppSession(["admin", "leader", "worker"]);
  const notifications = await getNotificationsForViewer(session, { limit: 50 });

  return (
    <WorkspaceShellFrame viewer={session}>
      <section className="panel-frame">
        <div className="panel-heading panel-heading--simple">
          <div>
            <p className="panel-eyebrow">Notifications</p>
            <h1 className="panel-title">All Notifications</h1>
          </div>
          <Link href="/notifications/settings" className="ghost-button">
            Settings
          </Link>
        </div>

        {notifications.length > 0 ? (
          <div className="notifications-page-list">
            {notifications.map((notification) => (
              <article key={notification.id} className="workspace-notification-item">
                <strong>{notification.title}</strong>
                <span>{notification.body}</span>
                <small>{notification.createdAt.slice(0, 10)}</small>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <strong>No notifications yet.</strong>
            <span>Schedule alerts, overtime updates, and mutual approvals will appear here.</span>
          </div>
        )}
      </section>
    </WorkspaceShellFrame>
  );
}
