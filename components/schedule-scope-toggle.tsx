"use client";

import { useState, useTransition } from "react";

import { saveScheduleScope } from "@/app/auth-actions";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { buildScheduleScopeHref, type ScheduleScope } from "@/lib/schedule-scope";

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 19.5a7 7 0 0 1 14 0" strokeLinecap="round" />
    </svg>
  );
}

function TeamIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3 19a6 6 0 0 1 12 0" strokeLinecap="round" />
      <path d="M16 6.2a3 3 0 0 1 0 5.6M17.5 19a6 6 0 0 0-2.4-4.8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Switches the Schedule page between the viewer's own schedule and the crew.
 *
 * The scope lives in the URL so back and forward restore it, and the same
 * choice is written to the account's cookie so the next plain visit opens the
 * same way. A failed write leaves the toggle where the user put it and says so
 * rather than snapping back — the view they asked for is already on screen.
 */
export function ScheduleScopeToggle({
  scope,
  month,
  schedule,
  onBeforeNavigate,
}: {
  scope: ScheduleScope;
  month: string;
  schedule: string | null;
  /** Lets the month grid flush pending edits before the page reloads. */
  onBeforeNavigate?: () => Promise<boolean> | boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [saveFailed, setSaveFailed] = useState(false);

  function handleChange(next: ScheduleScope) {
    startTransition(async () => {
      if (onBeforeNavigate) {
        const mayLeave = await onBeforeNavigate();

        if (!mayLeave) {
          return;
        }
      }

      const result = await saveScheduleScope(next);

      setSaveFailed(!result.ok);
      window.location.assign(buildScheduleScopeHref({ scope: next, month, schedule }));
    });
  }

  return (
    <div className="schedule-scope">
      <SegmentedControl
        label="Whose schedule to show"
        className="schedule-scope__control"
        value={scope}
        options={[
          { value: "mine", label: "My schedule", icon: <PersonIcon />, disabled: isPending },
          { value: "team", label: "Team", icon: <TeamIcon />, disabled: isPending },
        ]}
        onChange={(next) => handleChange(next)}
      />
      {saveFailed ? (
        <p className="schedule-scope__status" role="status">
          Showing this view, but it could not be saved for next time.
        </p>
      ) : null}
    </div>
  );
}
