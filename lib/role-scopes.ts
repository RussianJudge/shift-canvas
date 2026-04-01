import type { AppSession, SchedulerSnapshot } from "@/lib/types";

export function scopeScheduleSnapshot(snapshot: SchedulerSnapshot, session: AppSession) {
  return snapshot;
}
