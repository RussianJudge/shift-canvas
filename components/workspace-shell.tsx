"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { signOut } from "@/app/auth-actions";
import type { AppSession } from "@/lib/types";

/**
 * Shared application shell for every authenticated page.
 *
 * The sidebar is role-aware, so this component is effectively the UI boundary
 * for "who can navigate where" once the session has already been validated on
 * the server.
 */
/** Navigation icon for the main schedule workspace. */
function ScheduleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 4v4M18 4v4M4 10h16M6 14h4M6 18h4M14 14h4M14 18h4" />
      <rect x="4" y="6" width="16" height="14" rx="2" />
    </svg>
  );
}

/** Navigation icon for shift-pattern management. */
function PatternsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M4 12h10M4 17h6M17 10l3 2-3 2" />
    </svg>
  );
}

/** Navigation icon for the competencies reference page. */
function CompetenciesIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7h10v10H7zM4 12h3M17 12h3M12 4v3M12 17v3" />
    </svg>
  );
}

/** Navigation icon for time-code reference data. */
function TimeCodesIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 7v5l3 2M12 4a8 8 0 1 1 0 16a8 8 0 0 1 0-16Z" />
    </svg>
  );
}

/** Navigation icon for overtime review and claiming. */
function OvertimeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13 3L5 14h5l-1 7l8-11h-5l1-7Z" />
    </svg>
  );
}

/** Navigation icon for the personnel workspace. */
function PersonnelIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 12a3 3 0 1 0 0-6a3 3 0 0 0 0 6ZM6 19a6 6 0 0 1 12 0" />
    </svg>
  );
}

/** Navigation icon for the admin metrics dashboard. */
function MetricsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 19V9M12 19V5M19 19v-7" />
      <path d="M4 19h16" />
    </svg>
  );
}

/** Navigation icon for the worker self-service profile page. */
function ProfileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5.25a3.75 3.75 0 1 1 0 7.5a3.75 3.75 0 0 1 0-7.5Z" />
      <path d="M4.5 19.25a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

/** Navigation icon for the mutual shift swap workflow. */
function MutualsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.5 7.5a2.25 2.25 0 1 0 0 4.5a2.25 2.25 0 0 0 0-4.5Z" />
      <path d="M16.5 7.5a2.25 2.25 0 1 0 0 4.5a2.25 2.25 0 0 0 0-4.5Z" />
      <path d="M4.5 18a4.5 4.5 0 0 1 6-4.243A4.5 4.5 0 0 1 13.5 18" />
      <path d="M10.5 18a4.5 4.5 0 0 1 9 0" />
    </svg>
  );
}

/** Toggle icon that visually flips when the sidebar is collapsed. */
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

/** Small presentational wrapper so nav link semantics stay consistent everywhere. */
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

/** Responsive shell with a collapsible toolbar and role-scoped nav. */
export function WorkspaceShell({
  children,
  viewer,
}: {
  children: React.ReactNode;
  viewer: AppSession;
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  /**
   * Navigation is derived directly from the resolved app role so page
   * visibility stays centralized here instead of being scattered through the UI.
   */
  const navItems =
    viewer.role === "admin"
      ? [
          { href: "/schedule", label: "Schedule", icon: <ScheduleIcon /> },
          { href: "/overtime", label: "Overtime", icon: <OvertimeIcon /> },
          { href: "/mutuals", label: "Mutuals", icon: <MutualsIcon /> },
          { href: "/personnel", label: "Personnel", icon: <PersonnelIcon /> },
          { href: "/schedules", label: "Shifts", icon: <PatternsIcon /> },
          { href: "/competencies", label: "Competencies", icon: <CompetenciesIcon /> },
          { href: "/time-codes", label: "Time Codes", icon: <TimeCodesIcon /> },
          { href: "/metrics", label: "Metrics", icon: <MetricsIcon /> },
        ]
      : viewer.role === "leader"
      ? [
          { href: "/schedule", label: "Schedule", icon: <ScheduleIcon /> },
          { href: "/overtime", label: "Overtime", icon: <OvertimeIcon /> },
          { href: "/mutuals", label: "Mutuals", icon: <MutualsIcon /> },
          { href: "/personnel", label: "Personnel", icon: <PersonnelIcon /> },
        ]
      : [
          { href: "/schedule", label: "Schedule", icon: <ScheduleIcon /> },
          { href: "/overtime", label: "Overtime", icon: <OvertimeIcon /> },
          { href: "/mutuals", label: "Mutuals", icon: <MutualsIcon /> },
          { href: "/profile", label: "My Profile", icon: <ProfileIcon /> },
        ];

  return (
    <main className="shell">
      <section className={`workspace-frame ${isCollapsed ? "workspace-frame--collapsed" : ""}`}>
        <aside className={`workspace-sidebar ${isCollapsed ? "workspace-sidebar--collapsed" : ""}`}>
          <div className="workspace-brand-row">
            <div className="workspace-brand">
              <strong>Shift Canvas</strong>
              <span>{viewer.role === "admin" ? "Administrator" : viewer.displayName}</span>
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
            {navItems.map((item) => (
              <NavLink key={item.href} href={item.href} label={item.label} icon={item.icon} />
            ))}
          </nav>

          <form action={signOut} className="workspace-session">
            <div className="workspace-session__meta">
              <strong>{viewer.displayName}</strong>
              <span>{viewer.role}</span>
            </div>
            <button type="submit" className="ghost-button workspace-session__signout">
              Sign out
            </button>
          </form>
        </aside>

        <div className="workspace-content">{children}</div>
      </section>
    </main>
  );
}
