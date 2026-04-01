import Link from "next/link";

import { getAppSession, getSessionHomePath } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const session = await getAppSession();
  const primaryHref = session ? getSessionHomePath(session) : "/sign-in";

  return (
    <main className="landing-shell">
      <section className="landing-hero">
        <div className="landing-hero__copy">
          <span className="landing-kicker">Shift Canvas</span>
          <h1>Build monthly shift plans with the whole operation in view.</h1>
          <p>
            Assign posts, complete worked sets, publish overtime only when needed, and keep leaders,
            workers, and admins in the right parts of the workflow.
          </p>
          <div className="landing-actions">
            <Link href={primaryHref} className="primary-button">
              {session ? "Open workspace" : "Sign in"}
            </Link>
            {!session ? (
              <Link href="/sign-in" className="ghost-button">
                Enter demo
              </Link>
            ) : null}
          </div>
        </div>

        <div className="landing-hero__visual" aria-hidden="true">
          <div className="landing-blueprint">
            <div className="landing-blueprint__rail">
              <span>Shifts</span>
              <strong>601 · 602 · 603 · 604</strong>
            </div>
            <div className="landing-blueprint__grid">
              <span>Posts filled</span>
              <strong>Set coverage</strong>
              <span>Overtime only after completion</span>
            </div>
            <div className="landing-blueprint__roles">
              <div>
                <span>Admin</span>
                <strong>Full control</strong>
              </div>
              <div>
                <span>Leader</span>
                <strong>Own shift</strong>
              </div>
              <div>
                <span>Worker</span>
                <strong>View only</strong>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-band">
        <div>
          <span className="landing-band__label">What it does</span>
          <h2>One workspace for planning, staffing, and overtime decisions.</h2>
        </div>
        <div className="landing-columns">
          <article>
            <strong>Schedule the month</strong>
            <p>Lay out day, night, and off rotations across every worked block on a monthly grid.</p>
          </article>
          <article>
            <strong>Cover the right posts</strong>
            <p>Track competency coverage by set and highlight shortages before the shift is locked.</p>
          </article>
          <article>
            <strong>Control by role</strong>
            <p>Admins manage the whole system, leaders manage their shift, and workers get a clean read-only view.</p>
          </article>
        </div>
      </section>

      <section className="landing-detail">
        <div className="landing-detail__intro">
          <span className="landing-band__label">How teams use it</span>
          <h2>Move from planning to published coverage without losing the monthly picture.</h2>
        </div>
        <div className="landing-role-grid">
          <article>
            <span>Admin</span>
            <strong>Configure the whole operation</strong>
            <p>Manage shifts, competencies, time codes, workforce data, and overtime rules.</p>
          </article>
          <article>
            <span>Leader</span>
            <strong>Own a single shift</strong>
            <p>Adjust the schedule, manage workers on that shift, and complete sets when they are ready to post.</p>
          </article>
          <article>
            <span>Worker</span>
            <strong>See what matters</strong>
            <p>View the schedule and a personal worker profile without being exposed to admin tools.</p>
          </article>
        </div>
      </section>

      <section className="landing-cta">
        <span className="landing-band__label">Start</span>
        <h2>Sign in and enter the workspace with the right view for your role.</h2>
        <Link href="/sign-in" className="primary-button">
          Go to sign in
        </Link>
      </section>
    </main>
  );
}
