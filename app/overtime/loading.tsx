import { OvertimeRouteLoading } from "@/components/route-loading";
import { getCurrentMonthKey } from "@/lib/scheduling";
import type { AppSession } from "@/lib/types";

const loadingViewer = {
  role: "leader",
  displayName: "Loading",
} satisfies Pick<AppSession, "role" | "displayName">;

export default function Loading() {
  const month = getCurrentMonthKey("America/Edmonton");

  return <OvertimeRouteLoading viewer={loadingViewer} month={month} />;
}
