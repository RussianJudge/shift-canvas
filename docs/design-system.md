# Schwifty Design System

## Authority

This document defines Schwifty's shared visual language. Approved mockups in
`docs/ui_redesign/` control page-specific layout; the existing application
controls functionality and data.

Schwifty styles itself with a single global stylesheet (`app/globals.css`) and
CSS custom properties declared on `:root`. That is the whole styling
architecture — there are no CSS Modules, no Sass, no CSS-in-JS, and no component
library. Tailwind, CSS Modules, Sass, or any other styling framework **must not
be introduced during this redesign.** Implement every rule below by extending the
existing stylesheet and reusing or adding custom properties.

## Product character

Schwifty should feel professional, calm, capable, efficient, trustworthy, and
purpose-built for operational work. Preserve high information density while
improving hierarchy and scanability.

Avoid generic dashboard styling, excessive whitespace, oversized cards,
gradients, glass effects, neon colours, decorative charts, and novelty that
reduces usability.

## Principles

- Make staffing, conflicts, exceptions, approvals, and schedule status obvious.
- Preserve useful working context rather than hiding information.
- Reuse components and interaction patterns across pages.
- Reserve solid orange for the primary available action.
- Never add controls without working behavior.
- Never fabricate data or metrics to match a mockup.
- Use restrained semantic colour and never rely on colour alone.

## Tokens

Map these targets to existing project tokens instead of duplicating them:

```css
:root {
  --color-primary: #f35b20;
  --color-primary-hover: #dc4e17;
  --color-primary-soft: #fff0e9;
  --color-sidebar: #142633;
  --color-sidebar-raised: #1b3342;
  --color-sidebar-text: #f7f9fa;
  --color-sidebar-muted: #9eacb5;
  --color-canvas: #fafaf8;
  --color-surface: #ffffff;
  --color-surface-muted: #f5f6f5;
  --color-text: #17232c;
  --color-text-secondary: #64727d;
  --color-border: #dfe4e7;
  --color-border-strong: #cbd3d8;
  --color-info-bg: #eaf2f8;
  --color-info-text: #284d66;
  --color-success-bg: #e8f2e8;
  --color-success-text: #315c3a;
  --color-warning-bg: #f8eedb;
  --color-warning-text: #77571f;
  --color-leave-bg: #f8e8ec;
  --color-leave-text: #7d3e50;
  --color-danger: #c84242;
  --color-danger-bg: #fbeaea;
  --color-neutral-bg: #edf0f1;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-pill: 999px;
}
```

Semantic colour: orange for primary/selected/exception; red for
error/conflict/destructive; pale blue for information or standard work; sage
for active/success/qualified; sand for lead/warning; rose for
leave/unavailable; gray for off/inactive.

## Token mapping

The names above are design targets. The application already has its own token
set in `app/globals.css`, and that set is what components actually read. Use this
table rather than adding a second parallel palette — two systems styling the same
element is worse than either alone.

| Design target | Existing token | Value today | Action |
|---|---|---|---|
| `--color-primary` | `--accent` | `#f97316` | Retune to `#f35b20` |
| `--color-primary-hover` | `--accent-strong` | `#ea580c` | Retune to `#dc4e17` |
| `--color-primary-soft` | `--accent-soft` | `rgba(249,115,22,0.12)` | Keep translucent; do not swap to a solid tint |
| `--color-canvas` | `--bg` | `#f5f5f7` | Retune warmer to `#fafaf8` |
| `--color-surface` | `--surface` | `#ffffff` | Already matches |
| `--color-surface-muted` | `--surface-2` | `#fbfbfd` | Retune to `#f5f6f5` |
| `--color-text` | `--ink` | `#1d1d1f` | Retune cooler to `#17232c` |
| `--color-text-secondary` | `--muted` | `#6e6e73` | Retune to `#64727d` |
| `--color-border` | `--line` | `rgba(0,0,0,0.08)` | Keep alpha-based (see note) |
| `--color-border-strong` | `--line-strong` | `rgba(0,0,0,0.14)` | Keep alpha-based |
| `--color-danger` | `--danger` | `#b91c1c` | Retune to `#c84242` |
| `--color-danger-bg` | `--danger-soft` | `rgba(185,28,28,0.10)` | Retune with the above |
| `--color-info-bg` / `-text` | `--hue-blue-fill` / `-text` | translucent + light text | Reuse the hue family |
| `--color-success-bg` / `-text` | `--hue-teal-fill` / `-text` | translucent + light text | Reuse the hue family |
| `--color-warning-bg` / `-text` | `--hue-amber-fill` / `-text` | translucent + light text | Reuse the hue family |
| `--color-leave-bg` / `-text` | `--hue-rose-fill` / `-text` | translucent + light text | Reuse the hue family |
| `--color-neutral-bg` | `--hue-slate-fill` | translucent | Reuse the hue family |
| `--radius-sm` `md` `lg` | `--radius-sm` `--radius` `--radius-lg` | `10px` `14px` `20px` | Adopt `6/8/12px` — see note |
| `--space-1…8` | *(none)* | — | New tokens; see note |
| `--color-sidebar*` (4) | *(none)* | — | New tokens |

Four things this table makes visible:

**Borders are alpha, not solid.** The app uses `rgba(0,0,0,0.08)`, which composites
correctly over any surface and inverts cleanly to white-alpha in dark mode. The
solid `#dfe4e7` target would need a dark twin and would band against tinted grid
cells. Keep alpha.

**Radii: adopt the tighter scale, but the tokens are not the real work.** The app
is much rounder — 10/14/20px against the target's 6/8/12px. Softer corners read
as consumer product; tighter corners read as operational tooling, which is what
the mockups and the product-character list both call for. The target scale wins.

Retuning the four token values would change almost nothing, though. The
stylesheet has **97 `border-radius` declarations and only 17 use a token.** The
other 80 are hardcoded across **14 distinct rem values** — `0.7`, `0.75`, `0.8`,
`0.85`, `0.9`, `0.95`, `1`, `1.1`, `1.15`, `1.2`, `1.25`, `1.5`, `1.7`, `2rem`.
The single most common radius in the file is a hardcoded `1rem` (15
occurrences), which is not a token at all. Several of these differ by less than
a pixel and were clearly never deliberate choices.

Target scale:

| Token | Value | Applies to |
|---|---|---|
| `--radius-sm` | `6px` | Inputs, selects, badges, small controls |
| `--radius-md` | `8px` | Buttons, cards, menus, grid cells |
| `--radius-lg` | `12px` | Panels, modals, elevated containers |
| `--radius-pill` | `999px` | Pills and avatars — unchanged |

Collapse the hardcoded values into those buckets: `0.7–0.85rem` → `sm`,
`0.9–1rem` → `md`, `1.1–1.25rem` → `lg`, `1.5–2rem` → `lg`. The 15 `999px`
declarations are pills and stay as `--radius-pill`. Keep `--radius` as an alias
for `--radius-md` so nothing breaks mid-migration.

**Migrate per component during Phase 2, not as a sweep.** When the button
classes become a single `Button` component, roughly 20 declarations collapse
into one; same for cards, inputs, and modals. A global find-and-replace across
97 declarations changes every surface at once, and with no component tests and
manual-only verification, any regression becomes impossible to attribute.

**There are no spacing tokens.** `--space-*` does not exist; spacing is raw rem
values inline throughout 6,700 lines. Introducing the scale is worthwhile but is
its own task — adding the variables is cheap, adopting them everywhere is not.
Do not treat "add `--space-*`" as done until call sites actually use them.

**The sidebar tokens are genuinely new.** There is no dark sidebar today, so
those four have nothing to map onto and should be added outright.

One structural note: `--danger` is declared in a *second* `:root` block roughly
6,200 lines below the main one, not alongside the other tokens. Check for an
existing declaration further down the file before adding any token, or you will
create a duplicate where the later one silently wins.

## Dark mode

Schwifty ships a full dark theme and it is not optional. Every token above needs
a dark counterpart, and every page must be checked in both themes.

**Decision: light-first, dark preserved.** The mockups are light-mode only and
each redesign phase is designed and reviewed in light mode. Dark mode is not
dropped: because it is token-driven, a phase that only edits tokens and
token-reading rules keeps working in dark automatically. The obligation during
Phases 2–8 is therefore narrow — add a dark value for every new token, never
hardcode a colour — and dark-mode visual polish is deferred to Phase 9, where
every redesigned page is reviewed in dark and its remaining defects fixed.

### How it works today

Dark mode is `@media screen and (prefers-color-scheme: dark)` overriding the same
custom properties on `:root`. There is no class toggle and no JavaScript. Three
blocks in `app/globals.css` carry it:

1. The core token overrides (~41 properties) immediately after the light `:root`.
2. A small component block for surfaces that need a different treatment rather
   than a different token value (for example the sidebar switching to
   `--surface-2`).
3. The `--hue-*` pill palette, which is redefined wholesale.

Because it is media-query based, dark mode follows the operating system. A
component that reads tokens gets dark support for free; a component with a
hardcoded colour silently breaks in one theme.

**The rule that matters: never give a colour its only definition in the light
block.** If a new token is added to `:root`, it needs a dark value in the same
change, or it will render a light value on a dark surface.

### Dark values

```css
@media screen and (prefers-color-scheme: dark) {
  :root {
    --color-primary: #ff833d;          /* lightens, does not darken */
    --color-primary-hover: #ff9a5e;    /* hover goes lighter still */
    --color-primary-soft: rgba(255, 131, 61, 0.16);
    --color-sidebar: #1b2733;
    --color-sidebar-raised: #24333f;
    --color-sidebar-text: #f7f9fa;
    --color-sidebar-muted: #9eacb5;
    --color-canvas: #161618;
    --color-surface: #242427;
    --color-surface-muted: #1e1e21;
    --color-text: #f5f5f7;
    --color-text-secondary: #a1a1a6;
    --color-border: rgba(255, 255, 255, 0.10);
    --color-border-strong: rgba(255, 255, 255, 0.18);
    --color-info-bg: rgba(55, 138, 221, 0.18);
    --color-info-text: #b5d4f4;
    --color-success-bg: rgba(29, 158, 117, 0.18);
    --color-success-text: #9fe1cb;
    --color-warning-bg: rgba(239, 159, 39, 0.18);
    --color-warning-text: #fac775;
    --color-leave-bg: rgba(212, 83, 126, 0.18);
    --color-leave-text: #f4c0d1;
    --color-danger: #f87171;
    --color-danger-bg: rgba(248, 113, 113, 0.16);
    --color-neutral-bg: rgba(148, 163, 184, 0.16);
  }
}
```

Spacing and radii do not change between themes.

### Four non-obvious inversions

These come from the existing implementation and are easy to get wrong:

- **The accent lightens in dark, and its ink flips.** `#f35b20` on white becomes
  `#ff833d`, and text on top of the accent goes from white to near-black
  (`#1a1003`). Do not reuse a light-mode accent pairing in dark; it fails
  contrast in both directions.
- **Borders flip alpha channel.** Light borders are black at low alpha; dark
  borders are white at low alpha. A literal `#dfe4e7` border disappears on a
  dark surface.
- **Shadows get heavier, not lighter.** Light mode uses ~0.04–0.12 alpha; dark
  mode uses 0.4–0.55. A shadow tuned for light is invisible in dark.
- **Semantic colours lighten for legibility.** Success goes `#315c3a` →
  `#9fe1cb`, danger `#c84242` → `#f87171`. Backgrounds become translucent fills
  (`rgba(..., 0.16–0.20)`) rather than solid pastels, so they sit correctly on
  any surface beneath them.

### Schedule cells and pills

The grid has its own tinted cell tokens (`--cell-day`, `--cell-night`,
`--cell-off`, `--grid-line`, `--cell-weekend-veil`). In dark mode these are dark
tints of the same hue rather than pale ones — `--cell-day` goes `#fff8ef` →
`#2c2820`. Keep the hue relationship, invert the lightness.

Competency and time-code pills use the `--hue-*` family (amber, teal, violet,
rose, blue, lime, orange, slate), each with a `fill` / `border` / `text` triplet.
Dark mode redefines all three per hue: translucent fill, stronger border, light
text. A new pill colour means adding to both palettes.

### Verification

Dark mode is a system setting, so it is easy to forget. Check both themes before
calling a visual change done:

```bash
xcrun simctl ui booted appearance dark    # iOS Simulator
```

In a desktop browser, use the emulation setting for `prefers-color-scheme`. Any
page touched by a redesign phase should be looked at in both, with particular
attention to borders, shadows, disabled states, and anything layered on the
accent colour.

## Typography and surfaces

- Use the existing sans-serif typeface; otherwise prefer Inter, Geist, or a
  system sans-serif stack.
- Target 14px body, 12–13px supporting text, 16–18px section titles, and
  24–30px page titles. Avoid text below 12px.
- Use an 8px spacing rhythm, delicate 1px borders, 8–12px radii, white surfaces,
  and a warm off-white canvas.
- Reserve shadows for dialogs, menus, popovers, and genuinely elevated elements.

## Application shell

- Desktop sidebar: approximately 220–232px, deep navy, stable while content
  scrolls, with consistent line icons and restrained grouping.
- Preserve Schwifty branding, administrator context, workspace selector, user
  profile, and existing collapse behavior.
- Use orange for selected navigation.
- Keep the page header and toolbar compact. Group date navigation, filters,
  view selection, and actions by purpose.
- Present one primary action; subordinate supporting and destructive actions.

## Components

- Buttons need primary, secondary, subtle, and destructive variants with hover,
  pressed, focus, disabled, and loading states.
- Inputs, selects, and search share consistent sizing, labels, borders, focus,
  validation, and disabled treatment.
- Use segmented controls for closely related views such as Month, Week, and Day.
- Keep badges compact and text-led; do not turn all metadata into pills.
- Tables prioritize scanning, alignment, useful sticky context, and preservation
  of sorting, filtering, selection, and inline editing.
- Consequential dialogs explain what changes, what is affected, and whether it
  can be reversed.

## Schedule surfaces

- The schedule grid is the primary working surface.
- Month uses an employee-by-day grid with compact cells, weekend shading, today
  indication, and sticky employee/date context where feasible. **Month is the
  only view that exists today** — it is the sole schedule surface the redesign
  restyles.
- Week and Day are **new features, not restyling.** No implementation exists in
  the codebase; the mockups' `Month | Week | Day` control and the mobile
  day-list are proposals. The specification below describes the target once
  those views are built, and must not be read as describing something to
  reskin. Building them is separate scoped work with its own approval — see
  `scheduling-behavior.md`.
- When built, Week uses seven wider employee-by-day columns, not an appointment
  timeline. Show only supported shift, time, duration, exception, conflict, and
  open-shift data.
- Map real time codes to semantic styles after inspecting the data. Use neutral
  treatment for unknown codes.
- Avoid unnecessary nested scrolling.

Overtime should prioritize comparable postings, staffing gaps, eligibility, and
claim status. Mutuals should show both sides of an exchange. Personnel and
Competencies should remain dense and scanable. Metrics must support decisions
and use verified calculations.

## Responsive and accessible behavior

- Optimize desktop work at 1280, 1440, 1680, and 1920px.
- Preserve horizontal scrolling for wide grids rather than hiding required data.
- On mobile, adapt instead of shrinking desktop grids; prefer a selected-day
  roster and swipeable date strip for Schedule.
- Account for iOS safe areas and prevent fixed navigation from covering content.
- Use semantic HTML, keyboard access, visible focus, adequate contrast, and
  accessible names for icon-only controls.
- Preserve loading, empty, error, permission-denied, and disabled states.
- Preserve real terminology, names, dates, codes, and values.

## Validation

For each redesigned page, compare it with its approved mockup, verify existing
behavior, test representative widths and keyboard focus, run the repository's
checks, and report remaining visual differences or functional risks.

