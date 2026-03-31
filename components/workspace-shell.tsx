"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

function ScheduleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 4v4M18 4v4M4 10h16M6 14h4M6 18h4M14 14h4M14 18h4" />
      <rect x="4" y="6" width="16" height="14" rx="2" />
    </svg>
  );
}

function PatternsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M4 12h10M4 17h6M17 10l3 2-3 2" />
    </svg>
  );
}

function CompetenciesIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7h10v10H7zM4 12h3M17 12h3M12 4v3M12 17v3" />
    </svg>
  );
}

function TimeCodesIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 7v5l3 2M12 4a8 8 0 1 1 0 16a8 8 0 0 1 0-16Z" />
    </svg>
  );
}

function OvertimeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13 3L5 14h5l-1 7l8-11h-5l1-7Z" />
    </svg>
  );
}

function PersonnelIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 12a3 3 0 1 0 0-6a3 3 0 0 0 0 6ZM6 19a6 6 0 0 1 12 0" />
    </svg>
  );
}

function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M8.25 8.25L4.5 12m0 0l3.75 3.75M4.5 12h10.5M13.5 5.25h4.125c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125H13.5"
        transform={collapsed ? "translate(24 24) rotate(180)" : undefined}
      />
    </svg>
  );
}

function NavLink({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
}) {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <Link
      href={href}
      className={`workspace-nav-link ${isActive ? "workspace-nav-link--active" : ""}`}
      title={label}
      aria-current={isActive ? "page" : undefined}
    >
      <span className="workspace-nav-icon">{icon}</span>
      <strong>{label}</strong>
    </Link>
  );
}

export function WorkspaceShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <main className="shell">
      <section className={`workspace-frame ${isCollapsed ? "workspace-frame--collapsed" : ""}`}>
        <aside className={`workspace-sidebar ${isCollapsed ? "workspace-sidebar--collapsed" : ""}`}>
          <div className="workspace-brand-row">
            <div className="workspace-brand">
              <strong>Shift Canvas</strong>
            </div>
            <button
              type="button"
              className="sidebar-toggle"
              onClick={() => setIsCollapsed((current) => !current)}
              aria-label={isCollapsed ? "Expand toolbar" : "Collapse toolbar"}
              aria-pressed={isCollapsed}
            >
              <SidebarToggleIcon collapsed={isCollapsed} />
            </button>
          </div>

          <nav className="workspace-nav" aria-label="Primary">
            <NavLink href="/" label="Schedule" icon={<ScheduleIcon />} />
            <NavLink href="/overtime" label="Overtime" icon={<OvertimeIcon />} />
            <NavLink href="/personnel" label="Personnel" icon={<PersonnelIcon />} />
            <NavLink href="/schedules" label="Shifts" icon={<PatternsIcon />} />
            <NavLink href="/competencies" label="Competencies" icon={<CompetenciesIcon />} />
            <NavLink href="/time-codes" label="Time Codes" icon={<TimeCodesIcon />} />
          </nav>
        </aside>

        <div className="workspace-content">{children}</div>
      </section>
    </main>
  );
}
