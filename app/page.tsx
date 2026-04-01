import Link from "next/link";

import { getAppSession, getSessionHomePath } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getAppSession();
  const primaryHref = session ? getSessionHomePath(session) : "/sign-in";

  return (
    <main className="auth-home">
      <section className="auth-home__panel">
        <div className="auth-home__copy">
          <span className="auth-eyebrow">Shift Canvas</span>
          <h1 className="auth-home__title">Log in to manage schedules and shift coverage.</h1>
          <p className="auth-home__subtitle">
            A focused monthly planning workspace for admins, leaders, and workers.
          </p>
        </div>

        <div className="auth-home__actions">
          <Link href={primaryHref} className="primary-button">
            {session ? "Open workspace" : "Log in"}
          </Link>
          {!session ? (
            <Link href="/sign-up" className="ghost-button">
              Sign up
            </Link>
          ) : null}
        </div>

        {!session ? (
          <div className="auth-home__links">
            <Link href="/sign-in">Use existing email</Link>
            <Link href="/sign-up">Create demo access</Link>
          </div>
        ) : null}
      </section>
    </main>
  );
}
