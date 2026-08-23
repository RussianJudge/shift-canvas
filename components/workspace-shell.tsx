"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type MouseEvent,
} from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { setAdminViewingScope, signOut } from "@/app/auth-actions";
import { BrandLockup } from "@/components/brand-lockup";
import type { AppNotification, AppSession } from "@/lib/types";

const SIDEBAR_COLLAPSE_STORAGE_KEY = "shift-canvas-sidebar-collapsed";
const MOBILE_SIDEBAR_MAX_WIDTH = 600;
const MONTH_ROUTE_HREFS = new Set(["/schedule", "/overtime", "/metrics", "/mutuals", "/sub-schedules"]);

type WorkspaceNavigationGuard = (href: string) => Promise<boolean> | boolean;
type WorkspaceNavigationGuardSetter = (guard: WorkspaceNavigationGuard | null) => void;
const WorkspaceNavigationGuardContext = createContext<WorkspaceNavigationGuardSetter>(() => {});

export function useWorkspaceNavigationGuard(guard: WorkspaceNavigationGuard | null) {
  const setNavigationGuard = useContext(WorkspaceNavigationGuardContext);

  useEffect(() => {
    setNavigationGuard(guard);

    return () => {
      setNavigationGuard(null);
    };
  }, [guard, setNavigationGuard]);
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

function shouldUseDocumentNavigation(href: string) {
  return getWorkspaceRoutePath(href) === "/schedule";
}

function isWorkspaceRouteActive(pathname: string, href: string) {
  return pathname === getWorkspaceRoutePath(href);
}

type NavLinkProps = {
  href: string;
  activeHref: string;
  label: string;
  icon: React.ReactNode;
  isFinePointer: boolean;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
};

/**
 * next/link's shipped .d.ts resolves to the legacy Pages Router props and
 * doesn't know about this App Router-only prop, even though it exists in the
 * packaged runtime (next/dist/client/app-dir/link.js) and that router's own
 * link.d.ts. Spreading a separately-typed object sidesteps TypeScript's
 * excess-property check, which only fires on object literals.
 */
function dynamicHoverProps(isFinePointer: boolean): { unstable_dynamicOnHover?: boolean } {
  return isFinePointer ? { unstable_dynamicOnHover: true } : {};
}

/** Small presentational wrapper so nav link semantics stay consistent everywhere. */
function NavLink({
  href,
  activeHref,
  label,
  icon,
  isFinePointer,
  onNavigate,
}: NavLinkProps) {
  const pathname = usePathname();
  const isActive = isWorkspaceRouteActive(pathname, activeHref);

  return (
    <Link
      href={href}
      prefetch={isFinePointer ? undefined : false}
      {...dynamicHoverProps(isFinePointer)}
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
  /**
   * Touch devices bypass client-side routing entirely (see
   * useDocumentNavigation below), so hover-driven prefetch only ever matters
   * on a fine-pointer device. Detected in an effect, not at render, so the
   * server-rendered markup and the first client render match.
   */
  const [isFinePointer, setIsFinePointer] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [adminScope, setAdminScope] = useState<AdminScopePayload | null>(initialAdminScope);
  const [isAdminScopeCollapsed, setIsAdminScopeCollapsed] = useState(true);
  const [notifications, setNotifications] = useState<AppNotification[]>(initialNotifications);
  const [isUpdatingScope, startScopeTransition] = useTransition();
  const navigationGuardRef = useRef<WorkspaceNavigationGuard | null>(null);
  const setNavigationGuard = useCallback<WorkspaceNavigationGuardSetter>((guard) => {
    navigationGuardRef.current = guard;
  }, []);

  useEffect(() => {
    setIsFinePointer(window.matchMedia("(hover: hover) and (pointer: fine)").matches);
  }, []);

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
    setNotifications((previous) => {
      const unchanged =
        previous.length === initialNotifications.length &&
        previous.every((entry, index) => entry.id === initialNotifications[index]?.id);

      // Returning the existing reference makes React skip the update, so an
      // unstable (new-each-render) prop can't drive an infinite render loop.
      return unchanged ? previous : initialNotifications;
    });
  }, [initialNotifications]);

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
          { href: "/profile", label: "My Profile", icon: <ProfileIcon /> },
        ]
      : viewer.role === "leader"
      ? [
          { href: "/schedule", label: "Schedule", icon: <ScheduleIcon /> },
          { href: "/overtime", label: "Overtime", icon: <OvertimeIcon /> },
          { href: "/mutuals", label: "Mutuals", icon: <MutualsIcon /> },
          { href: "/sub-schedules", label: "Sub-Schedules", icon: <SubSchedulesIcon /> },
          { href: "/personnel", label: "Personnel", icon: <PersonnelIcon /> },
          { href: "/metrics", label: "Metrics", icon: <MetricsIcon /> },
          { href: "/profile", label: "My Profile", icon: <ProfileIcon /> },
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

  const handleNavLinkNavigate = async (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    setIsMobileSidebarOpen(false);

    const isPlainPrimaryClick =
      event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
    const useDocumentNavigation = isMobileSidebarMode || isCollapsed || shouldUseDocumentNavigation(href);
    const guard = navigationGuardRef.current;

    if (!guard) {
      if (useDocumentNavigation && isPlainPrimaryClick) {
        event.preventDefault();
        window.location.assign(href);
      }

      return;
    }

    event.preventDefault();
    let canNavigate = false;

    try {
      canNavigate = await guard(href);
    } catch (error) {
      console.error("Workspace navigation guard failed", error);
      canNavigate = false;
    }

    if (canNavigate) {
      if (useDocumentNavigation && isPlainPrimaryClick) {
        window.location.assign(href);
        return;
      }

      router.push(href);
    }
  };

  const notificationsNavItem = (
    <div className="workspace-nav-notifications">
      <Link
        href="/notifications"
        prefetch={isFinePointer ? undefined : false}
        {...dynamicHoverProps(isFinePointer)}
        className={`workspace-nav-link ${pathname === "/notifications" ? "workspace-nav-link--active" : ""}`}
        title="Notifications"
        aria-current={pathname === "/notifications" ? "page" : undefined}
        onClick={(event) => handleNavLinkNavigate(event, "/notifications")}
      >
        <span className="workspace-nav-icon">
          <NotificationsIcon />
        </span>
        <strong>Notifications</strong>
        {notifications.length > 0 ? <span className="workspace-notifications__badge">{notifications.length}</span> : null}
      </Link>
    </div>
  );

  return (
    <WorkspaceNavigationGuardContext.Provider value={setNavigationGuard}>
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
                  isFinePointer={isFinePointer}
                  onNavigate={handleNavLinkNavigate}
                />
              );
            })}
            {notificationsNavItem}
          </nav>

          <div className="workspace-sidebar-bottom">
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
                <strong>Menu</strong>
              </button>
            </div>
          ) : null}

          {children}
        </div>
      </section>
      </main>
    </WorkspaceNavigationGuardContext.Provider>
  );
}
