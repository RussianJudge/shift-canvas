import { redirect } from "next/navigation";

import { buildScheduleHref } from "@/lib/schedule-context";
import { getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

function isMonthKey(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}$/.test(value));
}

/**
 * Sub-schedules now live inside /schedule, chosen from the schedule selector.
 *
 * This route stays as a redirect so existing links and bookmarks keep working,
 * carrying both the month and the specific sub-schedule across. No session is
 * required here: /schedule authorises the request, and resolving the context
 * there means a viewer who may not open a sub-schedule lands on their own
 * roster instead of being told whether the id existed.
 */
export default async function SubSchedulesPage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string; subSchedule?: string }>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const month = isMonthKey(resolvedSearchParams?.month)
    ? resolvedSearchParams!.month!
    : getCurrentMonthKey("America/Edmonton");
  const subScheduleId = resolvedSearchParams?.subSchedule?.trim();

  redirect(
    subScheduleId
      ? buildScheduleHref(month, { kind: "sub", subScheduleId })
      : `/schedule?month=${month}`,
  );
}
