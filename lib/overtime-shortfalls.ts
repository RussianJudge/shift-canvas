import {
  createSetRangeKey,
  createSetRangeKeyFromEntry,
  getExtendedMonthDays,
  getMonthDays,
  getWorkedSetDays,
  shiftForDate,
} from "@/lib/scheduling";
import type { Competency, Schedule, SchedulerSnapshot, ShiftKind } from "@/lib/types";

type WorkingShiftKind = Exclude<ShiftKind, "OFF">;

/** Groups a schedule's month into worked sets and their day/night segments. */
export function getWorkedSets(
  schedule: Schedule,
  monthDays: Array<{ date: string }>,
  extendedMonthDays: Array<{ date: string }>,
) {
  const sets: Array<{
    dates: string[];
    segments: Array<{ shiftKind: WorkingShiftKind; dates: string[] }>;
  }> = [];
  const processedKeys = new Set<string>();

  for (const day of monthDays) {
    if (shiftForDate(schedule, day.date) === "OFF") {
      continue;
    }

    const setDays = getWorkedSetDays(schedule, extendedMonthDays, day.date);

    if (setDays.length === 0) {
      continue;
    }

    const setKey = `${setDays[0].date}:${setDays[setDays.length - 1].date}`;

    if (processedKeys.has(setKey)) {
      continue;
    }

    processedKeys.add(setKey);

    const segments = setDays.reduce<Array<{ shiftKind: WorkingShiftKind; dates: string[] }>>(
      (currentSegments, setDay) => {
        const shiftKind = shiftForDate(schedule, setDay.date);

        if (shiftKind === "OFF") {
          return currentSegments;
        }

        const currentSegment = currentSegments[currentSegments.length - 1];

        if (!currentSegment || currentSegment.shiftKind !== shiftKind) {
          currentSegments.push({ shiftKind, dates: [setDay.date] });
          return currentSegments;
        }

        currentSegment.dates.push(setDay.date);
        return currentSegments;
      },
      [],
    );

    sets.push({ dates: setDays.map((setDay) => setDay.date), segments });
  }

  return sets;
}

export function countScheduleAssignmentsForTarget({
  assignments,
  scheduleId,
  date,
  competencyId,
  timeCodeId = null,
}: {
  assignments: SchedulerSnapshot["assignments"];
  scheduleId: string;
  date: string;
  competencyId: string | null;
  timeCodeId?: string | null;
}) {
  return assignments.reduce(
    (count, assignment) =>
      count +
      Number(
        assignment.scheduleId === scheduleId &&
          assignment.date === date &&
          ((competencyId && assignment.competencyId === competencyId) ||
            (timeCodeId && assignment.timeCodeId === timeCodeId)),
      ),
    0,
  );
}

export type SegmentCoverage = {
  schedule: Schedule;
  shiftKind: WorkingShiftKind;
  competency: Competency;
  dates: string[];
  missingSlotsByDate: number[];
  maxMissing: number;
  staffedPeople: number;
};

/**
 * Staffing for every competency a schedule requires, across each day or night
 * segment of a completed set that starts in the snapshot's month.
 *
 * Only completed sets count: until a planner marks a set complete its gaps are
 * work in progress, not overtime. This is the one definition of a generated
 * overtime shortfall — the Overtime board renders from it and the server
 * notifies from it, so the two cannot disagree about what is open.
 */
export function buildCompletedSetCoverage(snapshot: SchedulerSnapshot): SegmentCoverage[] {
  const monthDays = getMonthDays(snapshot.month);
  const extendedMonthDays = getExtendedMonthDays(snapshot.month);
  const completedSetRangeKeys = new Set(snapshot.completedSets.map(createSetRangeKeyFromEntry));
  const coverage: SegmentCoverage[] = [];

  for (const schedule of snapshot.schedules) {
    const scheduleCompetencies = snapshot.competencies.filter((competency) =>
      schedule.competencyIds.includes(competency.id),
    );

    for (const workedSet of getWorkedSets(schedule, monthDays, extendedMonthDays)) {
      const setKey = createSetRangeKey(schedule.id, workedSet.dates[0], workedSet.dates[workedSet.dates.length - 1]);

      if (!completedSetRangeKeys.has(setKey)) {
        continue;
      }

      for (const segment of workedSet.segments) {
        if (segment.dates[0]?.slice(0, 7) !== snapshot.month) {
          continue;
        }

        for (const competency of scheduleCompetencies) {
          const missingSlotsByDate = segment.dates.map((date) => {
            const filledCount = countScheduleAssignmentsForTarget({
              assignments: snapshot.assignments,
              scheduleId: schedule.id,
              date,
              competencyId: competency.id,
            });

            return Math.max(0, competency.requiredStaff - filledCount);
          });
          const filledCells =
            segment.dates.length * competency.requiredStaff -
            missingSlotsByDate.reduce((sum, value) => sum + value, 0);

          coverage.push({
            schedule,
            shiftKind: segment.shiftKind,
            competency,
            dates: segment.dates,
            missingSlotsByDate,
            maxMissing: Math.max(0, ...missingSlotsByDate),
            staffedPeople: segment.dates.length > 0 ? filledCells / segment.dates.length : 0,
          });
        }
      }
    }
  }

  return coverage;
}

/**
 * The dates one open slot covers. Slot 0 is every date short at least one
 * person, slot 1 every date short at least two, and so on — so a segment short
 * two people on Tuesday and one on Wednesday yields slot 0 for both days and
 * slot 1 for Tuesday alone.
 */
export function getOpenSlotDates(coverage: Pick<SegmentCoverage, "dates" | "missingSlotsByDate">, slotIndex: number) {
  return coverage.dates.filter((_, index) => coverage.missingSlotsByDate[index] > slotIndex);
}

export type OvertimeShortfall = {
  key: string;
  scheduleId: string;
  scheduleName: string;
  competencyId: string;
  competencyCode: string;
  shiftKind: WorkingShiftKind;
  slotIndex: number;
  dates: string[];
};

/**
 * Identifies an open slot by where it sits in the rotation rather than by the
 * dates it currently covers. Those dates move as people are shuffled around;
 * the segment's first day and the slot's depth do not, so a slot keeps one
 * identity for as long as it stays open.
 */
export function buildShortfallKey(input: {
  scheduleId: string;
  competencyId: string;
  segmentStart: string;
  slotIndex: number;
}) {
  return `${input.segmentStart.slice(0, 7)}:${input.scheduleId}:${input.competencyId}:${input.segmentStart}:${input.slotIndex}`;
}

/** Every open generated-overtime slot, keyed stably, from `today` onward. */
export function findOvertimeShortfalls(snapshot: SchedulerSnapshot, today: string): OvertimeShortfall[] {
  return buildCompletedSetCoverage(snapshot).flatMap((coverage) =>
    Array.from({ length: coverage.maxMissing }, (_, slotIndex) => slotIndex).flatMap((slotIndex) => {
      const dates = getOpenSlotDates(coverage, slotIndex).filter((date) => date >= today);

      if (dates.length === 0) {
        return [];
      }

      return [
        {
          key: buildShortfallKey({
            scheduleId: coverage.schedule.id,
            competencyId: coverage.competency.id,
            segmentStart: coverage.dates[0],
            slotIndex,
          }),
          scheduleId: coverage.schedule.id,
          scheduleName: coverage.schedule.name,
          competencyId: coverage.competency.id,
          competencyCode: coverage.competency.code,
          shiftKind: coverage.shiftKind,
          slotIndex,
          dates,
        },
      ];
    }),
  );
}
