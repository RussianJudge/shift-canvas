"use server";

import { revalidatePath } from "next/cache";

import type { SaveAssignmentsInput } from "@/lib/types";
import { getSupabaseAdminClient } from "@/lib/supabase";

export async function saveAssignments(input: SaveAssignmentsInput) {
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return {
      ok: false,
      message:
        "Supabase is not configured yet. Your draft is still available locally in this browser.",
    };
  }

  const rowsToUpsert = input.updates
    .filter((update) => update.competencyId)
    .map((update) => ({
      employee_id: update.employeeId,
      assignment_date: update.date,
      competency_id: update.competencyId,
      notes: update.notes ?? null,
      shift_kind: update.shiftKind,
    }));

  const rowsToDelete = input.updates
    .filter((update) => !update.competencyId)
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

  revalidatePath("/");

  return {
    ok: true,
    message: "Assignments saved to Supabase.",
  };
}
