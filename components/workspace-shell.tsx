"use client";

import type { MouseEvent } from "react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { setAdminViewingScope, signOut } from "@/app/auth-actions";
import { BrandLockup } from "@/components/brand-lockup";
import type { AppNotification, AppSession } from "@/lib/types";

const SIDEBAR_COLLAPSE_STORAGE_KEY = "shift-canvas-sidebar-collapsed";
const MOBILE_SIDEBAR_MAX_WIDTH = 600;
const MONTH_ROUTE_HREFS = new Set(["/schedule", "/overtime", "/metrics", "/mutuals", "/sub-schedules"]);
const HEAVY_MOBILE_NAV_PATHS = new Set(["/schedule", "/overtime", "/mutuals", "/sub-schedules", "/metrics"]);

function isNotification(value: unknown): value is AppNotification {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "title" in value &&
    "body" in value &&
    "createdAt" in value
  );
}

function getCurrentMonthKey(now = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}`;
}

function isValidMonthParam(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}$/.test(value));
}

function resolveWorkspaceRouteTargets({
  href,
  fallbackMonth,
  selectedMonth,
}: {
  href: string;
  fallbackMonth: string;
  selectedMonth: string | null;
}) {
  const month = isValidMonthParam(selectedMonth) ? selectedMonth : fallbackMonth;
  const navigationHref = MONTH_ROUTE_HREFS.has(href) ? `${href}?month=${month}` : href;

  return {
    navigationHref,
  };
}

function getWorkspaceRoutePath(href: string) {
  const [pathname] = href.split("?");
  return pathname ?? href;
}

function isWorkspaceRouteActive(pathname: string, href: string) {
  return pathname === getWorkspaceRoutePath(href);
}

type NavLinkProps = {
  href: string;
  activeHref: string;
  label: string;
  icon: React.ReactNode;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
};

/** Small presentational wrapper so nav link semantics stay consistent everywhere. */
function NavLink({
  href,
  activeHref,
  label,
  icon,
  onNavigate,
}: NavLinkProps) {
  const pathname = usePathname();
  const isActive = isWorkspaceRouteActive(pathname, activeHref);

  return (
    <Link
      href={href}
      prefetch={false}
      className={`workspace-nav-link ${isActive ? "workspace-nav-link--active" : ""}`}
      title={label}
      aria-current={isActive ? "page" : undefined}
      onClick={(event) => onNavigate(event, href)}
    >
      <span className="workspace-nav-icon">{icon}</span>
      <strong>{label}</strong>
    </Link>
  );
}

export type AdminScopePayload = {
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

/** Navigation icon for event/outage overlay schedules. */
function SubSchedulesIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h9M4 12h16M4 17h11" />
      <path d="M17 5l3 2.5L17 10" />
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

/** Hamburger-style button used to reveal the navigation drawer on phones. */
function MobileMenuIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 7h14M5 12h14M5 17h14" />
    </svg>
  );
}

/** Bell icon used by the bottom notification launcher. */
function NotificationsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 9a6 6 0 1 0-12 0c0 7-3 7-3 8h18c0-1-3-1-3-8Z" />
      <path d="M10 21h4" />
    </svg>
  );
}

/** Gear icon used for notification settings. */
function NotificationSettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 8.25a3.75 3.75 0 1 1 0 7.5a3.75 3.75 0 0 1 0-7.5Z" />
      <path d="M19.5 12a7.46 7.46 0 0 0-.15-1.5l2.1-1.62l-2-3.46l-2.48 1a7.6 7.6 0 0 0-2.6-1.5L14 2.25h-4l-.38 2.67a7.6 7.6 0 0 0-2.6 1.5l-2.48-1l-2 3.46l2.1 1.62a7.4 7.4 0 0 0 0 3l-2.1 1.62l2 3.46l2.48-1a7.6 7.6 0 0 0 2.6 1.5l.38 2.67h4l.38-2.67a7.6 7.6 0 0 0 2.6-1.5l2.48 1l2-3.46l-2.1-1.62c.1-.49.15-.99.15-1.5Z" />
    </svg>
  );
}

/** Responsive shell with a collapsible toolbar and role-scoped nav. */
export function WorkspaceShell({
  children,
  viewer,
  initialAdminScope = null,
  initialNotifications = [],
}: {
  children: React.ReactNode;
  viewer: AppSession;
  initialAdminScope?: AdminScopePayload | null;
  initialNotifications?: AppNotification[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  /**
   * The sidebar remembers the user's last choice so a page navigation does not
   * feel like the app is fighting their layout preference.
   */
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileSidebarMode, setIsMobileSidebarMode] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [adminScope, setAdminScope] = useState<AdminScopePayload | null>(initialAdminScope);
  const [isAdminScopeCollapsed, setIsAdminScopeCollapsed] = useState(true);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>(initialNotifications);
  const [isUpdatingScope, startScopeTransition] = useTransition();
  const notificationPopoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedPreference = window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY);

    const updateSidebarMode = () => {
      const nextIsMobileSidebarMode = window.innerWidth < MOBILE_SIDEBAR_MAX_WIDTH;
      setIsMobileSidebarMode(nextIsMobileSidebarMode);
      setIsMobileSidebarOpen(false);
      setIsCollapsed(nextIsMobileSidebarMode ? false : storedPreference === "true");
    };

    updateSidebarMode();
    window.addEventListener("resize", updateSidebarMode);

    return () => {
      window.removeEventListener("resize", updateSidebarMode);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (isMobileSidebarMode) {
      return;
    }

    window.localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, String(isCollapsed));
  }, [isCollapsed, isMobileSidebarMode]);

  useEffect(() => {
    if (!isMobileSidebarMode) {
      return;
    }

    setIsMobileSidebarOpen(false);
  }, [pathname, isMobileSidebarMode]);

  useEffect(() => {
    setAdminScope(initialAdminScope);
  }, [initialAdminScope]);

  useEffect(() => {
    setNotifications(initialNotifications);
  }, [initialNotifications]);

  useEffect(() => {
    if (!isNotificationsOpen) {
      return;
    }

    const controller = new AbortController();

    fetch("/api/notifications?unread=1&limit=5", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { notifications?: unknown[] } | null) => {
        if (!payload?.notifications) {
          return;
        }

        setNotifications(payload.notifications.filter(isNotification));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        console.error("Could not refresh notifications", error);
      });

    return () => {
      controller.abort();
    };
  }, [isNotificationsOpen]);

  useEffect(() => {
    if (!isNotificationsOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (notificationPopoverRef.current?.contains(event.target as Node)) {
        return;
      }

      setIsNotificationsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsNotificationsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isNotificationsOpen]);
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
          { href: "/sub-schedules", label: "Sub-Schedules", icon: <SubSchedulesIcon /> },
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
          { href: "/sub-schedules", label: "Sub-Schedules", icon: <SubSchedulesIcon /> },
          { href: "/personnel", label: "Personnel", icon: <PersonnelIcon /> },
          { href: "/metrics", label: "Metrics", icon: <MetricsIcon /> },
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

  const currentMonthKey = useMemo(() => getCurrentMonthKey(), []);
  const selectedMonth = searchParams.get("month");

  const handleNavLinkNavigate = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (!isMobileSidebarMode) {
      return;
    }

    setIsMobileSidebarOpen(false);
    setIsNotificationsOpen(false);

    if (!HEAVY_MOBILE_NAV_PATHS.has(getWorkspaceRoutePath(href))) {
      return;
    }

    event.preventDefault();
    window.location.assign(href);
  };

  return (
    <main className="shell">
      <section
        className={`workspace-frame ${isCollapsed ? "workspace-frame--collapsed" : ""} ${
          isMobileSidebarMode ? "workspace-frame--mobile" : ""
        }`}
      >
        <aside
          className={`workspace-sidebar ${isCollapsed ? "workspace-sidebar--collapsed" : ""} ${
            isMobileSidebarMode ? "workspace-sidebar--mobile" : ""
          } ${isMobileSidebarOpen ? "workspace-sidebar--mobile-open" : ""}`}
        >
          <div className="workspace-brand-row">
            <div className="workspace-brand">
              <BrandLockup size="compact" />
              <span>{viewer.role === "admin" ? "Administrator" : viewer.displayName}</span>
            </div>
            {!isMobileSidebarMode ? (
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

          <nav id="workspace-primary-navigation" className="workspace-nav" aria-label="Primary">
            {navItems.map((item) => {
              const { navigationHref } = resolveWorkspaceRouteTargets({
                href: item.href,
                fallbackMonth: currentMonthKey,
                selectedMonth,
              });

              return (
                <NavLink
                  key={item.href}
                  href={navigationHref}
                  activeHref={item.href}
                  label={item.label}
                  icon={item.icon}
                  onNavigate={handleNavLinkNavigate}
                />
              );
            })}
          </nav>

          <div className="workspace-sidebar-bottom">
            <div className="workspace-notifications" ref={notificationPopoverRef}>
              <button
                type="button"
                className={`workspace-nav-link workspace-notifications__button ${
                  isNotificationsOpen ? "workspace-nav-link--active" : ""
                }`}
                onClick={() => setIsNotificationsOpen((current) => !current)}
                aria-expanded={isNotificationsOpen}
                aria-haspopup="dialog"
              >
                <span className="workspace-nav-icon">
                  <NotificationsIcon />
                </span>
                <strong>Notifications</strong>
                {notifications.length > 0 ? (
                  <span className="workspace-notifications__badge">{notifications.length}</span>
                ) : null}
              </button>

              {isNotificationsOpen ? (
                <section className="workspace-notifications-popover" role="dialog" aria-label="Notifications">
                  <div className="workspace-notifications-popover__header">
                    <div>
                      <strong>Notifications</strong>
                      <span>{notifications.length} unread</span>
                    </div>
                    <Link href="/notifications" onClick={() => setIsNotificationsOpen(false)}>
                      View all
                    </Link>
                  </div>

                  <div className="workspace-notifications-popover__list">
                    {notifications.length > 0 ? (
                      notifications.map((notification) => (
                        <article key={notification.id} className="workspace-notification-item">
                          <strong>{notification.title}</strong>
                          <span>{notification.body}</span>
                          <small>{notification.createdAt.slice(0, 10)}</small>
                        </article>
                      ))
                    ) : (
                      <div className="workspace-notifications-empty">
                        <strong>No notifications yet</strong>
                        <span>Schedule alerts, overtime updates, and mutual approvals will appear here.</span>
                      </div>
                    )}
                  </div>

                  <div className="workspace-notifications-popover__footer">
                    <Link
                      href="/notifications/settings"
                      className="icon-button workspace-notifications-popover__settings"
                      aria-label="Notification settings"
                      title="Notification settings"
                      onClick={() => setIsNotificationsOpen(false)}
                    >
                      <NotificationSettingsIcon />
                    </Link>
                  </div>
                </section>
              ) : null}
            </div>

            {viewer.role === "admin" && adminScope ? (
              <section
                className={`workspace-admin-scope ${
                  isAdminScopeCollapsed ? "workspace-admin-scope--collapsed" : ""
                }`}
                aria-label="Admin view scope"
              >
                <button
                  type="button"
                  className="workspace-admin-scope__toggle"
                  onClick={() => setIsAdminScopeCollapsed((current) => !current)}
                  aria-expanded={!isAdminScopeCollapsed}
                >
                  <span className="workspace-admin-scope__heading">
                    <strong>Viewing Context</strong>
                    <span>{adminScope.companyName}</span>
                  </span>
                  <span className="workspace-admin-scope__chevron" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M6 9l6 6l6-6" />
                    </svg>
                  </span>
                </button>

                {!isAdminScopeCollapsed ? (
                  <div className="workspace-admin-scope__fields">
                    <label className="field workspace-admin-scope__field">
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

                    <label className="field workspace-admin-scope__field">
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
                  </div>
                ) : null}
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
          </div>
        </aside>

        {isMobileSidebarMode && isMobileSidebarOpen ? (
          <button
            type="button"
            className="workspace-mobile-backdrop"
            aria-label="Close navigation menu"
            onClick={() => setIsMobileSidebarOpen(false)}
          />
        ) : null}

        <div className="workspace-content">
          {isMobileSidebarMode ? (
            <div className="workspace-mobile-toolbar">
              <button
                type="button"
                className="ghost-button workspace-mobile-toggle"
                onClick={() => setIsMobileSidebarOpen((current) => !current)}
                aria-expanded={isMobileSidebarOpen}
                aria-controls="workspace-primary-navigation"
              >
                <span className="workspace-nav-icon workspace-mobile-toggle__icon">
                  <MobileMenuIcon />
                </span>
                <strong>{isMobileSidebarOpen ? "Close Menu" : "Open Menu"}</strong>
              </button>
            </div>
          ) : null}

          {children}
        </div>
      </section>
    </main>
  );
}
