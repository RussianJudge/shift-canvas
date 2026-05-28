import Link from "next/link";

import { WorkspaceShellFrame } from "@/components/workspace-shell-frame";
import { requireAppSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

function SpeechBubbleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 6.75A3.75 3.75 0 0 1 8.75 3h6.5A3.75 3.75 0 0 1 19 6.75v4.5A3.75 3.75 0 0 1 15.25 15H11l-5.25 4v-4.25A3.75 3.75 0 0 1 5 11.25v-4.5Z" />
      <path d="M8.25 7.75h7.5M8.25 10.75h5" />
    </svg>
  );
}

export default async function NotificationSettingsPage() {
  const session = await requireAppSession(["admin", "leader", "worker"]);

  return (
    <WorkspaceShellFrame viewer={session}>
      <section className="panel-frame">
        <div className="panel-heading panel-heading--split">
          <div>
            <p className="panel-eyebrow">Notifications</p>
            <h1 className="panel-title">Notification Settings</h1>
          </div>
          <Link href="/notifications" className="icon-button" aria-label="View all notifications" title="View all notifications">
            <SpeechBubbleIcon />
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
