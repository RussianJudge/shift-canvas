import type { ShiftKind } from "@/lib/types";

/**
 * Helpers for encoding accepted-mutual schedule rows.
 *
 * Mutual swaps are written into the same `schedule_assignments` table as the
 * main schedule. The note metadata tells the UI which schedule a borrowed row
 * belongs to and gives cancellation logic enough information to restore the
 * original cell state later.
 */
export type MutualAssignmentRow = {
  employee_id: string;
  assignment_date: string;
  competency_id: string | null;
  time_code_id: string | null;
  notes: string | null;
  shift_kind: ShiftKind;
};

export type ParsedMutualAssignmentNote = {
  postingId: string | null;
  targetScheduleId: string | null;
  partnerEmployeeId: string | null;
  originalCompetencyId: string | null;
  originalTimeCodeId: string | null;
};

export function buildMutualAssignmentNote({
  postingId,
  targetScheduleId,
  partnerEmployeeId,
  originalCompetencyId,
  originalTimeCodeId,
}: {
  postingId: string;
  targetScheduleId: string;
  partnerEmployeeId: string;
  originalCompetencyId?: string | null;
  originalTimeCodeId?: string | null;
}) {
  const parts = [
    "MUT",
    `posting:${postingId}`,
    `target:${targetScheduleId}`,
    `partner:${partnerEmployeeId}`,
  ];

  if (originalCompetencyId) {
    parts.push(`origc:${originalCompetencyId}`);
  }

  if (originalTimeCodeId) {
    parts.push(`origt:${originalTimeCodeId}`);
  }

  return parts.join("|");
}

export function parseMutualAssignmentNote(note: string | null | undefined): ParsedMutualAssignmentNote {
  if (!note?.startsWith("MUT|")) {
    return {
      postingId: null,
      targetScheduleId: null,
      partnerEmployeeId: null,
      originalCompetencyId: null,
      originalTimeCodeId: null,
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
    postingId: values.get("posting") || null,
    targetScheduleId: values.get("target") || null,
    partnerEmployeeId: values.get("partner") || null,
    originalCompetencyId: values.get("origc") || null,
    originalTimeCodeId: values.get("origt") || null,
  };
}
