"use server";

import { revalidatePath } from "next/cache";

import type {
  AppRole,
  ApplyToMutualPostingInput,
  CancelAcceptedMutualInput,
  ClaimOvertimePostingInput,
  CreateMutualPostingInput,
  AcceptMutualApplicationInput,
  ReleaseOvertimePostingInput,
  SaveAssignmentsInput,
  SaveCompetenciesInput,
  SavePersonnelInput,
  SaveSchedulesInput,
  SaveTimeCodesInput,
  SetScheduleCompletionInput,
  ShiftKind,
  WithdrawMutualApplicationInput,
  WithdrawMutualPostingInput,
} from "@/lib/types";
import { getSchedulerSnapshot } from "@/lib/data";
import {
  buildOvertimeAssignmentNote,
  buildSwapOvertimeAssignmentRows,
  parseOvertimeAssignmentNote,
  type OvertimeAssignmentRow,
} from "@/lib/overtime";
import {
  buildAcceptedMutualAssignmentRows,
  parseMutualAssignmentNote,
  type MutualAssignmentRow,
} from "@/lib/mutuals";
import {
  buildAssignmentIndex,
  createSetRangeKey,
  getEmployeeMap,
  getExtendedMonthDays,
  getMonthDays,
  getMonthKeysForDateRange,
  getScheduleById,
  getWorkedSetDays,
  shiftForDate,
} from "@/lib/scheduling";
import { getAppSession } from "@/lib/auth";
import { getSupabaseAdminClient } from "@/lib/supabase";
type SupabaseAdminClient = NonNullable<ReturnType<typeof getSupabaseAdminClient>>;
type ActionScope = { companyId: string; siteId: string; businessAreaId: string };
type ScopedDatabaseRow = { company_id: string; site_id: string; business_area_id: string };

/**
 * Main server action layer for the app.
 *
 * This file owns every persisted edit path:
 * - schedule cell updates
 * - completed-set toggles
 * - overtime claim / release
 * - admin maintenance screens
 * - per-user schedule pin storage
 *
 * The actions deliberately centralize validation and side effects so the client
 * components can stay focused on interaction state.
 */
/** Small normalization helper used by many validation checks in this file. */
function isBlank(value: string) {
  return value.trim().length === 0;
}

/** Reusable shift-pattern validation shared by schedule editing actions. */
function hasValidShiftPattern(dayShiftDays: number, nightShiftDays: number, offDays: number) {
  return [dayShiftDays, nightShiftDays, offDays].every((value) => Number.isInteger(value) && value >= 0) &&
    dayShiftDays + nightShiftDays + offDays > 0;
}

/** Converts a scoped session into the database column payload used on inserts. */
function toDatabaseScope(scope: ActionScope) {
  return {
    company_id: scope.companyId,
    site_id: scope.siteId,
    business_area_id: scope.businessAreaId,
  };
}

/** Pulls the required company/site/business-area ids out of the signed session. */
function getSessionScope(session: Awaited<ReturnType<typeof getAppSession>>): ActionScope | null {
  if (!session?.companyId || !session.siteId || !session.businessAreaId) {
    return null;
  }

  return {
    companyId: session.companyId,
    siteId: session.siteId,
    businessAreaId: session.businessAreaId,
  };
}

/** Normalizes a scoped row from Supabase into the app-side scope shape. */
function scopeFromRow(row: ScopedDatabaseRow): ActionScope {
  return {
    companyId: row.company_id,
    siteId: row.site_id,
    businessAreaId: row.business_area_id,
  };
}

/** Company-wide admins pass on company match; others must match the exact business area. */
function canAccessScope(
  session: Awaited<ReturnType<typeof getAppSession>>,
  scope: ActionScope,
) {
  if (!session?.companyId) {
    return false;
  }

  if (session.role === "admin") {
    return session.companyId === scope.companyId;
  }

  return (
    session.companyId === scope.companyId &&
    session.siteId === scope.siteId &&
    session.businessAreaId === scope.businessAreaId
  );
}

/**
 * When an overtime claim is removed, this restores any on-team worker who had
 * been moved as part of a swap workflow back to their original competency.
 */
async function restoreSwappedAssignmentsForClaims(
  supabase: SupabaseAdminClient,
  claims: Array<{ employeeId: string; competencyId: string; date: string }>,
) {
  if (claims.length === 0) {
    return { ok: true as const };
  }

  const groupedClaims = claims.reduce<Record<string, { employeeId: string; competencyId: string; dates: string[] }>>(
    (map, claim) => {
      const key = `${claim.employeeId}:${claim.competencyId}`;
      map[key] ??= {
        employeeId: claim.employeeId,
        competencyId: claim.competencyId,
        dates: [],
      };
      map[key].dates.push(claim.date);
      return map;
    },
    {},
  );

  for (const group of Object.values(groupedClaims)) {
    const notePrefix = `OT|claimant:${group.employeeId}|claim:${group.competencyId}|`;
    const { data, error } = await supabase
      .from("schedule_assignments")
      .select("employee_id, assignment_date, notes, shift_kind, company_id, site_id, business_area_id")
      .in("assignment_date", group.dates)
      .like("notes", `${notePrefix}%`);

    if (error) {
      return {
        ok: false as const,
        message: `Could not restore swapped overtime assignments: ${error.message}`,
      };
    }

    const restoreRows = ((data as Array<{
      employee_id: string;
      assignment_date: string;
      notes: string | null;
      shift_kind: ShiftKind;
      company_id: string;
      site_id: string;
      business_area_id: string;
    }> | null) ?? [])
      .flatMap((row) => {
        const parsed = parseOvertimeAssignmentNote(row.notes);

        if (
          row.employee_id === group.employeeId ||
          !parsed.originalCompetencyId
        ) {
          return [];
        }

        return [
          {
            employee_id: row.employee_id,
            assignment_date: row.assignment_date,
            competency_id: parsed.originalCompetencyId,
            time_code_id: null,
            notes: null,
            shift_kind: row.shift_kind,
            company_id: row.company_id,
            site_id: row.site_id,
            business_area_id: row.business_area_id,
          } satisfies OvertimeAssignmentRow,
        ];
      });

    if (restoreRows.length === 0) {
      continue;
    }

    const { error: restoreError } = await supabase.from("schedule_assignments").upsert(restoreRows, {
      onConflict: "employee_id,assignment_date",
    });

    if (restoreError) {
      return {
        ok: false as const,
        message: `Could not restore swapped overtime assignments: ${restoreError.message}`,
      };
    }
  }

  return { ok: true as const };
}

/**
 * Clears the claimant's overtime-generated rows. We remove by note metadata
 * first so releases still work even if the visible competency changed as part
 * of a swap path.
 */
async function clearClaimantAssignmentsForClaims(
  supabase: SupabaseAdminClient,
  claims: Array<{ employeeId: string; competencyId: string; date: string }>,
) {
  if (claims.length === 0) {
    return { ok: true as const };
  }

  const groupedClaims = claims.reduce<Record<string, { employeeId: string; competencyId: string; dates: string[] }>>(
    (map, claim) => {
      const key = `${claim.employeeId}:${claim.competencyId}`;
      map[key] ??= {
        employeeId: claim.employeeId,
        competencyId: claim.competencyId,
        dates: [],
      };
      map[key].dates.push(claim.date);
      return map;
    },
    {},
  );

  for (const group of Object.values(groupedClaims)) {
    const notePrefix = `OT|claimant:${group.employeeId}|claim:${group.competencyId}|`;

    const noteDeleteResults = await Promise.all(
      group.dates.map((date) =>
        supabase
          .from("schedule_assignments")
          .delete()
          .eq("employee_id", group.employeeId)
          .eq("assignment_date", date)
          .like("notes", `${notePrefix}%`),
      ),
    );
    const noteDeleteError = noteDeleteResults.find((result) => result.error)?.error;

    if (noteDeleteError) {
      return {
        ok: false as const,
        message: `Could not clear overtime assignments: ${noteDeleteError.message}`,
      };
    }

    const fallbackDeleteResults = await Promise.all(
      group.dates.map((date) =>
        supabase
          .from("schedule_assignments")
          .delete()
          .eq("employee_id", group.employeeId)
          .eq("assignment_date", date)
          .eq("competency_id", group.competencyId),
      ),
    );
    const fallbackDeleteError = fallbackDeleteResults.find((result) => result.error)?.error;

    if (fallbackDeleteError) {
      return {
        ok: false as const,
        message: `Could not clear overtime assignments: ${fallbackDeleteError.message}`,
      };
    }
  }

  return { ok: true as const };
}

/** Shared role gate for server actions. Returns null instead of redirecting. */
async function requireActionRole(allowedRoles: AppRole[]) {
  const session = await getAppSession();

  if (!session || !allowedRoles.includes(session.role)) {
    return null;
  }

  return session;
}

/** Removes blanks, de-duplicates dates, and sorts them into stable order. */
function uniqueSortedDates(dates: string[]) {
  return Array.from(new Set(dates.filter(Boolean))).sort();
}

/** Resolves what kind of worked shift a schedule has on each requested date. */
function getWorkedShiftKindsForDates(
  schedule: NonNullable<ReturnType<typeof getScheduleById>>,
  dates: string[],
) {
  return dates.map((date) => shiftForDate(schedule, date));
}

/**
 * Recalculates OT claims after a scheduling change.
 *
 * Claims that still fit the staffing requirements are kept. Claims that no
 * longer represent a real shortage are released and their derived schedule rows
 * are removed/restored.
 */
async function removeStaleOvertimeClaims(
  supabase: SupabaseAdminClient,
  months: string[],
  session: Awaited<ReturnType<typeof getAppSession>> | null,
  forcedRanges: Array<{ scheduleId: string; startDate: string; endDate: string }> = [],
) {
  const uniqueMonths = Array.from(new Set(months.filter(Boolean)));
  let removedClaims = 0;

  for (const month of uniqueMonths) {
    const snapshot = await getSchedulerSnapshot(month, session);
    const assignmentIndex = buildAssignmentIndex(snapshot.assignments);
    const monthDays = getMonthDays(month);
    const completedDateKeys = snapshot.completedSets.reduce<Set<string>>((set, completedSet) => {
      for (const day of monthDays) {
        if (day.date >= completedSet.startDate && day.date <= completedSet.endDate) {
          set.add(`${completedSet.scheduleId}:${day.date}`);
        }
      }

      return set;
    }, new Set<string>());
    const claimsByCoverageKey = snapshot.overtimeClaims.reduce<Record<string, typeof snapshot.overtimeClaims>>(
      (map, claim) => {
        const key = `${claim.scheduleId}:${claim.competencyId}:${claim.date}`;
        map[key] ??= [];
        map[key].push(claim);
        return map;
      },
      {},
    );
    const claimsToRemove = snapshot.schedules.flatMap((schedule) =>
      monthDays.flatMap((day) => {
        if (shiftForDate(schedule, day.date) === "OFF") {
          return [];
        }

        return snapshot.competencies.flatMap((competency) => {
          const claims =
            claimsByCoverageKey[`${schedule.id}:${competency.id}:${day.date}`]
              ?.slice()
              .sort((left, right) => left.id.localeCompare(right.id)) ?? [];

          if (claims.length === 0) {
            return [];
          }

          const isForceEvaluated = forcedRanges.some(
            (range) =>
              range.scheduleId === schedule.id &&
              day.date >= range.startDate &&
              day.date <= range.endDate,
          );

          if (!isForceEvaluated && !completedDateKeys.has(`${schedule.id}:${day.date}`)) {
            return [];
          }

          const regularFilled = schedule.employees.reduce((count, employee) => {
            const selection = assignmentIndex[`${employee.id}:${day.date}`];
            return count + Number(selection?.competencyId === competency.id);
          }, 0);
          const allowedClaims = Math.max(0, competency.requiredStaff - regularFilled);

          return claims.slice(allowedClaims);
        });
      }),
    );

    if (claimsToRemove.length === 0) {
      continue;
    }

    const restoreResult = await restoreSwappedAssignmentsForClaims(
      supabase,
      claimsToRemove.map((claim) => ({
        employeeId: claim.employeeId,
        competencyId: claim.competencyId,
        date: claim.date,
      })),
    );

    if (!restoreResult.ok) {
      return {
        ok: false as const,
        message: restoreResult.message,
        removedClaims,
      };
    }

    const claimIds = claimsToRemove.map((claim) => claim.id);
    const { error: claimDeleteError } = await supabase.from("overtime_claims").delete().in("id", claimIds);

    if (claimDeleteError) {
      return {
        ok: false as const,
        message: `Assignments saved, but overtime cleanup failed: ${claimDeleteError.message}`,
        removedClaims,
      };
    }

    const clearAssignmentsResult = await clearClaimantAssignmentsForClaims(
      supabase,
      claimsToRemove.map((claim) => ({
        employeeId: claim.employeeId,
        competencyId: claim.competencyId,
        date: claim.date,
      })),
    );

    if (!clearAssignmentsResult.ok) {
      return {
        ok: false as const,
        message: `Assignments saved, but overtime cleanup failed: ${clearAssignmentsResult.message}`,
        removedClaims,
      };
    }

    removedClaims += claimsToRemove.length;
  }

  return {
    ok: true as const,
    removedClaims,
  };
}

/**
 * Persists scheduler cell edits for a month window.
 *
 * The action upserts non-empty cells, deletes cleared cells, and then
 * immediately re-evaluates overtime so the downstream overtime board does not
 * drift from the new staffing picture.
 */
export async function saveAssignments(input: SaveAssignmentsInput) {
  const session = await requireActionRole(["admin", "leader"]);

  if (!session) {
    return {
      ok: false,
      message: "You do not have permission to change schedule assignments.",
    };
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return {
      ok: false,
      message:
        "Supabase is not configured yet. Your draft is still available locally in this browser.",
    };
  }

  const sessionScope = getSessionScope(session);

  if (!sessionScope) {
    return {
      ok: false,
      message: "Your organizational scope is incomplete. Ask an admin to update your profile.",
    };
  }

  const scopeMonth = input.updates[0]?.date.slice(0, 7);
  const scopedSnapshot = scopeMonth ? await getSchedulerSnapshot(scopeMonth, session) : null;
  const scopedEmployeeMap = scopedSnapshot ? getEmployeeMap(scopedSnapshot.schedules) : {};

  const rowsToUpsert = input.updates
    .filter((update) => update.competencyId || update.timeCodeId)
    .map((update) => {
      const employee = scopedEmployeeMap[update.employeeId];
      const rowScope = employee
        ? {
            companyId: employee.companyId ?? sessionScope.companyId,
            siteId: employee.siteId ?? sessionScope.siteId,
            businessAreaId: employee.businessAreaId ?? sessionScope.businessAreaId,
          }
        : sessionScope;

      return {
        employee_id: update.employeeId,
        assignment_date: update.date,
        competency_id: update.competencyId,
        time_code_id: update.timeCodeId,
        notes: update.notes ?? null,
        shift_kind: update.shiftKind,
        ...toDatabaseScope(rowScope),
      };
    });

  const rowsToDelete = input.updates
    .filter((update) => !update.competencyId && !update.timeCodeId)
    .map((update) => ({
      employee_id: update.employeeId,
      assignment_date: update.date,
    }));

  if (rowsToUpsert.length > 0) {
    const { error } = await supabase.from("schedule_assignments").upsert(rowsToUpsert, {
      onConflict: "employee_id,assignment_date",
    });

    if (error) {
      return {
        ok: false,
        message: `Could not save assignments: ${error.message}`,
      };
    }
  }

  if (rowsToDelete.length > 0) {
    const deleteResults = await Promise.all(
      rowsToDelete.map((row) =>
        supabase
          .from("schedule_assignments")
          .delete()
          .eq("employee_id", row.employee_id)
          .eq("assignment_date", row.assignment_date),
      ),
    );

    const firstDeleteError = deleteResults.find((result) => result.error)?.error;

    if (firstDeleteError) {
      return {
        ok: false,
        message: `Could not clear assignments: ${firstDeleteError.message}`,
      };
    }
  }

  const cleanupResult = await removeStaleOvertimeClaims(
    supabase,
    input.updates.map((update) => update.date.slice(0, 7)),
    session,
  );

  revalidatePath("/schedule");
  revalidatePath("/overtime");

  return {
    ok: true,
    message: cleanupResult.ok
      ? cleanupResult.removedClaims > 0
        ? `Assignments saved. Removed ${cleanupResult.removedClaims} overtime claim${cleanupResult.removedClaims === 1 ? "" : "s"} that were no longer needed.`
        : "Assignments saved to Supabase."
      : cleanupResult.message,
  };
}

/**
 * Stores the current user's pinned rows for one shift in Supabase so the
 * preference survives refreshes and device changes.
 */
export async function saveSchedulePins(input: {
  scheduleId: string;
  pinnedEmployeeIds: string[];
}) {
  const session = await requireActionRole(["admin", "leader", "worker"]);

  if (!session) {
    return {
      ok: false,
      message: "You do not have permission to save pinned workers.",
    };
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return {
      ok: false,
      message: "Supabase is not configured yet. Pins could not be saved.",
    };
  }

  const sessionScope = getSessionScope(session);

  if (!sessionScope) {
    return {
      ok: false,
      message: "Your organizational scope is incomplete. Ask an admin to update your profile.",
    };
  }

  const scheduleResult = await supabase
    .from("schedules")
    .select("id, company_id, site_id, business_area_id")
    .eq("id", input.scheduleId)
    .maybeSingle();

  const scheduleScopeRow = scheduleResult.data as ({ id: string } & ScopedDatabaseRow) | null;

  if (scheduleResult.error || !scheduleScopeRow) {
    return {
      ok: false,
      message: "Could not resolve the selected shift for pinning.",
    };
  }

  const scheduleScope = scopeFromRow(scheduleScopeRow);

  if (!canAccessScope(session, scheduleScope)) {
    return {
      ok: false,
      message: "You do not have permission to save pins for that shift.",
    };
  }

  const profileResult = await supabase
    .from("profiles")
    .select("id")
    .eq("email", session.email)
    .maybeSingle();

  const userId = (profileResult.data as { id: string } | null)?.id;

  if (profileResult.error || !userId) {
    return {
      ok: false,
      message: "Could not resolve the signed-in user profile for pinning.",
    };
  }

  const { error: deleteError } = await supabase
    .from("user_schedule_pins")
    .delete()
    .eq("user_id", userId)
    .eq("schedule_id", input.scheduleId);

  if (deleteError) {
    return {
      ok: false,
      message: `Could not clear existing pins: ${deleteError.message}`,
    };
  }

  if (input.pinnedEmployeeIds.length > 0) {
    const rows = input.pinnedEmployeeIds.map((employeeId, index) => ({
      user_id: userId,
      schedule_id: input.scheduleId,
      employee_id: employeeId,
      sort_order: index,
      ...toDatabaseScope(scheduleScope),
    }));

    const { error: insertError } = await supabase
      .from("user_schedule_pins")
      .insert(rows);

    if (insertError) {
      return {
        ok: false,
        message: `Could not save pinned workers: ${insertError.message}`,
      };
    }
  }

  revalidatePath("/schedule");

  return {
    ok: true,
    message: "Pinned workers saved.",
  };
}

/**
 * Marks a worked set complete or reopens it for edits.
 *
 * Completion state drives overtime publishing, so this action also triggers the
 * overtime recalculation and cleanup flow that keeps the overtime board aligned
 * with the schedule.
 */
export async function setScheduleSetCompletion(input: SetScheduleCompletionInput) {
  const session = await requireActionRole(["admin", "leader"]);

  if (!session) {
    return {
      ok: false,
      message: "You do not have permission to complete sets.",
    };
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return {
      ok: false,
      message: "Supabase is not configured yet. Set completion is unavailable.",
    };
  }

  const scheduleResult = await supabase
    .from("schedules")
    .select("id, company_id, site_id, business_area_id")
    .eq("id", input.scheduleId)
    .maybeSingle();

  const scheduleScopeRow = scheduleResult.data as ({ id: string } & ScopedDatabaseRow) | null;

  if (scheduleResult.error || !scheduleScopeRow) {
    return {
      ok: false,
      message: "Could not resolve that shift for set completion.",
    };
  }

  const scheduleScope = scopeFromRow(scheduleScopeRow);

  if (!canAccessScope(session, scheduleScope)) {
    return {
      ok: false,
      message: "You do not have permission to complete sets for that shift.",
    };
  }

  if (
    isBlank(input.scheduleId) ||
    isBlank(input.startDate) ||
    isBlank(input.endDate)
  ) {
    return {
      ok: false,
      message: "Set completion is missing required details.",
    };
  }

  const touchedMonths = getMonthKeysForDateRange(input.startDate, input.endDate);

  const deleteCompletedSetRows = () =>
    supabase
      .from("completed_sets")
      .delete()
      .eq("schedule_id", input.scheduleId)
      .lte("start_date", input.endDate)
      .gte("end_date", input.startDate);

  if (input.isComplete) {
    const { error: deleteError } = await deleteCompletedSetRows();

    if (deleteError) {
      return {
        ok: false,
        message: `Could not refresh set completion state: ${deleteError.message}`,
      };
    }

    const rows = touchedMonths.map((monthKey) => ({
      schedule_id: input.scheduleId,
      month_key: monthKey,
      start_date: input.startDate,
      end_date: input.endDate,
      ...toDatabaseScope(scheduleScope),
    }));
    const { error } = await supabase.from("completed_sets").upsert(rows, {
      onConflict: "schedule_id,month_key,start_date,end_date",
    });

    if (error) {
      return {
        ok: false,
        message: `Could not mark that set complete: ${error.message}`,
      };
    }

    const cleanupResult = await removeStaleOvertimeClaims(supabase, touchedMonths, session);

    revalidatePath("/schedule");
    revalidatePath("/overtime");

    return {
      ok: true,
      message: cleanupResult.ok
        ? cleanupResult.removedClaims > 0
          ? `Set marked schedule complete. Removed ${cleanupResult.removedClaims} overtime claim${cleanupResult.removedClaims === 1 ? "" : "s"} that were no longer needed.`
          : "Set marked schedule complete."
        : cleanupResult.message,
    };
  } else {
    const { error } = await deleteCompletedSetRows();

    if (error) {
      return {
        ok: false,
        message: `Could not unmark that set: ${error.message}`,
      };
    }

    const cleanupResult = await removeStaleOvertimeClaims(supabase, touchedMonths, session, [
      {
        scheduleId: input.scheduleId,
        startDate: input.startDate,
        endDate: input.endDate,
      },
    ]);

    revalidatePath("/schedule");
    revalidatePath("/overtime");

    return {
      ok: true,
      message: cleanupResult.ok
        ? cleanupResult.removedClaims > 0
          ? `Set reopened for edits. Removed ${cleanupResult.removedClaims} overtime claim${cleanupResult.removedClaims === 1 ? "" : "s"} that were no longer needed.`
          : "Set reopened for edits. Existing valid overtime claims were kept."
        : cleanupResult.message,
    };
  }
}

/**
 * Claims an overtime posting for an employee and writes the mirrored schedule
 * rows needed for the target team to see that borrowed worker.
 */
export async function claimOvertimePosting(input: ClaimOvertimePostingInput) {
  const session = await requireActionRole(["admin", "leader", "worker"]);

  if (!session) {
    return {
      ok: false,
      message: "You do not have permission to claim overtime postings.",
    };
  }

  if (session.role === "worker" && session.employeeId !== input.employeeId) {
    return {
      ok: false,
      message: "Workers can only claim overtime as themselves.",
    };
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return {
      ok: false,
      message: "Supabase is not configured yet. Overtime postings are unavailable.",
    };
  }

  if (input.dates.length === 0) {
    return {
      ok: false,
      message: "No overtime dates were provided.",
    };
  }

  const month = input.dates[0]?.slice(0, 7);
  const snapshot = await getSchedulerSnapshot(month, session);
  const employeeMap = getEmployeeMap(snapshot.schedules);
  const employee = employeeMap[input.employeeId];
  const employeeSchedule = employee ? getScheduleById(snapshot, employee.scheduleId) : null;
  const targetSchedule = getScheduleById(snapshot, input.scheduleId);
  const competency = snapshot.competencies.find((entry) => entry.id === input.competencyId);
  const coverageCompetencyId = input.coverageCompetencyId ?? input.competencyId;
  const coverageCompetency = snapshot.competencies.find((entry) => entry.id === coverageCompetencyId);
  const assignmentIndex = buildAssignmentIndex(snapshot.assignments);

  if (!employee || !employeeSchedule || !competency || !coverageCompetency || !targetSchedule) {
    return {
      ok: false,
      message: "Could not find the employee or competency for this posting.",
    };
  }

  if (!employee.competencyIds.includes(input.competencyId)) {
    return {
      ok: false,
      message: `${employee.name} is not qualified for ${competency.code}.`,
    };
  }

  let swapAssignmentRows: OvertimeAssignmentRow[] = [];

  if (coverageCompetencyId !== input.competencyId) {
    if (!input.swapEmployeeId) {
      return {
        ok: false,
        message: "That overtime swap is missing the team member to rotate.",
      };
    }

    const swapEmployee = employeeMap[input.swapEmployeeId];

    if (!swapEmployee || swapEmployee.scheduleId !== input.scheduleId) {
      return {
        ok: false,
        message: "Could not find the team member to rotate for that posting.",
      };
    }

    if (!swapEmployee.competencyIds.includes(coverageCompetencyId)) {
      return {
        ok: false,
        message: `${swapEmployee.name} cannot be moved to ${coverageCompetency.code}.`,
      };
    }

    for (const date of input.dates) {
      const swapSelection = assignmentIndex[`${swapEmployee.id}:${date}`] ?? {
        competencyId: null,
        timeCodeId: null,
      };

      if (swapSelection.competencyId !== input.competencyId) {
        return {
          ok: false,
          message: `${swapEmployee.name} is no longer on ${competency.code} for every shift in that posting.`,
        };
      }
    }

    swapAssignmentRows = buildSwapOvertimeAssignmentRows({
      claimantEmployeeId: input.employeeId,
      claimedCompetencyId: input.competencyId,
      coverageCompetencyId,
      swapEmployeeId: swapEmployee.id,
      dates: input.dates,
      shiftKindForDate: (date) => shiftForDate(targetSchedule, date),
    });
  }

  const fullSetDays = getWorkedSetDays(targetSchedule, getExtendedMonthDays(month), input.dates[0] ?? null);
  const completedSetRangeKeys = new Set(
    snapshot.completedSets.map((entry) => createSetRangeKey(entry.scheduleId, entry.startDate, entry.endDate)),
  );

  if (
    fullSetDays.length === 0 ||
    !completedSetRangeKeys.has(
      createSetRangeKey(
        input.scheduleId,
        fullSetDays[0].date,
        fullSetDays[fullSetDays.length - 1].date,
      ),
    )
  ) {
    return {
      ok: false,
      message: "That set is not marked schedule complete yet.",
    };
  }

  for (const date of input.dates) {
    const shiftKind = shiftForDate(employeeSchedule, date);
    const currentAssignment = assignmentIndex[`${employee.id}:${date}`] ?? {
      competencyId: null,
      timeCodeId: null,
    };

    if (shiftKind !== "OFF" || currentAssignment.competencyId || currentAssignment.timeCodeId) {
      return {
        ok: false,
        message: `${employee.name} is not available for every shift in that posting.`,
      };
    }
  }

  const assignmentRows = input.dates.map((date) => ({
    employee_id: input.employeeId,
    assignment_date: date,
    competency_id: input.competencyId,
    time_code_id: null,
    notes: buildOvertimeAssignmentNote({
      claimantEmployeeId: input.employeeId,
      claimedCompetencyId: input.competencyId,
      coverageCompetencyId,
      swapEmployeeId: input.swapEmployeeId ?? null,
    }),
    shift_kind: shiftForDate(targetSchedule, date),
    ...toDatabaseScope({
      companyId: targetSchedule.companyId ?? session.companyId ?? "",
      siteId: targetSchedule.siteId ?? session.siteId ?? "",
      businessAreaId: targetSchedule.businessAreaId ?? session.businessAreaId ?? "",
    }),
  }));

  const claimRows = input.dates.map((date) => ({
    id: `ot-${input.scheduleId}-${input.employeeId}-${input.competencyId}-${date}`,
    schedule_id: input.scheduleId,
    employee_id: input.employeeId,
    competency_id: input.competencyId,
    assignment_date: date,
    ...toDatabaseScope({
      companyId: targetSchedule.companyId ?? session.companyId ?? "",
      siteId: targetSchedule.siteId ?? session.siteId ?? "",
      businessAreaId: targetSchedule.businessAreaId ?? session.businessAreaId ?? "",
    }),
  }));

  swapAssignmentRows = swapAssignmentRows.map((row) => ({
    ...row,
    ...toDatabaseScope({
      companyId: targetSchedule.companyId ?? session.companyId ?? "",
      siteId: targetSchedule.siteId ?? session.siteId ?? "",
      businessAreaId: targetSchedule.businessAreaId ?? session.businessAreaId ?? "",
    }),
  }));

  const { error: assignmentError } = await supabase.from("schedule_assignments").upsert([...assignmentRows, ...swapAssignmentRows], {
    onConflict: "employee_id,assignment_date",
  });

  if (assignmentError) {
    return {
      ok: false,
      message: `Could not save overtime assignments: ${assignmentError.message}`,
    };
  }

  const { error: claimError } = await supabase.from("overtime_claims").upsert(claimRows, {
    onConflict: "id",
  });

  if (claimError) {
    return {
      ok: false,
      message: `Could not save overtime claim: ${claimError.message}`,
    };
  }

  revalidatePath("/schedule");
  revalidatePath("/overtime");

  return {
    ok: true,
    message: `${employee.name} was added to the overtime posting.`,
  };
}

/**
 * Releases a previously claimed overtime posting and removes the derived
 * schedule rows that were created for that claim.
 */
export async function releaseOvertimePosting(input: ReleaseOvertimePostingInput) {
  const session = await requireActionRole(["admin", "leader", "worker"]);

  if (!session) {
    return {
      ok: false,
      message: "You do not have permission to release overtime postings.",
    };
  }

  if (session.role === "worker" && session.employeeId !== input.employeeId) {
    return {
      ok: false,
      message: "Workers can only release their own overtime claims.",
    };
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return {
      ok: false,
      message: "Supabase is not configured yet. Overtime postings are unavailable.",
    };
  }

  if (input.dates.length === 0) {
    return {
      ok: false,
      message: "No overtime dates were provided.",
    };
  }

  const restoreResult = await restoreSwappedAssignmentsForClaims(
    supabase,
    input.dates.map((date) => ({
      employeeId: input.employeeId,
      competencyId: input.competencyId,
      date,
    })),
  );

  if (!restoreResult.ok) {
    return {
      ok: false,
      message: restoreResult.message,
    };
  }

  const { error: claimDeleteError } = await supabase
    .from("overtime_claims")
    .delete()
    .eq("schedule_id", input.scheduleId)
    .eq("employee_id", input.employeeId)
    .eq("competency_id", input.competencyId)
    .in("assignment_date", input.dates);

  if (claimDeleteError) {
    return {
      ok: false,
      message: `Could not release overtime claim: ${claimDeleteError.message}`,
    };
  }

  const clearAssignmentsResult = await clearClaimantAssignmentsForClaims(
    supabase,
    input.dates.map((date) => ({
      employeeId: input.employeeId,
      competencyId: input.competencyId,
      date,
    })),
  );

  if (!clearAssignmentsResult.ok) {
    return {
      ok: false,
      message: clearAssignmentsResult.message,
    };
  }

  revalidatePath("/schedule");
  revalidatePath("/overtime");

  return {
    ok: true,
    message: "Overtime claim released.",
  };
}

/** Creates a new open mutual swap posting for a selected worker and date set. */
export async function createMutualPosting(input: CreateMutualPostingInput) {
  const session = await requireActionRole(["admin", "leader", "worker"]);

  if (!session) {
    return {
      ok: false,
      message: "You do not have permission to create mutual postings.",
    };
  }

  if (session.role === "worker" && session.employeeId !== input.employeeId) {
    return {
      ok: false,
      message: "Workers can only post their own shifts to mutuals.",
    };
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return {
      ok: false,
      message: "Supabase is not configured yet. Mutual postings are unavailable.",
    };
  }

  const dates = uniqueSortedDates(input.dates);

  if (dates.length === 0) {
    return {
      ok: false,
      message: "Select at least one shift date to post.",
    };
  }

  const month = dates[0].slice(0, 7);

  const snapshot = await getSchedulerSnapshot(month, session);
  const employeeMap = getEmployeeMap(snapshot.schedules);
  const employee = employeeMap[input.employeeId];
  const employeeSchedule = employee ? getScheduleById(snapshot, employee.scheduleId) : null;

  if (!employee || !employeeSchedule) {
    return {
      ok: false,
      message: "Could not find the selected employee for this mutual posting.",
    };
  }

  const shiftKinds = getWorkedShiftKindsForDates(employeeSchedule, dates);

  if (shiftKinds.some((shiftKind) => shiftKind === "OFF")) {
    return {
      ok: false,
      message: "Mutual postings can only include shifts the employee is scheduled to work.",
    };
  }

  const postingId = `mutual-post-${crypto.randomUUID()}`;
  const { error: postingError } = await supabase.from("mutual_shift_postings").insert({
    id: postingId,
    owner_employee_id: employee.id,
    owner_schedule_id: employee.scheduleId,
    status: "open",
    month_key: month,
    accepted_application_id: null,
    ...toDatabaseScope({
      companyId: employee.companyId ?? session.companyId ?? "",
      siteId: employee.siteId ?? session.siteId ?? "",
      businessAreaId: employee.businessAreaId ?? session.businessAreaId ?? "",
    }),
  });

  if (postingError) {
    return {
      ok: false,
      message: `Could not create mutual posting: ${postingError.message}`,
    };
  }

  const { error: datesError } = await supabase.from("mutual_shift_posting_dates").insert(
    dates.map((date, index) => ({
      posting_id: postingId,
      swap_date: date,
      shift_kind: shiftKinds[index],
      ...toDatabaseScope({
        companyId: employee.companyId ?? session.companyId ?? "",
        siteId: employee.siteId ?? session.siteId ?? "",
        businessAreaId: employee.businessAreaId ?? session.businessAreaId ?? "",
      }),
    })),
  );

  if (datesError) {
    await supabase.from("mutual_shift_postings").delete().eq("id", postingId);
    return {
      ok: false,
      message: `Could not save mutual posting dates: ${datesError.message}`,
    };
  }

  revalidatePath("/mutuals");
  revalidatePath("/mutals");

  return {
    ok: true,
    message: `${employee.name} posted ${dates.length} shift${dates.length === 1 ? "" : "s"} to mutuals.`,
  };
}

/** Submits an application against an existing mutual posting. */
export async function applyToMutualPosting(input: ApplyToMutualPostingInput) {
  const session = await requireActionRole(["admin", "leader", "worker"]);

  if (!session) {
    return {
      ok: false,
      message: "You do not have permission to apply to mutual postings.",
    };
  }

  if (session.role === "worker" && session.employeeId !== input.employeeId) {
    return {
      ok: false,
      message: "Workers can only apply using their own shifts.",
    };
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return {
      ok: false,
      message: "Supabase is not configured yet. Mutual applications are unavailable.",
    };
  }

  const postingResult = await supabase
    .from("mutual_shift_postings")
    .select("id, owner_employee_id, owner_schedule_id, status, month_key, company_id, site_id, business_area_id")
    .eq("id", input.postingId)
    .maybeSingle();

  const posting = postingResult.data as {
    id: string;
    owner_employee_id: string;
    owner_schedule_id: string;
    status: string;
    month_key: string;
    company_id: string;
    site_id: string;
    business_area_id: string;
  } | null;

  if (postingResult.error || !posting) {
    return {
      ok: false,
      message: "Could not find that mutual posting.",
    };
  }

  if (!canAccessScope(session, scopeFromRow(posting))) {
    return {
      ok: false,
      message: "You do not have permission to access that mutual posting.",
    };
  }

  if (posting.status !== "open") {
    return {
      ok: false,
      message: "That mutual posting is no longer open.",
    };
  }

  if (posting.owner_employee_id === input.employeeId) {
    return {
      ok: false,
      message: "You cannot apply to your own mutual posting.",
    };
  }

  const postingDatesResult = await supabase
    .from("mutual_shift_posting_dates")
    .select("swap_date, shift_kind")
    .eq("posting_id", input.postingId)
    .order("swap_date");

  const postingDates = ((postingDatesResult.data as Array<{ swap_date: string; shift_kind: ShiftKind }> | null) ?? []);
  const requestedDates = postingDates.map((row) => row.swap_date);
  const dates = uniqueSortedDates(input.dates);

  if (dates.length === 0 || dates.length !== requestedDates.length) {
    return {
      ok: false,
      message: "Your application must offer the same number of shifts as the original posting.",
    };
  }

  const snapshot = await getSchedulerSnapshot(posting.month_key, session);
  const employeeMap = getEmployeeMap(snapshot.schedules);
  const employee = employeeMap[input.employeeId];
  const employeeSchedule = employee ? getScheduleById(snapshot, employee.scheduleId) : null;
  const postingOwner = employeeMap[posting.owner_employee_id];
  const postingOwnerSchedule = postingOwner ? getScheduleById(snapshot, posting.owner_schedule_id) : null;

  if (!employee || !employeeSchedule) {
    return {
      ok: false,
      message: "Could not find the selected employee for this mutual application.",
    };
  }

  const offeredShiftKinds = getWorkedShiftKindsForDates(employeeSchedule, dates);

  if (offeredShiftKinds.some((shiftKind) => shiftKind === "OFF")) {
    return {
      ok: false,
      message: "Mutual applications can only offer shifts the employee is scheduled to work.",
    };
  }

  if (!postingOwner || !postingOwnerSchedule) {
    return {
      ok: false,
      message: "Could not validate the original mutual worker for this posting.",
    };
  }

  if (dates.some((date) => shiftForDate(postingOwnerSchedule, date) !== "OFF")) {
    return {
      ok: false,
      message: "Offered shifts must be on dates the original worker is off.",
    };
  }

  const applicationId = `mutual-app-${crypto.randomUUID()}`;
  const { error: applicationError } = await supabase.from("mutual_shift_applications").insert({
    id: applicationId,
    posting_id: input.postingId,
    applicant_employee_id: employee.id,
    applicant_schedule_id: employee.scheduleId,
    status: "open",
    ...toDatabaseScope({
      companyId: employee.companyId ?? session.companyId ?? "",
      siteId: employee.siteId ?? session.siteId ?? "",
      businessAreaId: employee.businessAreaId ?? session.businessAreaId ?? "",
    }),
  });

  if (applicationError) {
    return {
      ok: false,
      message: `Could not create mutual application: ${applicationError.message}`,
    };
  }

  const { error: datesError } = await supabase.from("mutual_shift_application_dates").insert(
    dates.map((date, index) => ({
      application_id: applicationId,
      swap_date: date,
      shift_kind: offeredShiftKinds[index],
      ...toDatabaseScope({
        companyId: employee.companyId ?? session.companyId ?? "",
        siteId: employee.siteId ?? session.siteId ?? "",
        businessAreaId: employee.businessAreaId ?? session.businessAreaId ?? "",
      }),
    })),
  );

  if (datesError) {
    await supabase.from("mutual_shift_applications").delete().eq("id", applicationId);
    return {
      ok: false,
      message: `Could not save mutual application dates: ${datesError.message}`,
    };
  }

  revalidatePath("/mutuals");
  revalidatePath("/mutals");

  return {
    ok: true,
    message: `${employee.name} applied to that mutual posting.`,
  };
}

/**
 * Accepts one mutual application, marks it as the winning offer, and writes the
 * `M` time-code schedule rows that make the swap visible on both schedules.
 */
export async function acceptMutualApplication(input: AcceptMutualApplicationInput) {
  const session = await requireActionRole(["admin", "leader", "worker"]);

  if (!session) {
    return {
      ok: false,
      message: "You do not have permission to accept mutual applications.",
    };
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return {
      ok: false,
      message: "Supabase is not configured yet. Mutual applications are unavailable.",
    };
  }

  const postingResult = await supabase
    .from("mutual_shift_postings")
    .select("id, owner_employee_id, owner_schedule_id, status, company_id, site_id, business_area_id")
    .eq("id", input.postingId)
    .maybeSingle();

  const posting = postingResult.data as {
    id: string;
    owner_employee_id: string;
    owner_schedule_id: string;
    status: string;
    company_id: string;
    site_id: string;
    business_area_id: string;
  } | null;

  if (postingResult.error || !posting) {
    return {
      ok: false,
      message: "Could not find that mutual posting.",
    };
  }

  if (!canAccessScope(session, scopeFromRow(posting))) {
    return {
      ok: false,
      message: "You do not have permission to access that mutual posting.",
    };
  }

  if (session.role !== "admin" && posting.owner_employee_id !== session.employeeId) {
    return {
      ok: false,
      message: "Only the original worker or an admin can accept a mutual application.",
    };
  }

  if (posting.status !== "open") {
    return {
      ok: false,
      message: "That mutual posting is no longer open.",
    };
  }

  const applicationResult = await supabase
    .from("mutual_shift_applications")
    .select("id, status, applicant_employee_id, applicant_schedule_id, company_id, site_id, business_area_id")
    .eq("id", input.applicationId)
    .eq("posting_id", input.postingId)
    .maybeSingle();

  const application = applicationResult.data as {
    id: string;
    status: string;
    applicant_employee_id: string;
    applicant_schedule_id: string;
    company_id: string;
    site_id: string;
    business_area_id: string;
  } | null;

  if (applicationResult.error || !application || application.status !== "open") {
    return {
      ok: false,
      message: "Could not find that mutual application.",
    };
  }

  if (!canAccessScope(session, scopeFromRow(application))) {
    return {
      ok: false,
      message: "You do not have permission to access that mutual application.",
    };
  }

  const mutualTimeCodeResult = await supabase
    .from("time_codes")
    .select("id")
    .eq("code", "M")
    .maybeSingle();
  const mutualTimeCodeId = (mutualTimeCodeResult.data as { id: string } | null)?.id ?? null;

  if (mutualTimeCodeResult.error || !mutualTimeCodeId) {
    return {
      ok: false,
      message: 'Time code "M" was not found. Add it before accepting mutuals.',
    };
  }

  const [postingDatesResult, applicationDatesResult] = await Promise.all([
    supabase
      .from("mutual_shift_posting_dates")
      .select("swap_date, shift_kind")
      .eq("posting_id", input.postingId)
      .order("swap_date"),
    supabase
      .from("mutual_shift_application_dates")
      .select("swap_date, shift_kind")
      .eq("application_id", input.applicationId)
      .order("swap_date"),
  ]);

  const postingDates = ((postingDatesResult.data as Array<{
    swap_date: string;
    shift_kind: ShiftKind;
  }> | null) ?? []);
  const applicationDates = ((applicationDatesResult.data as Array<{
    swap_date: string;
    shift_kind: ShiftKind;
  }> | null) ?? []);

  if (postingDatesResult.error || postingDates.length === 0) {
    return {
      ok: false,
      message: "Could not load the original mutual dates.",
    };
  }

  if (applicationDatesResult.error || applicationDates.length === 0) {
    return {
      ok: false,
      message: "Could not load the offered mutual dates.",
    };
  }

  const scheduleScopesResult = await supabase
    .from("schedules")
    .select("id, company_id, site_id, business_area_id")
    .in("id", [posting.owner_schedule_id, application.applicant_schedule_id]);

  if (scheduleScopesResult.error) {
    return {
      ok: false,
      message: `Could not resolve mutual schedule scope: ${scheduleScopesResult.error.message}`,
    };
  }

  const scheduleScopes = new Map(
    (((scheduleScopesResult.data as Array<{ id: string } & ScopedDatabaseRow> | null) ?? [])).map((row) => [
      row.id,
      scopeFromRow(row),
    ]),
  );

  const allMutualDates = Array.from(
    new Set([...postingDates.map((row) => row.swap_date), ...applicationDates.map((row) => row.swap_date)]),
  );
  const existingAssignmentsResult = await supabase
    .from("schedule_assignments")
    .select("employee_id, assignment_date, competency_id, time_code_id, company_id, site_id, business_area_id")
    .in("employee_id", [posting.owner_employee_id, application.applicant_employee_id])
    .in("assignment_date", allMutualDates);

  if (existingAssignmentsResult.error) {
    return {
      ok: false,
      message: `Could not prepare mutual schedule updates: ${existingAssignmentsResult.error.message}`,
    };
  }

  const existingAssignments = new Map(
    (((existingAssignmentsResult.data as Array<{
      employee_id: string;
      assignment_date: string;
      competency_id: string | null;
      time_code_id: string | null;
    }> | null) ?? [])).map((row) => [`${row.employee_id}:${row.assignment_date}`, row]),
  );

  const mutualRows: MutualAssignmentRow[] = buildAcceptedMutualAssignmentRows({
    postingId: input.postingId,
    mutualTimeCodeId,
    originalWorkerId: posting.owner_employee_id,
    originalWorkerScheduleId: posting.owner_schedule_id,
    originalDates: postingDates.map((row) => ({ date: row.swap_date, shiftKind: row.shift_kind })),
    applicantEmployeeId: application.applicant_employee_id,
    applicantScheduleId: application.applicant_schedule_id,
    applicantDates: applicationDates.map((row) => ({ date: row.swap_date, shiftKind: row.shift_kind })),
    existingAssignments,
  }).map((row) => {
    const parsed = parseMutualAssignmentNote(row.notes);
    const targetScope = parsed.targetScheduleId ? scheduleScopes.get(parsed.targetScheduleId) : null;

    return {
      ...row,
      ...toDatabaseScope(targetScope ?? scopeFromRow(posting)),
    };
  });

  const { error: mutualRowsError } = await supabase.from("schedule_assignments").upsert(mutualRows, {
    onConflict: "employee_id,assignment_date",
  });

  if (mutualRowsError) {
    return {
      ok: false,
      message: `Could not apply accepted mutual to the schedule: ${mutualRowsError.message}`,
    };
  }

  const { error: postingError } = await supabase
    .from("mutual_shift_postings")
    .update({
      status: "accepted",
      accepted_application_id: input.applicationId,
    })
    .eq("id", input.postingId);

  if (postingError) {
    return {
      ok: false,
      message: `Could not accept mutual application: ${postingError.message}`,
    };
  }

  await supabase
    .from("mutual_shift_applications")
    .update({ status: "accepted" })
    .eq("id", input.applicationId);

  await supabase
    .from("mutual_shift_applications")
    .update({ status: "rejected" })
    .eq("posting_id", input.postingId)
    .eq("status", "open")
    .neq("id", input.applicationId);

  revalidatePath("/mutuals");
  revalidatePath("/mutals");
  revalidatePath("/schedule");
  revalidatePath("/schedule/print");

  return {
    ok: true,
    message: "Mutual application accepted.",
  };
}

/** Cancels an open mutual posting before any application has been accepted. */
export async function withdrawMutualPosting(input: WithdrawMutualPostingInput) {
  const session = await requireActionRole(["admin", "leader", "worker"]);

  if (!session) {
    return {
      ok: false,
      message: "You do not have permission to withdraw mutual postings.",
    };
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return {
      ok: false,
      message: "Supabase is not configured yet. Mutual postings are unavailable.",
    };
  }

  const postingResult = await supabase
    .from("mutual_shift_postings")
    .select("id, owner_employee_id, status, company_id, site_id, business_area_id")
    .eq("id", input.postingId)
    .maybeSingle();

  const posting = postingResult.data as ({ id: string; owner_employee_id: string; status: string } & ScopedDatabaseRow) | null;

  if (postingResult.error || !posting) {
    return {
      ok: false,
      message: "Could not find that mutual posting.",
    };
  }

  if (!canAccessScope(session, scopeFromRow(posting))) {
    return {
      ok: false,
      message: "You do not have permission to access that mutual posting.",
    };
  }

  if (session.role === "worker" && posting.owner_employee_id !== session.employeeId) {
    return {
      ok: false,
      message: "Only the original worker can cancel this open mutual posting.",
    };
  }

  if (posting.status !== "open") {
    return {
      ok: false,
      message: "Only open mutual postings can be withdrawn.",
    };
  }

  const { error } = await supabase
    .from("mutual_shift_postings")
    .delete()
    .eq("id", input.postingId);

  if (error) {
    return {
      ok: false,
      message: `Could not cancel mutual posting: ${error.message}`,
    };
  }

  revalidatePath("/mutuals");
  revalidatePath("/mutals");

  return {
    ok: true,
    message: "Mutual posting cancelled.",
  };
}

/** Removes one open mutual application while leaving the parent posting alive. */
export async function withdrawMutualApplication(input: WithdrawMutualApplicationInput) {
  const session = await requireActionRole(["admin", "leader", "worker"]);

  if (!session) {
    return {
      ok: false,
      message: "You do not have permission to withdraw mutual applications.",
    };
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return {
      ok: false,
      message: "Supabase is not configured yet. Mutual applications are unavailable.",
    };
  }

  const applicationResult = await supabase
    .from("mutual_shift_applications")
    .select("id, applicant_employee_id, status, company_id, site_id, business_area_id")
    .eq("id", input.applicationId)
    .eq("posting_id", input.postingId)
    .maybeSingle();

  const application = applicationResult.data as ({ id: string; applicant_employee_id: string; status: string } & ScopedDatabaseRow) | null;

  if (applicationResult.error || !application) {
    return {
      ok: false,
      message: "Could not find that mutual application.",
    };
  }

  if (!canAccessScope(session, scopeFromRow(application))) {
    return {
      ok: false,
      message: "You do not have permission to access that mutual application.",
    };
  }

  if (application.applicant_employee_id !== session.employeeId) {
    return {
      ok: false,
      message: "Only the applicant can withdraw this offer.",
    };
  }

  if (application.status !== "open") {
    return {
      ok: false,
      message: "Only open applications can be withdrawn.",
    };
  }

  const { error } = await supabase
    .from("mutual_shift_applications")
    .delete()
    .eq("id", input.applicationId);

  if (error) {
    return {
      ok: false,
      message: `Could not delete mutual offer: ${error.message}`,
    };
  }

  revalidatePath("/mutuals");
  revalidatePath("/mutals");

  return {
    ok: true,
    message: "Mutual offer deleted.",
  };
}

/**
 * Cancels an already-accepted mutual and restores the workers' original cell
 * values using the metadata captured when the swap was accepted.
 */
export async function cancelAcceptedMutual(input: CancelAcceptedMutualInput) {
  const session = await requireActionRole(["admin", "leader"]);

  if (!session) {
    return {
      ok: false,
      message: "Only admins or leaders can cancel accepted mutuals.",
    };
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return {
      ok: false,
      message: "Supabase is not configured yet. Mutuals are unavailable.",
    };
  }

  const postingResult = await supabase
    .from("mutual_shift_postings")
    .select("id, status, company_id, site_id, business_area_id")
    .eq("id", input.postingId)
    .maybeSingle();

  const posting = postingResult.data as ({ id: string; status: string } & ScopedDatabaseRow) | null;

  if (postingResult.error || !posting) {
    return {
      ok: false,
      message: "Could not find that mutual.",
    };
  }

  if (!canAccessScope(session, scopeFromRow(posting))) {
    return {
      ok: false,
      message: "You do not have permission to access that mutual.",
    };
  }

  if (posting.status !== "accepted") {
    return {
      ok: false,
      message: "Only accepted mutuals can be cancelled.",
    };
  }

  const mutualAssignmentsResult = await supabase
    .from("schedule_assignments")
    .select("employee_id, assignment_date, competency_id, time_code_id, notes, shift_kind, company_id, site_id, business_area_id")
    .like("notes", `MUT|posting:${input.postingId}|%`);

  if (mutualAssignmentsResult.error) {
    return {
      ok: false,
      message: `Could not load accepted mutual schedule rows: ${mutualAssignmentsResult.error.message}`,
    };
  }

  const mutualAssignments = ((mutualAssignmentsResult.data as Array<{
    employee_id: string;
    assignment_date: string;
    competency_id: string | null;
    time_code_id: string | null;
    notes: string | null;
    shift_kind: ShiftKind;
    company_id: string;
    site_id: string;
    business_area_id: string;
  }> | null) ?? []);

  const restoreRows = mutualAssignments.flatMap((row) => {
    const parsed = parseMutualAssignmentNote(row.notes);

    if (!parsed.originalCompetencyId && !parsed.originalTimeCodeId) {
      return [];
    }

    return [
      {
        employee_id: row.employee_id,
        assignment_date: row.assignment_date,
        competency_id: parsed.originalCompetencyId,
        time_code_id: parsed.originalTimeCodeId,
        notes: null,
        shift_kind: row.shift_kind,
        company_id: row.company_id,
        site_id: row.site_id,
        business_area_id: row.business_area_id,
      } satisfies MutualAssignmentRow,
    ];
  });

  const deleteRows = mutualAssignments.filter((row) => {
    const parsed = parseMutualAssignmentNote(row.notes);
    return !parsed.originalCompetencyId && !parsed.originalTimeCodeId;
  });

  if (restoreRows.length > 0) {
    const { error: restoreError } = await supabase.from("schedule_assignments").upsert(restoreRows, {
      onConflict: "employee_id,assignment_date",
    });

    if (restoreError) {
      return {
        ok: false,
        message: `Could not restore cancelled mutual schedule rows: ${restoreError.message}`,
      };
    }
  }

  if (deleteRows.length > 0) {
    for (const row of deleteRows) {
      const { error: deleteError } = await supabase
        .from("schedule_assignments")
        .delete()
        .eq("employee_id", row.employee_id)
        .eq("assignment_date", row.assignment_date)
        .like("notes", `MUT|posting:${input.postingId}|%`);

      if (deleteError) {
        return {
          ok: false,
          message: `Could not clear cancelled mutual schedule rows: ${deleteError.message}`,
        };
      }
    }
  }

  const { error } = await supabase
    .from("mutual_shift_postings")
    .update({ status: "cancelled" })
    .eq("id", input.postingId);

  if (error) {
    return {
      ok: false,
      message: `Could not cancel mutual: ${error.message}`,
    };
  }

  revalidatePath("/mutuals");
  revalidatePath("/mutals");
  revalidatePath("/schedule");
  revalidatePath("/schedule/print");

  return {
    ok: true,
    message: "Accepted mutual cancelled.",
  };
}

/** Persists add/edit/remove operations from the Personnel admin workspace. */
export async function savePersonnel(input: SavePersonnelInput) {
  const session = await requireActionRole(["admin", "leader"]);

  if (!session) {
    return {
      ok: false,
      message: "You do not have permission to manage personnel.",
    };
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return {
      ok: false,
      message:
        "Supabase is not configured yet. Personnel edits are available locally in this browser only.",
    };
  }

  const invalidEmployee = input.updates.find(
    (update) => isBlank(update.name) || isBlank(update.role) || isBlank(update.scheduleId),
  );

  if (invalidEmployee) {
    return {
      ok: false,
      message: "Each employee needs a name, role, and shift before saving.",
    };
  }

  const sessionScope = getSessionScope(session);

  if (!sessionScope) {
    return {
      ok: false,
      message: "Your organizational scope is incomplete. Ask an admin to update your profile.",
    };
  }

  const scheduleIds = Array.from(new Set(input.updates.map((update) => update.scheduleId).filter(Boolean)));
  const unitIds = Array.from(new Set(input.updates.map((update) => update.unitId).filter(Boolean)));
  const competencyIds = Array.from(
    new Set(input.updates.flatMap((update) => update.competencyIds).filter(Boolean)),
  );
  const employeeIdsToDelete = Array.from(new Set(input.deletedEmployeeIds.filter(Boolean)));

  const [scheduleRowsResult, unitRowsResult, competencyRowsResult, deleteEmployeeRowsResult] = await Promise.all([
    scheduleIds.length > 0
      ? supabase
          .from("schedules")
          .select("id, company_id, site_id, business_area_id")
          .in("id", scheduleIds)
      : Promise.resolve({ data: [], error: null }),
    unitIds.length > 0
      ? supabase
          .from("production_units")
          .select("id, company_id, site_id, business_area_id")
          .in("id", unitIds)
      : Promise.resolve({ data: [], error: null }),
    competencyIds.length > 0
      ? supabase
          .from("competencies")
          .select("id, company_id, site_id, business_area_id")
          .in("id", competencyIds)
      : Promise.resolve({ data: [], error: null }),
    employeeIdsToDelete.length > 0
      ? supabase
          .from("employees")
          .select("id, company_id, site_id, business_area_id")
          .in("id", employeeIdsToDelete)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const scheduleScopeRows = (scheduleRowsResult.data as Array<{ id: string } & ScopedDatabaseRow> | null) ?? [];
  const unitScopeRows = (unitRowsResult.data as Array<{ id: string } & ScopedDatabaseRow> | null) ?? [];
  const competencyScopeRows = (competencyRowsResult.data as Array<{ id: string } & ScopedDatabaseRow> | null) ?? [];
  const deleteEmployeeScopeRows = (deleteEmployeeRowsResult.data as Array<{ id: string } & ScopedDatabaseRow> | null) ?? [];

  if (scheduleRowsResult.error || scheduleScopeRows.length !== scheduleIds.length) {
    return {
      ok: false,
      message: "Could not resolve one or more shifts for the personnel update.",
    };
  }

  if (unitRowsResult.error || unitScopeRows.length !== unitIds.length) {
    return {
      ok: false,
      message: "Could not resolve one or more business areas for the selected teams.",
    };
  }

  if (competencyRowsResult.error || competencyScopeRows.length !== competencyIds.length) {
    return {
      ok: false,
      message: "Could not resolve one or more competencies for the personnel update.",
    };
  }

  if (deleteEmployeeRowsResult.error || deleteEmployeeScopeRows.length !== employeeIdsToDelete.length) {
    return {
      ok: false,
      message: "Could not resolve one or more employees selected for removal.",
    };
  }

  const scheduleScopeMap = new Map(scheduleScopeRows.map((row) => [row.id, scopeFromRow(row)]));
  const unitScopeMap = new Map(unitScopeRows.map((row) => [row.id, scopeFromRow(row)]));
  const competencyScopeMap = new Map(competencyScopeRows.map((row) => [row.id, scopeFromRow(row)]));

  for (const scheduleScope of scheduleScopeMap.values()) {
    if (!canAccessScope(session, scheduleScope)) {
      return {
        ok: false,
        message: "You do not have permission to assign personnel to one or more selected shifts.",
      };
    }
  }

  for (const unitScope of unitScopeMap.values()) {
    if (!canAccessScope(session, unitScope)) {
      return {
        ok: false,
        message: "You do not have permission to use one or more selected business areas.",
      };
    }
  }

  for (const competencyScope of competencyScopeMap.values()) {
    if (!canAccessScope(session, competencyScope)) {
      return {
        ok: false,
        message: "You do not have permission to assign one or more selected competencies.",
      };
    }
  }

  for (const row of deleteEmployeeScopeRows) {
    if (!canAccessScope(session, scopeFromRow(row))) {
      return {
        ok: false,
        message: "You do not have permission to remove one or more selected employees.",
      };
    }
  }

  for (const update of input.updates) {
    const scheduleScope = scheduleScopeMap.get(update.scheduleId);

    if (!scheduleScope) {
      return {
        ok: false,
        message: "Could not resolve the organizational scope for one or more selected shifts.",
      };
    }

    if (update.unitId) {
      const unitScope = unitScopeMap.get(update.unitId);

      if (
        !unitScope ||
        unitScope.companyId !== scheduleScope.companyId ||
        unitScope.siteId !== scheduleScope.siteId ||
        unitScope.businessAreaId !== scheduleScope.businessAreaId
      ) {
        return {
          ok: false,
          message: "Employees must stay inside the same company, site, and business area as their assigned business unit.",
        };
      }
    }

    for (const competencyId of update.competencyIds) {
      const competencyScope = competencyScopeMap.get(competencyId);

      if (
        !competencyScope ||
        competencyScope.companyId !== scheduleScope.companyId ||
        competencyScope.siteId !== scheduleScope.siteId ||
        competencyScope.businessAreaId !== scheduleScope.businessAreaId
      ) {
        return {
          ok: false,
          message: "Employees can only be assigned competencies from the same company, site, and business area as their shift.",
        };
      }
    }
  }

  const employeeRows = input.updates.map((update) => ({
    ...toDatabaseScope(scheduleScopeMap.get(update.scheduleId) ?? sessionScope),
    id: update.employeeId,
    full_name: update.name.trim(),
    role_title: update.role.trim(),
    schedule_id: update.scheduleId,
    unit_id: update.unitId,
    is_active: true,
  }));

  const employeeError =
    employeeRows.length > 0
      ? (
          await supabase.from("employees").upsert(employeeRows, {
            onConflict: "id",
          })
        ).error
      : null;

  if (employeeError) {
    return {
      ok: false,
      message: `Could not save personnel details: ${employeeError.message}`,
    };
  }

  const syncResults = await Promise.all(
    input.updates.map(async (update) => {
      const deleteResult = await supabase
        .from("employee_competencies")
        .delete()
        .eq("employee_id", update.employeeId);

      if (deleteResult.error) {
        return deleteResult;
      }

      if (update.competencyIds.length === 0) {
        return { error: null };
      }

      return supabase.from("employee_competencies").insert(
        update.competencyIds.map((competencyId) => ({
          employee_id: update.employeeId,
          competency_id: competencyId,
          ...toDatabaseScope(scheduleScopeMap.get(update.scheduleId) ?? sessionScope),
        })),
      );
    }),
  );

  const firstSyncError = syncResults.find((result) => result.error)?.error;

  if (firstSyncError) {
    return {
      ok: false,
      message: `Could not save employee competencies: ${firstSyncError.message}`,
    };
  }

  if (input.deletedEmployeeIds.length > 0) {
    const { error: deleteError } = await supabase
      .from("employees")
      .delete()
      .in("id", input.deletedEmployeeIds);

    if (deleteError) {
      return {
        ok: false,
        message: `Could not remove employees: ${deleteError.message}`,
      };
    }
  }

  revalidatePath("/schedule");
  revalidatePath("/personnel");

  return {
    ok: true,
    message: "Personnel changes saved to Supabase.",
  };
}

/** Persists shift-pattern changes from the Shifts admin page. */
export async function saveSchedules(input: SaveSchedulesInput) {
  const session = await requireActionRole(["admin"]);

  if (!session) {
    return {
      ok: false,
      message: "Only admins can change shift definitions.",
    };
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return {
      ok: false,
      message:
        "Supabase is not configured yet. Schedule edits are available locally in this browser only.",
    };
  }

  const invalidSchedule = input.updates.find(
    (update) =>
      isBlank(update.name) ||
      !update.startDate ||
      !hasValidShiftPattern(update.dayShiftDays, update.nightShiftDays, update.offDays),
  );

  if (invalidSchedule) {
    return {
      ok: false,
      message: "Each shift needs a name, a start date, and at least one total worked/off day in the cycle.",
    };
  }

  const sessionScope = getSessionScope(session);

  if (!sessionScope) {
    return {
      ok: false,
      message: "Your organizational scope is incomplete. Ask an admin to update your profile.",
    };
  }

  const rows = input.updates.map((update) => ({
    id: update.scheduleId,
    name: update.name.trim(),
    start_date: update.startDate,
    day_shift_days: update.dayShiftDays,
    night_shift_days: update.nightShiftDays,
    off_days: update.offDays,
    ...toDatabaseScope(sessionScope),
  }));

  if (input.deletedScheduleIds.length > 0) {
    const deleteScopeResult = await supabase
      .from("schedules")
      .select("id, company_id, site_id, business_area_id")
      .in("id", input.deletedScheduleIds);

    const deleteScopeRows = (deleteScopeResult.data as Array<{ id: string } & ScopedDatabaseRow> | null) ?? [];

    if (deleteScopeResult.error || deleteScopeRows.length !== input.deletedScheduleIds.length) {
      return {
        ok: false,
        message: "Could not resolve one or more shifts selected for removal.",
      };
    }

    if (deleteScopeRows.some((row) => !canAccessScope(session, scopeFromRow(row)))) {
      return {
        ok: false,
        message: "You do not have permission to remove one or more selected shifts.",
      };
    }
  }

  const error =
    rows.length > 0
      ? (
          await supabase.from("schedules").upsert(rows, {
            onConflict: "id",
          })
        ).error
      : null;

  if (error) {
    return {
      ok: false,
      message: `Could not save schedules: ${error.message}`,
    };
  }

  if (input.deletedScheduleIds.length > 0) {
    const { error: deleteError } = await supabase
      .from("schedules")
      .delete()
      .in("id", input.deletedScheduleIds);

    if (deleteError) {
      return {
        ok: false,
        message: `Could not remove schedules: ${deleteError.message}`,
      };
    }
  }

  revalidatePath("/schedule");
  revalidatePath("/personnel");
  revalidatePath("/schedules");
  revalidatePath("/competencies");
  revalidatePath("/overtime");

  return {
    ok: true,
    message: "Shift changes saved to Supabase.",
  };
}

/** Persists competency catalog changes from the Competencies admin page. */
export async function saveCompetencies(input: SaveCompetenciesInput) {
  const session = await requireActionRole(["admin"]);

  if (!session) {
    return {
      ok: false,
      message: "Only admins can change competencies.",
    };
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return {
      ok: false,
      message:
        "Supabase is not configured yet. Competency edits are available locally in this browser only.",
    };
  }

  const invalidCompetency = input.updates.find(
    (update) =>
      isBlank(update.code) ||
      update.code.trim().length > 5 ||
      isBlank(update.label) ||
      !Number.isInteger(update.requiredStaff) ||
      update.requiredStaff < 1,
  );

  if (invalidCompetency) {
    return {
      ok: false,
      message: "Each competency needs a code of 5 characters or fewer, a label, and at least 1 required staff.",
    };
  }

  const sessionScope = getSessionScope(session);

  if (!sessionScope) {
    return {
      ok: false,
      message: "Your organizational scope is incomplete. Ask an admin to update your profile.",
    };
  }

  const rows = input.updates.map((update) => ({
    id: update.competencyId,
    code: update.code.trim(),
    label: update.label.trim(),
    color_token: update.colorToken,
    required_staff: update.requiredStaff,
    ...toDatabaseScope(sessionScope),
  }));

  if (input.deletedCompetencyIds.length > 0) {
    const deleteScopeResult = await supabase
      .from("competencies")
      .select("id, company_id, site_id, business_area_id")
      .in("id", input.deletedCompetencyIds);

    const deleteScopeRows = (deleteScopeResult.data as Array<{ id: string } & ScopedDatabaseRow> | null) ?? [];

    if (deleteScopeResult.error || deleteScopeRows.length !== input.deletedCompetencyIds.length) {
      return {
        ok: false,
        message: "Could not resolve one or more competencies selected for removal.",
      };
    }

    if (deleteScopeRows.some((row) => !canAccessScope(session, scopeFromRow(row)))) {
      return {
        ok: false,
        message: "You do not have permission to remove one or more selected competencies.",
      };
    }
  }

  const error =
    rows.length > 0
      ? (
          await supabase.from("competencies").upsert(rows, {
            onConflict: "id",
          })
        ).error
      : null;

  if (error) {
    return {
      ok: false,
      message: `Could not save competencies: ${error.message}`,
    };
  }

  if (input.deletedCompetencyIds.length > 0) {
    const { error: deleteError } = await supabase
      .from("competencies")
      .delete()
      .in("id", input.deletedCompetencyIds);

    if (deleteError) {
      return {
        ok: false,
        message: `Could not remove competencies: ${deleteError.message}`,
      };
    }
  }

  revalidatePath("/schedule");
  revalidatePath("/personnel");
  revalidatePath("/competencies");
  revalidatePath("/overtime");

  return {
    ok: true,
    message: "Competency changes saved to Supabase.",
  };
}

/** Persists time-code reference data changes from the Time Codes admin page. */
export async function saveTimeCodes(input: SaveTimeCodesInput) {
  const session = await requireActionRole(["admin"]);

  if (!session) {
    return {
      ok: false,
      message: "Only admins can change time codes.",
    };
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return {
      ok: false,
      message:
        "Supabase is not configured yet. Time code edits are available locally in this browser only.",
    };
  }

  const invalidTimeCode = input.updates.find(
    (update) =>
      isBlank(update.code) ||
      isBlank(update.label) ||
      update.code.trim().length > 5,
  );

  if (invalidTimeCode) {
    return {
      ok: false,
      message: "Each time code needs a code of 5 characters or fewer and a label.",
    };
  }

  const sessionScope = getSessionScope(session);

  if (!sessionScope) {
    return {
      ok: false,
      message: "Your organizational scope is incomplete. Ask an admin to update your profile.",
    };
  }

  const rows = input.updates.map((update) => ({
    id: update.timeCodeId,
    code: update.code.trim(),
    label: update.label.trim(),
    color_token: update.colorToken,
    ...toDatabaseScope(sessionScope),
  }));

  if (input.deletedTimeCodeIds.length > 0) {
    const deleteScopeResult = await supabase
      .from("time_codes")
      .select("id, company_id, site_id, business_area_id")
      .in("id", input.deletedTimeCodeIds);

    const deleteScopeRows = (deleteScopeResult.data as Array<{ id: string } & ScopedDatabaseRow> | null) ?? [];

    if (deleteScopeResult.error || deleteScopeRows.length !== input.deletedTimeCodeIds.length) {
      return {
        ok: false,
        message: "Could not resolve one or more time codes selected for removal.",
      };
    }

    if (deleteScopeRows.some((row) => !canAccessScope(session, scopeFromRow(row)))) {
      return {
        ok: false,
        message: "You do not have permission to remove one or more selected time codes.",
      };
    }
  }

  const error =
    rows.length > 0
      ? (
          await supabase.from("time_codes").upsert(rows, {
            onConflict: "id",
          })
        ).error
      : null;

  if (error) {
    return {
      ok: false,
      message: `Could not save time codes: ${error.message}`,
    };
  }

  if (input.deletedTimeCodeIds.length > 0) {
    const { error: deleteError } = await supabase
      .from("time_codes")
      .delete()
      .in("id", input.deletedTimeCodeIds);

    if (deleteError) {
      return {
        ok: false,
        message: `Could not remove time codes: ${deleteError.message}`,
      };
    }
  }

  revalidatePath("/schedule");
  revalidatePath("/time-codes");
  revalidatePath("/overtime");

  return {
    ok: true,
    message: "Time code changes saved to Supabase.",
  };
}
