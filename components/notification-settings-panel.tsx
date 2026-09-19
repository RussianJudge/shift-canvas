"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { setNotificationEmailPreference } from "@/app/actions";
import { EMAILED_NOTIFICATION_TYPES } from "@/lib/notifications";

/**
 * Per-type email preferences for the signed-in user.
 *
 * Stored as opt-outs, so an absent row means "send". The checkbox is phrased
 * the positive way round — people reason about what they want to receive, not
 * about what they have suppressed.
 */
export function NotificationSettingsPanel({ mutedTypes }: { mutedTypes: string[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState("");
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

  return (
    <div className="notification-settings">
      <p className="notification-settings__intro">
        Every update below always appears in Schwifty. These settings only control whether it is also
        emailed to you.
      </p>

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
