/**
 * Which roster the Schedule page is showing.
 *
 * The page has always had a `?schedule=` parameter carrying either a schedule
 * id or the literal "all". Sub-schedules join it through a `sub:` prefix rather
 * than a second parameter, so there is one selector and one piece of URL state
 * instead of two that can disagree.
 *
 * The prefix is not new: Overtime and Competencies already key their targets as
 * "all" / a schedule id / "sub:<id>". Sub-schedule ids are generated as
 * `sub-schedule-<uuid>`, so no real id can be mistaken for a prefixed one.
 */

export const ALL_SCHEDULES_PARAM = "all";
export const SUB_SCHEDULE_PARAM_PREFIX = "sub:";

export type ScheduleContext =
  | { kind: "all" }
  | { kind: "main"; scheduleId: string }
  | { kind: "sub"; subScheduleId: string };

/** Reads a raw `?schedule=` value. Returns null when there is nothing usable. */
export function parseScheduleContextParam(value: string | null | undefined): ScheduleContext | null {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed === ALL_SCHEDULES_PARAM) {
    return { kind: "all" };
  }

  if (trimmed.startsWith(SUB_SCHEDULE_PARAM_PREFIX)) {
    // A bare "sub:" is the sub-schedule area with nothing selected. That is
    // how an empty workspace is reached at all: the builder's create and
    // manage controls live inside it, so requiring an existing id would leave
    // nowhere to make the first one.
    return { kind: "sub", subScheduleId: trimmed.slice(SUB_SCHEDULE_PARAM_PREFIX.length).trim() };
  }

  return { kind: "main", scheduleId: trimmed };
}

/** The `?schedule=` value for a context. */
export function scheduleContextToParam(context: ScheduleContext): string {
  if (context.kind === "all") {
    return ALL_SCHEDULES_PARAM;
  }

  if (context.kind === "sub") {
    return `${SUB_SCHEDULE_PARAM_PREFIX}${context.subScheduleId}`;
  }

  return context.scheduleId;
}

/** A link to a context, keeping the month the viewer is already looking at. */
export function buildScheduleHref(month: string, context: ScheduleContext): string {
  return `/schedule?month=${month}&schedule=${encodeURIComponent(scheduleContextToParam(context))}`;
}

/**
 * Only non-workers may open a sub-schedule: /sub-schedules has always been
 * admin-and-leader only, and moving the selector onto a page workers can reach
 * must not widen that. Scope (company/site/business area) is enforced earlier,
 * by the loader — `accessibleSubScheduleIds` is what that already returned, so
 * an out-of-scope id simply is not in the list.
 */
export function canAccessScheduleContext(
  context: ScheduleContext,
  viewer: { role: string },
  accessibleSubScheduleIds: readonly string[],
): boolean {
  if (context.kind !== "sub") {
    return true;
  }

  if (viewer.role === "worker") {
    return false;
  }

  // No id means the area itself, which any non-worker may open; a specific one
  // must be in the scoped list.
  return context.subScheduleId === "" || accessibleSubScheduleIds.includes(context.subScheduleId);
}

/**
 * The context to actually render.
 *
 * A missing, deleted or inaccessible id falls back to the viewer's own roster
 * rather than erroring, so a stale link degrades into a usable page and never
 * reports whether the id existed.
 */
export function resolveScheduleContext({
  param,
  viewer,
  accessibleSubScheduleIds,
  fallbackScheduleId,
}: {
  param: string | null | undefined;
  viewer: { role: string };
  accessibleSubScheduleIds: readonly string[];
  fallbackScheduleId: string | null;
}): ScheduleContext {
  const parsed = parseScheduleContextParam(param);
  const fallback: ScheduleContext = fallbackScheduleId
    ? { kind: "main", scheduleId: fallbackScheduleId }
    : { kind: "all" };

  if (!parsed) {
    return fallback;
  }

  return canAccessScheduleContext(parsed, viewer, accessibleSubScheduleIds) ? parsed : fallback;
}
