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
function isBlank(value: string) {
  return value.trim().length === 0;
}

/** Reusable shift-pattern validation shared by schedule editing actions. */
function hasValidShiftPattern(dayShiftDays: number, nightShiftDays: number, offDays: number) {
  return [dayShiftDays, nightShiftDays, offDays].every((value) => Number.isInteger(value) && value >= 0) &&
    dayShiftDays + nightShiftDays + offDays > 0;
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
      .select("employee_id, assignment_date, notes, shift_kind")
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

function uniqueSortedDates(dates: string[]) {
  return Array.from(new Set(dates.filter(Boolean))).sort();
}

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
  forcedRanges: Array<{ scheduleId: string; startDate: string; endDate: string }> = [],
) {
  const uniqueMonths = Array.from(new Set(months.filter(Boolean)));
  let removedClaims = 0;

  for (const month of uniqueMonths) {
    const snapshot = await getSchedulerSnapshot(month);
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

  const rowsToUpsert = input.updates
    .filter((update) => update.competencyId || update.timeCodeId)
    .map((update) => ({
      employee_id: update.employeeId,
      assignment_date: update.date,
      competency_id: update.competencyId,
      time_code_id: update.timeCodeId,
      notes: update.notes ?? null,
      shift_kind: update.shiftKind,
    }));

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

    const cleanupResult = await removeStaleOvertimeClaims(supabase, touchedMonths);

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

    const cleanupResult = await removeStaleOvertimeClaims(supabase, touchedMonths, [
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
  const snapshot = await getSchedulerSnapshot(month);
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
  }));

  const claimRows = input.dates.map((date) => ({
    id: `ot-${input.scheduleId}-${input.employeeId}-${input.competencyId}-${date}`,
    schedule_id: input.scheduleId,
    employee_id: input.employeeId,
    competency_id: input.competencyId,
    assignment_date: date,
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

  if (dates.some((date) => date.slice(0, 7) !== month)) {
    return {
      ok: false,
      message: "Mutual postings must stay within a single month.",
    };
  }

  const snapshot = await getSchedulerSnapshot(month);
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
    .select("id, owner_employee_id, owner_schedule_id, status, month_key")
    .eq("id", input.postingId)
    .maybeSingle();

  const posting = postingResult.data as {
    id: string;
    owner_employee_id: string;
    owner_schedule_id: string;
    status: string;
    month_key: string;
  } | null;

  if (postingResult.error || !posting) {
    return {
      ok: false,
      message: "Could not find that mutual posting.",
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

  if (dates.some((date) => date.slice(0, 7) !== posting.month_key)) {
    return {
      ok: false,
      message: "Mutual applications must stay within the same month as the posting.",
    };
  }

  const snapshot = await getSchedulerSnapshot(posting.month_key);
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

export async function acceptMutualApplication(input: AcceptMutualApplicationInput) {
  const session = await requireActionRole(["admin", "leader", "worker"]);

  if (!session || !session.employeeId) {
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
    .select("id, owner_employee_id, status")
    .eq("id", input.postingId)
    .maybeSingle();

  const posting = postingResult.data as { id: string; owner_employee_id: string; status: string } | null;

  if (postingResult.error || !posting) {
    return {
      ok: false,
      message: "Could not find that mutual posting.",
    };
  }

  if (posting.owner_employee_id !== session.employeeId) {
    return {
      ok: false,
      message: "Only the original worker can accept a mutual application.",
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
    .select("id, status")
    .eq("id", input.applicationId)
    .eq("posting_id", input.postingId)
    .maybeSingle();

  const application = applicationResult.data as { id: string; status: string } | null;

  if (applicationResult.error || !application || application.status !== "open") {
    return {
      ok: false,
      message: "Could not find that mutual application.",
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

  return {
    ok: true,
    message: "Mutual application accepted.",
  };
}

export async function withdrawMutualPosting(input: WithdrawMutualPostingInput) {
  const session = await requireActionRole(["admin", "leader", "worker"]);

  if (!session || !session.employeeId) {
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
    .select("id, owner_employee_id, status")
    .eq("id", input.postingId)
    .maybeSingle();

  const posting = postingResult.data as { id: string; owner_employee_id: string; status: string } | null;

  if (postingResult.error || !posting) {
    return {
      ok: false,
      message: "Could not find that mutual posting.",
    };
  }

  if (posting.owner_employee_id !== session.employeeId) {
    return {
      ok: false,
      message: "Only the original worker can withdraw an open mutual posting.",
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
    .update({ status: "withdrawn" })
    .eq("id", input.postingId);

  if (error) {
    return {
      ok: false,
      message: `Could not withdraw mutual posting: ${error.message}`,
    };
  }

  revalidatePath("/mutuals");
  revalidatePath("/mutals");

  return {
    ok: true,
    message: "Mutual posting withdrawn.",
  };
}

export async function withdrawMutualApplication(input: WithdrawMutualApplicationInput) {
  const session = await requireActionRole(["admin", "leader", "worker"]);

  if (!session || !session.employeeId) {
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
    .select("id, applicant_employee_id, status")
    .eq("id", input.applicationId)
    .eq("posting_id", input.postingId)
    .maybeSingle();

  const application = applicationResult.data as { id: string; applicant_employee_id: string; status: string } | null;

  if (applicationResult.error || !application) {
    return {
      ok: false,
      message: "Could not find that mutual application.",
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
    .update({ status: "withdrawn" })
    .eq("id", input.applicationId);

  if (error) {
    return {
      ok: false,
      message: `Could not withdraw mutual application: ${error.message}`,
    };
  }

  revalidatePath("/mutuals");
  revalidatePath("/mutals");

  return {
    ok: true,
    message: "Mutual application withdrawn.",
  };
}

export async function cancelAcceptedMutual(input: CancelAcceptedMutualInput) {
  const session = await requireActionRole(["leader"]);

  if (!session) {
    return {
      ok: false,
      message: "Only leaders can cancel accepted mutuals.",
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
    .select("id, status")
    .eq("id", input.postingId)
    .maybeSingle();

  const posting = postingResult.data as { id: string; status: string } | null;

  if (postingResult.error || !posting) {
    return {
      ok: false,
      message: "Could not find that mutual.",
    };
  }

  if (posting.status !== "accepted") {
    return {
      ok: false,
      message: "Only accepted mutuals can be cancelled.",
    };
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

  return {
    ok: true,
    message: "Accepted mutual cancelled.",
  };
}

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

  const employeeRows = input.updates.map((update) => ({
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

  const rows = input.updates.map((update) => ({
    id: update.scheduleId,
    name: update.name.trim(),
    start_date: update.startDate,
    day_shift_days: update.dayShiftDays,
    night_shift_days: update.nightShiftDays,
    off_days: update.offDays,
  }));

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

  const rows = input.updates.map((update) => ({
    id: update.competencyId,
    code: update.code.trim(),
    label: update.label.trim(),
    color_token: update.colorToken,
    required_staff: update.requiredStaff,
  }));

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

  const rows = input.updates.map((update) => ({
    id: update.timeCodeId,
    code: update.code.trim(),
    label: update.label.trim(),
    color_token: update.colorToken,
  }));

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
