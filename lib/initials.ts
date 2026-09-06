/**
 * Initials for an avatar, taken from whatever display name the record
 * actually carries — "Bowman, Riley", a single word, or an email local part.
 * Returns null when no letters can be derived, so callers omit the avatar
 * rather than rendering a placeholder.
 */
export function deriveInitials(displayName: string) {
  const words = displayName.trim().split(/[\s@._,-]+/).filter(Boolean);

  if (words.length === 0) {
    return null;
  }

  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? words[words.length - 1]?.[0] ?? "" : "";
  const initials = `${first}${last}`.toUpperCase();

  return /^[A-Z]{1,2}$/.test(initials) ? initials : null;
}
