export type StaffingAssignment = {
  scheduleId: string;
  date: string;
  competencyId: string | null;
  timeCodeId?: string | null;
  notes?: string | null;
};

export type StaffingOvertimeClaim = {
  scheduleId: string | null;
  date: string;
  competencyId: string | null;
};

export type StaffingSchedule = {
  id: string;
  competencyIds: string[];
};

export type StaffingCompetency = {
  id: string;
  code: string;
  requiredStaff: number;
};

function isOvertimeGeneratedAssignment(notes: string | null | undefined) {
  return notes?.startsWith("OT|") ?? false;
}

/**
 * Which post a mutual's worker takes when the swap lands them on another crew.
 *
 * Only posts they are qualified for and that the crew requires, and only ones
 * with room: overtime cover does not count towards a post being filled, since
 * the point of placing someone here is that they are on regular time.
 *
 * Where there is a choice, a genuinely open post wins, and a post somebody has
 * claimed overtime on is taken only when there is nothing else.
 *
 * That order used to be reversed, to let the regular-time body absorb a post
 * overtime was paying for. It saved nothing: the shortfall moved to whichever
 * post the worker vacated, to be posted and claimed again, while the person who
 * had claimed the original shift lost it without asking for any of it. A swap
 * between two people should not reshuffle a third one's work.
 */
export function findBestMutualCoverageCompetency({
  schedule,
  employeeCompetencyIds,
  date,
  competencies,
  assignments,
  overtimeClaims,
  pendingFillCounts,
}: {
  schedule: StaffingSchedule;
  employeeCompetencyIds: string[];
  date: string;
  competencies: StaffingCompetency[];
  assignments: StaffingAssignment[];
  overtimeClaims: StaffingOvertimeClaim[];
  pendingFillCounts: Map<string, number>;
}) {
  const candidates = competencies
    .filter(
      (competency) =>
        schedule.competencyIds.includes(competency.id) &&
        employeeCompetencyIds.includes(competency.id),
    )
    .map((competency) => {
      const fillKey = `${schedule.id}:${date}:${competency.id}`;
      const filledCount =
        assignments.reduce(
          (count, assignment) =>
            count +
            Number(
              assignment.scheduleId === schedule.id &&
                assignment.date === date &&
                assignment.competencyId === competency.id &&
                !isOvertimeGeneratedAssignment(assignment.notes),
            ),
          0,
        ) + (pendingFillCounts.get(fillKey) ?? 0);
      const openSlots = Math.max(0, competency.requiredStaff - filledCount);
      const attachedOvertimeClaims = overtimeClaims.filter(
        (claim) =>
          claim.scheduleId === schedule.id &&
          claim.date === date &&
          claim.competencyId === competency.id,
      ).length;

      return {
        competency,
        attachedOvertimeClaims,
        openSlots,
      };
    })
    .filter((entry) => entry.openSlots > 0)
    .sort(
      (left, right) =>
        left.attachedOvertimeClaims - right.attachedOvertimeClaims ||
        right.openSlots - left.openSlots ||
        left.competency.code.localeCompare(right.competency.code),
    );

  return candidates[0]?.competency.id ?? null;
}
