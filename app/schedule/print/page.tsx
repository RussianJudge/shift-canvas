import Link from "next/link";

import { PrintDialogLauncher } from "@/components/print-dialog-launcher";
import { SchedulePrintView } from "@/components/schedule-print-view";
import { requireAppSession } from "@/lib/auth";
import { getSchedulerSnapshot, getUserSchedulePins } from "@/lib/data";
import { scopeScheduleSnapshot } from "@/lib/role-scopes";
import { formatMonthLabel, getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

function isMonthKey(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}$/.test(value));
}

export default async function SchedulePrintPage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string }>;
}) {
  const session = await requireAppSession(["admin", "leader", "worker"]);
  const currentMonth = getCurrentMonthKey("America/Edmonton");
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const month = isMonthKey(resolvedSearchParams?.month) ? resolvedSearchParams!.month! : currentMonth;
  const snapshot = scopeScheduleSnapshot(await getSchedulerSnapshot(month), session);
  const pinnedEmployeesBySchedule = await getUserSchedulePins(session.email);

  return (
    <main className="print-preview-page">
      <header className="print-preview-toolbar">
        <div>
          <span className="panel-eyebrow">Print Preview</span>
          <h1 className="panel-title">Schedule · {formatMonthLabel(month)}</h1>
        </div>
        <div className="print-preview-toolbar__actions">
          <PrintDialogLauncher />
          <Link href={`/schedule?month=${month}`} className="ghost-button">
            Back to schedule
          </Link>
        </div>
      </header>

      <SchedulePrintView
        snapshot={snapshot}
        monthKey={month}
        pinnedEmployeesBySchedule={pinnedEmployeesBySchedule}
      />
    </main>
  );
}
