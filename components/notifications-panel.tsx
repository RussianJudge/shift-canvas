"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  dismissAllNotifications,
  dismissNotification,
  markAllNotificationsRead,
  markNotificationReadById,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  countUnread,
  formatNotificationAge,
  groupNotificationsByAge,
} from "@/lib/notifications";
import { useBusinessToday } from "@/lib/use-business-today";
import type { AppNotification } from "@/lib/types";

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="3.25" />
      <path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l1.7-1.3-1.8-3.1-2 .8a7.6 7.6 0 0 0-2.6-1.5L14.4 3h-3.6l-.3 2.4a7.6 7.6 0 0 0-2.6 1.5l-2-.8-1.8 3.1 1.7 1.3a7.6 7.6 0 0 0 0 3l-1.7 1.3 1.8 3.1 2-.8a7.6 7.6 0 0 0 2.6 1.5l.3 2.4h3.6l.3-2.4a7.6 7.6 0 0 0 2.6-1.5l2 .8 1.8-3.1Z" />
    </svg>
  );
}

type Filter = "all" | "unread";

/**
 * The notification list.
 *
 * Read state is server state — every row here came from the database and the
 * mutations write back to it — so the only local state is which filter is
 * showing. Marking read is optimistic so the list responds immediately, and
 * falls back to the server's answer if the write fails.
 */
export function NotificationsPanel({
  notifications,
  initialToday,
}: {
  notifications: AppNotification[];
  /** Resolved on the server so relative times do not shift after hydration. */
  initialToday: string;
}) {
  const router = useRouter();
  const businessToday = useBusinessToday() ?? initialToday;
  const [filter, setFilter] = useState<Filter>("all");
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState("");
  const [confirmingClearAll, setConfirmingClearAll] = useState(false);
  const [optimistic, applyOptimistic] = useOptimistic(
    notifications,
    (current: AppNotification[], action: { type: "read" | "dismiss"; ids: string[] | "all" }) => {
      const matches = (notification: AppNotification) =>
        action.ids === "all" || action.ids.includes(notification.id);

      if (action.type === "dismiss") {
        return current.filter((notification) => !matches(notification));
      }

      return current.map((notification) =>
        notification.readAt || !matches(notification)
          ? notification
          : { ...notification, readAt: new Date().toISOString() },
      );
    },
  );

  const unreadCount = countUnread(optimistic);
  const visible = useMemo(
    () => (filter === "unread" ? optimistic.filter((entry) => !entry.readAt) : optimistic),
    [filter, optimistic],
  );
  const groups = useMemo(
    () => groupNotificationsByAge(visible, businessToday),
    [businessToday, visible],
  );

  function handleMarkAll() {
    startTransition(async () => {
      setErrorMessage("");
      applyOptimistic({ type: "read", ids: "all" });

      const result = await markAllNotificationsRead();

      if (!result.ok) {
        setErrorMessage(result.message);
      }

      router.refresh();
    });
  }

  function handleMarkOne(notification: AppNotification) {
    if (notification.readAt) {
      return;
    }

    startTransition(async () => {
      setErrorMessage("");
      applyOptimistic({ type: "read", ids: [notification.id] });

      const result = await markNotificationReadById(notification.id);

      if (!result.ok) {
        setErrorMessage(result.message);
      }

      router.refresh();
    });
  }

  function handleDismiss(notification: AppNotification) {
    startTransition(async () => {
      setErrorMessage("");
      applyOptimistic({ type: "dismiss", ids: [notification.id] });

      const result = await dismissNotification(notification.id);

      if (!result.ok) {
        setErrorMessage(result.message);
      }

      router.refresh();
    });
  }

  function handleClearAll() {
    setConfirmingClearAll(false);
    startTransition(async () => {
      setErrorMessage("");
      applyOptimistic({ type: "dismiss", ids: "all" });

      const result = await dismissAllNotifications();

      if (!result.ok) {
        setErrorMessage(result.message);
      }

      router.refresh();
    });
  }

  return (
    <section className="panel-frame notifications">
      <header className="notifications__header">
        <div>
          <h1 className="notifications__title">Notifications</h1>
          <p className="notifications__summary" role="status">
            {unreadCount > 0
              ? `${unreadCount} unread of ${optimistic.length}`
              : `${optimistic.length} notification${optimistic.length === 1 ? "" : "s"}, all read`}
          </p>
        </div>

        <div className="notifications__actions">
          <SegmentedControl
            label="Filter notifications"
            value={filter}
            options={[
              { value: "all", label: "All" },
              { value: "unread", label: `Unread${unreadCount > 0 ? ` (${unreadCount})` : ""}` },
            ]}
            onChange={(next) => setFilter(next)}
          />
          <Button
            variant="secondary"
            onClick={handleMarkAll}
            disabled={unreadCount === 0}
            loading={isPending}
          >
            Mark all as read
          </Button>
          <Button
            variant="secondary"
            onClick={() => setConfirmingClearAll(true)}
            disabled={optimistic.length === 0 || isPending}
          >
            Clear all
          </Button>
          <Link
            href="/notifications/settings"
            className="icon-button"
            aria-label="Notification settings"
            title="Notification settings"
          >
            <SettingsIcon />
          </Link>
        </div>
      </header>

      {errorMessage ? (
        <p className="notifications__error" role="alert">
          {errorMessage}{" "}
          <button type="button" className="notifications__retry" onClick={handleMarkAll}>
            Try again
          </button>
        </p>
      ) : null}

      {visible.length === 0 ? (
        <div className="empty-state">
          <strong>{filter === "unread" ? "Nothing unread." : "No notifications yet."}</strong>
          <span>
            {filter === "unread"
              ? "Everything here has been read."
              : "Overtime openings and schedule changes that involve you will appear here."}
          </span>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.key} className="notifications__group" aria-label={group.label}>
            <h2 className="notifications__group-title">{group.label}</h2>
            <ul className="notifications__list">
              {group.items.map((notification) => (
                <li key={notification.id}>
                  <NotificationRow
                    notification={notification}
                    today={businessToday}
                    onOpen={() => handleMarkOne(notification)}
                    onDismiss={() => handleDismiss(notification)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {confirmingClearAll ? (
        <Modal
          open
          onClose={() => setConfirmingClearAll(false)}
          eyebrow="Notifications"
          title="Clear all notifications?"
          description={`This clears ${optimistic.length} notification${optimistic.length === 1 ? "" : "s"} from your list. You cannot bring them back, and clearing does not change your schedule or any overtime you have claimed.`}
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmingClearAll(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleClearAll}>
                Clear all
              </Button>
            </>
          }
        />
      ) : null}
    </section>
  );
}

function NotificationRow({
  notification,
  today,
  onOpen,
  onDismiss,
}: {
  notification: AppNotification;
  today: string;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const isUnread = !notification.readAt;
  const age = formatNotificationAge(notification.createdAt, `${today}T23:59:59.000Z`);
  const body = (
    <>
      <span className="notifications__row-heading">
        {/* "Unread" is a word as well as a dot, so the state does not rest on
            colour or on seeing the marker. */}
        <span className={`notifications__dot ${isUnread ? "notifications__dot--unread" : ""}`} aria-hidden="true" />
        <strong>{notification.title}</strong>
        <span className="notifications__badge">{isUnread ? "Unread" : "Read"}</span>
      </span>
      <span className="notifications__body">{notification.body}</span>
      <span className="notifications__meta">
        <time dateTime={notification.createdAt}>{age}</time>
      </span>
    </>
  );

  // The clear control sits beside the row rather than inside it: the row is
  // itself a link or a button, and one cannot nest inside the other.
  return (
    <div className="notifications__row-wrap">
      {notification.href ? (
        <Link
          href={notification.href}
          className={`notifications__row ${isUnread ? "notifications__row--unread" : ""}`}
          onClick={onOpen}
        >
          {body}
        </Link>
      ) : (
        <button
          type="button"
          className={`notifications__row ${isUnread ? "notifications__row--unread" : ""}`}
          onClick={onOpen}
          disabled={!isUnread}
        >
          {body}
        </button>
      )}

      <button
        type="button"
        className="notifications__dismiss"
        onClick={onDismiss}
        aria-label={`Clear notification: ${notification.title}`}
        title="Clear"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
