"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { markAllNotificationsRead, markNotificationReadById } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  countUnread,
  formatNotificationAge,
  groupNotificationsByAge,
} from "@/lib/notifications";
import { useBusinessToday } from "@/lib/use-business-today";
import type { AppNotification } from "@/lib/types";

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
  const [optimistic, markOptimistic] = useOptimistic(
    notifications,
    (current: AppNotification[], readIds: string[] | "all") =>
      current.map((notification) =>
        notification.readAt || (readIds !== "all" && !readIds.includes(notification.id))
          ? notification
          : { ...notification, readAt: new Date().toISOString() },
      ),
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
      markOptimistic("all");

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
      markOptimistic([notification.id]);

      const result = await markNotificationReadById(notification.id);

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
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </section>
  );
}

function NotificationRow({
  notification,
  today,
  onOpen,
}: {
  notification: AppNotification;
  today: string;
  onOpen: () => void;
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

  if (notification.href) {
    return (
      <Link
        href={notification.href}
        className={`notifications__row ${isUnread ? "notifications__row--unread" : ""}`}
        onClick={onOpen}
      >
        {body}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={`notifications__row ${isUnread ? "notifications__row--unread" : ""}`}
      onClick={onOpen}
      disabled={!isUnread}
    >
      {body}
    </button>
  );
}
