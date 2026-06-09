import { createAssignmentKey } from "@/lib/scheduling";
import type { ShiftKind } from "@/lib/types";

export type TemporaryLoanRole = "source" | "target";

export type TemporaryLoanAssignmentRow = {
  employee_id: string;
  schedule_id: string;
  assignment_date: string;
  competency_id: string | null;
  time_code_id: string | null;
  notes: string | null;
  shift_kind: ShiftKind;
  company_id?: string;
  site_id?: string;
  business_area_id?: string;
};

export type ParsedTemporaryLoanNote = {
  loanId: string | null;
  role: TemporaryLoanRole | null;
  sourceScheduleId: string | null;
  targetScheduleId: string | null;
  targetCompetencyId: string | null;
  originalCompetencyId: string | null;
  originalTimeCodeId: string | null;
  originalNotes: string | null;
};

type ExistingLoanSourceState = {
  competency_id: string | null;
  time_code_id: string | null;
  notes: string | null;
};

function encodeNoteValue(value: string) {
  return encodeURIComponent(value);
}

function decodeNoteValue(value: string | undefined) {
  if (!value) {
    return null;
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function buildTemporaryLoanAssignmentNote({
  loanId,
  role,
  sourceScheduleId,
  targetScheduleId,
  targetCompetencyId,
  originalCompetencyId,
  originalTimeCodeId,
  originalNotes,
}: {
  loanId: string;
  role: TemporaryLoanRole;
  sourceScheduleId: string;
  targetScheduleId: string;
  targetCompetencyId: string;
  originalCompetencyId?: string | null;
  originalTimeCodeId?: string | null;
  originalNotes?: string | null;
}) {
  const parts = [
    "LOAN",
    `id:${loanId}`,
    `role:${role}`,
    `source:${sourceScheduleId}`,
    `target:${targetScheduleId}`,
    `comp:${targetCompetencyId}`,
  ];

  if (originalCompetencyId) {
    parts.push(`origc:${originalCompetencyId}`);
  }

  if (originalTimeCodeId) {
    parts.push(`origt:${originalTimeCodeId}`);
  }

  if (originalNotes) {
    parts.push(`orign:${encodeNoteValue(originalNotes)}`);
  }

  return parts.join("|");
}

export function parseTemporaryLoanAssignmentNote(
  note: string | null | undefined,
): ParsedTemporaryLoanNote {
  if (!note?.startsWith("LOAN|")) {
    return {
      loanId: null,
      role: null,
      sourceScheduleId: null,
      targetScheduleId: null,
      targetCompetencyId: null,
      originalCompetencyId: null,
      originalTimeCodeId: null,
      originalNotes: null,
    };
  }

  const values = new Map(
    note
      .split("|")
      .slice(1)
      .map((part) => {
        const [key, ...rest] = part.split(":");
        return [key, rest.join(":")];
      }),
  );
  const role = values.get("role");

  return {
    loanId: values.get("id") || null,
    role: role === "source" || role === "target" ? role : null,
    sourceScheduleId: values.get("source") || null,
    targetScheduleId: values.get("target") || null,
    targetCompetencyId: values.get("comp") || null,
    originalCompetencyId: values.get("origc") || null,
    originalTimeCodeId: values.get("origt") || null,
    originalNotes: decodeNoteValue(values.get("orign")),
  };
}

export function buildTemporaryLoanAssignmentRows({
  loanId,
  employeeId,
  sourceScheduleId,
  targetScheduleId,
  targetCompetencyId,
  dates,
  sourceShiftForDate,
  targetShiftForDate,
  existingSourceAssignments,
}: {
  loanId: string;
  employeeId: string;
  sourceScheduleId: string;
  targetScheduleId: string;
  targetCompetencyId: string;
  dates: string[];
  sourceShiftForDate: (date: string) => ShiftKind;
  targetShiftForDate: (date: string) => ShiftKind;
  existingSourceAssignments: Map<string, ExistingLoanSourceState>;
}) {
  return dates.flatMap<TemporaryLoanAssignmentRow>((date) => {
    const original = existingSourceAssignments.get(createAssignmentKey(sourceScheduleId, employeeId, date));

    return [
      {
        employee_id: employeeId,
        schedule_id: sourceScheduleId,
        assignment_date: date,
        competency_id: null,
        time_code_id: null,
        notes: buildTemporaryLoanAssignmentNote({
          loanId,
          role: "source",
          sourceScheduleId,
          targetScheduleId,
          targetCompetencyId,
          originalCompetencyId: original?.competency_id ?? null,
          originalTimeCodeId: original?.time_code_id ?? null,
          originalNotes: original?.notes ?? null,
        }),
        shift_kind: sourceShiftForDate(date),
      },
      {
        employee_id: employeeId,
        schedule_id: targetScheduleId,
        assignment_date: date,
        competency_id: targetCompetencyId,
        time_code_id: null,
        notes: buildTemporaryLoanAssignmentNote({
          loanId,
          role: "target",
          sourceScheduleId,
          targetScheduleId,
          targetCompetencyId,
        }),
        shift_kind: targetShiftForDate(date),
      },
    ];
  });
}
