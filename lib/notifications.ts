import type { AppNotification } from "@/lib/types";

export const NOTIFICATION_TYPES = {
  overtimePosted: "overtime_posted",
  overtimeRemoved: "overtime_removed",
  scheduleLoan: "schedule_loan",
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

/**
 * The types that also send email, and the only ones the settings page offers.
 *
 * Schedule loans are absent because their notification ids are still random,
 * so a repeated write would mail the same person twice.
 */
export const EMAILED_NOTIFICATION_TYPES = [
  {
    value: NOTIFICATION_TYPES.overtimePosted,
    label: "Overtime available",
    description: "When a posting is created that you are eligible to claim.",
  },
  {
    value: NOTIFICATION_TYPES.overtimeRemoved,
    label: "Overtime no longer needed",
    description: "When overtime you claimed is released because the posting was filled or changed.",
  },
] as const;

/**
 * The id doubles as the idempotency key.
 *
 * `notifications.id` is a text primary key, so deriving it from what the
 * notification is *about* means a retried enqueue collides with the row it
 * already wrote instead of adding a second one. No extra column, and the
 * database enforces it rather than the application remembering to.
 */
export function buildOvertimePostingNotificationId(postingId: string, employeeId: string) {
  return `notification-${NOTIFICATION_TYPES.overtimePosted}-${postingId}-${employeeId}`;
}

/**
 * Keyed on the claim, because the claim is what stopped being needed.
 *
 * The three cleanup paths all write their notifications before deleting the
 * claims and can return early in between, so a repeated sweep re-detects the
 * same releases. A random id turned that into a second notification every time;
 * deriving it from the claim makes the retry collide instead.
 */
export function buildOvertimeRemovedNotificationId(claimId: string) {
  return `notification-${NOTIFICATION_TYPES.overtimeRemoved}-${claimId}`;
}

/**
 * Generated overtime has no posting row, so the set's own key stands in for a
 * posting id. The key leads with the month, which lets the server fetch one
 * month's notices with a prefix match and reconcile them against what is
 * currently open.
 */
export function buildShortfallPostingId(noticeKey: string) {
  return `auto:${noticeKey}`;
}

export function buildShortfallNotificationIdPrefix(month: string) {
  return `notification-${NOTIFICATION_TYPES.overtimePosted}-${buildShortfallPostingId(month)}:`;
}

/**
 * What a set's open overtime reads as in the bell.
 *
 * Counts and dates rather than a list of posts: the point is whether it is
 * worth opening the board, and the board is where the detail belongs.
 */
export function buildShortfallNotification(input: {
  noticeKey: string;
  employeeId: string;
  scheduleName: string;
  dates: string[];
  slotCount: number;
  month: string;
}) {
  const shiftLabel = input.slotCount === 1 ? "shift" : "shifts";

  return {
    id: buildOvertimePostingNotificationId(buildShortfallPostingId(input.noticeKey), input.employeeId),
    recipient_employee_id: input.employeeId,
    type: NOTIFICATION_TYPES.overtimePosted,
    title: `Overtime available: ${input.scheduleName}`,
    body: `${input.slotCount} open ${shiftLabel} on ${describeDateRange(input.dates)} you are eligible to claim.`,
    href: `/overtime?month=${input.month}`,
  };
}

export type OvertimePostingNotificationInput = {
  postingId: string;
  employeeId: string;
  assignmentLabel: string;
  scheduleName: string;
  dates: string[];
  month: string;
};

/**
 * Describes a posting in the terms the schedule itself uses.
 *
 * Dates, the post's own code, and where it is. No hours, no duration, no shift
 * times — nothing in this data model records them, and a notification is the
 * last place to start inventing them.
 */
export function buildOvertimePostingNotification(input: OvertimePostingNotificationInput) {
  const dateLabel = describeDateRange(input.dates);

  return {
    id: buildOvertimePostingNotificationId(input.postingId, input.employeeId),
    recipient_employee_id: input.employeeId,
    type: NOTIFICATION_TYPES.overtimePosted,
    title: `Overtime available: ${input.assignmentLabel}`,
    body: `${input.scheduleName} needs ${input.assignmentLabel} cover on ${dateLabel}. You are eligible to claim it.`,
    href: `/overtime?month=${input.month}`,
  };
}

/** "5 September" for one date, "5–8 September" for a run, else a plain count. */
export function describeDateRange(dates: string[]) {
  const sorted = [...new Set(dates)].sort();

  if (sorted.length === 0) {
    return "an upcoming shift";
  }

  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  if (sorted.length === 1) {
    return formatDate(first);
  }

  return isContiguous(sorted)
    ? `${Number(first.slice(8, 10))}–${formatDate(last)}`
    : `${sorted.length} dates from ${formatDate(first)}`;
}

function isContiguous(sortedDates: string[]) {
  return sortedDates.every((date, index) => index === 0 || date === addDays(sortedDates[index - 1], 1));
}

function addDays(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDate(isoDate: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );
}

/** "Just now", "12m ago", "3h ago", "2d ago", then a date. */
export function formatNotificationAge(createdAt: string, now: string) {
  const minutes = Math.floor(
    (new Date(now).getTime() - new Date(createdAt).getTime()) / 60000,
  );

  if (!Number.isFinite(minutes) || minutes < 1) {
    return "Just now";
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);

  return days <= 7 ? `${days}d ago` : formatDate(createdAt.slice(0, 10));
}

export function countUnread(notifications: Pick<AppNotification, "readAt">[]) {
  return notifications.filter((notification) => !notification.readAt).length;
}

/**
 * Today / Earlier this week / Older.
 *
 * Grouping by age rather than by type: someone opening this page is asking
 * what they have missed, and the answer is ordered by when it happened.
 */
export function groupNotificationsByAge<T extends Pick<AppNotification, "createdAt">>(
  notifications: T[],
  today: string,
) {
  const weekAgo = addDays(today, -7);
  const groups: Array<{ key: string; label: string; items: T[] }> = [
    { key: "today", label: "Today", items: [] },
    { key: "week", label: "Earlier this week", items: [] },
    { key: "older", label: "Older", items: [] },
  ];

  for (const notification of notifications) {
    const date = notification.createdAt.slice(0, 10);
    const bucket = date >= today ? 0 : date >= weekAgo ? 1 : 2;
    groups[bucket].items.push(notification);
  }

  return groups.filter((group) => group.items.length > 0);
}
