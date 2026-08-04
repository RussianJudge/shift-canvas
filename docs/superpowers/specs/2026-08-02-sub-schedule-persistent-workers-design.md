# Sub-schedule persistent worker list — design

**Date:** 2026-08-02
**Status:** Approved, ready for implementation planning
**Affects:** `app/sub-schedules`, `components/sub-schedules-panel.tsx`, `lib/sub-schedules.ts`, `lib/data.ts`, `app/actions.ts`, one new migration

---

## Problem

The Sub-Schedules monthly builder derives its worker rows from data rather than storing them. `rowEmployeeIds` ([`components/sub-schedules-panel.tsx:767`](../../../components/sub-schedules-panel.tsx)) is the union of:

- `assignedEmployeeIds` — employees with at least one non-empty cell **in the loaded month**
- `addedEmployeeIds` — employees added via the picker, held in React state and reset on every month change

Nothing persists membership. Switching to the next month therefore presents an empty builder, and the planner re-adds every worker by hand before they can enter anything. For a sub-schedule with a stable crew this repeats monthly, forever.

## Goal

A per-sub-schedule toggle that keeps the same worker rows present in every month, so the planner opens a new month to a ready-to-fill grid.

## Scope decisions

| Question | Decision |
|---|---|
| What carries across months | **Worker rows only.** Day cells start empty in each month. |
| Which months | **All months, past and future.** One global list per sub-schedule, not per-month records. |
| Removing someone | **Explicit `×` on each row**, visible only when the toggle is on. |
| Removal guard | **No hard guard.** A confirm dialog names the consequence instead. |
| Default for existing sub-schedules | **Off.** Nothing changes until someone opts in. |
| Toggle location | The existing per-sub-schedule settings modal, beneath `Active`. |

Explicitly **not** in scope: copying assignments between months, per-month membership, bulk roster import, and any change to how sub-schedule work projects onto the main schedule.

## Rejected alternatives

**Derive membership from all-time assignment history** (no migration). Fails the core use case: you could never add someone *before* they have work, which is precisely what the feature is for. Removal would also require deleting historical assignments.

**Store the roster as a `text[]` column on `sub_schedules`.** No foreign key to `employees`, so deleted employees leave orphaned ids; and it carries none of the scope columns used consistently everywhere else in the schema.

**Copy assignments as well as rows.** Sub-schedule assignments project onto the main schedule and shadow regular work ([`lib/sub-schedules.ts:24`](../../../lib/sub-schedules.ts), `buildProjectedSubScheduleAssignments`). Auto-creating them in months nobody has reviewed would silently manufacture scheduled work. If this is wanted later it should be an explicit per-month "copy last month" action, not a toggle.

---

## 1. Schema

One migration, two changes.

**Toggle column:**

```sql
alter table public.sub_schedules
add column if not exists carry_workers_across_months boolean not null default false;
```

**Roster table**, mirroring `sub_schedule_competencies` ([`202605180001`](../../../supabase/migrations/202605180001_add_sub_schedule_competencies_and_overtime_targets.sql)) in shape, naming, and index strategy:

```sql
create table if not exists public.sub_schedule_members (
  sub_schedule_id text not null references public.sub_schedules(id) on delete cascade,
  employee_id text not null references public.employees(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  company_id text not null references public.companies(id),
  site_id text not null references public.sites(id),
  business_area_id text not null references public.business_areas(id),
  primary key (sub_schedule_id, employee_id)
);

create index if not exists sub_schedule_members_scope_idx
on public.sub_schedule_members (business_area_id, sub_schedule_id, employee_id);

alter table public.sub_schedule_members enable row level security;
```

### Deliberate deviation: no permissive RLS policy

Every sibling table in this schema ships a `to authenticated using (true) with check (true)` policy. This table will **not**. RLS is enabled with no policy, which denies all non-service-role access.

The application reads and writes this table exclusively through `getSupabaseAdminClient()`, which bypasses RLS — so the restriction costs nothing functionally, and it avoids adding another table to the blanket-grant surface described in finding 1b of the 2026-08-02 code review. If a future feature needs user-scoped access, it should get a properly scoped policy rather than a blanket one.

Both `on delete cascade` FKs matter: deleting an employee or a sub-schedule cleans up membership automatically, with no application-side bookkeeping.

## 2. Read path

Extend `getSubSchedulesSnapshot` ([`lib/data.ts:1822`](../../../lib/data.ts)) with a `sub_schedule_members` fetch in the existing `Promise.all`, wrapped in `applySessionScope`, directly alongside the `sub_schedule_competencies` fetch it mirrors:

```ts
applySessionScope(
  supabase
    .from("sub_schedule_members")
    .select("sub_schedule_id, employee_id, company_id, site_id, business_area_id"),
  session,
),
```

Add `subScheduleMembers` to the snapshot type and `carryWorkersAcrossMonths` to the `SubSchedule` type in `lib/types.ts`, mapped from `carry_workers_across_months`.

## 3. Server action

New `saveSubScheduleMembers({ subScheduleId, employeeIds })` in `app/actions.ts`, modelled on `saveSubScheduleCompetencies` ([`app/actions.ts:5547`](../../../app/actions.ts)):

1. `requireActionRole(["admin", "leader"])`
2. Load the `sub_schedules` row; `canAccessScope(session, scopeFromRow(row))` or refuse
3. **Verify every incoming `employeeId` resolves within the caller's scope** — load the employee rows and reject if any is missing or fails `canAccessScope`
4. Replace the member set for that sub-schedule, stamping scope from the sub-schedule row
5. `revalidatePath("/sub-schedules")`

Step 3 is not optional. It is the check that `saveAssignments` and `savePersonnel` are missing (findings 2 and 3 of the code review), and the reason those are exploitable. Since every write here runs as service role with RLS bypassed, an unvalidated `employeeId` would let a leader attach another tenant's employee to their own sub-schedule.

The toggle itself needs no new action — `carry_workers_across_months` is a column on `sub_schedules` and rides along in the existing `saveSubSchedules` definitions save.

## 4. Row-resolution logic

Extract the union out of the 1,313-line panel into `lib/sub-schedules.ts` as a pure function:

```ts
export function resolveSubScheduleRowEmployeeIds(input: {
  assignedEmployeeIds: string[];
  memberEmployeeIds: string[];
  addedEmployeeIds: string[];
  carryWorkersAcrossMonths: boolean;
}): string[]
```

Returns the distinct union of `assignedEmployeeIds`, `addedEmployeeIds`, and — only when `carryWorkersAcrossMonths` is true — `memberEmployeeIds`. Sorting stays in the component, which owns the name lookup.

Keeping `assignedEmployeeIds` in the union unconditionally is what makes removal non-destructive (see §6).

## 5. UI

**Settings modal** ([`components/sub-schedules-panel.tsx:425`](../../../components/sub-schedules-panel.tsx)) — a checkbox beneath `Active`, following the same `subschedule-status-toggle` markup:

> ☐ Keep the same workers every month

**Add row.** With the toggle on, choosing someone in the picker persists them via `saveSubScheduleMembers` in addition to the existing local state update. With the toggle off, behaviour is unchanged — session-local `addedEmployeeIds` only.

**Remove row.** A `×` button in the sticky employee cell, rendered only when the toggle is on, and disabled under the same conditions as the existing cell controls (`!isPersistedActiveSubSchedule || activeSubSchedule.isArchived`).

## 6. Removal semantics

Removal deletes one row from `sub_schedule_members`. It never touches `sub_schedule_assignments`. No scheduled work can be lost.

Because `assignedEmployeeIds` remains in the union unconditionally, anyone with real work in a given month still appears in that month after removal. History preserves itself; the `×` only stops the automatic carry-forward into months where they have nothing. Removal is fully reversible by re-adding from the picker.

This is why there is no hard guard. Refusing to remove anyone with existing assignments would pin a worker who took a single January shift to every future month permanently — a worse and far more likely failure than the confusion the guard would prevent.

**Confirm dialog.** Uses `window.confirm`, following the precedent at [`components/mutuals-panel.tsx:654`](../../../components/mutuals-panel.tsx). The inline two-step pattern used in the settings modal's danger zone does not fit the narrow sticky row column. Copy varies by whether the employee has work in the currently loaded month:

- **No work this month** — "Remove {name} from this sub-schedule's monthly list? They will stop appearing automatically in new months. You can add them back at any time."
- **Has work this month** — "Remove {name} from this sub-schedule's monthly list? They have work assigned in {Month}, so their row stays visible here. This only stops them carrying forward to months where they have none."

The dialog can only speak accurately about the loaded month — the snapshot is month-bounded and does not know about work in other months. The second message is worded to state the general rule rather than imply a complete picture.

After a removal where the row persists, the status line reads: "Removed from the monthly list — still shown here because they have work this month."

## 7. Edge cases

| Case | Behaviour |
|---|---|
| Toggle switched off | Member rows are retained in the table, just unused. Switching back on restores the list. |
| Employee deleted | FK cascade removes membership. |
| Sub-schedule deleted | FK cascade removes membership. |
| Sub-schedule archived | Add and remove controls disabled, consistent with existing `isArchived` guards. |
| Unsaved (draft) sub-schedule | Controls disabled — same `isPersistedActiveSubSchedule` guard the cell editor already uses. |
| Member no longer in the caller's scope | Filtered out of the rendered rows by the scoped snapshot; the stored row is left alone. |
| Same employee added twice | Primary key makes it idempotent. |

## 8. Testing

Unit tests for `resolveSubScheduleRowEmployeeIds`, covering: toggle off ignores members; toggle on unions them; duplicates collapse; an assigned employee absent from members still appears; a member with no assignments appears only when the toggle is on.

**Prerequisite.** The suite cannot currently run — there is no `test` script in `package.json`, and `@/` path aliases do not resolve under `node --test` (finding 9 of the code review). This needs fixing first or the tests are decorative. It is a small change and is listed as step 0 of the implementation plan, separable if you would rather not touch it here.

No integration coverage is proposed for the server action; the codebase has no harness for one, and adding it is out of scope.

## 9. Verification

Type check and build must pass. Manual verification in the browser:

1. Enable the toggle on a sub-schedule with workers in month A.
2. Navigate to month B — the same rows appear, cells empty.
3. Enter work in month B, return to A — month A is unchanged.
4. Remove a worker with no work → row disappears, gone from both months.
5. Remove a worker with work in the loaded month → confirm copy names it, row persists, status line explains.
6. Disable the toggle → rows revert to assignment-derived only.
