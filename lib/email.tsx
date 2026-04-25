import { Resend } from "resend";

import { AccountInviteEmail } from "@/components/emails/account-invite-email";

function getPublicAppUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return "http://localhost:3000";
}

/**
 * Builds a direct account-creation link for the invite email.
 *
 * We deep-link into the existing sign-in page instead of building a separate
 * invitation screen, which keeps the onboarding flow aligned with the auth UI
 * users already have.
 */
export function buildCreateAccountInviteUrl(email: string) {
  const inviteUrl = new URL("/sign-in", getPublicAppUrl());
  inviteUrl.searchParams.set("mode", "create");
  inviteUrl.searchParams.set("email", email.trim().toLowerCase());
  return inviteUrl.toString();
}

/**
 * Sends the branded account invitation email through Resend.
 *
 * Nothing in the app calls this yet; it is a reusable delivery helper we can
 * plug into Personnel, an admin action, or a future invite workflow.
 */
export async function sendAccountInviteEmail(input: {
  to: string;
  firstName?: string | null;
  lastName?: string | null;
  invitedByName?: string | null;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const replyTo = process.env.RESEND_REPLY_TO_EMAIL;

  if (!apiKey || !from) {
    throw new Error("Resend is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.");
  }

  const resend = new Resend(apiKey);
  const normalizedEmail = input.to.trim().toLowerCase();
  const appBaseUrl = getPublicAppUrl();
  const inviteUrl = buildCreateAccountInviteUrl(normalizedEmail);
  const recipientName =
    [input.firstName?.trim(), input.lastName?.trim()].filter(Boolean).join(" ") || "there";

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
      />
    ),
  });

  if (error) {
    throw new Error(error.message || "Resend failed to send the account invitation email.");
  }

  return inviteUrl;
}
