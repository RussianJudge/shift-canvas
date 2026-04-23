"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

import {
  formatMonthLabel,
  getEmployeeMap,
  getMonthDays,
  shiftMonthKey,
  shiftForDate,
} from "@/lib/scheduling";
import type { Competency, OvertimeClaim, SchedulerSnapshot, StoredAssignment, TimeCode } from "@/lib/types";

/**
 * Metrics dashboard and planning sandbox.
 *
 * The charts are read-only summaries built from the current month snapshot.
 * The "Shift Transfer" tool is also intentionally read-only: it calculates a
 * best-fit single-person move without mutating live schedule or personnel data.
 */
type TeamCompetencyMetric = {
  competencyId: string;
  code: string;
  colorToken: string;
  qualifiedPeople: number;
};

type TeamMetric = {
  scheduleId: string;
  scheduleName: string;
  competencyMetrics: TeamCompetencyMetric[];
  shiftFragilityMetrics: ShiftFragilityMetric[];
  overtimeShifts: number;
  overtimeWorkers: number;
  topCompetencyCode: string | null;
  topOvertimeCompetencies: Array<{
    competencyId: string;
    code: string;
    claimedShifts: number;
  }>;
  topOvertimePeople: Array<{
    employeeId: string;
    employeeName: string;
    claimedShifts: number;
  }>;
};

type ShiftFragilityMetric = {
  competencyId: string;
  code: string;
  colorToken: string;
  riskScore: number;
  overtimeClaims: number;
  recentWeight: number;
  qualifiedPeople: number;
  requiredStaff: number;
  lastClaimDate: string | null;
};

type FatigueBand = "green" | "amber" | "red" | "critical";

type EmployeeFatigueMetric = {
  employeeId: string;
  employeeName: string;
  consecutiveShifts: number;
  band: FatigueBand;
  excessOverNormalCycle: number;
};

type TeamFatigueMetric = {
  scheduleId: string;
  scheduleName: string;
  totalScheduledEmployees: number;
  greenCount: number;
  amberCount: number;
  redCount: number;
  criticalCount: number;
  highestStreak: number;
  countAboveNormalCycle: number;
  averageConsecutiveShifts: number;
  topEmployees: EmployeeFatigueMetric[];
};

type TeamTimeCodeMetric = {
  scheduleId: string;
  scheduleName: string;
  entryCount: number;
  peopleCount: number;
  topPeople: Array<{
    employeeId: string;
    employeeName: string;
    codedShifts: number;
  }>;
};

type OvertimeMetricEntry = {
  scheduleId: string;
  employeeId: string;
  competencyId: string | null;
  date: string;
};

type OvertimeWindow = "30d" | "90d" | "1y" | "ytd";
type TimeCodeWindow = "30d" | "90d" | "1y" | "ytd";
type FragilityWindow = OvertimeWindow;
const NORMAL_FATIGUE_CYCLE = 6;
const FATIGUE_LOOKBACK_DAYS = 30;

type TransferProjection = {
  competencyId: string;
  code: string;
  colorToken: string;
  sourceCount: number;
  targetCount: number;
  nextSourceCount: number;
  nextTargetCount: number;
  included: boolean;
  improvesTarget: boolean;
};

type TransferSuggestion = {
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  sourceScheduleName: string;
  targetScheduleName: string;
  score: number;
  matchedCompetencyIds: string[];
  projections: TransferProjection[];
};

/** Pads "top 3" lists with blanks so metric cards keep a stable height. */
function padMetricPeopleRows<T extends { employeeId: string; employeeName: string }>(rows: T[], size = 3) {
  return Array.from({ length: size }, (_, index) => rows[index] ?? null);
}

/** Generic version used for non-person metric rows that still need stable height. */
function padMetricRows<T>(rows: T[], size = 3) {
  return Array.from({ length: size }, (_, index) => rows[index] ?? null);
}

/** Creates an inclusive UTC date list for streak scans. */
function getDateRange(startDate: string, endDate: string) {
  const days = daysBetweenDateKeys(startDate, endDate);

  return Array.from({ length: days + 1 }, (_, index) => shiftDateKey(startDate, index));
}

/** Shifts an ISO date string by whole days while keeping the result in UTC. */
function shiftDateKey(dateKey: string, deltaDays: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return shifted.toISOString().slice(0, 10);
}

/** Counts calendar days between two ISO date keys in UTC. */
function daysBetweenDateKeys(startDate: string, endDate: string) {
  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const [endYear, endMonth, endDay] = endDate.split("-").map(Number);
  const startTime = Date.UTC(startYear, startMonth - 1, startDay);
  const endTime = Date.UTC(endYear, endMonth - 1, endDay);

  return Math.max(0, Math.round((endTime - startTime) / 86_400_000));
}

/** Returns the first day included in the selected overtime time window. */
function getWindowStart(today: string, window: OvertimeWindow) {
  switch (window) {
    case "30d":
      return shiftDateKey(today, -29);
    case "90d":
      return shiftDateKey(today, -89);
    case "1y":
      return shiftDateKey(today, -364);
    case "ytd":
      return `${today.slice(0, 4)}-01-01`;
  }
}

/** Returns the first day included in the selected time-code analytics window. */
function getTimeCodeWindowStart(today: string, window: TimeCodeWindow) {
  switch (window) {
    case "30d":
      return shiftDateKey(today, -29);
    case "90d":
      return shiftDateKey(today, -89);
    case "1y":
      return shiftDateKey(today, -364);
    case "ytd":
      return `${today.slice(0, 4)}-01-01`;
  }
}

/** Returns the last day inside the selected snapshot month. */
function getMonthEndDateKey(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const monthEnd = new Date(Date.UTC(year, monthNumber, 0));
  return monthEnd.toISOString().slice(0, 10);
}

/**
 * Uses the literal last day of the selected month as the reporting anchor.
 *
 * This makes the rolling windows read as "what would 30d / 90d / 1Y / YTD look
 * like as of the end of the chosen month?" instead of blending that question
 * with today's real date.
 */
function getMetricsAnchorDate(month: string) {
  return getMonthEndDateKey(month);
}

/** Compact label used to show which day the rolling windows are anchored to. */
function formatAnchorDateLabel(isoDate: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

function formatFragilityScore(score: number) {
  return score.toFixed(1);
}

function getFatigueBand(consecutiveShifts: number): FatigueBand {
  if (consecutiveShifts <= 6) {
    return "green";
  }

  if (consecutiveShifts <= 12) {
    return "amber";
  }

  if (consecutiveShifts < 18) {
    return "red";
  }

  return "critical";
}

function formatFatigueBandLabel(band: FatigueBand) {
  return band[0].toUpperCase() + band.slice(1);
}

function isNonWorkingTimeCode(timeCode: TimeCode | undefined) {
  if (!timeCode) {
    return false;
  }

  const code = timeCode.code.trim().toUpperCase();
  const label = timeCode.label.trim().toUpperCase();

  return (
    code === "OFF" ||
    code === "V" ||
    code === "VAC" ||
    code === "VACATION" ||
    code === "BOT" ||
    label.includes("BOOKED OFF") ||
    label.includes("VACATION") ||
    label.includes("LEAVE")
  );
}

function isWorkingAssignment(assignment: StoredAssignment, timeCodeMap: Record<string, TimeCode>) {
  if (assignment.competencyId) {
    return true;
  }

  if (!assignment.timeCodeId) {
    return false;
  }

  return !isNonWorkingTimeCode(timeCodeMap[assignment.timeCodeId]);
}

/**
 * Converts schedule rows entered on a worker's rostered day off into overtime
 * metric events.
 *
 * Claimed overtime already has an `overtime_claims` row and an assignment row,
 * so those claim-backed assignment rows are skipped here. This keeps metrics
 * from double-counting normal claimed OT while still counting leader-entered
 * work that was keyed straight into the schedule.
 */
function getManualOffDayOvertimeEntries(
  snapshot: SchedulerSnapshot,
  assignmentHistory: StoredAssignment[],
  claimEntries: OvertimeMetricEntry[],
): OvertimeMetricEntry[] {
  const employeeMap = getEmployeeMap(snapshot.schedules);
  const scheduleMap = Object.fromEntries(
    snapshot.schedules.map((schedule) => [schedule.id, schedule]),
  );
  const timeCodeMap = Object.fromEntries(
    snapshot.timeCodes.map((timeCode) => [timeCode.id, timeCode]),
  ) as Record<string, TimeCode>;
  const claimKeys = new Set(
    claimEntries.map(
      (claim) => `${claim.scheduleId}:${claim.employeeId}:${claim.date}:${claim.competencyId ?? ""}`,
    ),
  );

  return assignmentHistory.flatMap((assignment) => {
    const employee = employeeMap[assignment.employeeId];
    const homeSchedule = employee ? scheduleMap[employee.scheduleId] : null;

    if (!employee || !homeSchedule) {
      return [];
    }

    if (shiftForDate(homeSchedule, assignment.date) !== "OFF") {
      return [];
    }

    if (!isWorkingAssignment(assignment, timeCodeMap)) {
      return [];
    }

    const claimKey = `${assignment.scheduleId}:${assignment.employeeId}:${assignment.date}:${assignment.competencyId ?? ""}`;

    if (claimKeys.has(claimKey) || assignment.notes?.startsWith("OT|")) {
      return [];
    }

    return [
      {
        scheduleId: assignment.scheduleId ?? employee.scheduleId,
        employeeId: assignment.employeeId,
        competencyId: assignment.competencyId,
        date: assignment.date,
      },
    ];
  });
}

/** Builds the overtime events used by metrics cards from claims plus manual schedule work. */
function getOvertimeMetricEntries(
  snapshot: SchedulerSnapshot,
  overtimeClaims: OvertimeClaim[],
  assignmentHistory: StoredAssignment[],
) {
  const claimEntries = overtimeClaims.map<OvertimeMetricEntry>((claim) => ({
    scheduleId: claim.scheduleId,
    employeeId: claim.employeeId,
    competencyId: claim.competencyId,
    date: claim.date,
  }));

  return [
    ...claimEntries,
    ...getManualOffDayOvertimeEntries(snapshot, assignmentHistory, claimEntries),
  ];
}

/** Summarizes one chosen time code across teams for the selected history window. */
function getTeamTimeCodeMetrics(
  snapshot: SchedulerSnapshot,
  assignmentHistory: StoredAssignment[],
  timeCodeId: string,
): TeamTimeCodeMetric[] {
  const employeeMap = getEmployeeMap(snapshot.schedules);
  const matchingAssignments = assignmentHistory.filter(
    (assignment) => assignment.timeCodeId === timeCodeId,
  );

  return snapshot.schedules.map((schedule) => {
    const scheduleAssignments = matchingAssignments.filter((assignment) => {
      return (assignment.scheduleId ?? employeeMap[assignment.employeeId]?.scheduleId) === schedule.id;
    });

    const countsByEmployee = scheduleAssignments.reduce<Record<string, number>>((counts, assignment) => {
      counts[assignment.employeeId] = (counts[assignment.employeeId] ?? 0) + 1;
      return counts;
    }, {});

    const topPeople = Object.entries(countsByEmployee)
      .map(([employeeId, codedShifts]) => ({
        employeeId,
        employeeName: employeeMap[employeeId]?.name ?? employeeId,
        codedShifts,
      }))
      .sort(
        (left, right) =>
          right.codedShifts - left.codedShifts ||
          left.employeeName.localeCompare(right.employeeName),
      )
      .slice(0, 3);

    return {
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      entryCount: scheduleAssignments.length,
      peopleCount: Object.keys(countsByEmployee).length,
      topPeople,
    };
  });
}

function getTeamFatigueMetrics({
  snapshot,
  assignmentHistory,
  overtimeHistory,
  month,
}: {
  snapshot: SchedulerSnapshot;
  assignmentHistory: StoredAssignment[];
  overtimeHistory: OvertimeClaim[];
  month: string;
}): TeamFatigueMetric[] {
  const monthDays = getMonthDays(month);
  const monthStart = monthDays[0]?.date ?? `${month}-01`;
  const monthEnd = monthDays[monthDays.length - 1]?.date ?? getMonthEndDateKey(month);
  const scanStart = shiftDateKey(monthStart, -FATIGUE_LOOKBACK_DAYS);
  const scanDates = getDateRange(scanStart, monthEnd);
  const timeCodeMap = Object.fromEntries(
    snapshot.timeCodes.map((timeCode) => [timeCode.id, timeCode]),
  ) as Record<string, TimeCode>;
  const assignmentsByEmployeeDate = assignmentHistory.reduce<Map<string, StoredAssignment[]>>((map, assignment) => {
    const key = `${assignment.employeeId}:${assignment.date}`;
    const existing = map.get(key);

    if (existing) {
      existing.push(assignment);
      return map;
    }

    map.set(key, [assignment]);
    return map;
  }, new Map<string, StoredAssignment[]>());
  const overtimeClaimDatesByEmployee = overtimeHistory.reduce<Record<string, Set<string>>>((map, claim) => {
    map[claim.employeeId] ??= new Set<string>();
    map[claim.employeeId].add(claim.date);
    return map;
  }, {});

  return snapshot.schedules.map((schedule) => {
    const employeeMetrics = schedule.employees.map<EmployeeFatigueMetric>((employee) => {
      let currentStreak = 0;
      let highestStreak = 0;

      for (const date of scanDates) {
        const assignmentEntries = assignmentsByEmployeeDate.get(`${employee.id}:${date}`) ?? [];
        const hasWorkedAssignment = assignmentEntries.some((assignment) => {
          if (assignment.competencyId) {
            return true;
          }

          if (!assignment.timeCodeId) {
            return false;
          }

          return !isNonWorkingTimeCode(timeCodeMap[assignment.timeCodeId]);
        });
        const defaultWorkedShift = shiftForDate(schedule, date) !== "OFF";
        const hasOvertimeClaim = overtimeClaimDatesByEmployee[employee.id]?.has(date) ?? false;

        /**
         * Fatigue is intentionally based on worked-day exposure only. The base
         * rotation counts as work, overtime/mutual/saved work entries add work
         * exposure, and obvious leave/off time codes break the streak.
         */
        const workedDate =
          defaultWorkedShift || hasOvertimeClaim || hasWorkedAssignment;

        currentStreak = workedDate ? currentStreak + 1 : 0;

        if (date >= monthStart) {
          highestStreak = Math.max(highestStreak, currentStreak);
        }
      }

      return {
        employeeId: employee.id,
        employeeName: employee.name,
        consecutiveShifts: highestStreak,
        band: getFatigueBand(highestStreak),
        excessOverNormalCycle: Math.max(0, highestStreak - NORMAL_FATIGUE_CYCLE),
      };
    });
    const bandCounts = employeeMetrics.reduce<Record<FatigueBand, number>>(
      (counts, employee) => {
        counts[employee.band] += 1;
        return counts;
      },
      { green: 0, amber: 0, red: 0, critical: 0 },
    );
    const topEmployees = [...employeeMetrics]
      .sort(
        (left, right) =>
          right.consecutiveShifts - left.consecutiveShifts ||
          left.employeeName.localeCompare(right.employeeName),
      )
      .slice(0, 3);
    const totalConsecutiveShifts = employeeMetrics.reduce(
      (total, employee) => total + employee.consecutiveShifts,
      0,
    );

    return {
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      totalScheduledEmployees: schedule.employees.length,
      greenCount: bandCounts.green,
      amberCount: bandCounts.amber,
      redCount: bandCounts.red,
      criticalCount: bandCounts.critical,
      highestStreak: topEmployees[0]?.consecutiveShifts ?? 0,
      countAboveNormalCycle: employeeMetrics.filter(
        (employee) => employee.consecutiveShifts > NORMAL_FATIGUE_CYCLE,
      ).length,
      averageConsecutiveShifts:
        employeeMetrics.length === 0 ? 0 : totalConsecutiveShifts / employeeMetrics.length,
      topEmployees,
    };
  });
}

/** Builds the main dashboard summaries shown on the metrics screen. */
function getTeamMetrics(
  snapshot: SchedulerSnapshot,
  overtimeEntries: OvertimeMetricEntry[],
  fragilityEntries: OvertimeMetricEntry[],
  anchorDate: string,
): TeamMetric[] {
  const employeeMap = getEmployeeMap(snapshot.schedules);
  const competencyMap = Object.fromEntries(
    snapshot.competencies.map((competency) => [competency.id, competency]),
  ) as Record<string, Competency>;

  return snapshot.schedules.map((schedule) => {
    const competencyMetrics = snapshot.competencies
      .map((competency) => ({
        competencyId: competency.id,
        code: competency.code,
        colorToken: competency.colorToken,
        qualifiedPeople: schedule.employees.filter((employee) =>
          employee.competencyIds.includes(competency.id),
        ).length,
      }))
      .sort((left, right) => right.qualifiedPeople - left.qualifiedPeople || left.code.localeCompare(right.code));

    const incurredOvertimeEntries = overtimeEntries.filter((claim) => {
      if (claim.scheduleId !== schedule.id) {
        return false;
      }

      const claimEmployee = employeeMap[claim.employeeId];
      return Boolean(claimEmployee);
    });
    const fragilityOvertimeEntries = fragilityEntries.filter((claim) => {
      if (claim.scheduleId !== schedule.id) {
        return false;
      }

      const claimEmployee = employeeMap[claim.employeeId];
      return Boolean(claimEmployee && claim.competencyId);
    });

    const overtimeCounts = incurredOvertimeEntries.reduce<Record<string, number>>((counts, claim) => {
      if (!claim.competencyId) {
        return counts;
      }

      counts[claim.competencyId] = (counts[claim.competencyId] ?? 0) + 1;
      return counts;
    }, {});

    const topOvertimeCompetencyId =
      Object.entries(overtimeCounts).sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;

    const topCompetencyCode =
      (topOvertimeCompetencyId ? competencyMap[topOvertimeCompetencyId]?.code : null) ?? null;

    const topOvertimeCompetencies = Object.entries(overtimeCounts)
      .map(([competencyId, claimedShifts]) => ({
        competencyId,
        code: competencyMap[competencyId]?.code ?? competencyId,
        claimedShifts,
      }))
      .sort(
        (left, right) =>
          right.claimedShifts - left.claimedShifts ||
          left.code.localeCompare(right.code),
      )
      .slice(0, 3);

    const overtimePeopleCounts = incurredOvertimeEntries.reduce<Record<string, number>>((counts, claim) => {
      counts[claim.employeeId] = (counts[claim.employeeId] ?? 0) + 1;
      return counts;
    }, {});

    const topOvertimePeople = Object.entries(overtimePeopleCounts)
      .map(([employeeId, claimedShifts]) => ({
        employeeId,
        employeeName: employeeMap[employeeId]?.name ?? employeeId,
        claimedShifts,
      }))
      .sort(
        (left, right) =>
          right.claimedShifts - left.claimedShifts ||
          left.employeeName.localeCompare(right.employeeName),
      )
      .slice(0, 3);

    const shiftFragilityMetrics = snapshot.competencies
      .map((competency) => {
        const claims = fragilityOvertimeEntries.filter((claim) => claim.competencyId === competency.id);
        const qualifiedPeople = schedule.employees.filter((employee) =>
          employee.competencyIds.includes(competency.id),
        ).length;
        const requiredStaff = Math.max(1, competency.requiredStaff);
        const lastClaimDate = claims
          .map((claim) => claim.date)
          .sort((left, right) => right.localeCompare(left))[0] ?? null;
        const recentWeight = claims.reduce((total, claim) => {
          const daysAgo = daysBetweenDateKeys(claim.date, anchorDate);

          /**
           * Every claim counts, but recent overtime should move a competency
           * higher on the fragility list because it represents a risk that has
           * happened under the current staffing reality.
           */
          return total + Math.max(0.25, 1 - daysAgo / 365);
        }, 0);
        const coverageRatio = qualifiedPeople / requiredStaff;
        const depthMultiplier =
          qualifiedPeople === 0
            ? 3
            : coverageRatio < 1
            ? 2.4
            : coverageRatio < 1.5
            ? 1.8
            : coverageRatio < 2
            ? 1.35
            : 1;

        return {
          competencyId: competency.id,
          code: competency.code,
          colorToken: competency.colorToken,
          riskScore: recentWeight * depthMultiplier,
          overtimeClaims: claims.length,
          recentWeight,
          qualifiedPeople,
          requiredStaff,
          lastClaimDate,
        } satisfies ShiftFragilityMetric;
      })
      .filter((metric) => metric.overtimeClaims > 0)
      .sort(
        (left, right) =>
          right.riskScore - left.riskScore ||
          right.overtimeClaims - left.overtimeClaims ||
          left.code.localeCompare(right.code),
      )
      .slice(0, 3);

    return {
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      competencyMetrics,
      shiftFragilityMetrics,
      overtimeShifts: incurredOvertimeEntries.length,
      overtimeWorkers: new Set(incurredOvertimeEntries.map((claim) => claim.employeeId)).size,
      topCompetencyCode,
      topOvertimeCompetencies,
      topOvertimePeople,
    };
  });
}

/** Precomputes per-team qualified staff counts for transfer planning. */
function buildQualifiedCountMap(snapshot: SchedulerSnapshot) {
  return Object.fromEntries(
    snapshot.schedules.map((schedule) => [
      schedule.id,
      Object.fromEntries(
        snapshot.competencies.map((competency) => [
          competency.id,
          schedule.employees.filter((employee) => employee.competencyIds.includes(competency.id)).length,
        ]),
      ),
    ]),
  ) as Record<string, Record<string, number>>;
}

/**
 * Scores the best single-person move from one shift to another for a selected
 * set of competencies. Higher scores favor teams that gain scarce coverage
 * without overly hollowing out the source shift.
 */
function getTransferSuggestions({
  snapshot,
  sourceScheduleId,
  targetScheduleId,
  selectedCompetencyIds,
}: {
  snapshot: SchedulerSnapshot;
  sourceScheduleId: string;
  targetScheduleId: string;
  selectedCompetencyIds: string[];
}) {
  if (
    !sourceScheduleId ||
    !targetScheduleId ||
    sourceScheduleId === targetScheduleId ||
    selectedCompetencyIds.length === 0
  ) {
    return [];
  }

  const sourceSchedule = snapshot.schedules.find((schedule) => schedule.id === sourceScheduleId);
  const targetSchedule = snapshot.schedules.find((schedule) => schedule.id === targetScheduleId);

  if (!sourceSchedule || !targetSchedule) {
    return [];
  }

  const competencyMap = Object.fromEntries(snapshot.competencies.map((competency) => [competency.id, competency])) as Record<
    string,
    Competency
  >;
  const qualifiedCountMap = buildQualifiedCountMap(snapshot);
  const suggestions: TransferSuggestion[] = [];

  for (const employee of sourceSchedule.employees) {
    const matchedCompetencyIds = selectedCompetencyIds.filter((competencyId) =>
      employee.competencyIds.includes(competencyId),
    );

    if (matchedCompetencyIds.length === 0) {
      continue;
    }

    const projections = selectedCompetencyIds
      .map((competencyId) => {
        const competency = competencyMap[competencyId];

        if (!competency) {
          return null;
        }

        const sourceCount = qualifiedCountMap[sourceScheduleId]?.[competencyId] ?? 0;
        const targetCount = qualifiedCountMap[targetScheduleId]?.[competencyId] ?? 0;
        const included = matchedCompetencyIds.includes(competencyId);
        const nextSourceCount = sourceCount - Number(included);
        const nextTargetCount = targetCount + Number(included);

        return {
          competencyId,
          code: competency.code,
          colorToken: competency.colorToken,
          sourceCount,
          targetCount,
          nextSourceCount,
          nextTargetCount,
          included,
          improvesTarget: included && nextTargetCount > targetCount,
        } satisfies TransferProjection;
      })
      .filter((projection): projection is TransferProjection => Boolean(projection));

    const score =
      projections.reduce((total, projection) => {
        if (!projection.included) {
          return total;
        }

        const targetNeedWeight =
          projection.targetCount === 0 ? 2.6 : 1.6 / (projection.targetCount + 1);
        const balanceWeight = projection.targetCount < projection.sourceCount ? 0.9 : 0.2;
        const sourcePenalty =
          projection.sourceCount <= 1 ? 2.4 : 0.8 / projection.sourceCount;
        const overswingPenalty =
          projection.nextSourceCount < projection.targetCount ? 0.45 : 0;

        return total + targetNeedWeight + balanceWeight - sourcePenalty - overswingPenalty;
      }, 0) + matchedCompetencyIds.length * 0.35;

    suggestions.push({
      employeeId: employee.id,
      employeeName: employee.name,
      employeeRole: employee.role,
      sourceScheduleName: sourceSchedule.name,
      targetScheduleName: targetSchedule.name,
      score,
      matchedCompetencyIds,
      projections,
    });
  }

  const topMatchCount = suggestions.reduce(
    (best, suggestion) => Math.max(best, suggestion.matchedCompetencyIds.length),
    0,
  );

  return suggestions
    .filter((suggestion) => suggestion.matchedCompetencyIds.length === topMatchCount)
    .sort(
    (left, right) =>
      right.score - left.score ||
      right.matchedCompetencyIds.length - left.matchedCompetencyIds.length ||
      left.employeeName.localeCompare(right.employeeName),
  );
}

export function MetricsPanel({
  snapshot,
  overtimeHistory,
  assignmentHistory,
}: {
  snapshot: SchedulerSnapshot;
  overtimeHistory: OvertimeClaim[];
  assignmentHistory: StoredAssignment[];
}) {
  const router = useRouter();
  const [overtimeWindow, setOvertimeWindow] = useState<OvertimeWindow>("30d");
  const [fragilityWindow, setFragilityWindow] = useState<FragilityWindow>("1y");
  const [timeCodeWindow, setTimeCodeWindow] = useState<TimeCodeWindow>("30d");
  const [selectedTimeCodeId, setSelectedTimeCodeId] = useState(snapshot.timeCodes[0]?.id ?? "");
  const metricsAnchorDate = useMemo(
    () => getMetricsAnchorDate(snapshot.month),
    [snapshot.month],
  );
  const filteredOvertimeHistory = useMemo(() => {
    const start = getWindowStart(metricsAnchorDate, overtimeWindow);
    return overtimeHistory.filter((claim) => claim.date >= start && claim.date <= metricsAnchorDate);
  }, [overtimeHistory, overtimeWindow, metricsAnchorDate]);
  const filteredFragilityHistory = useMemo(() => {
    const start = getWindowStart(metricsAnchorDate, fragilityWindow);
    return overtimeHistory.filter((claim) => claim.date >= start && claim.date <= metricsAnchorDate);
  }, [overtimeHistory, fragilityWindow, metricsAnchorDate]);
  const filteredAssignmentHistory = useMemo(() => {
    const start = getTimeCodeWindowStart(metricsAnchorDate, timeCodeWindow);
    return assignmentHistory.filter((assignment) => assignment.date >= start && assignment.date <= metricsAnchorDate);
  }, [assignmentHistory, timeCodeWindow, metricsAnchorDate]);
  const filteredOvertimeAssignmentHistory = useMemo(() => {
    const start = getWindowStart(metricsAnchorDate, overtimeWindow);
    return assignmentHistory.filter((assignment) => assignment.date >= start && assignment.date <= metricsAnchorDate);
  }, [assignmentHistory, overtimeWindow, metricsAnchorDate]);
  const filteredFragilityAssignmentHistory = useMemo(() => {
    const start = getWindowStart(metricsAnchorDate, fragilityWindow);
    return assignmentHistory.filter((assignment) => assignment.date >= start && assignment.date <= metricsAnchorDate);
  }, [assignmentHistory, fragilityWindow, metricsAnchorDate]);
  const filteredOvertimeEntries = useMemo(
    () => getOvertimeMetricEntries(snapshot, filteredOvertimeHistory, filteredOvertimeAssignmentHistory),
    [snapshot, filteredOvertimeHistory, filteredOvertimeAssignmentHistory],
  );
  const filteredFragilityEntries = useMemo(
    () => getOvertimeMetricEntries(snapshot, filteredFragilityHistory, filteredFragilityAssignmentHistory),
    [snapshot, filteredFragilityHistory, filteredFragilityAssignmentHistory],
  );
  const teamMetrics = useMemo(
    () => getTeamMetrics(snapshot, filteredOvertimeEntries, filteredFragilityEntries, metricsAnchorDate),
    [snapshot, filteredOvertimeEntries, filteredFragilityEntries, metricsAnchorDate],
  );
  const maxQualifiedPeople = Math.max(
    1,
    ...teamMetrics.flatMap((team) => team.competencyMetrics.map((metric) => metric.qualifiedPeople)),
  );
  const maxOvertimeShifts = Math.max(1, ...teamMetrics.map((team) => team.overtimeShifts));
  const maxFragilityScore = Math.max(
    1,
    ...teamMetrics.flatMap((team) => team.shiftFragilityMetrics.map((metric) => metric.riskScore)),
  );
  const teamFatigueMetrics = useMemo(
    () =>
      getTeamFatigueMetrics({
        snapshot,
        assignmentHistory,
        overtimeHistory,
        month: snapshot.month,
      }),
    [snapshot, assignmentHistory, overtimeHistory],
  );
  const teamTimeCodeMetrics = useMemo(
    () => getTeamTimeCodeMetrics(snapshot, filteredAssignmentHistory, selectedTimeCodeId),
    [snapshot, filteredAssignmentHistory, selectedTimeCodeId],
  );
  const maxTimeCodeShifts = Math.max(1, ...teamTimeCodeMetrics.map((team) => team.entryCount));
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [sourceScheduleId, setSourceScheduleId] = useState(snapshot.schedules[0]?.id ?? "");
  const [targetScheduleId, setTargetScheduleId] = useState(snapshot.schedules[1]?.id ?? snapshot.schedules[0]?.id ?? "");
  const [selectedTransferCompetencyIds, setSelectedTransferCompetencyIds] = useState<string[]>([]);
  const [transferSuggestions, setTransferSuggestions] = useState<TransferSuggestion[]>([]);
  const [selectedTransferSuggestionIndex, setSelectedTransferSuggestionIndex] = useState(0);
  const [transferMessage, setTransferMessage] = useState("");

  function navigateMonth(delta: number) {
    const nextMonth = shiftMonthKey(snapshot.month, delta);
    router.push(`/metrics?month=${nextMonth}`, { scroll: false });
  }

  useEffect(() => {
    setSelectedTimeCodeId((current) =>
      snapshot.timeCodes.some((timeCode) => timeCode.id === current) ? current : snapshot.timeCodes[0]?.id ?? "",
    );
    setSourceScheduleId((current) =>
      snapshot.schedules.some((schedule) => schedule.id === current) ? current : snapshot.schedules[0]?.id ?? "",
    );
    setTargetScheduleId((current) => {
      if (snapshot.schedules.some((schedule) => schedule.id === current)) {
        return current;
      }

      return snapshot.schedules[1]?.id ?? snapshot.schedules[0]?.id ?? "";
    });
    setSelectedTransferCompetencyIds((current) =>
      current.filter((competencyId) => snapshot.competencies.some((competency) => competency.id === competencyId)),
    );
    setTransferSuggestions([]);
    setSelectedTransferSuggestionIndex(0);
    setTransferMessage("");
  }, [snapshot]);

  function toggleTransferCompetency(competencyId: string) {
    setSelectedTransferCompetencyIds((current) =>
      current.includes(competencyId)
        ? current.filter((id) => id !== competencyId)
        : [...current, competencyId],
    );
    setTransferSuggestions([]);
    setSelectedTransferSuggestionIndex(0);
    setTransferMessage("");
  }

  function handleCalculateTransfer() {
    if (!sourceScheduleId || !targetScheduleId || sourceScheduleId === targetScheduleId) {
      setTransferSuggestions([]);
      setSelectedTransferSuggestionIndex(0);
      setTransferMessage("Choose two different shifts to calculate a transfer.");
      return;
    }

    if (selectedTransferCompetencyIds.length === 0) {
      setTransferSuggestions([]);
      setSelectedTransferSuggestionIndex(0);
      setTransferMessage("Pick at least one competency to include.");
      return;
    }

    const suggestions = getTransferSuggestions({
      snapshot,
      sourceScheduleId,
      targetScheduleId,
      selectedCompetencyIds: selectedTransferCompetencyIds,
    });

    if (suggestions.length === 0) {
      setTransferSuggestions([]);
      setSelectedTransferSuggestionIndex(0);
      setTransferMessage("No single-person transfer fit was found for that mix.");
      return;
    }

    setTransferSuggestions(suggestions);
    setSelectedTransferSuggestionIndex(0);
    setTransferMessage("");
  }

  const transferSuggestion = transferSuggestions[selectedTransferSuggestionIndex] ?? null;

  return (
    <section className="panel-frame">
      <div className="panel-heading panel-heading--split">
        <h1 className="panel-title">Metrics</h1>
        <div className="metrics-month-nav">
          <div className="metrics-month-nav__current">
            <strong>{formatMonthLabel(snapshot.month)}</strong>
          </div>
          <div className="metrics-month-nav__actions">
            <button type="button" className="ghost-button" onClick={() => navigateMonth(-1)}>
              Prev month
            </button>
            <button type="button" className="ghost-button" onClick={() => navigateMonth(1)}>
              Next month
            </button>
          </div>
        </div>
      </div>

      <div className="metrics-grid">
        <section className="metrics-section">
          <div className="metrics-section__header">
            <div className="metrics-section__title-group">
              <h2 className="metrics-section__title">Competencies By Team</h2>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setIsTransferModalOpen(true)}
              >
                Shift Transfer
              </button>
            </div>
          </div>

          <div className="metrics-team-list">
            {teamMetrics.map((team) => (
              <article key={team.scheduleId} className="metrics-card">
                <div className="metrics-card__header">
                  <div>
                    <p className="metrics-card__eyebrow">Shift {team.scheduleName}</p>
                    <h3 className="metrics-card__title">Qualified staff by competency</h3>
                  </div>
                </div>

                <div className="metrics-bars">
                  {team.competencyMetrics.map((metric) => (
                    <div key={metric.competencyId} className="metrics-bar-row">
                      <div className="metrics-bar-row__label">
                        <span className={`legend-pill legend-pill--${metric.colorToken.toLowerCase()}`}>
                          {metric.code}
                        </span>
                        <strong>{metric.qualifiedPeople}</strong>
                      </div>
                      <div className="metrics-bar-track">
                        <span
                          className={`metrics-bar-fill metrics-bar-fill--${metric.colorToken.toLowerCase()}`}
                          style={{
                            width:
                              metric.qualifiedPeople === 0
                                ? "0%"
                                : `${Math.max(8, (metric.qualifiedPeople / maxQualifiedPeople) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="metrics-section">
          <div className="metrics-section__header">
            <div className="metrics-section__title-group">
              <h2 className="metrics-section__title">Overtime Incurred By Team</h2>
              <p className="toolbar-status">Anchored to {formatAnchorDateLabel(metricsAnchorDate)}</p>
            </div>
            <div className="metrics-window-toggle" aria-label="Overtime time window">
              {(["30d", "90d", "1y", "ytd"] as OvertimeWindow[]).map((window) => (
                <button
                  key={window}
                  type="button"
                  className={`ghost-button ${overtimeWindow === window ? "ghost-button--active" : ""}`}
                  onClick={() => setOvertimeWindow(window)}
                >
                  {window.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="metrics-team-list">
            {teamMetrics.map((team) => (
              <article key={`${team.scheduleId}-overtime`} className="metrics-card">
                <div className="metrics-card__header">
                  <div>
                    <p className="metrics-card__eyebrow">Shift {team.scheduleName}</p>
                    <h3 className="metrics-card__title">
                      {team.overtimeShifts} overtime shift{team.overtimeShifts === 1 ? "" : "s"}
                    </h3>
                  </div>
                  <div className="metrics-card__stats">
                    <span>{team.overtimeWorkers} worker{team.overtimeWorkers === 1 ? "" : "s"}</span>
                    <span>{team.topCompetencyCode ? `Top post ${team.topCompetencyCode}` : "No overtime yet"}</span>
                  </div>
                </div>

                <div className="metrics-bar-track metrics-bar-track--tall">
                  <span
                    className="metrics-bar-fill metrics-bar-fill--overtime"
                    style={{
                      width: `${team.overtimeShifts === 0 ? 0 : Math.max(10, (team.overtimeShifts / maxOvertimeShifts) * 100)}%`,
                    }}
                  />
                </div>

                <div className="metrics-top-list">
                  <strong className="metrics-top-list__title">Top 3 overtime personnel</strong>
                  <div className="metrics-top-list__rows">
                    {padMetricPeopleRows(team.topOvertimePeople).map((person, index) => (
                      <div
                        key={person?.employeeId ?? `overtime-empty-${team.scheduleId}-${index}`}
                        className={`metrics-top-list__row ${person ? "" : "metrics-top-list__row--empty"}`}
                      >
                        <span>{person?.employeeName ?? "\u00A0"}</span>
                        <strong>{person ? person.claimedShifts : "\u00A0"}</strong>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="metrics-top-list">
                  <strong className="metrics-top-list__title">Top 3 overtime competencies</strong>
                  <div className="metrics-top-list__rows">
                    {padMetricRows(team.topOvertimeCompetencies).map((competency, index) => (
                      <div
                        key={competency?.competencyId ?? `overtime-competency-empty-${team.scheduleId}-${index}`}
                        className={`metrics-top-list__row ${competency ? "" : "metrics-top-list__row--empty"}`}
                      >
                        <span>{competency?.code ?? "\u00A0"}</span>
                        <strong>{competency ? competency.claimedShifts : "\u00A0"}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="metrics-section">
          <div className="metrics-section__header">
            <div className="metrics-section__title-group">
              <h2 className="metrics-section__title">Fatigue Potential</h2>
              <p className="toolbar-status">
                Consecutive shifts worked in {formatMonthLabel(snapshot.month)}
              </p>
            </div>
          </div>

          <div className="metrics-team-list">
            {teamFatigueMetrics.map((team) => (
              <article key={`${team.scheduleId}-fatigue`} className="metrics-card">
                <div className="metrics-card__header">
                  <div>
                    <p className="metrics-card__eyebrow">Shift {team.scheduleName}</p>
                    <h3 className="metrics-card__title">
                      {team.totalScheduledEmployees} scheduled employee{team.totalScheduledEmployees === 1 ? "" : "s"}
                    </h3>
                  </div>
                  <div className="metrics-card__stats">
                    <span>Highest streak {team.highestStreak}</span>
                    <span>{team.countAboveNormalCycle} above normal cycle</span>
                    <span>Avg {team.averageConsecutiveShifts.toFixed(1)}</span>
                  </div>
                </div>

                <div className="metrics-fatigue-bands" aria-label={`Fatigue bands for shift ${team.scheduleName}`}>
                  <span className="metrics-fatigue-band metrics-fatigue-band--green">
                    Green <strong>{team.greenCount}</strong>
                  </span>
                  <span className="metrics-fatigue-band metrics-fatigue-band--amber">
                    Amber <strong>{team.amberCount}</strong>
                  </span>
                  <span className="metrics-fatigue-band metrics-fatigue-band--red">
                    Red <strong>{team.redCount}</strong>
                  </span>
                  <span className="metrics-fatigue-band metrics-fatigue-band--critical">
                    Critical <strong>{team.criticalCount}</strong>
                  </span>
                </div>

                <div className="metrics-top-list">
                  <strong className="metrics-top-list__title">Top 3 fatigue potential</strong>
                  <div className="metrics-top-list__rows">
                    {padMetricRows(team.topEmployees).map((employee, index) => (
                      <div
                        key={employee?.employeeId ?? `fatigue-empty-${team.scheduleId}-${index}`}
                        className={`metrics-top-list__row metrics-top-list__row--stacked ${
                          employee ? "" : "metrics-top-list__row--empty"
                        }`}
                        title={
                          employee
                            ? `${employee.employeeName}: ${employee.consecutiveShifts} consecutive shifts worked. Normal cycle = ${NORMAL_FATIGUE_CYCLE}. Excess = ${employee.excessOverNormalCycle}. Exposure band = ${formatFatigueBandLabel(employee.band)}.`
                            : undefined
                        }
                      >
                        <span>
                          {employee ? (
                            <>
                              <span className={`metrics-fatigue-dot metrics-fatigue-dot--${employee.band}`} />
                              <span>{employee.employeeName}</span>
                              <small>{formatFatigueBandLabel(employee.band)}</small>
                            </>
                          ) : (
                            "\u00A0"
                          )}
                        </span>
                        <strong>{employee ? employee.consecutiveShifts : "\u00A0"}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="metrics-section">
          <div className="metrics-section__header">
            <div className="metrics-section__title-group">
              <h2 className="metrics-section__title">Shift Fragility</h2>
              <p className="toolbar-status">
                Historical overtime risk, anchored to {formatAnchorDateLabel(metricsAnchorDate)}
              </p>
            </div>
            <div className="metrics-window-toggle" aria-label="Shift fragility history window">
              {(["30d", "90d", "1y", "ytd"] as FragilityWindow[]).map((window) => (
                <button
                  key={window}
                  type="button"
                  className={`ghost-button ${fragilityWindow === window ? "ghost-button--active" : ""}`}
                  onClick={() => setFragilityWindow(window)}
                >
                  {window.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="metrics-team-list">
            {teamMetrics.map((team) => {
              const topFragilityScore = team.shiftFragilityMetrics[0]?.riskScore ?? 0;

              return (
                <article key={`${team.scheduleId}-fragility`} className="metrics-card">
                  <div className="metrics-card__header">
                    <div>
                      <p className="metrics-card__eyebrow">Shift {team.scheduleName}</p>
                      <h3 className="metrics-card__title">
                        {topFragilityScore > 0
                          ? `${formatFragilityScore(topFragilityScore)} risk score`
                          : "No historical fragility"}
                      </h3>
                    </div>
                    <div className="metrics-card__stats">
                      <span>Recent OT weighted</span>
                      <span>Depth adjusted</span>
                    </div>
                  </div>

                  <div className="metrics-bar-track metrics-bar-track--tall">
                    <span
                      className="metrics-bar-fill metrics-bar-fill--fragility"
                      style={{
                        width: `${topFragilityScore === 0 ? 0 : Math.max(10, (topFragilityScore / maxFragilityScore) * 100)}%`,
                      }}
                    />
                  </div>

                  <div className="metrics-top-list">
                    <strong className="metrics-top-list__title">Top risk competencies</strong>
                    <div className="metrics-top-list__rows">
                      {padMetricRows(team.shiftFragilityMetrics).map((metric, index) => (
                        <div
                          key={metric?.competencyId ?? `fragility-empty-${team.scheduleId}-${index}`}
                          className={`metrics-top-list__row metrics-top-list__row--stacked ${
                            metric ? "" : "metrics-top-list__row--empty"
                          }`}
                        >
                          <span>
                            {metric ? (
                              <>
                                <span className={`legend-pill legend-pill--${metric.colorToken.toLowerCase()}`}>
                                  {metric.code}
                                </span>
                                <small>
                                  {metric.overtimeClaims} OT · {metric.qualifiedPeople}/{metric.requiredStaff} qualified
                                </small>
                              </>
                            ) : (
                              "\u00A0"
                            )}
                          </span>
                          <strong>{metric ? formatFragilityScore(metric.riskScore) : "\u00A0"}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="metrics-section">
          <div className="metrics-section__header">
            <div className="metrics-section__title-group">
              <h2 className="metrics-section__title">Time Code Usage By Team</h2>
              {snapshot.timeCodes.length > 0 ? (
                <label className="field metrics-field-inline">
                  <select
                    value={selectedTimeCodeId}
                    onChange={(event) => setSelectedTimeCodeId(event.target.value)}
                  >
                    {snapshot.timeCodes.map((timeCode) => (
                      <option key={timeCode.id} value={timeCode.id}>
                        {timeCode.code} · {timeCode.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            <div className="metrics-section__controls">
              <p className="toolbar-status">Anchored to {formatAnchorDateLabel(metricsAnchorDate)}</p>
              <div className="metrics-window-toggle" aria-label="Time code time window">
                {(["30d", "90d", "1y", "ytd"] as TimeCodeWindow[]).map((window) => (
                  <button
                    key={window}
                    type="button"
                    className={`ghost-button ${timeCodeWindow === window ? "ghost-button--active" : ""}`}
                    onClick={() => setTimeCodeWindow(window)}
                  >
                    {window.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {snapshot.timeCodes.length === 0 ? (
            <div className="empty-state">
              <strong>No time codes available.</strong>
              <span>Add time codes to start tracking usage by team.</span>
            </div>
          ) : (
            <div className="metrics-team-list">
              {teamTimeCodeMetrics.map((team) => (
                <article key={`${team.scheduleId}-time-code`} className="metrics-card">
                  <div className="metrics-card__header">
                    <div>
                      <p className="metrics-card__eyebrow">Shift {team.scheduleName}</p>
                      <h3 className="metrics-card__title">
                        {team.entryCount} schedule entr{team.entryCount === 1 ? "y" : "ies"} with this code
                      </h3>
                    </div>
                    <div className="metrics-card__stats">
                      <span>{team.peopleCount} people</span>
                    </div>
                  </div>

                  <div className="metrics-bar-track metrics-bar-track--tall">
                    <span
                      className="metrics-bar-fill metrics-bar-fill--slate"
                      style={{
                        width: `${team.entryCount === 0 ? 0 : Math.max(10, (team.entryCount / maxTimeCodeShifts) * 100)}%`,
                      }}
                    />
                  </div>

                  <div className="metrics-top-list">
                    <strong className="metrics-top-list__title">Top 3 personnel</strong>
                    <div className="metrics-top-list__rows">
                      {padMetricPeopleRows(team.topPeople).map((person, index) => (
                        <div
                          key={person?.employeeId ?? `time-code-empty-${team.scheduleId}-${index}`}
                          className={`metrics-top-list__row ${person ? "" : "metrics-top-list__row--empty"}`}
                        >
                          <span>{person?.employeeName ?? "\u00A0"}</span>
                          <strong>{person ? person.codedShifts : "\u00A0"}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      {isTransferModalOpen && typeof document !== "undefined"
        ? createPortal(
        <div className="assignment-modal-backdrop" onClick={() => setIsTransferModalOpen(false)}>
          <section
            className="assignment-modal metrics-transfer-modal"
            aria-label="Shift transfer planner"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="assignment-modal__header">
              <div>
                <h2 className="assignment-modal__title">Shift Transfer</h2>
                <p className="assignment-modal__context">
                  Pick a source shift, target shift, and the competencies to include. This calculates the best single-person transfer only.
                </p>
              </div>
              <button type="button" className="ghost-button" onClick={() => setIsTransferModalOpen(false)}>
                Close
              </button>
            </div>

            <div className="metrics-transfer-grid">
              <label className="field">
                <span>From shift</span>
                <select
                  value={sourceScheduleId}
                  onChange={(event) => {
                    setSourceScheduleId(event.target.value);
                    setTransferSuggestions([]);
                    setSelectedTransferSuggestionIndex(0);
                    setTransferMessage("");
                  }}
                >
                  {snapshot.schedules.map((schedule) => (
                    <option key={schedule.id} value={schedule.id}>
                      {schedule.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>To shift</span>
                <select
                  value={targetScheduleId}
                  onChange={(event) => {
                    setTargetScheduleId(event.target.value);
                    setTransferSuggestions([]);
                    setSelectedTransferSuggestionIndex(0);
                    setTransferMessage("");
                  }}
                >
                  {snapshot.schedules.map((schedule) => (
                    <option key={schedule.id} value={schedule.id}>
                      {schedule.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="assignment-modal__group">
              <span className="assignment-modal__label">Include competencies</span>
              <div className="assignment-modal__options">
                {snapshot.competencies.map((competency) => {
                  const isSelected = selectedTransferCompetencyIds.includes(competency.id);

                  return (
                    <button
                      key={competency.id}
                      type="button"
                      className={`legend-pill legend-pill--${competency.colorToken.toLowerCase()} ${
                        isSelected ? "legend-pill--selected" : ""
                      }`}
                      onClick={() => toggleTransferCompetency(competency.id)}
                    >
                      {competency.code}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="metrics-transfer-actions">
              <button type="button" className="primary-button" onClick={handleCalculateTransfer}>
                Calculate best fit
              </button>
            </div>

            {transferMessage ? <p className="toolbar-status">{transferMessage}</p> : null}

            {transferSuggestion ? (
              <section className="metrics-transfer-result">
                <div className="metrics-transfer-result__header">
                  <div>
                    <p className="metrics-card__eyebrow">
                      Shift {transferSuggestion.sourceScheduleName} to Shift {transferSuggestion.targetScheduleName}
                    </p>
                    <h3 className="metrics-card__title">{transferSuggestion.employeeName}</h3>
                  </div>
                  <div className="metrics-card__stats">
                    <span>{transferSuggestion.employeeRole}</span>
                    <span>{transferSuggestion.matchedCompetencyIds.length} matched competency{transferSuggestion.matchedCompetencyIds.length === 1 ? "" : "ies"}</span>
                  </div>
                </div>

                {transferSuggestions.length > 1 ? (
                  <div className="metrics-transfer-actions metrics-transfer-actions--split">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() =>
                        setSelectedTransferSuggestionIndex((current) =>
                          current === 0 ? transferSuggestions.length - 1 : current - 1,
                        )
                      }
                    >
                      Previous match
                    </button>
                    <p className="toolbar-status">
                      Match {selectedTransferSuggestionIndex + 1} of {transferSuggestions.length}
                    </p>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() =>
                        setSelectedTransferSuggestionIndex((current) =>
                          current === transferSuggestions.length - 1 ? 0 : current + 1,
                        )
                      }
                    >
                      Next match
                    </button>
                  </div>
                ) : null}

                <div className="metrics-transfer-pill-row">
                  {transferSuggestion.projections.filter((projection) => projection.included).map((projection) => (
                    <span
                      key={projection.competencyId}
                      className={`legend-pill legend-pill--${projection.colorToken.toLowerCase()}`}
                    >
                      {projection.code}
                    </span>
                  ))}
                </div>

                <div className="metrics-transfer-projections">
                  {transferSuggestion.projections.map((projection) => (
                    <div key={projection.competencyId} className="metrics-transfer-projection">
                      <div className="metrics-transfer-projection__label">
                        <span className={`legend-pill legend-pill--${projection.colorToken.toLowerCase()}`}>
                          {projection.code}
                        </span>
                        <strong>{projection.included ? "Included" : "Reference"}</strong>
                      </div>
                      <p>
                        Shift {transferSuggestion.sourceScheduleName}: {projection.sourceCount} to {projection.nextSourceCount}
                      </p>
                      <p>
                        Shift {transferSuggestion.targetScheduleName}: {projection.targetCount} to {projection.nextTargetCount}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </section>
        </div>,
        document.body,
      ) : null}
    </section>
  );
}
