# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Next dev server on :3000
npm run build        # Production build
npm test             # node --test via tsx loader (tests/*.test.ts)
npx tsc --noEmit     # Type check
```

Run a single test file:

```bash
node --import tsx --test tests/overtime-swap-assignments.test.ts
```

There is **no lint script and no ESLint config** in this repo.

### A gotcha that will waste your time

**Never run `npm run build` while `npm run dev` is running.** Both write to `.next/`, and the production build overwrites the dev server's manifests. The symptom is every route suddenly 404ing or 500ing with `Cannot find module './xxx.js'`. Recovery: stop the dev server, `rm -rf .next`, restart.

## Architecture

Next.js 15 App Router, React 19, TypeScript strict, Supabase (Postgres), Resend (email), deployed on Vercel.

### The page pattern

Every workspace route follows the same shape, and deviating from it is almost always a mistake:

```
app/<route>/page.tsx           server component, force-dynamic
  └─ requireAppSession([roles])       auth + role gate, redirects
  └─ get<X>Snapshot(month, session)   one scoped read from lib/data.ts
  └─ <WorkspaceShellFrame viewer>     nav shell
       └─ <XPanel snapshot={...} />   client component, owns all interaction
```

Panels are large client components (`components/*-panel.tsx`) that receive a snapshot as props, hold local draft state, and call server actions. Several autosave on a debounced signature rather than an explicit Save button — check before adding one.

### Data flow

- **Reads:** 18 loaders in `lib/data.ts`. All scope-filtered through `applySessionScope()` (company / site / business area).
- **Writes:** 30 server actions in `app/actions.ts` (~6,300 lines). Every one starts with `requireActionRole([...])`.
- **Auth:** HMAC-signed cookie in `lib/auth.ts`. `getAppSession()` is wrapped in React `cache()` — it re-hydrates role and scope from `profiles` on every request, so a role change takes effect on the next navigation.

### Security model — read this before touching a server action

All database access uses the **service-role client**, which **bypasses RLS entirely**. The RLS policies that exist are blanket `to authenticated using (true)` grants and enforce nothing. Application code is the only thing separating tenants.

Consequently every mutation must verify scope itself:

```ts
const session = await requireActionRole(["admin", "leader"]);   // role gate
const row = await supabase.from("x").select("...").eq("id", id).maybeSingle();
if (!canAccessScope(session, scopeFromRow(row))) return { ok: false, message: "..." };
```

`deleteSubSchedule` in `app/actions.ts` is the reference implementation. `saveAssignments` and `savePersonnel` are **known to be missing this check** — they accept arbitrary `employeeId`s and stamp the caller's scope onto whatever they write. Don't copy those two as patterns.

Helpers: `canAccessScope`, `scopeFromRow`, `toDatabaseScope`, `getSessionScope` (all in `app/actions.ts`).

## Styling architecture

- This project does not use Tailwind CSS.
- Do not install Tailwind or introduce another styling framework.
- Inspect the existing CSS architecture before making changes.
- Reuse the current approach: global CSS, CSS Modules, styled components,
  component styles, or whichever system the repository already uses.
- Define shared design tokens with CSS custom properties where compatible.
- Create reusable component classes instead of duplicating page-specific CSS.
- Preserve the current build tooling and stylesheet-loading order.
- Avoid inline styles except for genuinely dynamic values.
- Avoid broad stylesheet rewrites.

### Schedule grid

`components/monthly-scheduler.tsx` is ~3,800 lines and the highest-risk file in the repo: a CSS Grid (name column + 31 day columns via `gridTemplateColumns`), `@tanstack/react-virtual` row virtualization, drag-select, set builder, temporary loans. **Month view only** — no week or day view exists.

Assignment rows carry encoded prefixes in `notes` that drive behavior, parsed by `lib/overtime.ts`, `lib/mutuals.ts`, `lib/temporary-loans.ts`:

- `OT|…` overtime-generated
- `MUT|…` mutual swap
- `LOAN|…` temporary loan

Cancelling a mutual or loan reads `originalCompetencyId` back out of that note to restore the prior cell — a row with no original is deleted rather than restored. Preserve these notes when editing assignment logic.

## Database

41 migrations in `supabase/migrations/`. Apply with `npx supabase db push` (needs `SUPABASE_DB_PASSWORD`).

**Code that queries a column or table which hasn't been migrated yet takes the page down.** Adding a column to an existing `SELECT` breaks that entire query — a new table is safer, since a missing-table read can fall back to defaults (see `readMutualSettings` in `lib/data.ts`). Ship the migration before or with the code that depends on it.

Migrations are additive files only — never edit an applied one.

## Conventions

- **Timezone:** UTC for all date math (`getUTCHours`, `Date.UTC`, `toISOString`). Dates are `YYYY-MM-DD` strings; months are `YYYY-MM`.
- **Comments:** sparse. Explain a non-obvious *why* (a constraint, an invariant, a workaround); never restate what the code does.
- **No `any`, no `@ts-ignore` / `@ts-expect-error`** — the codebase currently has one `any` and zero suppressions. When a type is genuinely wrong upstream (e.g. `next/link` types resolving to the Pages Router and omitting `unstable_dynamicOnHover`), pass the prop via a separately-typed object spread rather than suppressing.
- Tests are pure-logic only (`lib/` helpers). There are no component or integration tests, so UI changes need manual browser verification.

## Naming

The product is **Schwifty** (domain `getschwifty.app`, Vercel project `schwifty`), but `package.json` still says `shift-canvas` and `README.md` describes it under the old name with some stale details. Same app.

# Schwifty Project Instructions

Schwifty is a premium workforce scheduling application for complex
industrial operations. It must feel efficient, dependable, professional,
and purpose-built for supervisors and frontline operational teams.

Read these project references before making product or UI decisions:

@docs/product-vision.md
@docs/design-system.md
@docs/scheduling-behavior.md

Approved visual references are stored in `docs/ui_redesign/`.

## Sources of truth

- The existing application is the functional source of truth.
- The approved mockups are the visual and layout source of truth.
- The design-system document governs reusable styling and components.
- Existing APIs, permissions, scheduling rules, mutations, and data
  contracts must be preserved unless the task explicitly changes them.

## Product principles

- Optimize for operational clarity and fast scanning.
- Maintain high information density without visual clutter.
- Prioritize the user's main task over decorative dashboard elements.
- Preserve recognizable workflows and terminology.
- Never remove functionality merely to simplify the interface.
- Never create controls without functional handlers.
- Never replace real application data with mock data.
- Do not invent major functionality from a visual reference.
- Desktop scheduling grids must remain practical at 1280–1920px.
- Mobile views may adapt the layout but must preserve the workflow.

## Visual identity

- Deep charcoal/navy application navigation.
- Warm orange/coral primary accent.
- Warm off-white canvas with white working surfaces.
- Fine neutral borders and restrained shadows.
- Compact controls and an approximately 8px spacing rhythm.
- Modern sans-serif typography.
- Soft semantic colours for shifts and statuses.
- No gradients, glassmorphism, neon styling, oversized cards, or
  generic dashboard decoration.
- Use solid orange only for the page's primary action.

## Implementation rules

- Inspect existing components and behavior before editing.
- Reuse shared components and existing dependencies.
- Prefer Tailwind classes backed by semantic CSS variables or tokens.
- Avoid page-specific duplication of common controls and styles.
- Keep visual changes separate from behavioral changes where practical.
- Preserve loading, empty, error, permission, and responsive states.
- Maintain keyboard accessibility and visible focus states.
- Do not perform broad rewrites unless explicitly requested.
- Preserve unrelated changes in the working tree.

## Required workflow

Before implementation:

1. Inspect the relevant route, components, data flow, and reference image.
2. Explain the proposed changes and identify affected files.
3. Confirm whether the task is visual, behavioral, or both.

After implementation:

1. Run linting, type checking, tests, and the production build.
2. Fix errors introduced by the change.
3. Visually review the affected page at representative widths.
4. Summarize files changed, behavior preserved, and known limitations.
5. Stop before redesigning another page unless explicitly asked.
