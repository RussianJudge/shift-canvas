import type { AppSession } from "@/lib/types";

export function scopeScheduleSnapshot<T>(snapshot: T, session: AppSession) {
  return snapshot;
}
