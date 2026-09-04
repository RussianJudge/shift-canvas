# Phase 1 — Redesign Audit

Audit only. No application files were modified.

Baseline commit `65b1443` on `claude-visual-updates`.

---

## 1. Executive summary

The application is a Next.js 15 App Router workspace with 12 authenticated
routes, all following one consistent pattern: a `force-dynamic` server page
gates on role, loads a single scoped snapshot, and hands it to a large client
panel that owns all interaction. That consistency is the redesign's biggest
asset — the shell is shared by every page, and the styling is driven by CSS
custom properties that already carry the target palette.

Three findings change the plan materially.

**There is no publish or merge step for sub-schedules, and there never was.**
Projection onto the main schedule is derived at read time by
`buildProjectedSubScheduleAssignments`, computed on every snapshot load. A
sub-schedule edit is live on the main schedule the moment its 2.5-second
autosave fires. `docs/scheduling-behavior.md` states "Never imply sub-schedule
edits are live on Main" — they are. The publish/merge workflow described in
the product vision is aspirational, not a reskin, and Phase 5 as originally
sequenced is a domain/contract project rather than a visual one.

**There are no UI primitives.** No `Button`, `Input`, `Modal`, `Badge`, or
`Table` component exists. Those are CSS classes applied to raw elements, and
modals are hand-rolled `createPortal` blocks duplicated across five panels.
This is why the same four actions (add / revert / save / remove) are expressed
four different ways across structurally identical admin pages.

**Week, Day, mobile day-list, KPI stat rows, Auto-fill, Publish schedule, and
global search do not exist.** They appear in the mockups but have no
implementation. Building them is feature work, not restyling, and adding their
controls early would violate the project's own "never create controls without
functional handlers" rule.

The baseline is green: type check clean, 8/8 tests, production build succeeds.

---

## 2. Verified technology stack

Verified from the repository, not inferred.

| Concern | Finding |
|---|---|
| Framework | Next.js `15.5.14`, App Router |
| UI runtime | React `19`, React DOM `19` |
| Language | TypeScript `5.8`, `strict: true`, `noEmit` |
| Package manager | npm (`package-lock.json`; no yarn/pnpm lockfile) |
| Build | `next build`; no custom bundler config, no `next.config.*` |
| Routing | File-based App Router; all workspace routes `force-dynamic` |
| State management | **None.** No redux/zustand/jotai/mobx. Local `useState` per panel |
| React Context | Two only: `WorkspaceNavigationGuardContext`, `MetricsSettingsContext` |
| Form management | **None.** No react-hook-form/formik. Raw controlled inputs |
| Validation | **No schema library.** Hand-written `get*Issues()` per panel, re-implemented independently server-side |
| Component library | **None** |
| Icon library | **None.** Hand-authored inline `<svg viewBox="0 0 24 24">` components |
| Date library | **None.** Custom date math in `lib/scheduling.ts`, UTC, `YYYY-MM-DD` strings |
| Virtualization | `@tanstack/react-virtual` `3.13` — used in exactly one file |
| Backend | Supabase JS `2.49`, service-role client |
| Email | Resend `6.12` |
| Telemetry | `@vercel/speed-insights` |
| Test runner | `node --test` via `tsx` loader |
| Linting | **None.** No ESLint config, no lint script |

Scripts: `dev`, `build`, `start`, `test`. No `lint`, no `typecheck`, no e2e.

---

## 3. Styling architecture

**One global stylesheet.** `app/globals.css`, 6,749 lines, imported once in
`app/layout.tsx`. No CSS Modules, no Sass, no styled-components, no CSS-in-JS,
no PostCSS config, **no Tailwind**. Classes are global and applied as string
literals. Naming is loosely BEM-ish (`workspace-nav-link`,
`assignment-modal__header`, `table-action--danger`) but not enforced.

**Tokens** are CSS custom properties on `:root` — roughly 40 in the main block
covering colour, typography stacks, radii, shadows, grid cell tints, and state
colours. Dark mode overrides ~41 of them under
`@media screen and (prefers-color-scheme: dark)`. A separate `--hue-*` family
(amber, teal, violet, rose, blue, lime, orange, slate; each `fill`/`border`/
`text`) drives competency and time-code pills, redefined wholesale for dark.

**Breakpoints are thin:** `max-width: 600px` (5 blocks), `720px` (1), `1100px`
(1), plus `@media print`. The design system asks for optimisation at
1280/1440/1680/1920 — none of those have breakpoints today.

**Conflicting systems.** No competing framework, but three real hazards:

- `--danger`, `--danger-soft`, `--danger-border` are declared in a *second*
  `:root` block ~6,200 lines below the first.
- Duplicate rules exist where a later definition silently wins; this has
  already produced one live bug (`.table-action--danger` defined twice).
- **25 `app/globals.css.bak*` files are tracked in git**, alongside
  `app/Untitled`, four `app/.fuse_hidden*` files, and two `.DS_Store`. A
  search for `--accent` in `app/` returns 30 files, 24 of them backups.

### Where shared tokens belong

Keep the existing architecture. The token layer already exists and already
carries the target palette; it does not need replacing, only tightening.

1. **Extend `:root` in `app/globals.css`** rather than introducing a parallel
   `--color-*` namespace. `docs/design-system.md` now contains the mapping
   table; most targets are retunes of existing tokens, not new variables.
2. **Consolidate the fragmented declarations** — move `--danger*` up into the
   main block so there is exactly one place tokens are defined.
3. **Add the genuinely new tokens** (`--space-*`, the four `--color-sidebar*`)
   to that same block, each with a dark counterpart in the same change.
4. **Do not adopt `--space-*` call sites in bulk.** Adding the variables is
   cheap; migrating spacing across 6,700 lines is a separate project.
5. **Introduce component classes, not utilities.** The architecture is global
   CSS; a `.btn`/`.btn--primary` family backed by tokens fits it. Utility
   classes would be a second system.

If file size becomes unmanageable, the safe evolution is splitting
`globals.css` into `@import`ed partials (tokens / base / shell / components /
pages) preserving cascade order — but that should follow the redesign, not
precede it.

---

## 4. Application-shell architecture

`components/workspace-shell.tsx` (689 lines) is the whole shell, wrapped by the
39-line `components/workspace-shell-frame.tsx` which **12 files import** — every
authenticated page. It is the single highest-leverage and highest-blast-radius
file in the redesign.

Contains: brand lockup, primary nav (role-filtered), notifications item with
unread badge, admin workspace/scope selector, user block with sign-out,
desktop collapse toggle with `localStorage` persistence
(`shift-canvas-sidebar-collapsed`), mobile drawer with backdrop, and a
navigation guard context that lets a panel block route changes on unsaved work.

**Reusable as-is:** `NavLink` (one shared component, rendered via `.map`),
the icon set (10 inline SVG components), the guard context, collapse
persistence, role-based nav filtering.

**Needs careful refactor:** the notifications item duplicates `NavLink`'s
markup rather than reusing it (it needs the badge). Nav is defined as three
near-identical arrays per role rather than one array filtered by role.

**Mobile specifics that must survive.** Mobile does **not** use client-side
routing — `handleNavLinkNavigate` forces `window.location.assign()` when
`isMobileSidebarMode || isCollapsed || shouldUseDocumentNavigation(href)`. This
was a deliberate fix for links breaking on touch. Prefetch is gated to
fine-pointer devices for the same reason. Safe-area handling
(`env(safe-area-inset-top)`) is tuned for the floating mobile menu button, and
`viewport-fit=cover` with a black-translucent status bar means the app draws
under the notch in standalone mode.

The mockups' sidebar (dark navy, workspace switcher, avatar, breadcrumbs,
global search) is a restyle of a structure that mostly exists — except global
search and the avatar, which do not.

---

## 5. Route and page inventory

| Route | Panel | Roles | Loader | Save model |
|---|---|---|---|---|
| `/schedule` | `monthly-scheduler` (3,840) | all | `getSchedulerSnapshot` | Debounced autosave (5s) |
| `/schedule/print` | `schedule-print-view` (509) | all | reference snapshot | read-only |
| `/sub-schedules` | `sub-schedules-panel` (1,417) | admin, leader | `getSubSchedulesSnapshot` | Split: explicit (definitions) + 2.5s autosave (assignments) + immediate (members) |
| `/overtime` | `overtime-panel` (2,646) | all | `getSchedulerSnapshot` + months | action-driven |
| `/mutuals` | `mutuals-panel` (1,272) | all | `getMutualsSnapshot` | action-driven |
| `/personnel` | `personnel-panel` (1,996) | admin, leader | `getPersonnelSnapshot` | Debounced autosave |
| `/metrics` | `metrics-panel` (1,598) + `metrics-streamed-sections` (1,354) | admin, leader | 3 loaders, streamed | read-only |
| `/competencies` | `competencies-panel` (666) | **admin** | `getCompetenciesSnapshot` | Explicit Save + Revert |
| `/time-codes` | `time-codes-panel` (453) | **admin** | `getTimeCodesSnapshot` | Explicit Save + Revert |
| `/schedules` ("Shifts") | `schedules-panel` (462) | **admin** | `getSchedulesSnapshot` | Explicit Save + Revert |
| `/profile` | `profile-panel` (96) | all | `getProfileSnapshot` | read-only + password reset |
| `/notifications` | *(none — server component)* | all | `getNotificationsForViewer` | form actions |
| `/notifications/settings` | *(none)* | all | **none** | **stub** |
| `/mutals` | — | *(no gate)* | — | typo redirect to `/mutuals` |

**No Configuration route exists.** It was listed in the audit request; there is
no such page, and nothing in the nav points to one.

**Save-model inconsistency is a real finding.** Three admin pages use explicit
Save + Revert; three panels autosave on a debounced signature (5s / 2.5s /
debounced); Profile and Notifications hold no draft state. A user moving
between Competencies and Sub-Schedules gets different persistence semantics
with no visual signal distinguishing them.

**Loading states** use `Suspense` + skeleton components from
`workspace-loading.tsx` (imported by 9 files) and `route-loading.tsx` (5). Two
gaps: `/notifications` has no `Suspense` and no `loading.tsx`; several skeleton
column lists don't match the real table headers (Competencies, Time Codes,
Shifts), so the skeleton visibly reflows on load.

---

## 6. Schedule and Sub-Schedule architecture

### Main schedule

`components/monthly-scheduler.tsx`, ~3,840 lines. Month view only.

- **Columns:** `gridTemplateColumns` built as
  `var(--schedule-name-column-width, 7.75rem) repeat(N, minmax(var(--schedule-day-column-width, 1.72rem), 1fr))`,
  where N is days in month. Widths are CSS-variable driven with a mobile
  override.
- **Rows:** `buildDisplayEmployeesForSchedule` composes `baseRows` (the
  schedule's own employees) with borrowed rows keyed by `rowId` prefix —
  `ot:` (overtime claims), `loan:` (temporary loans), `manual:` (manual
  borrows) — plus mutual rows. Row identity by prefix is load-bearing; a
  regression here silently drops people from the grid.
- **Virtualization:** `useVirtualizer` over rows only (`count:
  visibleEmployees.length`, `overscan: 8`), absolute positioning via
  `translateY`. All 28–31 day columns render per row.
  **`SCHEDULE_ROW_HEIGHT_PX = 51` is a hardcoded constant with no
  `measureElement` fallback** — row height is asserted, never measured. Any
  change to `.employee-cell` padding or font size silently desynchronises row
  positions from row heights and rows begin overlapping. This is the single
  most dangerous interaction between a visual reskin and this file.
- **Rows contribute nothing to grid width.** `.schedule-grid` is
  `width: max-content`, rows are `position: absolute; width: 100%`, so the
  **header alone** sizes the grid. `gridColumns` is passed separately to the
  header and to each row; nothing enforces that they stay identical.
- **Scrolling: two scrollers, manually synced.** A visually-hidden top
  scrollbar (`.schedule-wrap--top-scroll` containing a 1px-high width proxy)
  mirrors `scrollLeft` bidirectionally with the real body scroller, guarded by
  an `isSyncing` flag, with a `ResizeObserver` recomputing the proxy width from
  `grid.scrollWidth`.
- **A `min-height: 0` flex chain four levels deep** —
  `.workspace-content:has(.schedule-scroll-shell)` → `.panel-frame:has(...)` →
  `.schedule-scroll-shell` → `.schedule-wrap`. Break any link, or insert a
  wrapper without `flex: 0 0 auto`, and the grid either collapses to zero
  height or grows past the viewport, and the virtualizer's scroll element stops
  scrolling. Note this `:has()` rule is **declared twice** (the later wins) —
  another instance of the duplicate-rule hazard.
- **Sticky depends on CSS source order.** The corner cell matches both a
  `z-index: 4` and a `z-index: 3` rule; the later wins, so the corner sits
  *below* the day headers and only reads correctly because the parent header
  row is itself a sticky stacking context at `z-index: 5`. Introducing a
  `transform`, `filter`, or `will-change` on any ancestor collapses both
  layers.
- **`EmployeeRow` is not memoized** and receives inline closures, so every
  parent render re-renders every mounted row. Virtualization is currently the
  only thing bounding that cost.
- **`.shift-cell-button` is `position: absolute; inset: 0`**, overlaying its
  cell — drag-select works by event bubbling from that button to the cell's
  `onPointerDown`/`onPointerEnter`. Making the button non-absolute breaks
  drag-select.
- **No grid keyboard navigation exists.** The only handler is Escape-to-close.
  Cells are `<button>`s so they are tab-reachable, but with ~31 per row and
  virtualized rows, focus is destroyed when a row scrolls out of the overscan
  window.
- **Editing:** drag-select across a date range, an assignment modal, a set
  builder, and locked-cell guards. Autosave fires 5 seconds after the last
  edit.
- **Cells:** content and colour derive from competency or time code, resolved
  through `colorToken` into `legend-pill--*` classes and the `--cell-*` tints.

### Sub-schedules

`components/sub-schedules-panel.tsx`, 1,417 lines — architecturally *unlike*
the main grid despite looking similar:

- **No virtualization.** Every cell renders eagerly.
- **Hardcoded columns:** `` `12rem repeat(${monthDays.length}, minmax(2.1rem, 1fr))` `` —
  literal values, no CSS variable hook.
- Four tables: `sub_schedules`, `sub_schedule_assignments`,
  `sub_schedule_competencies`, `sub_schedule_members`.
- `sub_schedule_assignments` carries `unique (employee_id, assignment_date)`
  **globally** — an employee can be in only one sub-schedule per day, ever.

### Publishing and merging — does not exist

There is no publish step, no merge, no `status`, no `published_at`, no
versioning, no approval. Grepping the four migrations for
`publish|merge|promote|draft|status` returns **zero** hits.

Instead, `buildProjectedSubScheduleAssignments` synthesises assignments at read
time in `lib/data.ts` (five call sites), and
`filterAssignmentsShadowedBySubSchedules` removes the real
`schedule_assignments` rows they shadow. The main grid renders these as
read-only cells that refuse edits with "managed by {subScheduleName}".
Propagation is nothing more than `revalidatePath("/schedule")`.

The only true write-through is destructive: `saveSubScheduleAssignments`
**hard-deletes** conflicting `schedule_assignments` rows (refusing only when
the conflict is mutual/overtime/loan-generated) and deletes rows in other
sub-schedules for the same employee/date.

The only status axis is `is_archived`, surfaced as an "Active" checkbox.

### Feasibility: moving Sub-Schedules into a Schedule selector

**Visually feasible and behaviourally significant. Resolved: the selector is a
navigation and presentation change only.**

- **Selection state is not URL-backed today.** The `?subSchedule=` param is
  read once as an initial value; the dropdown only sets local state and never
  writes the URL. Making the selector deep-linkable is a *frontend behavioural*
  change requiring routing, default, invalid-value, and history handling.
- **Permissions differ.** `/sub-schedules` is admin+leader; `/schedule` is
  open to workers. Merging contexts means gating the selector by role, not
  just moving a control.
- **The two grids are different implementations.** One virtualizes and is
  variable-driven; the other doesn't and is hardcoded. A unified selector
  implies unifying them — a large change to the riskiest file.
- **The doc/reality contradiction is resolved in favour of reality.** The docs
  previously said "clearly identify unpublished content" and "never imply
  sub-schedule edits are live on Main." They *are* live on Main, and no
  draft/publish/merge/promote workflow will be built. Those statements have been
  removed from `product-vision.md` and `scheduling-behavior.md`. Phase 5 presents
  Main and sub-schedules as selectable contexts and nothing more — no status
  badge, no review screen, no conflict resolution.

### Change classification

| Change | Class |
|---|---|
| Restyling the month grid, cells, toolbar | **Visual** |
| Sidebar, header, breadcrumbs, page chrome | **Visual** |
| Token consolidation, radii, primitives | **Visual** |
| URL-backed schedule selection | **Frontend behavioural** |
| Sub-Schedules selector on `/schedule` | **Frontend behavioural** |
| Week / Day views, mobile day-list | **Frontend behavioural** (new feature) |
| KPI stat row (Coverage / Open / Conflicts) | **Domain** — no verified formula exists |
| Publish / merge sub-schedules | **Not in scope** — decided against; no workflow will be built |
| Auto-fill | **Domain** — no implementation |

---

## 7. Data flow, mutations, and permissions

Reads: 18 loaders in `lib/data.ts`, all scope-filtered by
`applySessionScope()` on company/site/business-area. Writes: 30 server actions
in `app/actions.ts` (~6,300 lines), each opening with `requireActionRole([...])`.

**All database access uses the service-role client and bypasses RLS.** The RLS
policies that exist are blanket `to authenticated using (true)` grants that
enforce nothing. Application code is the only tenant boundary.

Two known gaps, already recorded in `CLAUDE.md`: `saveAssignments` and
`savePersonnel` accept arbitrary `employeeId`s without a `canAccessScope`
check. **The redesign must not touch these**, but equally must not copy them as
patterns. `deleteSubSchedule` is the reference implementation.

`sub_schedule_members` has RLS enabled with no policy — deliberate, since it is
service-role only, and correct as long as no anon-key access is added.

---

## 8. Reusable-component inventory

Genuinely shared today:

| Component | Imported by |
|---|---|
| `workspace-shell-frame` | 12 |
| `workspace-loading` | 9 |
| `app-date-selector` | 7 |
| `workspace-shell` | 5 |
| `route-loading` | 5 |
| `brand-lockup` | 4 |

Everything else is single-use. **No UI primitives exist.**

Recommended primitives, ordered by duplication removed:

1. **`Button`** — absorbs `.primary-button`, `.ghost-button`, `.icon-button`,
   `.table-action`, `.table-action--danger`, `.table-action--confirm`. Needs
   `variant`, `size`, `loading`, `iconOnly` (with a required accessible name).
   ~108 `ghost-button` + 28 `primary-button` usages today.
2. **`Modal`** — five hand-rolled `createPortal` implementations share the same
   `assignment-modal` shell, header, footer, and danger-zone markup.
3. **`Field`** — label + input/select + `row-issue` error, repeated in every
   admin panel.
4. **`Badge` / `Pill`** — `legend-pill--*` and the `--hue-*` family.
5. **`DataTable` shell** — `personnel-table` markup is duplicated across
   Personnel, Competencies, Time Codes, and Shifts.
6. **`Toolbar` / `PageHeader`** — `workspace-toolbar--actions` +
   `planner-actions` + `toolbar-status-wrap`, repeated per page.
7. **`EmptyState`** — exists as a class, not a component; Profile diverges.
8. **`SegmentedControl`** — does not exist; needed for Month/Week/Day and the
   Metrics tabs *if and when* those views are built.
9. **`EmployeeCell`** — avatar initials + name + role, in the mockups on four
   pages; avatar initials do not exist today.

---

## 9. Mockup-to-page mapping

Six PNGs in `docs/ui_redesign/` (note: **underscore**, not hyphen as the audit
request stated).

| Mockup | Route | Directly maps | Needs behaviour | Not implemented |
|---|---|---|---|---|
| `schwifty-schedule-page.png` | `/schedule` | Grid, employee rows, day columns, cell codes, legend, month nav | Sticky header polish | **Month/Week/Day tabs, Coverage/Open/Overtime/Conflicts KPIs, Auto-fill, Publish schedule, global search, avatar, breadcrumbs, Today button** |
| `schwifty-overtime-page.png` | `/overtime` | Filters (Claim as / Schedule / Assignment / Availability), Calendar, My claims, Create, Claim posting, Eligible employees, Delete posting, "0/1 staffed" | Card layout restyle | Staffing progress bar; breadcrumbs; avatar |
| `schwifty-personnel-page.png` | `/personnel` | Per-row gear, Actions menu, Add employee, competency pills, shift select, grouped rows | — | Search box, All shifts / All competencies filters, "9 employees" count, avatar initials, `?` header tooltips |
| `schwifty-mutuals-page.png` | `/mutuals` | Search, year selector, settings gear, Create mutual posting, Open/Pending sections, Apply, Cancel, Review request | Card restyle | Avatar initials, the ⇄ exchange graphic |
| `schwifty-metrics-page.png` | `/metrics` | Competencies-by-team bars, overtime-by-team cards, top personnel, settings gear, month selector | — | **Overview / Competencies / Overtime tabs**, 30D/90D/1Y/YTD toggle as shown, "Shift transfer" button placement |
| `schwifty-mobile-view.png` | `/schedule` (mobile) | Month data | — | **Bottom tab bar, day-list cards, Day/Week/Month switch, date strip, Published badge, Edit schedule FAB, shift times, Open shift row** |

**No mockups exist** for Sub-Schedules, Competencies, Time Codes, Shifts,
Profile, or Notifications — 6 of 12 routes have no visual reference. Those
pages must be derived from the design system alone. **Do not invent mockups for
them.**

**Decided:** the "Published" badge is dropped — no backing field exists and no
publish model will be built. The mockups being light-only is expected: design
light-first and preserve dark through tokens (see `design-system.md`).

**Ambiguities to resolve:** shift times (`7:00 AM – 7:00 PM`, `12h`) appear in
the mobile mock but the data model stores codes, not times — verify whether
times are derivable. Coverage %, Open shifts, and Conflicts counts have no
verified formula.

---

## 10. Existing responsive behaviour

Breakpoints: `600px` (primary), `720px`, `1100px`, plus print. Nothing between
1100px and 4K, despite the design system targeting 1280–1920.

At ≤600px: sidebar becomes an overlay drawer with backdrop; a floating menu
pill replaces persistent nav; `.workspace-content` is `height: 100dvh` with
internal scrolling; schedule day columns narrow via
`--schedule-day-column-width`; navigation switches to full document loads.

Safe areas: `viewport-fit=cover` with `black-translucent` status bar; the
mobile toolbar clears the notch via `max(0.6rem, env(safe-area-inset-top))`
and content clears the floating button via
`calc(env(safe-area-inset-top, 0px) + 3.75rem)`. Every `min-height: 100vh` is
paired with `100dvh` except `.print-preview-page`, which is intentional.

Nineteen `overflow: auto` containers exist; the schedule page nests its own.

---

## 11. Baseline validation results

Run on `65b1443` with no modifications.

| Check | Command | Result |
|---|---|---|
| Type check | `npx tsc --noEmit` | **Pass** — exit 0, no output |
| Unit tests | `npm test` | **Pass** — 8/8, 122ms |
| Production build | `npm run build` | **Pass** — 25 routes compiled |
| Lint | — | **Not available** — no config, no script |
| E2E | — | **Not available** — none exist |
| Visual/browser | manual | Not run; pages are auth-gated |

No pre-existing failures. Any failure appearing later in the redesign is
attributable to redesign work.

Bundle baseline for regression comparison: shared JS 102 kB; `/schedule`
23.3 kB / 140 kB first load; `/overtime` 11.9 kB; `/metrics` 9.56 kB;
`/personnel` 8.95 kB; `/sub-schedules` 7.51 kB.

---

## 12. Risks and architectural concerns

**High**

1. **`monthly-scheduler.tsx` at 3,840 lines**, with several load-bearing
   invariants that a purely visual change can break silently: a hardcoded
   51px row height with no measurement fallback, drag-select depending on an
   absolutely-positioned button overlay, a four-level `min-height: 0` flex
   chain, and sticky layering that depends on CSS source order. See §6 and
   Phase 4. No component tests exist to catch any of it.
2. **`workspace-shell.tsx` is a single point of failure** for all 12 routes.
3. **No component tests anywhere.** Verification is manual browser passes only,
   and the pages are auth-gated — an assistant cannot sign in to verify.
4. **The sub-schedule doc/reality contradiction** (§6) will produce wrong work
   if a future phase trusts the docs over the code.

**Medium**

5. **Dark mode is easy to forget** — it is a system setting, the mockups are
   light-only, and a light-only change silently breaks ~41 token overrides.
6. **25 tracked `globals.css.bak*` files** pollute every search of the file
   being redesigned (24 of 30 `--accent` hits) and invite editing the wrong
   copy.
7. **Duplicate CSS rules where the later wins** — already caused one live bug.
8. **Save-model inconsistency** across pages with no visual signal.
9. **Migration/code ordering** — a column added to an existing `SELECT` takes
   the page down until migrated.

**Low**

10. Skeleton/table column mismatches cause visible reflow on three pages.
11. `/notifications` has no loading state and its actions return `void`, so
    failures are silent.
12. `/mutals` typo route exists and is ungated.
13. `CLAUDE.md` contained a *"Prefer Tailwind classes"* line contradicting its
    own no-Tailwind rule. **Corrected** — the line is gone and the styling
    architecture is now stated explicitly.

---

## 13. Missing or ambiguous information

**Decided:**

- **Publish/merge** — not being built. Sub-schedule assignments are live on
  Main; the docs no longer promise a draft model. Phase 5 is navigation and
  presentation only.
- **Dark mode** — retained. Light-first mockups, dark preserved through tokens,
  polish in Phase 9 (see `design-system.md`).
- **Phase order** — `2 → 3 → 6 → 7 → 4 → 8 → 5 → 9` accepted.
- **"Published" badge** — dropped from the mobile mock; no backing field exists
  and none will be added.
- **Six routes with no mockup** — derive from the design system. Do not invent
  mockups for them.

**Still needs a decision before the phases that depend on it:**

1. **Coverage %, Open shifts, Conflicts** — no formula exists. Omit, or define?
2. **Shift times in the mobile mock** — is the data derivable from codes?
3. **Radii** — `docs/design-system.md` now specifies 6/8/12px against the app's
   10/14/20px; recorded as adopted, worth confirming against the mockup source.
4. **Global search** — scope and backend are undefined.
5. **Avatar initials** — no avatar field exists; derive from names?
6. **Are 1280–1920 breakpoints wanted**, given only 600/720/1100 exist?

---

## 14. Recommended phased implementation plan

Accepted order: **2 → 3 → 6 → 7 → 4 → 8 → 5 → 9.**

Phase 5 is not a visual phase — it is a navigation and presentation change
(presenting Main and sub-schedules as selectable contexts), and it sits late so
it lands on stable surfaces.

Rationale: primitives and shell first (they unblock every page); then the
lower-risk pages that prove the system; then the schedule grid once the
primitives are proven; Metrics after; the schedule-context selector once the
grid work is settled; mobile and accessibility last, once surfaces are stable.

Each phase should be one commit per page or per primitive group, never a
sweep, so a regression is attributable and revertible.

---

## 15. File-by-file change proposal per phase

### Phase 2 — Tokens and primitives

**Scope.** Consolidate tokens; add `--space-*` and `--color-sidebar*` with dark
counterparts; adopt the 6/8/12 radius scale; create the first primitives.

**Files.** `app/globals.css` (token blocks; move `--danger*` into the main
`:root`); new `components/ui/button.tsx`, `modal.tsx`, `field.tsx`,
`badge.tsx`, `empty-state.tsx`. First adopters: `components/time-codes-panel.tsx`,
`components/competencies-panel.tsx`, `components/schedules-panel.tsx` (~1,580
lines combined, explicit-save, lowest risk).

**Reuse/create/refactor.** Create the five primitives. Refactor the three admin
panels' toolbars onto `Button`. Do not touch the schedule grid.

**Preserve.** Explicit Save + Revert semantics; `get*Issues()` validation and
`row-issue` display; disabled logic on Save/Revert; the delete guard on shifts
with employees; admin-only gating.

**Risks.** Radius change is visible everywhere; token consolidation can collide
with the duplicate-rule hazard.

**Validation.** `tsc`, `npm test`, `npm run build`; both colour themes; the
three pages exercised manually.

**Commit boundary.** One per primitive, one per adopting panel.

### Phase 3 — Shell and navigation

**Scope.** Dark sidebar, workspace switcher, user block, breadcrumbs, page
header. No new controls.

**Files.** `components/workspace-shell.tsx`,
`components/workspace-shell-frame.tsx`, `components/brand-lockup.tsx`,
`app/globals.css` (`workspace-*` classes).

**Reuse/refactor.** Reuse `NavLink`; refactor the notifications item to use it;
collapse the three per-role nav arrays into one filtered array.

**Preserve.** Role filtering; collapse persistence; the mobile drawer;
**document-navigation on mobile and the fine-pointer prefetch gate** (both
deliberate fixes); the navigation guard context; safe-area handling.

**Risks.** Highest blast radius — all 12 routes. Regressions in mobile
navigation are the specific danger.

**Validation.** All 12 routes; mobile drawer; collapsed and expanded; both
themes; verify mobile links still navigate.

**Commit boundary.** One commit; revert-as-a-unit.

### Phase 6 — Overtime and Mutuals

**Scope.** Card and toolbar restyle onto primitives. Overtime maps closely to
its mockup already.

**Files.** `components/overtime-panel.tsx` (2,646),
`components/mutuals-panel.tsx` (1,272), `app/globals.css`
(`overtime-*`, `mutual-*`).

**Preserve.** Claim/release/withdraw; eligibility gating and its reasons;
"Eligible employees" modal; the full mutual lifecycle including
`pending_leader_approval`; mutual settings; filters.

**Risks.** Both files are large; mutual state transitions are intricate.

**Validation.** Standard checks; exercise a claim and a mutual application.

**Commit boundary.** One per page.

### Phase 7 — Personnel and admin pages

**Scope.** Personnel restyle; finish primitive adoption on the admin trio.

**Files.** `components/personnel-panel.tsx` (1,996), plus the three admin
panels, `app/globals.css` (`personnel-table*`).

**Preserve.** Debounced autosave; the add-employee and per-employee settings
modals; the invite and account-link flows; admin-only gear gating; CSV import;
grouped rows.

**Risks.** Autosave interacts with modal state; recently changed.

**Validation.** Standard; add an employee end-to-end.

**Commit boundary.** One per page.

### Phase 4 — Schedule month view

**Scope.** Restyle the **existing month grid only.** No Week, no Day, no tabs,
no KPI row, no Auto-fill, no Publish.

**Files.** `components/monthly-scheduler.tsx`,
`components/schedule-assignment-modal.tsx`, `app/globals.css`
(`shift-cell`, `day-header`, `employee-cell`, `schedule-grid*`,
`set-builder`, `scheduler-toolbar`).

**Preserve.** The `rowId` prefix scheme (`ot:`/`loan:`/`manual:`/`mut:`) and the
fact that OT, loan, and manual share one accumulator so a borrowed employee
collapses to a single row; the two-scroller sync; sticky header and name
column; the `:has()` flex chain; drag-select; set builder; locked-cell and
projected-cell guards; the 5-second autosave with its stale-snapshot protection
and `localStorage` draft persistence; `OT|`/`MUT|`/`LOAN|` note prefixes; time
code winning over competency for cell colour.

**Risks — the highest in the project, and specifically hostile to reskinning.**

- **Cell padding and font-size changes are not cosmetic here.** Row height is
  the hardcoded `SCHEDULE_ROW_HEIGHT_PX = 51` with no measurement fallback.
  If restyled cells exceed 51px, rows overlap. Any change to `.employee-cell`
  or `.shift-cell` padding must be checked against that constant, and the
  constant updated deliberately in the same commit.
- **Do not make `.shift-cell-button` non-absolute** — drag-select depends on
  it overlaying the cell and bubbling pointer events.
- **Do not add a wrapper element** inside the `.panel-frame` →
  `.schedule-scroll-shell` chain without `flex: 0 0 auto`.
- **Do not add `transform`/`filter`/`will-change`** to any ancestor of the
  sticky header — it collapses the stacking context the header relies on.
- Restyling that changes grid width behaviour desyncs the fake top scrollbar.

**Validation.** Standard checks, plus explicitly: measure a rendered row
against 51px; scroll a full month vertically and horizontally and confirm the
top scrollbar tracks the body; drag-select across a week boundary; open a
locked cell; confirm a projected sub-schedule cell still refuses edits; confirm
sticky header and name column at 1280/1440/1920; both themes.

**Commit boundary.** Several small commits — tokens/cells, then header/sticky,
then toolbar. Never one sweep.

### Phase 8 — Metrics

**Scope.** Restyle cards and bars. Add tabs **only if** they map to sections
that already exist.

**Files.** `components/metrics-panel.tsx` (1,598),
`components/metrics-streamed-sections.tsx` (1,354), `app/metrics/page.tsx`,
`app/globals.css` (`metrics-*`).

**Preserve.** The streaming architecture — this page passes **unresolved
promises** into multiple `Suspense` boundaries, unlike every other route.
Preserve `MetricsSettingsContext`, the rolling-window logic, and every existing
calculation.

**Risks.** Restructuring markup can collapse streaming boundaries into a
waterfall. Do not invent metrics to match the mockup.

**Validation.** Standard; confirm sections still stream independently.

**Commit boundary.** One per section.

### Phase 5 — Sub-schedules (re-scoped: navigation and presentation only)

**Decided.** No draft, publish, merge, or promote workflow will be built.
Sub-schedule assignments are already live on Main via
`buildProjectedSubScheduleAssignments`.

Scope: restyle `sub-schedules-panel.tsx` in place, and present Main and
sub-schedules as selectable contexts. URL-backed selection is an explicit
frontend-behavioural change with its own tests. No status badge, no review
screen, no conflict resolution — do **not** imply a draft model the data cannot
honour.

**Files.** `components/sub-schedules-panel.tsx`,
`app/sub-schedules/page.tsx`, `app/globals.css` (`subschedule-*`).

**Preserve.** The global `unique (employee_id, assignment_date)` constraint;
archived read-only behaviour; carry-workers-across-months; the destructive
conflict deletion in `saveSubScheduleAssignments`; 2.5s autosave.

**Risks.** The grid is unvirtualized and hardcoded; any unification with the
main grid is a Phase 4-scale change.

**Commit boundary.** One for restyle; separate one for URL state.

### Phase 9 — Mobile, accessibility, visual QA

**Scope.** Mobile adaptation within existing capability, accessible names on
icon-only controls, focus states, final pass. Bottom tab bar and day-list are
**new features** — separate approval.

**Files.** `app/globals.css` (media queries), `components/workspace-shell.tsx`,
any component with icon-only buttons.

**Preserve.** Safe-area handling; `100vh`/`100dvh` pairing; document navigation
on mobile; horizontal scrolling for wide grids.

**Risks.** Safe-area and notch behaviour is only observable on a real device or
simulator.

**Validation.** iOS Simulator, both themes, keyboard traversal of every page,
1280/1440/1680/1920.

**Commit boundary.** One per concern.
