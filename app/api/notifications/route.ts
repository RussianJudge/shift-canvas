import { NextResponse } from "next/server";

import { getAppSession } from "@/lib/auth";
import { getNotificationsForViewer } from "@/lib/data";

export async function GET(request: Request) {
  const session = await getAppSession();

  if (!session) {
    return NextResponse.json({ notifications: [] }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") ?? "5");
  const unreadOnly = searchParams.get("unread") === "1";
  const notifications = await getNotificationsForViewer(session, {
    unreadOnly,
    limit: Number.isFinite(limit) ? Math.max(1, Math.min(limit, 50)) : 5,
  });

  return NextResponse.json({ notifications });
}
