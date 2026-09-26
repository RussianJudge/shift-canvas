"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  clearNotificationEmailOverride,
  requestNotificationEmailChange,
  setNotificationEmailPreference,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import { EMAILED_NOTIFICATION_TYPES } from "@/lib/notifications";
import type { ResolvedNotificationAddress } from "@/lib/notification-email-address";

const CONFIRMATION_MESSAGES: Record<string, string> = {
  confirmed: "That address is confirmed. Notifications will be emailed there from now on.",
  expired: "That confirmation link had expired. Send yourself a new one.",
  invalid: "That confirmation link is not valid. Send yourself a new one.",
  failed: "That address could not be confirmed. Try again shortly.",
};

/**
 * Per-type email preferences for the signed-in user.
 *
 * Stored as opt-outs, so an absent row means "send". The checkbox is phrased
 * the positive way round — people reason about what they want to receive, not
 * about what they have suppressed.
 */
export function NotificationSettingsPanel({
  mutedTypes,
  address,
  confirmationResult,
}: {
  mutedTypes: string[];
  address: ResolvedNotificationAddress | null;
  confirmationResult: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState("");
  const [addressDraft, setAddressDraft] = useState("");
  const [addressMessage, setAddressMessage] = useState(
    confirmationResult ? CONFIRMATION_MESSAGES[confirmationResult] ?? "" : "",
  );
  const [optimisticMuted, toggleOptimistic] = useOptimistic(
    mutedTypes,
    (current: string[], change: { type: string; muted: boolean }) =>
      change.muted
        ? [...current, change.type]
        : current.filter((entry) => entry !== change.type),
  );

  function handleToggle(notificationType: string, enabled: boolean) {
    startTransition(async () => {
      setErrorMessage("");
      toggleOptimistic({ type: notificationType, muted: !enabled });

      const result = await setNotificationEmailPreference({
        notificationType,
        muted: !enabled,
      });

      if (!result.ok) {
        setErrorMessage(result.message);
      }

      router.refresh();
    });
  }

  function handleAddressSave() {
    startTransition(async () => {
      setAddressMessage("");

      const result = await requestNotificationEmailChange(addressDraft);

      setAddressMessage(result.message);

      if (result.ok) {
        setAddressDraft("");
      }

      router.refresh();
    });
  }

  function handleAddressClear() {
    startTransition(async () => {
      setAddressMessage("");

      const result = await clearNotificationEmailOverride();

      setAddressMessage(result.message);
      router.refresh();
    });
  }

  return (
    <div className="notification-settings">
      <p className="notification-settings__intro">
        Every update below always appears in Schwifty. These settings only control whether it is also
        emailed to you.
      </p>

      {address ? (
        <section className="notification-settings__address" aria-label="Where notifications are emailed">
          <h2 className="notification-settings__section-title">Where notifications are emailed</h2>

          <p className="notification-settings__current">
            {address.email ? (
              <>
                Currently sent to <strong>{address.email}</strong>{" "}
                <span className="notification-settings__description">
                  {address.source === "chosen"
                    ? "(an address you chose)"
                    : "(from your personnel record)"}
                </span>
              </>
            ) : (
              <>No address on file, so nothing can be emailed to you yet.</>
            )}
          </p>

          {address.pendingEmail ? (
            <p className="notification-settings__pending">
              Waiting for confirmation of <strong>{address.pendingEmail}</strong>. Open the link in that
              inbox — check junk, since a first message from a new sender often lands there.
            </p>
          ) : null}

          <div className="notification-settings__address-form">
            <TextInput
              label="Send notifications to"
              type="email"
              value={addressDraft}
              placeholder={address.email ?? "you@example.com"}
              disabled={isPending}
              onChange={(event) => setAddressDraft(event.target.value)}
            />
            <Button variant="secondary" onClick={handleAddressSave} disabled={isPending || !addressDraft.trim()}>
              Send confirmation
            </Button>
            {address.source === "chosen" || address.pendingEmail ? (
              <Button variant="subtle" onClick={handleAddressClear} disabled={isPending}>
                Use my personnel address
              </Button>
            ) : null}
          </div>

          {addressMessage ? (
            <p className="notification-settings__message" role="status">
              {addressMessage}
            </p>
          ) : null}
        </section>
      ) : null}

      <h2 className="notification-settings__section-title">What gets emailed</h2>

      <ul className="notification-settings__list">
        {EMAILED_NOTIFICATION_TYPES.map((type) => {
          const enabled = !optimisticMuted.includes(type.value);

          return (
            <li key={type.value} className="notification-settings__row">
              <label className="subschedule-status-toggle">
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={isPending}
                  onChange={(event) => handleToggle(type.value, event.target.checked)}
                />
                <span className="notification-settings__label">
                  <strong>{type.label}</strong>
                  <span className="notification-settings__description">{type.description}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {errorMessage ? (
        <p className="notifications__error" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
