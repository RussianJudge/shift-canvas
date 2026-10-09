import Link from "next/link";

import { BrandLockup } from "@/components/brand-lockup";

const ROSTER_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function PatLeaveNotice({
  eyebrow,
  title,
  actionHref,
  actionLabel,
}: {
  eyebrow: string;
  title: string;
  actionHref: string;
  actionLabel: string;
}) {
  return (
    <main className="pat-leave">
      <div className="pat-leave__content">
        <BrandLockup size="compact" />

        <div className="pat-leave__icon" aria-hidden="true">
          <svg viewBox="0 0 64 64">
            <circle cx="32" cy="34" r="18" />
            <path d="M14.3 30.5a4.5 4.5 0 0 0 0 9" />
            <path d="M49.7 30.5a4.5 4.5 0 0 1 0 9" />
            <path d="M32 16c-3-5 3-8 5-4" />
            <path d="M21 29l5 3-5 3" />
            <path d="M43 29l-5 3 5 3" />
            <path d="M26 40.5c0-1.5 12-1.5 12 0 0 4-2.5 7-6 7s-6-3-6-7z" />
            <path
              className="pat-leave__tear"
              d="M8 44c-1.5 2.2-2.5 3.6-2.5 5a2.5 2.5 0 0 0 5 0c0-1.4-1-2.8-2.5-5z"
            />
            <path
              className="pat-leave__tear pat-leave__tear--late"
              d="M56 44c-1.5 2.2-2.5 3.6-2.5 5a2.5 2.5 0 0 0 5 0c0-1.4-1-2.8-2.5-5z"
            />
          </svg>
        </div>

        <p className="pat-leave__eyebrow">{eyebrow}</p>
        <h1 className="pat-leave__title">{title}</h1>
        <p className="pat-leave__body">
          Its owner is at home with a newborn, running on roughly three hours of sleep. No coverage
          was arranged.
        </p>

        <div className="pat-leave__roster" role="img" aria-label="Roster: owner on PAT, Monday to Sunday">
          <span className="pat-leave__roster-name">Owner</span>
          {ROSTER_DAYS.map((day) => (
            <span key={day} className="pat-leave__roster-day">
              <span className="pat-leave__roster-label">{day}</span>
              <span className="pat-leave__roster-cell">PAT</span>
            </span>
          ))}
        </div>

        <p className="pat-leave__excel">In the meantime, please enjoy using Excel.</p>

        <Link href={actionHref} className="ui-button ui-button--primary ui-button--lg">
          {actionLabel}
        </Link>
      </div>
    </main>
  );
}
