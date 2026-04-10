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

export type ParsedMutualAssignmentNote = {
  postingId: string | null;
  targetScheduleId: string | null;
  partnerEmployeeId: string | null;
  originalCompetencyId: string | null;
  originalTimeCodeId: string | null;
};

type ExistingMutualAssignmentState = {
  competency_id: string | null;
  time_code_id: string | null;
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

/**
 * Builds the schedule-assignment rows created when a mutual is accepted.
 *
 * Each worker keeps a row on their own dates and also gets a mirrored borrowed
 * row on the partner schedule for the dates they are covering. All involved
 * rows use time code `M`, while the note payload preserves the cell's original
 * state so leader cancellation can restore it later.
 */
export function buildAcceptedMutualAssignmentRows({
  postingId,
  mutualTimeCodeId,
  originalWorkerId,
  originalWorkerScheduleId,
  originalDates,
  applicantEmployeeId,
  applicantScheduleId,
  applicantDates,
  existingAssignments,
}: {
  postingId: string;
  mutualTimeCodeId: string;
  originalWorkerId: string;
  originalWorkerScheduleId: string;
  originalDates: Array<{ date: string; shiftKind: ShiftKind }>;
  applicantEmployeeId: string;
  applicantScheduleId: string;
  applicantDates: Array<{ date: string; shiftKind: ShiftKind }>;
  existingAssignments: Map<string, ExistingMutualAssignmentState>;
}) {
  const buildRow = ({
    employeeId,
    date,
    shiftKind,
    targetScheduleId,
    partnerEmployeeId,
  }: {
    employeeId: string;
    date: string;
    shiftKind: ShiftKind;
    targetScheduleId: string;
    partnerEmployeeId: string;
  }) => {
    const original = existingAssignments.get(`${employeeId}:${date}`);

    return {
      employee_id: employeeId,
      schedule_id: targetScheduleId,
      assignment_date: date,
      competency_id: null,
      time_code_id: mutualTimeCodeId,
      notes: buildMutualAssignmentNote({
        postingId,
        targetScheduleId,
        partnerEmployeeId,
        originalCompetencyId: original?.competency_id ?? null,
        originalTimeCodeId: original?.time_code_id ?? null,
      }),
      shift_kind: shiftKind,
    } satisfies MutualAssignmentRow;
  };

  return [
    ...originalDates.flatMap((row) => [
      buildRow({
        employeeId: originalWorkerId,
        date: row.date,
        shiftKind: row.shiftKind,
        targetScheduleId: originalWorkerScheduleId,
        partnerEmployeeId: applicantEmployeeId,
      }),
      buildRow({
        employeeId: applicantEmployeeId,
        date: row.date,
        shiftKind: row.shiftKind,
        targetScheduleId: originalWorkerScheduleId,
        partnerEmployeeId: originalWorkerId,
      }),
    ]),
    ...applicantDates.flatMap((row) => [
      buildRow({
        employeeId: applicantEmployeeId,
        date: row.date,
        shiftKind: row.shiftKind,
        targetScheduleId: applicantScheduleId,
        partnerEmployeeId: originalWorkerId,
      }),
      buildRow({
        employeeId: originalWorkerId,
        date: row.date,
        shiftKind: row.shiftKind,
        targetScheduleId: applicantScheduleId,
        partnerEmployeeId: applicantEmployeeId,
      }),
    ]),
  ];
}
