import { Resend } from "resend";

import type { AppRole } from "@/lib/types";
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
 * We deep-link into the dedicated sign-up page so invite links open directly
 * into the account creation flow with the intended email/token context.
 */
export function buildCreateAccountInviteUrl(email: string, inviteToken?: string | null) {
  const inviteUrl = new URL("/sign-up", getPublicAppUrl());
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
  const inviteUrl = buildCreateAccountInviteUrl(normalizedEmail, input.inviteToken);
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
