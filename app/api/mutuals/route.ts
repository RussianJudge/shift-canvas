import { NextResponse } from "next/server";

import { getAppSession } from "@/lib/auth";
import { getMutualsSnapshot } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getAppSession();

  if (!session) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month");

  if (!month) {
    return NextResponse.json({ error: "Month is required." }, { status: 400 });
  }

  return NextResponse.json(await getMutualsSnapshot(month));
}
