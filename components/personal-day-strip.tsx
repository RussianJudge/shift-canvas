"use client";

import { useRef } from "react";

import type { PersonalDay } from "@/lib/personal-schedule";

/**
 * The seven days around the selected one, for a thumb on a phone.
 *
 * Arrow keys move between days and follow the selection, so the list below
 * changes as focus moves — the same behaviour a date picker has, without
 * leaving the page.
 */
export function PersonalDayStrip({
  days,
  today,
  selectedDate,
  onSelectDate,
}: {
  days: PersonalDay[];
  today: string | null;
  selectedDate: string;
  onSelectDate: (date: string) => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);

  function focusDate(date: string) {
    onSelectDate(date);
    // The button is keyed by date, so it survives the re-render and can take
    // focus straight after it.
    requestAnimationFrame(() => {
      stripRef.current?.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)?.focus();
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;

    if (delta === 0) {
      return;
    }

    const next = days[index + delta];

    if (next) {
      event.preventDefault();
      focusDate(next.date);
    }
  }

  return (
    <div className="personal-strip" role="group" aria-label="Pick a day" ref={stripRef}>
      {days.map((day, index) => {
        const isSelected = day.date === selectedDate;

        return (
          <button
            key={day.date}
            type="button"
            data-date={day.date}
            className={`personal-strip__day ${isSelected ? "personal-strip__day--selected" : ""}`}
            aria-pressed={isSelected}
            aria-current={day.date === today ? "date" : undefined}
            onClick={() => onSelectDate(day.date)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <span className="personal-strip__weekday">{weekdayLabel(day.date)}</span>
            <span className="personal-strip__number">{Number(day.date.slice(8, 10))}</span>
            <span
              className={`personal-strip__dot ${
                day.colorToken ? `legend-pill--${day.colorToken.toLowerCase()}` : ""
              } ${day.code ? "" : "personal-strip__dot--empty"}`}
              aria-hidden="true"
            />
            <span className="sr-only">{day.code ? `${day.code}, ${day.shiftLabel}` : "Nothing scheduled"}</span>
          </button>
        );
      })}
    </div>
  );
}

function weekdayLabel(isoDate: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" })
    .format(new Date(`${isoDate}T00:00:00Z`))
    .toUpperCase();
}
