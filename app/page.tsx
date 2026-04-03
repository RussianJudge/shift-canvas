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
          <h1 className="auth-home__title">Turn your personnel data into clear staffing decisions.</h1>
          <p className="auth-home__subtitle">
            Use workforce availability, competencies, and overtime coverage to plan smarter every month.
          </p>
        </div>

        <div className="auth-home__actions">
          <Link href={primaryHref} className="primary-button">
            {session ? "Open workspace" : "Log in"}
          </Link>
        </div>
      </section>
    </main>
  );
}
