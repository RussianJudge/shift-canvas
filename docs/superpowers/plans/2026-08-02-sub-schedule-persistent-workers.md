# Sub-Schedule Persistent Worker List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-sub-schedule checkbox that keeps the same worker rows present in every month, so planners stop re-picking staff each month.

**Architecture:** A new `sub_schedule_members` roster table plus a `carry_workers_across_months` flag on `sub_schedules`. The builder's row list becomes the union of month-derived assignees, the persistent roster (when the flag is on), and session-local additions. The union moves out of the 1,313-line panel into a pure, tested function in `lib/sub-schedules.ts`.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript 5.8 (strict), Supabase (service-role client, RLS bypassed), `node --test` for unit tests.

## Global Constraints

- Every server action starts with `requireActionRole([...])` and validates scope with `canAccessScope` before writing. No exceptions.
- All database access goes through `getSupabaseAdminClient()`. Never the anon client.
- The new table gets **no** permissive RLS policy — `enable row level security` with no policy. Do not copy the `to authenticated using (true)` blocks from sibling tables.
- Default state is **off**: `carry_workers_across_months` defaults to `false`, so existing sub-schedules are unchanged.
- Removal is never destructive — it deletes only from `sub_schedule_members`, never from `sub_schedule_assignments`.
- Repo style: no comments unless the *why* is non-obvious. No `any`. No `console.log`.
- Migrations are additive files only. Never edit an existing migration.
- Commits: this repo requires the user's go-ahead before committing. Run the commit steps only once the user has approved.
- `npm test` baseline is 3 tests, all passing. Any failure means you broke something.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `supabase/migrations/202608020001_add_sub_schedule_members.sql` | Roster table + toggle column | Create |
| `lib/types.ts` | `SubSchedule.carryWorkersAcrossMonths`, `SubScheduleMember`, snapshot field, action input type | Modify |
| `lib/data.ts` | Fetch + map `sub_schedule_members` into the snapshot | Modify |
| `lib/sub-schedules.ts` | `resolveSubScheduleRowEmployeeIds` pure function | Modify |
| `tests/sub-schedule-row-employees.test.ts` | Unit tests for the union logic | Create |
| `app/actions.ts` | `saveSubScheduleMembers` action; toggle column in `saveSubSchedules` | Modify |
| `components/sub-schedules-panel.tsx` | Settings checkbox, row union wiring, add/remove persistence, confirm dialog | Modify |
| `package.json` / `tsconfig.json` | Working test runner (Task 0) | Modify |

---

## Task 0: Make the test suite runnable

Currently `npm test` does not exist and `node --test tests/` fails: `@/` path aliases do not resolve, and `.ts` import extensions fail `tsc --noEmit` with TS5097. Without this, Task 2's tests are decorative.

**This task is separable.** If the user chose to skip it, skip Task 2's steps 2 and 4 as well and note the logic ships untested.

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `tests/overtime-swap-assignments.test.ts:11`

**Interfaces:**
- Consumes: nothing
- Produces: a working `npm test` command used by every later task

- [ ] **Step 1: Install the TypeScript-aware loader**

```bash
npm install --save-dev tsx
```

`tsx` resolves `tsconfig.json` `paths`, which is what `node --test` cannot do on its own.

- [ ] **Step 2: Add the test script**

In `package.json`, add to `"scripts"`:

```json
"test": "node --import tsx --test tests/*.test.ts"
```

- [ ] **Step 3: Allow .ts import extensions in the type checker**

In `tsconfig.json`, add to `compilerOptions` (valid because `noEmit: true` is already set):

```json
"allowImportingTsExtensions": true,
```

- [ ] **Step 4: Fix the stale test fixture**

`tests/overtime-swap-assignments.test.ts` omits `targetScheduleId`, which `buildSwapOvertimeAssignmentRows` now requires. At line 11, change the call argument to include it:

```ts
  const rows = buildSwapOvertimeAssignmentRows({
    claimantEmployeeId: "emp-ot",
    claimedCompetencyId: "comp-post-12",
    coverageCompetencyId: "comp-post-1",
    swapEmployeeId: "emp-team",
    dates,
    targetScheduleId: "schedule-601",
    shiftKindForDate: () => "DAY",
  });
```

- [ ] **Step 5: Verify the suite runs green**

Run: `npm test`
Expected: 4 tests, 4 pass, 0 fail.

Run: `npx tsc --noEmit`
Expected: no output (all 4 pre-existing errors resolved).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json tests/overtime-swap-assignments.test.ts
git commit -m "test: make the node test suite runnable"
```

---

## Task 1: Schema, types, and read path

**Files:**
- Create: `supabase/migrations/202608020001_add_sub_schedule_members.sql`
- Modify: `lib/types.ts:94-100` (`SubSchedule`), `lib/types.ts:207-209` (snapshot), `lib/types.ts:405-410` (`SubScheduleUpdate`)
- Modify: `lib/data.ts:124-132` (`SubScheduleRow`), `lib/data.ts:656-673` (`mapSubSchedules`), `lib/data.ts:1822-1870` (`getSubSchedulesSnapshot`)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `SubSchedule.carryWorkersAcrossMonths: boolean`
  - `SubScheduleMember { subScheduleId: string; employeeId: string }` extending `OrganizationScope`
  - `SchedulerSnapshot.subScheduleMembers: SubScheduleMember[]`
  - `SubScheduleUpdate.carryWorkersAcrossMonths: boolean`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/202608020001_add_sub_schedule_members.sql`:

```sql
alter table public.sub_schedules
add column if not exists carry_workers_across_months boolean not null default false;

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

Do **not** add a `create policy ... using (true)` block. The app reads this table only through the service-role client, which bypasses RLS; leaving it policy-free keeps it off the blanket-grant surface the sibling tables have.

- [ ] **Step 2: Add the types**

In `lib/types.ts`, extend `SubSchedule` (line 94):

```ts
export interface SubSchedule extends OrganizationScope {
  id: string;
  name: string;
  summaryTimeCodeId: string;
  isArchived: boolean;
  competencyIds: string[];
  carryWorkersAcrossMonths: boolean;
}
```

Add after `SubScheduleAssignment`:

```ts
export interface SubScheduleMember extends OrganizationScope {
  subScheduleId: string;
  employeeId: string;
}
```

Add to the snapshot interface at line 207, beside `subScheduleAssignments`:

```ts
  subScheduleMembers: SubScheduleMember[];
```

Extend `SubScheduleUpdate` (line 405):

```ts
export interface SubScheduleUpdate {
  subScheduleId: string;
  name: string;
  summaryTimeCodeId: string;
  isArchived: boolean;
  carryWorkersAcrossMonths: boolean;
}
```

Add the new action input beside `SaveSubScheduleCompetenciesInput` (line 420):

```ts
export interface SaveSubScheduleMembersInput {
  subScheduleId: string;
  employeeIds: string[];
}
```

- [ ] **Step 3: Add the row type and mapper**

In `lib/data.ts`, extend `SubScheduleRow` (line 124) with `carry_workers_across_months: boolean;` and add beside `SubScheduleCompetencyRow`:

```ts
type SubScheduleMemberRow = {
  sub_schedule_id: string;
  employee_id: string;
  company_id: string;
  site_id: string;
  business_area_id: string;
};
```

Update `mapSubSchedules` (line 656) to carry the flag through — add to the returned object:

```ts
    carryWorkersAcrossMonths: row.carry_workers_across_months,
```

Add a mapper beside `mapSubScheduleAssignments`:

```ts
function mapSubScheduleMembers(rows: SubScheduleMemberRow[]) {
  return rows.map<SubScheduleMember>((row) => ({
    subScheduleId: row.sub_schedule_id,
    employeeId: row.employee_id,
    companyId: row.company_id,
    siteId: row.site_id,
    businessAreaId: row.business_area_id,
  }));
}
```

Import `SubScheduleMember` from `@/lib/types` in the existing type import block.

- [ ] **Step 4: Fetch members in the snapshot**

In `getSubSchedulesSnapshot` (line 1822), add `carry_workers_across_months` to the `sub_schedules` select, then add a sixth entry to the `Promise.all` array immediately after the `sub_schedule_competencies` fetch:

```ts
      applySessionScope(
        supabase
          .from("sub_schedule_members")
          .select("sub_schedule_id, employee_id, company_id, site_id, business_area_id"),
        session,
      ),
```

Destructure it as `subScheduleMembersResult` and include `subScheduleMembers: mapSubScheduleMembers((subScheduleMembersResult.data as SubScheduleMemberRow[] | null) ?? [])` in the returned snapshot object.

Then find every other construction site of the snapshot shape — `emptySnapshot` and any demo-data builder in `lib/demo-data.ts` — and add `subScheduleMembers: []` so the type stays satisfied.

- [ ] **Step 5: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no output. If it reports a missing `subScheduleMembers` property, add it to whichever snapshot constructor it names.

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 6: Apply the migration**

```bash
npx supabase db push
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/202608020001_add_sub_schedule_members.sql lib/types.ts lib/data.ts
git commit -m "feat: add sub-schedule member roster schema and read path"
```

---

## Task 2: Row-resolution logic

**Files:**
- Modify: `lib/sub-schedules.ts`
- Create: `tests/sub-schedule-row-employees.test.ts`

**Interfaces:**
- Consumes: nothing (pure function, no imports from Task 1)
- Produces: `resolveSubScheduleRowEmployeeIds(input): string[]` — consumed by Task 5

- [ ] **Step 1: Write the failing test**

Create `tests/sub-schedule-row-employees.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { resolveSubScheduleRowEmployeeIds } from "../lib/sub-schedules.ts";

test("members are ignored when the carry-forward toggle is off", () => {
  const result = resolveSubScheduleRowEmployeeIds({
    assignedEmployeeIds: ["emp-a"],
    memberEmployeeIds: ["emp-b"],
    addedEmployeeIds: [],
    carryWorkersAcrossMonths: false,
  });

  assert.deepEqual(result, ["emp-a"]);
});

test("members are included when the carry-forward toggle is on", () => {
  const result = resolveSubScheduleRowEmployeeIds({
    assignedEmployeeIds: ["emp-a"],
    memberEmployeeIds: ["emp-b"],
    addedEmployeeIds: [],
    carryWorkersAcrossMonths: true,
  });

  assert.deepEqual(result.sort(), ["emp-a", "emp-b"]);
});

test("an employee present in several sources appears once", () => {
  const result = resolveSubScheduleRowEmployeeIds({
    assignedEmployeeIds: ["emp-a"],
    memberEmployeeIds: ["emp-a"],
    addedEmployeeIds: ["emp-a"],
    carryWorkersAcrossMonths: true,
  });

  assert.deepEqual(result, ["emp-a"]);
});

test("assigned employees still appear after being removed from the roster", () => {
  const result = resolveSubScheduleRowEmployeeIds({
    assignedEmployeeIds: ["emp-a"],
    memberEmployeeIds: [],
    addedEmployeeIds: [],
    carryWorkersAcrossMonths: true,
  });

  assert.deepEqual(result, ["emp-a"]);
});

test("session additions appear regardless of the toggle", () => {
  const result = resolveSubScheduleRowEmployeeIds({
    assignedEmployeeIds: [],
    memberEmployeeIds: [],
    addedEmployeeIds: ["emp-c"],
    carryWorkersAcrossMonths: false,
  });

  assert.deepEqual(result, ["emp-c"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `resolveSubScheduleRowEmployeeIds` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `lib/sub-schedules.ts`:

```ts
export function resolveSubScheduleRowEmployeeIds(input: {
  assignedEmployeeIds: string[];
  memberEmployeeIds: string[];
  addedEmployeeIds: string[];
  carryWorkersAcrossMonths: boolean;
}) {
  return Array.from(
    new Set([
      ...input.assignedEmployeeIds,
      ...(input.carryWorkersAcrossMonths ? input.memberEmployeeIds : []),
      ...input.addedEmployeeIds,
    ]),
  );
}
```

Keeping `assignedEmployeeIds` unconditional is what makes roster removal non-destructive — anyone with real work in the loaded month keeps their row.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: 8 tests, 8 pass.

- [ ] **Step 5: Commit**

```bash
git add lib/sub-schedules.ts tests/sub-schedule-row-employees.test.ts
git commit -m "feat: add sub-schedule row employee resolution"
```

---

## Task 3: The `saveSubScheduleMembers` server action

**Files:**
- Modify: `app/actions.ts` (add after `saveSubScheduleCompetencies`, which ends at line 5669)

**Interfaces:**
- Consumes: `SaveSubScheduleMembersInput` from Task 1
- Produces: `saveSubScheduleMembers(input): Promise<{ ok: boolean; message: string }>` — consumed by Task 5

- [ ] **Step 1: Write the action**

Add `SaveSubScheduleMembersInput` to the type import block at the top of `app/actions.ts`, then add after `saveSubScheduleCompetencies`:

```ts
/** Persists the persistent worker roster for one sub-schedule. */
export async function saveSubScheduleMembers(input: SaveSubScheduleMembersInput) {
  const session = await requireActionRole(["admin", "leader"]);

  if (!session) {
    return {
      ok: false,
      message: "Only admins or leaders can change sub-schedule workers.",
    };
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return {
      ok: false,
      message: "Supabase is not configured yet. Sub-schedule workers are unavailable.",
    };
  }

  const subScheduleResult = await supabase
    .from("sub_schedules")
    .select("id, is_archived, company_id, site_id, business_area_id")
    .eq("id", input.subScheduleId)
    .maybeSingle();

  const subSchedule = subScheduleResult.data as ({ id: string; is_archived: boolean } & ScopedDatabaseRow) | null;

  if (subScheduleResult.error || !subSchedule) {
    return {
      ok: false,
      message: "Could not resolve the selected sub-schedule.",
    };
  }

  if (!canAccessScope(session, scopeFromRow(subSchedule))) {
    return {
      ok: false,
      message: "You do not have permission to edit that sub-schedule.",
    };
  }

  if (subSchedule.is_archived) {
    return {
      ok: false,
      message: "Archived sub-schedules are read-only.",
    };
  }

  const employeeIds = Array.from(new Set(input.employeeIds.filter(Boolean)));
  const employeeRowsResult =
    employeeIds.length > 0
      ? await supabase
          .from("employees")
          .select("id, company_id, site_id, business_area_id")
          .in("id", employeeIds)
      : { data: [], error: null };

  const employeeRows = (employeeRowsResult.data as Array<{ id: string } & ScopedDatabaseRow> | null) ?? [];

  if (employeeRowsResult.error || employeeRows.length !== employeeIds.length) {
    return {
      ok: false,
      message: "Could not resolve one or more selected workers.",
    };
  }

  for (const row of employeeRows) {
    if (!canAccessScope(session, scopeFromRow(row))) {
      return {
        ok: false,
        message: "You do not have permission to add one or more of those workers.",
      };
    }
  }

  const subScheduleScope = scopeFromRow(subSchedule);

  const { error: deleteError } = await supabase
    .from("sub_schedule_members")
    .delete()
    .eq("sub_schedule_id", input.subScheduleId);

  if (deleteError) {
    return {
      ok: false,
      message: `Could not clear existing sub-schedule workers: ${deleteError.message}`,
    };
  }

  if (employeeIds.length > 0) {
    const { error: insertError } = await supabase.from("sub_schedule_members").insert(
      employeeIds.map((employeeId) => ({
        sub_schedule_id: input.subScheduleId,
        employee_id: employeeId,
        ...toDatabaseScope(subScheduleScope),
      })),
    );

    if (insertError) {
      return {
        ok: false,
        message: `Could not save sub-schedule workers: ${insertError.message}`,
      };
    }
  }

  revalidatePath("/sub-schedules");

  return {
    ok: true,
    message: "Sub-schedule workers saved.",
  };
}
```

The `canAccessScope` loop over `employeeRows` is mandatory. Without it a leader could attach another site's employee to their own sub-schedule — this action writes as service role, so RLS will not catch it.

- [ ] **Step 2: Carry the toggle through the definitions save**

In `saveSubSchedules`, add the column to the upsert rows (around line 5328):

```ts
  const rows = input.updates.map((update) => ({
    id: update.subScheduleId,
    name: update.name.trim(),
    summary_time_code_id: update.summaryTimeCodeId,
    is_archived: update.isArchived,
    carry_workers_across_months: update.carryWorkersAcrossMonths,
    ...toDatabaseScope(sessionScope),
  }));
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add app/actions.ts
git commit -m "feat: add saveSubScheduleMembers action"
```

---

## Task 4: The settings checkbox

**Files:**
- Modify: `components/sub-schedules-panel.tsx:425-437` (settings modal), plus `normalizeSubSchedule` and the local draft type

**Interfaces:**
- Consumes: `SubSchedule.carryWorkersAcrossMonths` (Task 1), `SubScheduleUpdate.carryWorkersAcrossMonths` (Task 1)
- Produces: the toggle value read by Task 5

- [ ] **Step 1: Thread the field through the draft state**

Add `carryWorkersAcrossMonths: boolean;` to the `EditableSubSchedule` type at `components/sub-schedules-panel.tsx:35`, beside its existing `isArchived` field.

Add the field to `normalizeSubSchedule` (line 88):

```tsx
function normalizeSubSchedule(subSchedule: EditableSubSchedule): SubScheduleUpdate {
  return {
    subScheduleId: subSchedule.id,
    name: subSchedule.name.trim(),
    summaryTimeCodeId: subSchedule.summaryTimeCodeId,
    isArchived: subSchedule.isArchived,
    carryWorkersAcrossMonths: subSchedule.carryWorkersAcrossMonths,
  };
}
```

This is required, not cosmetic: `dirtySubScheduleIds` (line 660) compares `JSON.stringify` of normalized objects. If the field is missing here, ticking the checkbox never marks the row dirty and `Save settings` stays disabled.

`cloneSubSchedules` (line 84) is a shallow spread and needs no change. Wherever a new blank sub-schedule draft is constructed in this file, add `carryWorkersAcrossMonths: false`; `npx tsc --noEmit` will name each site if you miss one.

- [ ] **Step 2: Add the checkbox**

In the settings modal, directly after the existing `Active` label (line 425-437):

```tsx
          <label className="subschedule-status-toggle">
            <input
              type="checkbox"
              checked={subSchedule.carryWorkersAcrossMonths}
              disabled={isBusy}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  carryWorkersAcrossMonths: event.target.checked,
                }))
              }
            />
            <span>Keep the same workers every month</span>
          </label>
```

- [ ] **Step 3: Verify in the browser**

Run: `npm run dev`, open `/sub-schedules`, open a sub-schedule's settings.
Expected: the new checkbox appears under `Active`, unchecked. Ticking it enables `Save settings`. Saving, closing, and reopening shows it still ticked.

- [ ] **Step 4: Commit**

```bash
git add components/sub-schedules-panel.tsx
git commit -m "feat: add keep-workers-every-month toggle to sub-schedule settings"
```

---

## Task 5: Builder wiring — rows, add, remove

**Files:**
- Modify: `components/sub-schedules-panel.tsx:767-774` (`rowEmployeeIds`), `:909-921` (`handleAddEmployeeRow`), `:1144-1150` (row cell render)

**Interfaces:**
- Consumes: `resolveSubScheduleRowEmployeeIds` (Task 2), `saveSubScheduleMembers` (Task 3), `snapshot.subScheduleMembers` (Task 1)
- Produces: nothing downstream

- [ ] **Step 1: Use the resolver for row ids**

Import `resolveSubScheduleRowEmployeeIds` from `@/lib/sub-schedules`, then derive the member ids for the active sub-schedule and replace `rowEmployeeIds` (line 767):

```tsx
  const memberEmployeeIds = useMemo(
    () =>
      activeSubSchedule
        ? snapshot.subScheduleMembers
            .filter((member) => member.subScheduleId === activeSubSchedule.id)
            .map((member) => member.employeeId)
        : [],
    [activeSubSchedule, snapshot.subScheduleMembers],
  );
  const rowEmployeeIds = useMemo(
    () =>
      resolveSubScheduleRowEmployeeIds({
        assignedEmployeeIds,
        memberEmployeeIds,
        addedEmployeeIds,
        carryWorkersAcrossMonths: activeSubSchedule?.carryWorkersAcrossMonths ?? false,
      }).sort((left, right) => {
        const leftName = employeeMap[left]?.name ?? left;
        const rightName = employeeMap[right]?.name ?? right;
        return leftName.localeCompare(rightName);
      }),
    [activeSubSchedule, addedEmployeeIds, assignedEmployeeIds, employeeMap, memberEmployeeIds],
  );
```

- [ ] **Step 2: Persist additions when the toggle is on**

Replace `handleAddEmployeeRow` (line 909):

```tsx
  function handleAddEmployeeRow() {
    const employeeId = employeeToAddId;

    if (!employeeId) {
      return;
    }

    setAddedEmployeeIds((current) =>
      current.includes(employeeId) ? current : [...current, employeeId],
    );
    setEmployeeToAddId("");
    setIsEmployeePickerOpen(false);
    setAssignmentMessage("");

    if (!activeSubSchedule?.carryWorkersAcrossMonths) {
      return;
    }

    const nextMemberIds = Array.from(new Set([...memberEmployeeIds, employeeId]));

    startAssignmentSaveTransition(async () => {
      const result = await saveSubScheduleMembers({
        subScheduleId: activeSubSchedule.id,
        employeeIds: nextMemberIds,
      });

      if (!result.ok) {
        setAssignmentMessage(result.message);
        return;
      }

      router.refresh();
    });
  }
```

Import `saveSubScheduleMembers` from `@/app/actions` in the existing action import block.

- [ ] **Step 3: Add the remove handler with the confirm dialog**

Add beside `handleAddEmployeeRow`:

```tsx
  function handleRemoveEmployeeRow(employeeId: string) {
    if (!activeSubSchedule) {
      return;
    }

    const employeeName = employeeMap[employeeId]?.name ?? "this worker";
    const hasWorkThisMonth = assignedEmployeeIds.includes(employeeId);
    const message = hasWorkThisMonth
      ? `Remove ${employeeName} from this sub-schedule's monthly list? They have work assigned in ${formatMonthLabel(
          snapshot.month,
        )}, so their row stays visible here. This only stops them carrying forward to months where they have none.`
      : `Remove ${employeeName} from this sub-schedule's monthly list? They will stop appearing automatically in new months. You can add them back at any time.`;

    if (typeof window !== "undefined" && !window.confirm(message)) {
      return;
    }

    setAddedEmployeeIds((current) => current.filter((id) => id !== employeeId));

    startAssignmentSaveTransition(async () => {
      const result = await saveSubScheduleMembers({
        subScheduleId: activeSubSchedule.id,
        employeeIds: memberEmployeeIds.filter((id) => id !== employeeId),
      });

      if (!result.ok) {
        setAssignmentMessage(result.message);
        return;
      }

      setAssignmentMessage(
        hasWorkThisMonth
          ? "Removed from the monthly list — still shown here because they have work this month."
          : "",
      );
      router.refresh();
    });
  }
```

- [ ] **Step 4: Add the remove button to the row**

In the sticky employee cell (line 1144), add the button after the `employee-cell__main` div:

```tsx
                    <div key={`sub-row-${employeeId}`} className="employee-cell sticky-column">
                      <div className="employee-cell__main">
                        <strong>{employee.name}</strong>
                        <span>{homeSchedule?.name ?? "Unassigned"}</span>
                      </div>
                      {activeSubSchedule.carryWorkersAcrossMonths ? (
                        <button
                          type="button"
                          className="table-action table-action--danger"
                          aria-label={`Remove ${employee.name}`}
                          disabled={!isPersistedActiveSubSchedule || activeSubSchedule.isArchived}
                          onClick={() => handleRemoveEmployeeRow(employee.id)}
                        >
                          ×
                        </button>
                      ) : null}
                    </div>,
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` — expected: no output.
Run: `npm test` — expected: 8 pass.
Run: `npm run build` — expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add components/sub-schedules-panel.tsx
git commit -m "feat: carry sub-schedule workers across months"
```

---

## Task 6: End-to-end verification

**Files:** none modified — this is a manual gate.

**Interfaces:**
- Consumes: everything above
- Produces: confidence the feature works in the real app

- [ ] **Step 1: Run the full check set**

```bash
npm test && npx tsc --noEmit && npm run build
```

Expected: 8 tests pass, no type errors, build exit 0.

- [ ] **Step 2: Walk the flow in the browser**

Start `npm run dev`, open `/sub-schedules`, and confirm each:

1. Pick a sub-schedule with workers in the current month. Open settings — "Keep the same workers every month" is **unchecked**.
2. Tick it, save. Navigate to the next month — the same worker rows appear with empty cells.
3. Enter work in the new month, navigate back — the original month is unchanged.
4. Remove a worker who has no work → confirm dialog shows the "stop appearing automatically" copy; the row disappears in both months.
5. Remove a worker who has work this month → confirm dialog names the month; the row **stays**; the status line explains why.
6. Untick the toggle → rows revert to assignment-derived only, and the `×` buttons disappear.
7. Archive the sub-schedule → add and remove controls are disabled.

- [ ] **Step 3: Confirm the security check holds**

The roster action must reject out-of-scope employees. With no second tenant available locally this is a code-read verification: confirm `saveSubScheduleMembers` contains the `canAccessScope` loop over `employeeRows` and that it runs *before* any write.

---

## Self-Review

**Spec coverage:** §1 schema → Task 1. §2 read path → Task 1. §3 server action → Task 3. §4 row logic → Task 2. §5 UI → Tasks 4 and 5. §6 removal semantics + confirm → Task 5 steps 3-4. §7 edge cases → covered by the archived/persisted guards in Tasks 4-5 and the FK cascades in Task 1. §8 testing → Tasks 0 and 2. §9 verification → Task 6.

**Placeholders:** none — every code step contains the actual code.

**Type consistency:** `resolveSubScheduleRowEmployeeIds` has the same four-field input in Task 2's test, Task 2's implementation, and Task 5's call site. `saveSubScheduleMembers` takes `{ subScheduleId, employeeIds }` in Task 1's type, Task 3's definition, and both Task 5 call sites. `carryWorkersAcrossMonths` is spelled identically in Tasks 1, 3, 4, and 5.
