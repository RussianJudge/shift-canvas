export const SIDEBAR_COLLAPSE_STORAGE_KEY = "shift-canvas-sidebar-collapsed";

/** Stored as "true"/"false"; anything else (absent, corrupt) means expanded. */
export function parseSidebarCollapsePreference(stored: string | null) {
  return stored === "true";
}

export function serializeSidebarCollapsePreference(isCollapsed: boolean) {
  return String(isCollapsed);
}

/**
 * Collapsed state to apply after a viewport change, or `null` to leave the
 * state exactly as the user last set it.
 *
 * Only crossing the mobile breakpoint reconciles the state. A plain resize on
 * one side of it must not touch the sidebar: the stored preference is written
 * by an effect after the user toggles, so re-applying it on every resize tick
 * is at best redundant and at worst races that write.
 */
export function resolveSidebarCollapseForViewport({
  isMobileSidebarMode,
  wasMobileSidebarMode,
  storedPreference,
}: {
  isMobileSidebarMode: boolean;
  wasMobileSidebarMode: boolean | null;
  storedPreference: string | null;
}): boolean | null {
  if (wasMobileSidebarMode === isMobileSidebarMode) {
    return null;
  }

  // The drawer is always expanded on mobile; the desktop preference is left
  // untouched in storage so it survives the round trip.
  return isMobileSidebarMode ? false : parseSidebarCollapsePreference(storedPreference);
}
