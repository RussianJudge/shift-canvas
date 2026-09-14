import {
  formatUpcomingDayNumbers,
  formatUpcomingWeekdays,
  type UpcomingEntry,
} from "@/lib/personal-schedule";

/** What follows the next assignment, runs of the same thing collapsed. */
export function UpcomingAssignments({ entries }: { entries: UpcomingEntry[] }) {
  if (entries.length === 0) {
    return <p className="personal-upcoming__empty">Nothing else is scheduled this month.</p>;
  }

  return (
    <ul className="personal-upcoming__list">
      {entries.map((entry) => (
        <li key={entry.startDate} className="personal-upcoming__row">
          <div className="personal-upcoming__when">
            <span className="personal-upcoming__weekday">
              {formatUpcomingWeekdays(entry.startDate, entry.endDate)}
            </span>
            <span className="personal-upcoming__number">
              {formatUpcomingDayNumbers(entry.startDate, entry.endDate)}
            </span>
          </div>

          <div className="personal-upcoming__what">
            {entry.isWorking ? (
              <span
                className={`legend-pill ${
                  entry.colorToken ? `legend-pill--${entry.colorToken.toLowerCase()}` : ""
                }`}
              >
                {entry.code}
              </span>
            ) : (
              <span className="personal-upcoming__rest-icon" aria-hidden="true">
                <RestIcon />
              </span>
            )}
            <span className="personal-upcoming__label">
              {entry.isWorking ? entry.shiftLabel : "Days off"}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function RestIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" strokeLinecap="round" />
    </svg>
  );
}
