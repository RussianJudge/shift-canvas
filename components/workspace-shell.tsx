"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function NavLink({
  href,
  label,
  detail,
}: {
  href: string;
  label: string;
  detail: string;
}) {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <Link
      href={href}
      className={`workspace-nav-link ${isActive ? "workspace-nav-link--active" : ""}`}
    >
      <strong>{label}</strong>
      <span>{detail}</span>
    </Link>
  );
}

export function WorkspaceShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="shell">
      <section className="workspace-frame">
        <aside className="workspace-sidebar">
          <div className="workspace-brand">
            <span>Shift Canvas</span>
            <strong>Operations workspace</strong>
          </div>

          <nav className="workspace-nav" aria-label="Primary">
            <NavLink href="/" label="Schedule" detail="Monthly coverage grid" />
            <NavLink href="/personnel" label="Personnel" detail="People, roles, competencies" />
          </nav>
        </aside>

        <div className="workspace-content">{children}</div>
      </section>
    </main>
  );
}
