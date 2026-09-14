"use client";

import type { ScheduleWeek } from "@/lib/scheduling";
import type { PersonalDay } from "@/lib/personal-schedule";

const WEEKDAY_HEADINGS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * The signed-in employee's month.
 *
 * Deliberately not the team grid: there is one row, no virtualization and no
 * drag-select, so none of that machinery applies. It shares the cell language —
 * the same competency and time-code pills — through `legend-pill`.
 */
export function PersonalCalendar({
  weeks,
  daysByDate,
  today,
  selectedDate,
  onSelectDate,
}: {
  weeks: ScheduleWeek[];
  daysByDate: Map<string, PersonalDay>;
  today: string | null;
  selectedDate: string;
  onSelectDate: (date: string) => void;
}) {
  return (
    <div className="personal-calendar">
      <div className="personal-calendar__headings" aria-hidden="true">
        {WEEKDAY_HEADINGS.map((heading) => (
          <span key={heading} className="personal-calendar__heading">
            {heading.toUpperCase()}
          </span>
        ))}
      </div>

      <div className="personal-calendar__grid" role="grid" aria-label="Your month">
        {weeks.map((week) => (
          <div key={week.key} className="personal-calendar__week" role="row">
            {week.days.map((gridDay) => {
              const day = daysByDate.get(gridDay.date);
              const isToday = gridDay.date === today;
              const isSelected = gridDay.date === selectedDate;

              return (
                <div key={gridDay.date} role="gridcell" aria-selected={isSelected}>
                  <button
                    type="button"
                    className={`personal-calendar__day ${
                      gridDay.isWeekend ? "personal-calendar__day--weekend" : ""
                    } ${gridDay.isOutsideMonth ? "personal-calendar__day--outside" : ""} ${
                      isSelected ? "personal-calendar__day--selected" : ""
                    }`}
                    aria-current={isToday ? "date" : undefined}
                    onClick={() => onSelectDate(gridDay.date)}
                  >
                    <span className="personal-calendar__date">
                      <span
                        className={`personal-calendar__number ${
                          isToday ? "personal-calendar__number--today" : ""
                        }`}
                      >
                        {gridDay.dayNumber}
                      </span>
                      {gridDay.isOutsideMonth ? (
                        <span className="personal-calendar__month">
                          {monthAbbreviation(gridDay.date)}
                        </span>
                      ) : null}
                    </span>

                    {day?.code ? (
                      <span className="personal-calendar__entry">
                        <span
                          className={`legend-pill ${
                            day.colorToken ? `legend-pill--${day.colorToken.toLowerCase()}` : ""
                          }`}
                        >
                          {day.code}
                        </span>
                        <span className="personal-calendar__shift">{day.shiftLabel}</span>
                      </span>
                    ) : null}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function monthAbbreviation(isoDate: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" })
    .format(new Date(`${isoDate}T00:00:00Z`))
    .toUpperCase();
}
