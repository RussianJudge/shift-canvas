import { createHash } from "node:crypto";

import type { NotificationType } from "@/lib/notifications";

/** Resend's documented maximum number of messages in one batch call. */
export const BATCH_SEND_LIMIT = 100;

export type EmployeeContact = {
  email: string | null;
  name: string;
};

export type NotificationEmailCandidate = {
  id: string;
  employeeId: string;
  type: NotificationType;
  title: string;
  body: string;
  href: string | null;
};

export type NotificationEmailRecipient = {
  notificationId: string;
  /** Every notification this one email covers, including the folded-in extras. */
  notificationIds: string[];
  employeeId: string;
  type: NotificationType;
  email: string;
  name: string;
  title: string;
  body: string;
  href: string | null;
  /** Same-type notifications from this send folded into this one email. */
  additionalCount: number;
};

export type EmailRecipientSelection = {
  recipients: NotificationEmailRecipient[];
  skipped: {
    noEmail: number;
    muted: number;
    collapsed: number;
  };
};

/** Matches the partial-unique index the employees table keeps on lower(btrim(email)). */
export function normalizeRecipientEmail(raw: string | null | undefined) {
  return raw?.trim().toLowerCase() || null;
}

export function buildOptoutKey(employeeId: string, type: string) {
  return `${employeeId}:${type}`;
}

/**
 * Decides who actually gets mail, and counts everyone who does not.
 *
 * One email per person per type per send. Releasing a whole month of claims for
 * one worker produces a month of notification rows — correct in the app, but a
 * month of separate emails would read as a malfunction, so the extras are
 * folded into `additionalCount` and the caller mentions them.
 *
 * An opt-out is checked before the address, so someone who muted a type and has
 * no email on file counts once, as muted.
 */
export function selectEmailRecipients(input: {
  notifications: NotificationEmailCandidate[];
  contactsByEmployeeId: Map<string, EmployeeContact>;
  mutedKeys: Set<string>;
}): EmailRecipientSelection {
  const recipients = new Map<string, NotificationEmailRecipient>();
  const skipped = { noEmail: 0, muted: 0, collapsed: 0 };

  for (const notification of input.notifications) {
    const groupKey = buildOptoutKey(notification.employeeId, notification.type);
    const existing = recipients.get(groupKey);

    if (existing) {
      existing.additionalCount += 1;
      existing.notificationIds.push(notification.id);
      skipped.collapsed += 1;
      continue;
    }

    if (input.mutedKeys.has(groupKey)) {
      skipped.muted += 1;
      continue;
    }

    const contact = input.contactsByEmployeeId.get(notification.employeeId);
    const email = normalizeRecipientEmail(contact?.email);

    if (!email) {
      skipped.noEmail += 1;
      continue;
    }

    recipients.set(groupKey, {
      notificationId: notification.id,
      notificationIds: [notification.id],
      employeeId: notification.employeeId,
      type: notification.type,
      email,
      name: contact?.name?.trim() || "there",
      title: notification.title,
      body: notification.body,
      href: notification.href,
      additionalCount: 0,
    });
  }

  return { recipients: Array.from(recipients.values()), skipped };
}

export function chunkForBatchSend<T>(items: T[], size = BATCH_SEND_LIMIT): T[][] {
  if (size < 1) {
    return items.length > 0 ? [items] : [];
  }

  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

/**
 * Hashed rather than concatenated: a hundred ids would be a several-kilobyte
 * HTTP header. Sorted first so the key describes the set, not the order it
 * happened to be assembled in.
 */
export function buildBatchIdempotencyKey(ids: string[]) {
  return createHash("sha256").update([...ids].sort().join("|")).digest("hex");
}
