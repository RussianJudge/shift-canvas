import { NextResponse } from "next/server";

import { confirmNotificationEmail } from "@/app/actions";

export const dynamic = "force-dynamic";

/**
 * The target of the link in a confirmation email.
 *
 * Deliberately open to anyone holding the token: the link is usually opened in
 * whichever app the mailbox lives in, not the browser that asked for the
 * change, and controlling the mailbox is exactly what is being proven.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const result = await confirmNotificationEmail(url.searchParams.get("token") ?? "");

  return NextResponse.redirect(new URL(`/notifications/settings?address=${result.reason}`, url.origin));
}
