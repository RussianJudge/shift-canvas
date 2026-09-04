# Schwifty Scheduling Behavior

## Authority

This document protects scheduling behavior during the redesign. The current
application, verified contracts, and authorization rules remain the functional
source of truth. Mockups define visual direction, not business logic.

If this document conflicts with verified behavior, stop and report the conflict.

## Non-negotiable rules

- Do not infer business rules from screenshots.
- Do not replace real data with mock data.
- Do not change APIs, schemas, permissions, calculations, or workflow states
  during visual work.
- Preserve handlers, mutations, validation, loading, error, and empty states.
- Never display a functional control without working behavior.
- Classify changes as visual, frontend-behavioral, or domain/contract.

## Schedule contexts

The Main Schedule is the authoritative published schedule. Always show the
selected schedule, date range, view, and whether content is published, draft,
pending, or staged.

Sub-schedules are planning contexts that publish or merge changes into Main.
Approved direction:

- Present Main and sub-schedules as contexts in the main Schedule experience.
- Prefer a schedule selector over a permanent Sub-Schedules sidebar item.
- Preserve each sub-schedule's employees, shifts, codes, notes, settings, status,
  and permissions.
- Clearly identify unpublished content.
- Never imply sub-schedule edits are live on Main.

These remain proposals until verified and approved:

- URL-backed schedule selection.
- “Review & publish to Main” or “Review & merge” terminology.
- A review screen for affected employees, dates, changes, and conflicts.
- Overwrite, skip, or manual conflict resolution.

Do not remove the existing route or navigation until its replacement is
complete, tested, and reachable.

## Views and navigation

Month, Week, Day, and mobile presentations should share the same schedule
context and date model unless existing behavior says otherwise.

Preserve selected schedule, date, team, filters, timezone, locale, overnight
handling, navigation, editing, permissions, and deep links.

- Month: employee-by-day roster.
- Week: seven-day employee roster, not an appointment timeline.
- Day/mobile: may use a selected-day employee list.

Changing presentation must not change data. URL persistence is a behavioral
change; verify routing, defaults, invalid values, and browser history first.

## Shift integrity

Shift labels, times, duration, colour, notes, and interactions must come from
actual data and verified rules.

Preserve time-code meaning, overnight handling, leave/lead/off classifications,
conflicts, exceptions, editability, selection, bulk editing, keyboard behavior,
copying, menus, saving, autosave, undo, and cancellation where implemented.

Semantic styles may map existing time codes but cannot redefine them. Unknown
codes receive neutral treatment.

A time code's meaning must survive both colour themes. The application ships a
dark theme driven by `prefers-color-scheme`, and the grid's cell tints and
competency pills are redefined in it (see `design-system.md`). A code that is
distinguishable in light mode but collapses into its neighbours in dark mode is
a defect, not a cosmetic issue — the same applies to conflict, exception, open
shift, and locked-cell indication. Verify shift-status legibility in both themes
before treating a change as complete, and keep a non-colour signal (label,
icon, border, or text) carrying the meaning.

## Open shifts, conflicts, and exceptions

Display an open shift only when supported by a record or verified derived state.
Show available date, time, assignment, vacancy, eligibility, status, and actions.

Conflicts must come from existing validation. Show affected employees, dates,
assignments, and explanations where available, while preserving whether the
conflict is blocking or advisory.

Keep exceptions distinct from conflicts unless the data model combines them.
Never rely on colour alone.

## Publishing and merging

Before changing publishing, verify:

- What is published and whether it replaces, appends, or merges.
- Which employees and dates are affected.
- Validation, conflict, visibility, permission, audit, and reversibility rules.
- Partial-failure and concurrent-change behavior.

Name the target and scope accurately, prevent duplicate submission, show
blocking conflicts before confirmation, and preserve context on success or
failure. Never claim completion before the authoritative operation succeeds.

## Related workflows

### Overtime

Preserve posting visibility, filters, shift details, vacancies, eligibility,
claims, withdrawal, ranking/assignment, approvals, administrative actions,
permissions, and concurrent-update handling. Coverage must use verified data
and a documented formula.

### Mutuals

Preserve request creation, participants, original/proposed shifts, responses,
validation, approval chain, rejection, cancellation, schedule mutation, and
notifications. Show both sides clearly without bypassing approval.

### Personnel and competencies

Preserve identity, active status, team, shift, role/post, competency,
qualification, expiry, editing, validation, permission, and per-person actions.
A competency indicator is not proof of scheduling eligibility unless existing
logic uses it that way.

### Metrics

Every metric needs a verified source, formula, scope, date range, timezone,
missing-data behavior, refresh timing, and permission rule. Omit unsupported
mockup metrics or record them as future work.

## Authorization, state, and integrity

Inspect actual authorization checks; do not infer access from role labels.
Preserve route, record, edit, approval, publication, administrative, and
field-level restrictions. Hiding a control does not replace server authorization.

Preserve initial loading, refresh, empty/filtered-empty, denial, validation and
server failure, stale data, concurrency, partial success, and retry states.

- Keep stable IDs separate from displayed names.
- Preserve timezone and date boundaries.
- Avoid duplicate requests and submissions.
- Preserve caching and invalidation until reviewed.
- Keep large employee-by-date grids performant.
- Treat virtualization or rendering-architecture changes as separate work.

## Change classification

- **Visual:** colour, spacing, typography, composition, responsiveness; behavior
  unchanged.
- **Frontend behavioral:** navigation, URL state, review steps, or cross-route
  state preservation.
- **Domain/contract:** statuses, conflict or eligibility rules, publish
  semantics, APIs, or schemas.

Visual changes may proceed in redesign phases. Frontend behavior needs explicit
scope and tests. Domain/contract changes require separate approval.

## Required verification

Before each scheduling change:

1. Trace affected routes, components, data, derived values, handlers, mutations,
   and authorization.
2. Confirm schedule context, date/timezone, non-default states, and concurrency.
3. Compare existing behavior with this document and the approved mockup.
4. Report conflicts or unknowns.
5. Implement only the authorized change type and run relevant checks.

Phase 1 must verify the schedule/time-code models, publish/merge semantics,
statuses and conflicts, view implementations, state persistence, overtime and
mutual rules, competency relationships, permissions, timezone handling,
audit/rollback behavior, and expected dataset sizes.

Do not convert findings into permanent rules until verified from the repository
or confirmed by the product owner.

