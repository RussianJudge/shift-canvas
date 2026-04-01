import type { AppSession, SchedulerSnapshot } from "@/lib/types";

export function scopeScheduleSnapshot(snapshot: SchedulerSnapshot, session: AppSession) {
  if (session.role === "admin" || !session.scheduleId) {
    return snapshot;
  }

  const supportScheduleIds = new Set(
    snapshot.overtimeClaims
      .filter((claim) => claim.scheduleId === session.scheduleId)
      .map((claim) => {
        const employee = snapshot.schedules.flatMap((schedule) => schedule.employees).find((entry) => entry.id === claim.employeeId);
        return employee?.scheduleId ?? null;
      })
      .filter(Boolean) as string[],
  );

  supportScheduleIds.add(session.scheduleId);

  return {
    ...snapshot,
    schedules: snapshot.schedules.filter((schedule) => supportScheduleIds.has(schedule.id)),
    overtimeClaims: snapshot.overtimeClaims.filter((claim) => claim.scheduleId === session.scheduleId),
    completedSets: snapshot.completedSets.filter((entry) => entry.scheduleId === session.scheduleId),
  };
}
