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

The Main Schedule is the authoritative schedule. Always show the selected
schedule, date range, and view.

**Sub-schedule assignments are live on Main.** There is no draft, publish,
merge, promote, or conflict-resolution workflow, and none is to be built during
this redesign. `buildProjectedSubScheduleAssignments` (`lib/sub-schedules.ts`)
synthesises sub-schedule assignments onto the Main grid at read time, on every
snapshot load, and `filterAssignmentsShadowedBySubSchedules` removes the real
rows they shadow. A sub-schedule edit reaches Main as soon as its ~2.5 second
autosave completes.

The only status axis is `is_archived`, surfaced as an "Active" toggle. Archived
sub-schedules are read-only.

Consequences for the UI:

- Never label sub-schedule content as unpublished, draft, pending, or staged —
  no such state exists.
- Never present publish, merge, promote, or review-and-approve actions.
- Main-grid cells sourced from a sub-schedule are read-only and must keep
  saying so ("managed by {subScheduleName}").
- Preserve each sub-schedule's employees, shifts, codes, notes, settings, and
  permissions.

Phase 5 may present Main and sub-schedules as selectable contexts in the
Schedule experience. **That is a navigation and presentation change only** and
must preserve live projection semantics. URL-backed schedule selection is a
frontend behavioural change requiring its own scope and tests; it is not
implied by the selector.

Do not remove the existing route or navigation until its replacement is
complete, tested, and reachable.

## Views and navigation

**Only Month exists today.** `components/monthly-scheduler.tsx` renders an
employee-by-day grid for a calendar month and nothing else. Week, Day, and the
mobile day-list are **new features, not visual work** — new date-range logic,
new data shaping, new interaction handling.

Scope as approved:

- **Week is in scope for Phase 4**, built against the approved mockup.
- **Day is deferred.** It has no approved scope and must not be built.
- The `Month | Week | Day` control ships in Phase 4 alongside Week, as a
  segmented control offering only the views that exist. Adding a Day tab before
  the view exists would create a control with no working behavior, which the
  non-negotiable rules prohibit.

Once they exist, all presentations should share the same schedule context and
date model unless existing behavior says otherwise, and must preserve selected
schedule, date, team, filters, timezone, locale, overnight handling, navigation,
editing, permissions, and deep links.

- Month: employee-by-day roster. *(exists)*
- Week: seven-day employee roster, not an appointment timeline. *(Phase 4)*
- Day/mobile: may use a selected-day employee list. *(deferred)*

Changing the presentation of an existing view must not change data. URL
persistence is a behavioral change; verify routing, defaults, invalid values,
and browser history first.

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

## Saving

There is no publishing step to change. Edits reach the authoritative schedule
through autosave, and the redesign must not introduce a publish gate in front
of it.

Save models differ by page and must be preserved as they are: the Schedule grid
autosaves ~5s after the last edit; sub-schedule assignments autosave ~2.5s;
Personnel autosaves on a debounced signature; Competencies, Time Codes and
Shifts use explicit Save with Revert. Preserve each page's existing model,
including its disabled-state logic, and never claim completion before the
server action returns success.

One destructive behaviour to preserve deliberately: `saveSubScheduleAssignments`
hard-deletes conflicting `schedule_assignments` rows, refusing only when the
conflict is overtime-, mutual-, or loan-generated.

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
- **Domain/contract:** statuses, conflict or eligibility rules, save and
  projection semantics, APIs, or schemas.

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

Phase 1 must verify the schedule/time-code models, sub-schedule projection and
save semantics, statuses and conflicts, the Month view implementation, state
persistence, overtime and
mutual rules, competency relationships, permissions, timezone handling,
audit/rollback behavior, and expected dataset sizes.

Do not convert findings into permanent rules until verified from the repository
or confirmed by the product owner.

