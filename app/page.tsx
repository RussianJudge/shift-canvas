import { MonthlyScheduler } from "@/components/monthly-scheduler";
import { getCurrentMonthKey } from "@/lib/scheduling";
import { getSchedulerSnapshot } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const month = getCurrentMonthKey("America/Edmonton");
  const snapshot = await getSchedulerSnapshot(month);

  return <MonthlyScheduler initialSnapshot={snapshot} />;
}
