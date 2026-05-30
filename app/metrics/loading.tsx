import { MetricsRouteLoading } from "@/components/route-loading";
import { getCurrentMonthKey } from "@/lib/scheduling";

export default function Loading() {
  const month = getCurrentMonthKey("America/Edmonton");

  return <MetricsRouteLoading month={month} />;
}
