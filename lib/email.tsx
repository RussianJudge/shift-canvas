import { Resend } from "resend";

import {
  buildBatchIdempotencyKey,
  chunkForBatchSend,
  type NotificationEmailRecipient,
} from "@/lib/notification-email";
import type { AppRole } from "@/lib/types";
import { AccountInviteEmail } from "@/components/emails/account-invite-email";
import { NotificationEmail } from "@/components/emails/notification-email";

export function getPublicAppUrl(overrideBaseUrl?: string | null) {
  const normalizedOverride = overrideBaseUrl?.trim().replace(/\/+$/, "");

  if (normalizedOverride) {
    return normalizedOverride;
  }

  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.trim().replace(/\/+$/, "");
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return "http://localhost:3000";
}


function getResendConfig() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const replyTo = process.env.RESEND_REPLY_TO_EMAIL;

  if (!apiKey || !from) {
    return null;
  }

  return { resend: new Resend(apiKey), from, replyTo: replyTo || undefined };
}

/**
 * Builds a direct account-creation link for the invite email.
 *
 * We deep-link into the dedicated sign-up page so invite links open directly
 * into the account creation flow with the intended email/token context.
 */
export function buildCreateAccountInviteUrl(email: string, inviteToken?: string | null, baseUrl?: string | null) {
  const inviteUrl = new URL("/sign-up", getPublicAppUrl(baseUrl));
  inviteUrl.searchParams.set("email", email.trim().toLowerCase());

  if (inviteToken) {
    inviteUrl.searchParams.set("invite", inviteToken);
  }

  return inviteUrl.toString();
}

/**
 * Sends the branded account invitation email through Resend.
 *
 * The Personnel admin invite builder uses this helper to send the branded
 * invite email, and other future admin flows can reuse it too.
 */
export async function sendAccountInviteEmail(input: {
  to: string;
  firstName?: string | null;
  lastName?: string | null;
  invitedByName?: string | null;
  inviteToken?: string | null;
  role?: AppRole;
  baseUrl?: string | null;
}) {
  const config = getResendConfig();

  if (!config) {
    throw new Error("Resend is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.");
  }

  const { resend, from, replyTo } = config;
  const normalizedEmail = input.to.trim().toLowerCase();
  const appBaseUrl = getPublicAppUrl(input.baseUrl);
  const inviteUrl = buildCreateAccountInviteUrl(normalizedEmail, input.inviteToken, appBaseUrl);
  const recipientName =
    [input.firstName?.trim(), input.lastName?.trim()].filter(Boolean).join(" ") || "there";
  const roleLabel =
    input.role === "admin" ? "Admin" : input.role === "leader" ? "Leader" : "Worker";

  const { error } = await resend.emails.send({
    from,
    to: normalizedEmail,
    replyTo: replyTo || undefined,
    subject: "Create your Schwifty account",
    react: (
      <AccountInviteEmail
        recipientName={recipientName}
        inviteUrl={inviteUrl}
        invitedByName={input.invitedByName}
        appBaseUrl={appBaseUrl}
        roleLabel={roleLabel}
      />
    ),
  });

  if (error) {
    throw new Error(error.message || "Resend failed to send the account invitation email.");
  }

  return inviteUrl;
}

/**
 * Sends one email per notification recipient through Resend's batch endpoint.
 *
 * Never throws. Email is a side channel: the notification rows are already
 * written and the mutation that produced them has already returned, so a
 * delivery failure is logged and nothing else.
 *
 * Chunks go one after another rather than in parallel — Resend's rate limit is
 * far below a hundred simultaneous batch calls — and each carries an
 * idempotency key derived from the notification ids it contains, so a retried
 * chunk is recognised rather than delivered twice.
 */
export async function sendNotificationEmails(input: {
  recipients: NotificationEmailRecipient[];
  baseUrl?: string | null;
}) {
  const config = getResendConfig();

  if (!config) {
    console.error(
      `Resend is not configured, so ${input.recipients.length} notification emails were not sent.`,
    );
    return { sent: 0, failed: input.recipients.length };
  }

  if (input.recipients.length === 0) {
    return { sent: 0, failed: 0 };
  }

  const { resend, from, replyTo } = config;
  const appBaseUrl = getPublicAppUrl(input.baseUrl);
  const settingsUrl = `${appBaseUrl}/notifications/settings`;
  let sent = 0;
  let failed = 0;

  for (const chunk of chunkForBatchSend(input.recipients)) {
    const payload = chunk.map((recipient) => ({
      from,
      to: recipient.email,
      replyTo,
      subject: recipient.title,
      react: (
        <NotificationEmail
          recipientName={recipient.name}
          title={recipient.title}
          body={recipient.body}
          actionUrl={recipient.href ? `${appBaseUrl}${recipient.href}` : null}
          actionLabel="Open in Schwifty"
          settingsUrl={settingsUrl}
          appBaseUrl={appBaseUrl}
          additionalCount={recipient.additionalCount}
        />
      ),
    }));

    // Permissive, so one malformed address cannot discard the whole chunk and
    // leave no record of which address was at fault.
    const { data, error } = await resend.batch.send(payload, {
      batchValidation: "permissive" as const,
      idempotencyKey: buildBatchIdempotencyKey(chunk.map((recipient) => recipient.notificationId)),
    });

    if (error) {
      failed += chunk.length;
      console.error(`Notification email batch of ${chunk.length} failed:`, error.message);
      continue;
    }

    const rejected = data?.errors ?? [];

    for (const rejection of rejected) {
      console.error(
        `Notification email to ${chunk[rejection.index]?.email ?? "an unknown recipient"} was rejected:`,
        rejection.message,
      );
    }

    failed += rejected.length;
    sent += chunk.length - rejected.length;
  }

  console.info(`Notification email: ${sent} sent, ${failed} failed.`);

  return { sent, failed };
}
