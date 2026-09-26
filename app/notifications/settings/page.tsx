import Link from "next/link";

import { NotificationSettingsPanel } from "@/components/notification-settings-panel";
import { WorkspaceShellFrame } from "@/components/workspace-shell-frame";
import { requireAppSession } from "@/lib/auth";
import { getNotificationEmailSettings, readNotificationEmailOptouts } from "@/lib/data";

export const dynamic = "force-dynamic";

function SpeechBubbleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 6.75A3.75 3.75 0 0 1 8.75 3h6.5A3.75 3.75 0 0 1 19 6.75v4.5A3.75 3.75 0 0 1 15.25 15H11l-5.25 4v-4.25A3.75 3.75 0 0 1 5 11.25v-4.5Z" />
      <path d="M8.25 7.75h7.5M8.25 10.75h5" />
    </svg>
  );
}

export default async function NotificationSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ address?: string }>;
}) {
  const session = await requireAppSession(["admin", "leader", "worker"]);
  const { address: confirmationResult } = await searchParams;
  const optouts = session.employeeId
    ? await readNotificationEmailOptouts([session.employeeId])
    : null;
  const mutedTypes =
    optouts?.ok && session.employeeId
      ? Array.from(optouts.muted)
          .filter((key) => key.startsWith(`${session.employeeId}:`))
          .map((key) => key.slice(key.indexOf(":") + 1))
      : [];
  const addressSettings = await getNotificationEmailSettings(session);

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

        {!session.employeeId ? (
          <div className="empty-state">
            <strong>Your account is not linked to an employee record.</strong>
            <span>Notifications are addressed to an employee, so there is nothing to configure until a leader links your account.</span>
          </div>
        ) : optouts && !optouts.ok ? (
          <div className="empty-state">
            <strong>Your notification settings could not be loaded.</strong>
            <span>Refresh the page to try again.</span>
          </div>
        ) : (
          <NotificationSettingsPanel
            mutedTypes={mutedTypes}
            address={addressSettings}
            confirmationResult={confirmationResult ?? null}
          />
        )}
      </section>
    </WorkspaceShellFrame>
  );
}
