/** A worker's chosen notification address, as stored. */
export type NotificationEmailOverride = {
  email: string;
  verifiedAt: string | null;
  tokenExpiresAt: string | null;
};

export type NotificationAddressSource = "personnel" | "chosen";

export type ResolvedNotificationAddress = {
  email: string | null;
  source: NotificationAddressSource;
  /** An address requested but not yet confirmed, still waiting on its link. */
  pendingEmail: string | null;
};

/** Matches the normalisation the employees table's unique index applies. */
export function normalizeNotificationEmail(raw: string | null | undefined) {
  return raw?.trim().toLowerCase() || null;
}

/**
 * Good enough to catch a typo, not an attempt to validate deliverability.
 *
 * Confirmation is what actually proves the address works; this only rejects
 * input that could never be an address at all.
 */
export function isPlausibleEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isTokenExpired(tokenExpiresAt: string | null, now: string) {
  return !tokenExpiresAt || tokenExpiresAt <= now;
}

/**
 * Which address a notification actually goes to.
 *
 * Only a confirmed override wins. An unconfirmed one is reported separately so
 * the settings page can say a change is waiting, while mail carries on going
 * to the personnel address — the point of confirming at all is that nobody
 * stops receiving notifications because they mistyped.
 */
export function resolveNotificationAddress(input: {
  employeeEmail: string | null;
  override: NotificationEmailOverride | null;
}): ResolvedNotificationAddress {
  const personnelEmail = normalizeNotificationEmail(input.employeeEmail);
  const overrideEmail = normalizeNotificationEmail(input.override?.email);

  if (overrideEmail && input.override?.verifiedAt) {
    return { email: overrideEmail, source: "chosen", pendingEmail: null };
  }

  return {
    email: personnelEmail,
    source: "personnel",
    pendingEmail: overrideEmail && !input.override?.verifiedAt ? overrideEmail : null,
  };
}
