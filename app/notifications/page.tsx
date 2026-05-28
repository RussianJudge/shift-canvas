import Link from "next/link";

import { deleteNotification, markNotificationViewed } from "@/app/actions";
import { WorkspaceShellFrame } from "@/components/workspace-shell-frame";
import { requireAppSession } from "@/lib/auth";
import { getNotificationsForViewer } from "@/lib/data";

export const dynamic = "force-dynamic";

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 8.25a3.75 3.75 0 1 1 0 7.5a3.75 3.75 0 0 1 0-7.5Z" />
      <path d="M19.5 12a7.46 7.46 0 0 0-.15-1.5l2.1-1.62l-2-3.46l-2.48 1a7.6 7.6 0 0 0-2.6-1.5L14 2.25h-4l-.38 2.67a7.6 7.6 0 0 0-2.6 1.5l-2.48-1l-2 3.46l2.1 1.62a7.4 7.4 0 0 0 0 3l-2.1 1.62l2 3.46l2.48-1a7.6 7.6 0 0 0 2.6 1.5l.38 2.67h4l.38-2.67a7.6 7.6 0 0 0 2.6-1.5l2.48 1l2-3.46l-2.1-1.62c.1-.49.15-.99.15-1.5Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.5 6.5h15" />
      <path d="M9 6.5V4.75A1.75 1.75 0 0 1 10.75 3h2.5A1.75 1.75 0 0 1 15 4.75V6.5" />
      <path d="M18 6.5l-.72 12.11A2.5 2.5 0 0 1 14.78 21H9.22a2.5 2.5 0 0 1-2.5-2.39L6 6.5" />
      <path d="M10 10.25v6.5M14 10.25v6.5" />
    </svg>
  );
}

export default async function NotificationsPage() {
  const session = await requireAppSession(["admin", "leader", "worker"]);
  const notifications = await getNotificationsForViewer(session, { limit: 50 });

  return (
    <WorkspaceShellFrame viewer={session}>
      <section className="panel-frame">
        <div className="panel-heading panel-heading--split">
          <div>
            <p className="panel-eyebrow">Notifications</p>
            <h1 className="panel-title">All Notifications</h1>
          </div>
          <Link href="/notifications/settings" className="icon-button" aria-label="Notification settings" title="Notification settings">
            <GearIcon />
          </Link>
        </div>

        {notifications.length > 0 ? (
          <div className="notifications-page-list">
            {notifications.map((notification) => (
              <article
                key={notification.id}
                className={`workspace-notification-item notifications-page-list__item ${
                  notification.readAt ? "workspace-notification-item--read" : ""
                }`}
              >
                <form action={markNotificationViewed} className="notifications-page-list__view-form">
                  <input type="hidden" name="notificationId" value={notification.id} />
                  <button
                    type="submit"
                    className="notifications-page-list__content"
                    aria-label={`Mark notification viewed: ${notification.title}`}
                  >
                    <strong>{notification.title}</strong>
                    <span>{notification.body}</span>
                    <small>
                      {notification.readAt ? "Viewed" : "Unread"} · {notification.createdAt.slice(0, 10)}
                    </small>
                  </button>
                </form>
                <form action={deleteNotification}>
                  <input type="hidden" name="notificationId" value={notification.id} />
                  <button
                    type="submit"
                    className="icon-button notification-delete-button"
                    aria-label={`Delete notification: ${notification.title}`}
                    title="Delete notification"
                  >
                    <TrashIcon />
                  </button>
                </form>
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
