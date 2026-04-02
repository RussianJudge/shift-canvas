"use server";

import { revalidatePath } from "next/cache";

import type {
  AppRole,
  ClaimOvertimePostingInput,
  ReleaseOvertimePostingInput,
  SaveAssignmentsInput,
  SaveCompetenciesInput,
  SavePersonnelInput,
  SaveSchedulesInput,
  SaveTimeCodesInput,
  SetScheduleCompletionInput,
  ShiftKind,
} from "@/lib/types";
import { getSchedulerSnapshot } from "@/lib/data";
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

type OvertimeAssignmentRow = {
  employee_id: string;
  assignment_date: string;
  competency_id: string | null;
  time_code_id: string | null;
  notes: string | null;
  shift_kind: ShiftKind;
};

type ParsedOvertimeNote = {
  claimantEmployeeId: string | null;
  claimedCompetencyId: string | null;
  coverageCompetencyId: string | null;
  swapEmployeeId: string | null;
  originalCompetencyId: string | null;
};

function isBlank(value: string) {
  return value.trim().length === 0;
}

function hasValidShiftPattern(dayShiftDays: number, nightShiftDays: number, offDays: number) {
  return [dayShiftDays, nightShiftDays, offDays].every((value) => Number.isInteger(value) && value >= 0) &&
    dayShiftDays + nightShiftDays + offDays > 0;
}

function buildOvertimeAssignmentNote({
  claimantEmployeeId,
  claimedCompetencyId,
  coverageCompetencyId,
  swapEmployeeId,
  originalCompetencyId,
}: {
  claimantEmployeeId: string;
  claimedCompetencyId: string;
  coverageCompetencyId?: string | null;
  swapEmployeeId?: string | null;
  originalCompetencyId?: string | null;
}) {
  const parts = [
    "OT",
    `claimant:${claimantEmployeeId}`,
    `claim:${claimedCompetencyId}`,
  ];

  if (coverageCompetencyId) {
    parts.push(`coverage:${coverageCompetencyId}`);
  }

  if (swapEmployeeId) {
    parts.push(`swap:${swapEmployeeId}`);
  }

  if (originalCompetencyId) {
    parts.push(`orig:${originalCompetencyId}`);
  }

  return parts.join("|");
}

function parseOvertimeAssignmentNote(note: string | null | undefined): ParsedOvertimeNote {
  if (!note?.startsWith("OT|")) {
    return {
      claimantEmployeeId: null,
      claimedCompetencyId: null,
      coverageCompetencyId: null,
      swapEmployeeId: null,
      originalCompetencyId: null,
    };
  }

  const values = new Map(
    note
      .split("|")
      .slice(1)
      .map((part) => {
        const [key, value] = part.split(":");
        return [key, value ?? ""];
      }),
  );

  return {
    claimantEmployeeId: values.get("claimant") || null,
    claimedCompetencyId: values.get("claim") || null,
    coverageCompetencyId: values.get("coverage") || null,
    swapEmployeeId: values.get("swap") || null,
    originalCompetencyId: values.get("orig") || null,
  };
}

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

async function requireActionRole(allowedRoles: AppRole[]) {
  const session = await getAppSession();

  if (!session || !allowedRoles.includes(session.role)) {
    return null;
  }

  return session;
}

async function removeStaleOvertimeClaims(supabase: SupabaseAdminClient, months: string[]) {
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

          if (!completedDateKeys.has(`${schedule.id}:${day.date}`)) {
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

    const assignmentDeleteResults = await Promise.all(
      claimsToRemove.map((claim) =>
        supabase
          .from("schedule_assignments")
          .delete()
          .eq("employee_id", claim.employeeId)
          .eq("assignment_date", claim.date)
          .eq("competency_id", claim.competencyId),
      ),
    );
    const firstAssignmentDeleteError = assignmentDeleteResults.find((result) => result.error)?.error;

    if (firstAssignmentDeleteError) {
      return {
        ok: false as const,
        message: `Assignments saved, but overtime cleanup failed: ${firstAssignmentDeleteError.message}`,
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
  }

  revalidatePath("/schedule");
  revalidatePath("/overtime");

  return {
    ok: true,
    message: "Set reopened for edits. Existing overtime claims were left in place.",
  };
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

    swapAssignmentRows = input.dates.map((date) => ({
      employee_id: swapEmployee.id,
      assignment_date: date,
      competency_id: coverageCompetencyId,
      time_code_id: null,
      notes: buildOvertimeAssignmentNote({
        claimantEmployeeId: input.employeeId,
        claimedCompetencyId: input.competencyId,
        coverageCompetencyId,
        swapEmployeeId: swapEmployee.id,
        originalCompetencyId: input.competencyId,
      }),
      shift_kind: shiftForDate(targetSchedule, date),
    }));
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

  const deleteResults = await Promise.all(
    input.dates.map((date) =>
      supabase
        .from("schedule_assignments")
        .delete()
        .eq("employee_id", input.employeeId)
        .eq("assignment_date", date)
        .eq("competency_id", input.competencyId)
    ),
  );

  const firstDeleteError = deleteResults.find((result) => result.error)?.error;

  if (firstDeleteError) {
    return {
      ok: false,
      message: `Could not clear overtime assignments: ${firstDeleteError.message}`,
    };
  }

  revalidatePath("/schedule");
  revalidatePath("/overtime");

  return {
    ok: true,
    message: "Overtime claim released.",
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
