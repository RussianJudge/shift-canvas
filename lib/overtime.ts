import type { ShiftKind } from "@/lib/types";

export type OvertimeAssignmentRow = {
  employee_id: string;
  assignment_date: string;
  competency_id: string | null;
  time_code_id: string | null;
  notes: string | null;
  shift_kind: ShiftKind;
};

export type ParsedOvertimeNote = {
  claimantEmployeeId: string | null;
  claimedCompetencyId: string | null;
  coverageCompetencyId: string | null;
  swapEmployeeId: string | null;
  originalCompetencyId: string | null;
};

export function buildOvertimeAssignmentNote({
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

export function parseOvertimeAssignmentNote(note: string | null | undefined): ParsedOvertimeNote {
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

export function buildSwapOvertimeAssignmentRows({
  claimantEmployeeId,
  claimedCompetencyId,
  coverageCompetencyId,
  swapEmployeeId,
  dates,
  shiftKindForDate,
}: {
  claimantEmployeeId: string;
  claimedCompetencyId: string;
  coverageCompetencyId: string;
  swapEmployeeId: string;
  dates: string[];
  shiftKindForDate: (date: string) => ShiftKind;
}) {
  return dates.map<OvertimeAssignmentRow>((date) => ({
    employee_id: swapEmployeeId,
    assignment_date: date,
    competency_id: coverageCompetencyId,
    time_code_id: null,
    notes: buildOvertimeAssignmentNote({
      claimantEmployeeId,
      claimedCompetencyId,
      coverageCompetencyId,
      swapEmployeeId,
      originalCompetencyId: claimedCompetencyId,
    }),
    shift_kind: shiftKindForDate(date),
  }));
}
