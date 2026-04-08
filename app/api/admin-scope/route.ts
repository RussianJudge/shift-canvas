import { NextResponse } from "next/server";

import { getAppSession } from "@/lib/auth";
import { getAdminScopeOptions } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAppSession();

  if (!session) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  if (session.role !== "admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const options = await getAdminScopeOptions(session);

  return NextResponse.json({
    companyName: session.companyName,
    activeSiteId: session.activeSiteId ?? null,
    activeBusinessAreaId: session.activeBusinessAreaId ?? null,
    sites: options.sites,
    businessAreas: options.businessAreas,
  });
}
