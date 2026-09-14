import type { AppRole } from "@/lib/types";

/** Whose schedule the Schedule page is showing. */
export type ScheduleScope = "mine" | "team";

/**
 * Not signed, unlike the session cookie: the scope decides which of the
 * viewer's own views renders, never what they may reach. My schedule is built
 * from their own employee record and Team keeps every existing permission
 * check, so a tampered value grants nothing.
 */
export const SCHEDULE_SCOPE_COOKIE = "schwifty-schedule-scope";

export function parseScheduleScope(value: string | null | undefined): ScheduleScope | null {
  return value === "mine" || value === "team" ? value : null;
}

/**
 * Workers open their own schedule; everyone else is here to run a crew.
 */
export function defaultScheduleScopeForRole(role: AppRole): ScheduleScope {
  return role === "worker" ? "mine" : "team";
}

/**
 * A `?scope=` in the link wins for the visit without disturbing what was saved,
 * so a shared link lands on the view it names and the next plain visit goes
 * back to the viewer's own preference.
 */
export function resolveScheduleScope({
  param,
  stored,
  role,
}: {
  param: string | null | undefined;
  stored: string | null | undefined;
  role: AppRole;
}): ScheduleScope {
  return parseScheduleScope(param) ?? parseScheduleScope(stored) ?? defaultScheduleScopeForRole(role);
}

/** Carries the scope across links that already hold a month and a context. */
export function buildScheduleScopeHref({
  scope,
  month,
  schedule,
}: {
  scope: ScheduleScope;
  month: string;
  schedule: string | null;
}) {
  const params = new URLSearchParams();
  params.set("month", month);

  if (schedule) {
    params.set("schedule", schedule);
  }

  params.set("scope", scope);

  return `/schedule?${params.toString()}`;
}
