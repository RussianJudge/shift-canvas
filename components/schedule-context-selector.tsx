"use client";

import { useEffect, useRef, useState } from "react";

import {
  buildScheduleHref,
  scheduleContextToParam,
  type ScheduleContext,
} from "@/lib/schedule-context";

function ScheduleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

function AllSchedulesIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3l9 5l-9 5l-9-5l9-5Z" />
      <path d="M3 13l9 5l9-5M3 17l9 5l9-5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ManageIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.25" />
      <path d="M19.5 12a7.5 7.5 0 0 0-.15-1.5l2.1-1.62l-2-3.46l-2.48 1a7.6 7.6 0 0 0-2.6-1.5L14 2.25h-4l-.38 2.67a7.6 7.6 0 0 0-2.6 1.5l-2.48-1l-2 3.46l2.1 1.62a7.4 7.4 0 0 0 0 3l-2.1 1.62l2 3.46l2.48-1a7.6 7.6 0 0 0 2.6 1.5L10 21.75h4l.38-2.67a7.6 7.6 0 0 0 2.6-1.5l2.48 1l2-3.46l-2.1-1.62c.1-.49.15-.99.15-1.5Z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="schedule-switch__check">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

/**
 * The one control that chooses what the Schedule page shows: a main roster,
 * every roster at once, or a sub-schedule.
 *
 * Both renderers use this — the month grid and the sub-schedule builder — so
 * there is a single selector rather than one per view. Create and manage are
 * always listed, not just when a sub-schedule already exists, or a workspace
 * with none would have no way to make its first one.
 *
 * Navigation is a full document load, as the shift switcher has always done:
 * the server re-resolves and re-authorises the context, and back/forward work
 * without replaying client state.
 */
export function ScheduleContextSelector({
  month,
  context,
  schedules,
  subSchedules,
  canManageSubSchedules,
  disabled = false,
  onBeforeNavigate,
}: {
  month: string;
  context: ScheduleContext;
  schedules: Array<{ id: string; name: string }>;
  /** Already filtered to what the viewer may open. */
  subSchedules: Array<{ id: string; name: string; isArchived: boolean }>;
  /** False for workers, who may not open a sub-schedule at all. */
  canManageSubSchedules: boolean;
  disabled?: boolean;
  /** Returns false to abort the switch, e.g. when a save could not complete. */
  onBeforeNavigate?: (next: ScheduleContext) => boolean | Promise<boolean>;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }

      setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const activeParam = scheduleContextToParam(context);

  function triggerLabel() {
    if (context.kind === "all") {
      return "All schedules";
    }

    if (context.kind === "sub") {
      return (
        subSchedules.find((subSchedule) => subSchedule.id === context.subScheduleId)?.name ??
        "Sub-schedules"
      );
    }

    return schedules.find((schedule) => schedule.id === context.scheduleId)?.name ?? "Main schedule";
  }

  async function go(next: ScheduleContext, extraQuery = "") {
    if (isSwitching) {
      return;
    }

    setIsSwitching(true);

    try {
      if (onBeforeNavigate && (await onBeforeNavigate(next)) === false) {
        setIsSwitching(false);
        return;
      }

      window.location.assign(`${buildScheduleHref(month, next)}${extraQuery}`);
    } catch {
      // A failed guard leaves the viewer on unsaved work rather than moving on.
      setIsSwitching(false);
    }
  }

  function Option({
    param,
    icon,
    children,
    onSelect,
  }: {
    param?: string;
    icon?: React.ReactNode;
    children: React.ReactNode;
    onSelect: () => void;
  }) {
    const isSelected = param !== undefined && param === activeParam;

    return (
      <button
        type="button"
        role="menuitemradio"
        aria-checked={isSelected}
        className={`schedule-switch__option ${isSelected ? "schedule-switch__option--selected" : ""}`}
        disabled={isSwitching}
        onClick={() => {
          setIsOpen(false);
          onSelect();
        }}
      >
        {icon ? <span className="schedule-switch__icon">{icon}</span> : null}
        <span className="schedule-switch__label">{children}</span>
        {isSelected ? <CheckIcon /> : null}
      </button>
    );
  }

  return (
    <div className="schedule-switch" ref={rootRef}>
      <button
        type="button"
        className="schedule-switch__trigger"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        disabled={disabled || isSwitching}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className="schedule-switch__icon">
          <ScheduleIcon />
        </span>
        <span className="schedule-switch__trigger-label">{triggerLabel()}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true" className="schedule-switch__chevron">
          <path d="M6 9l6 6l6-6" />
        </svg>
      </button>

      {isOpen ? (
        <div className="schedule-switch__menu" role="menu" aria-label="Schedule">
          {schedules.map((schedule) => (
            <Option
              key={schedule.id}
              param={schedule.id}
              icon={<ScheduleIcon />}
              onSelect={() => void go({ kind: "main", scheduleId: schedule.id })}
            >
              {schedule.name}
            </Option>
          ))}

          <Option
            param="all"
            icon={<AllSchedulesIcon />}
            onSelect={() => void go({ kind: "all" })}
          >
            All schedules
          </Option>

          {canManageSubSchedules ? (
            <>
              <p className="schedule-switch__section">Sub-schedules</p>

              {subSchedules.map((subSchedule) => (
                <Option
                  key={subSchedule.id}
                  param={scheduleContextToParam({ kind: "sub", subScheduleId: subSchedule.id })}
                  onSelect={() => void go({ kind: "sub", subScheduleId: subSchedule.id })}
                >
                  {subSchedule.name}
                  {subSchedule.isArchived ? " (Archived)" : ""}
                </Option>
              ))}

              {subSchedules.length === 0 ? (
                <p className="schedule-switch__empty">None yet.</p>
              ) : null}

              <div className="schedule-switch__divider" role="separator" />

              <Option
                icon={<PlusIcon />}
                onSelect={() => void go({ kind: "sub", subScheduleId: "" }, "&new=1")}
              >
                Create sub-schedule
              </Option>

              <Option
                icon={<ManageIcon />}
                onSelect={() => void go({ kind: "sub", subScheduleId: "" })}
              >
                Manage sub-schedules
              </Option>

              {/* Sub-schedule edits are live on Main once saved — there is no
                  publish step, and this says so rather than implying one. */}
              <p className="schedule-switch__hint">Edits appear on Main after saving.</p>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
