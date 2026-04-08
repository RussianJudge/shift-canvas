"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { setAdminViewingScope, signOut } from "@/app/auth-actions";
import { BrandLockup } from "@/components/brand-lockup";
import type { AppSession } from "@/lib/types";

const SIDEBAR_COLLAPSE_STORAGE_KEY = "shift-canvas-sidebar-collapsed";
const SIDEBAR_COLLAPSE_MIN_WIDTH = 450;

type AdminScopePayload = {
  companyName: string;
  activeSiteId: string | null;
  activeBusinessAreaId: string | null;
  sites: Array<{ id: string; name: string }>;
  businessAreas: Array<{ id: string; siteId: string; name: string }>;
};

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
  const router = useRouter();
  /**
   * The sidebar remembers the user's last choice so a page navigation does not
   * feel like the app is fighting their layout preference.
   */
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [adminScope, setAdminScope] = useState<AdminScopePayload | null>(null);
  const [isUpdatingScope, startScopeTransition] = useTransition();
  const [canCollapseSidebar, setCanCollapseSidebar] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const updateCollapseAvailability = () => {
      const nextCanCollapse = window.innerWidth >= SIDEBAR_COLLAPSE_MIN_WIDTH;
      setCanCollapseSidebar(nextCanCollapse);

      if (!nextCanCollapse) {
        setIsCollapsed(false);
      }
    };

    const storedPreference = window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY);

    updateCollapseAvailability();

    if (storedPreference === "true" && window.innerWidth >= SIDEBAR_COLLAPSE_MIN_WIDTH) {
      setIsCollapsed(true);
    }

    window.addEventListener("resize", updateCollapseAvailability);

    return () => {
      window.removeEventListener("resize", updateCollapseAvailability);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!canCollapseSidebar) {
      window.localStorage.removeItem(SIDEBAR_COLLAPSE_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, String(isCollapsed));
  }, [canCollapseSidebar, isCollapsed]);

  useEffect(() => {
    if (viewer.role !== "admin") {
      return;
    }

    let cancelled = false;

    fetch("/api/admin-scope", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Unable to load admin scope.");
        }

        return (await response.json()) as AdminScopePayload;
      })
      .then((payload) => {
        if (!cancelled) {
          setAdminScope(payload);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAdminScope(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [viewer.role]);
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

  const filteredBusinessAreas = useMemo(() => {
    if (!adminScope) {
      return [];
    }

    const activeSiteId = adminScope.activeSiteId ?? null;

    if (!activeSiteId) {
      return adminScope.businessAreas;
    }

    return adminScope.businessAreas.filter((entry) => entry.siteId === activeSiteId);
  }, [adminScope]);

  return (
    <main className="shell">
      <section className={`workspace-frame ${isCollapsed ? "workspace-frame--collapsed" : ""}`}>
        <aside className={`workspace-sidebar ${isCollapsed ? "workspace-sidebar--collapsed" : ""}`}>
          <div className="workspace-brand-row">
            <div className="workspace-brand">
              <BrandLockup size="compact" />
              <span>{viewer.role === "admin" ? "Administrator" : viewer.displayName}</span>
            </div>
            {canCollapseSidebar ? (
              <button
                type="button"
                className="sidebar-toggle"
                onClick={() => setIsCollapsed((current) => !current)}
                aria-label={isCollapsed ? "Expand toolbar" : "Collapse toolbar"}
                aria-pressed={isCollapsed}
              >
                <SidebarToggleIcon collapsed={isCollapsed} />
              </button>
            ) : null}
          </div>

          <nav className="workspace-nav" aria-label="Primary">
            {navItems.map((item) => (
              <NavLink key={item.href} href={item.href} label={item.label} icon={item.icon} />
            ))}
          </nav>

          {viewer.role === "admin" && adminScope ? (
            <section className="workspace-admin-scope" aria-label="Admin view scope">
              <div className="workspace-admin-scope__heading">
                <strong>Viewing Context</strong>
                <span>{adminScope.companyName}</span>
              </div>

              <label className="field">
                <span>Site</span>
                <select
                  value={adminScope.activeSiteId ?? ""}
                  onChange={(event) => {
                    const nextSiteId = event.target.value || null;

                    startScopeTransition(async () => {
                      const result = await setAdminViewingScope({
                        siteId: nextSiteId,
                        businessAreaId: null,
                      });

                      if (!result.ok) {
                        return;
                      }

                      setAdminScope((current) =>
                        current
                          ? {
                              ...current,
                              activeSiteId: nextSiteId,
                              activeBusinessAreaId: null,
                            }
                          : current,
                      );
                      router.refresh();
                    });
                  }}
                  disabled={isUpdatingScope}
                >
                  <option value="">All sites</option>
                  {adminScope.sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Business Area</span>
                <select
                  value={adminScope.activeBusinessAreaId ?? ""}
                  onChange={(event) => {
                    const nextBusinessAreaId = event.target.value || null;

                    startScopeTransition(async () => {
                      const result = await setAdminViewingScope({
                        siteId: adminScope.activeSiteId ?? null,
                        businessAreaId: nextBusinessAreaId,
                      });

                      if (!result.ok) {
                        return;
                      }

                      setAdminScope((current) =>
                        current
                          ? {
                              ...current,
                              activeBusinessAreaId: nextBusinessAreaId,
                            }
                          : current,
                      );
                      router.refresh();
                    });
                  }}
                  disabled={isUpdatingScope || !adminScope.activeSiteId}
                >
                  <option value="">{adminScope.activeSiteId ? "All business areas" : "Select a site first"}</option>
                  {filteredBusinessAreas.map((businessArea) => (
                    <option key={businessArea.id} value={businessArea.id}>
                      {businessArea.name}
                    </option>
                  ))}
                </select>
              </label>
            </section>
          ) : null}

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
