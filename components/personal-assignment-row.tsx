import { getShiftLabel } from "@/lib/personal-schedule";
import type { PersonalDay } from "@/lib/personal-schedule";

/**
 * One day's work, as shown in the next-assignment block and the day list.
 *
 * There are no clock times: no time code or schedule row in this data model
 * carries a start, an end, or a duration, so the shift kind and the code are
 * the whole of what is known.
 */
export function PersonalAssignmentRow({
  day,
  location,
}: {
  day: PersonalDay;
  location: string | null;
}) {
  return (
    <div className="personal-assignment">
      <div className="personal-assignment__codes">
        {day.code ? (
          <span
            className={`legend-pill ${day.colorToken ? `legend-pill--${day.colorToken.toLowerCase()}` : ""}`}
          >
            {day.code}
          </span>
        ) : null}
        <span className="personal-assignment__label">{day.shiftLabel}</span>
      </div>

      {day.awayScheduleName ? (
        <p className="personal-assignment__meta">Overtime on {day.awayScheduleName}</p>
      ) : null}

      {day.subScheduleName ? (
        <p className="personal-assignment__meta">Managed by {day.subScheduleName}</p>
      ) : null}

      {location ? (
        <p className="personal-assignment__meta">
          <LocationIcon />
          {location}
        </p>
      ) : null}
    </div>
  );
}

/** A day with nothing on it, so the list never renders an unexplained gap. */
export function PersonalRestRow({ day }: { day: PersonalDay }) {
  return (
    <div className="personal-assignment personal-assignment--rest">
      <span className="personal-assignment__label">
        {day.code ? day.shiftLabel : "Nothing scheduled"}
      </span>
      <span className="sr-only">{getShiftLabel(day.shiftKind)}</span>
    </div>
  );
}

function LocationIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}
