import { NextResponse } from "next/server";

import { getSchedulerSnapshot } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month");

  if (!month) {
    return NextResponse.json({ error: "Month is required." }, { status: 400 });
  }

  const snapshot = await getSchedulerSnapshot(month);

  return NextResponse.json(snapshot);
}
