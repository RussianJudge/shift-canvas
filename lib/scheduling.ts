import type {
  CompletedSet,
  Competency,
  Employee,
  Schedule,
  SchedulerSnapshot,
  ShiftKind,
  StoredAssignment,
  TimeCode,
} from "./types";

/**
 * Pure scheduling and calendar helpers shared across server and client code.
 *
 * This file deliberately stays side-effect free so the same logic can drive:
 * - server snapshot generation
 * - schedule page rendering
 * - overtime packaging
 * - completed-set bookkeeping
 */
export interface MonthDay {
  date: string;
  dayNumber: number;
  dayName: string;
  isWeekend: boolean;
}

/** Converts a calendar day into a UTC day number so date math stays timezone-safe. */
function toUtcDayNumber(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** Shifts a `YYYY-MM` month key forward/backward by whole months. */
export function shiftMonthKey(monthKey: string, delta: number) {
  const [year, month] = monthKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));

  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Returns the current month key in the caller's business timezone. */
export function getCurrentMonthKey(timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  });

  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "2026";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";

  return `${year}-${month}`;
}

/** Human-friendly month label used throughout the UI. */
export function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/**
 * Resolves where a schedule sits in its repeating pattern on a calendar date.
 *
 * The schedule start date is treated as the first DAY in the cycle, and all
 * math is done in UTC day numbers to avoid local-time drift.
 */
export function shiftForDate(schedule: Pick<Schedule, "startDate" | "dayShiftDays" | "nightShiftDays" | "offDays">, isoDate: string) {
  const pattern: ShiftKind[] = [
    ...Array.from({ length: schedule.dayShiftDays }, () => "DAY" as const),
    ...Array.from({ length: schedule.nightShiftDays }, () => "NIGHT" as const),
    ...Array.from({ length: schedule.offDays }, () => "OFF" as const),
  ];

  if (pattern.length === 0) {
    return "OFF";
  }

  // The start date is the first DAY cell in the pattern, so compare pure calendar
  // days instead of local timestamps to avoid off-by-one rotation drift.
  const dayDelta = toUtcDayNumber(isoDate) - toUtcDayNumber(schedule.startDate);
  const index = ((dayDelta % pattern.length) + pattern.length) % pattern.length;

  return pattern[index];
}

/** Returns the visible calendar grid for a single month. */
export function getMonthDays(monthKey: string): MonthDay[] {
  const [year, month] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();

  return Array.from({ length: daysInMonth }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1, index + 1));
    const isoDate = date.toISOString().slice(0, 10);
    const weekday = date.getUTCDay();

    return {
      date: isoDate,
      dayNumber: index + 1,
      dayName: new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        timeZone: "UTC",
      }).format(date),
      isWeekend: weekday === 0 || weekday === 6,
    };
  });
}

/** Expands the visible month into a small window used for cross-month sets. */
export function getExtendedMonthDays(monthKey: string, monthsBefore = 1, monthsAfter = 1) {
  return Array.from({ length: monthsBefore + monthsAfter + 1 }, (_, index) =>
    shiftMonthKey(monthKey, index - monthsBefore),
  ).flatMap((key) => getMonthDays(key));
}

/** Lists every month touched by a date range, inclusive. */
export function getMonthKeysForDateRange(startDate: string, endDate: string) {
  const startMonth = startDate.slice(0, 7);
  const endMonth = endDate.slice(0, 7);
  const months = [startMonth];

  while (months[months.length - 1] !== endMonth) {
    months.push(shiftMonthKey(months[months.length - 1], 1));
  }

  return months;
}

/** Finds the contiguous worked block that contains a selected anchor day. */
export function getWorkedSetDays(
  schedule: Pick<Schedule, "startDate" | "dayShiftDays" | "nightShiftDays" | "offDays"> | null,
  monthDays: Array<Pick<MonthDay, "date">>,
  anchorDate: string | null,
) {
  if (!schedule || !anchorDate) {
    return [];
  }

  const anchorIndex = monthDays.findIndex((day) => day.date === anchorDate);

  if (anchorIndex === -1 || shiftForDate(schedule, anchorDate) === "OFF") {
    return [];
  }

  let startIndex = anchorIndex;
  let endIndex = anchorIndex;

  while (startIndex > 0 && shiftForDate(schedule, monthDays[startIndex - 1].date) !== "OFF") {
    startIndex -= 1;
  }

  while (
    endIndex < monthDays.length - 1 &&
    shiftForDate(schedule, monthDays[endIndex + 1].date) !== "OFF"
  ) {
    endIndex += 1;
  }

  return monthDays.slice(startIndex, endIndex + 1);
}

/** Unique key for a month-scoped completed-set row. */
export function createCompletedSetKey(
  scheduleId: string,
  month: string,
  startDate: string,
  endDate: string,
) {
  return `${scheduleId}:${month}:${startDate}:${endDate}`;
}

export function createCompletedSetKeyFromEntry(entry: CompletedSet) {
  return createCompletedSetKey(entry.scheduleId, entry.month, entry.startDate, entry.endDate);
}

/** Unique key for a completed set by its real date range, regardless of month rows. */
export function createSetRangeKey(scheduleId: string, startDate: string, endDate: string) {
  return `${scheduleId}:${startDate}:${endDate}`;
}

export function createSetRangeKeyFromEntry(entry: CompletedSet) {
  return createSetRangeKey(entry.scheduleId, entry.startDate, entry.endDate);
}

/** Checks whether a full worked set has been marked complete already. */
export function isCompletedSetRange(
  completedSets: CompletedSet[],
  scheduleId: string,
  startDate: string,
  endDate: string,
) {
  const rangeKey = createSetRangeKey(scheduleId, startDate, endDate);

  return completedSets.some((entry) => createSetRangeKeyFromEntry(entry) === rangeKey);
}

/** Returns the month-local dates that belong to completed sets for one schedule. */
export function getCompletedSetDatesForMonth(
  completedSets: CompletedSet[],
  scheduleId: string,
  monthDays: Array<Pick<MonthDay, "date">>,
) {
  const dates = new Set<string>();

  for (const completedSet of completedSets) {
    if (completedSet.scheduleId !== scheduleId) {
      continue;
    }

    for (const day of monthDays) {
      if (day.date >= completedSet.startDate && day.date <= completedSet.endDate) {
        dates.add(day.date);
      }
    }
  }

  return dates;
}

/**
 * Applies or removes a completed-set range while also cleaning out overlapping
 * legacy/truncated rows. The UI uses this for optimistic updates.
 */
export function toggleCompletedSetEntries(
  completedSets: CompletedSet[],
  scheduleId: string,
  startDate: string,
  endDate: string,
  isComplete: boolean,
) {
  const remainingEntries = completedSets.filter(
    (entry) =>
      !(
        entry.scheduleId === scheduleId &&
        entry.startDate <= endDate &&
        entry.endDate >= startDate
      ),
  );

  if (!isComplete) {
    return remainingEntries;
  }

  return [
    ...remainingEntries,
    ...getMonthKeysForDateRange(startDate, endDate).map((month) => ({
      scheduleId,
      month,
      startDate,
      endDate,
    })),
  ];
}

/** Small deterministic helper used where a fallback post suggestion is needed. */
export function getSuggestedCompetencyId(employee: Pick<Employee, "id" | "competencyIds">, isoDate: string) {
  if (employee.competencyIds.length === 0) {
    return null;
  }

  const epochReference = Date.UTC(2026, 0, 1);
  const employeeOffset = employee.id
    .split("")
    .reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const dayOffset = Math.floor((new Date(`${isoDate}T00:00:00Z`).getTime() - epochReference) / 86_400_000);

  return employee.competencyIds[(dayOffset + employeeOffset) % employee.competencyIds.length];
}

/** Converts persisted assignment rows into O(1) lookup shape for UI logic. */
export function buildAssignmentIndex(assignments: StoredAssignment[]) {
  return assignments.reduce<Record<string, { competencyId: string | null; timeCodeId: string | null; notes: string | null }>>(
    (index, assignment) => {
      index[createAssignmentKey(assignment.employeeId, assignment.date)] = {
        competencyId: assignment.competencyId,
        timeCodeId: assignment.timeCodeId,
        notes: assignment.notes ?? null,
      };
      return index;
    },
    {},
  );
}

/** Stable key shared by server and client for assignment lookups. */
export function createAssignmentKey(employeeId: string, date: string) {
  return `${employeeId}:${date}`;
}

/** Finds one schedule from the current snapshot, falling back to the first entry. */
export function getScheduleById(snapshot: SchedulerSnapshot, scheduleId: string) {
  return snapshot.schedules.find((schedule) => schedule.id === scheduleId) ?? snapshot.schedules[0];
}

/** Builds an id lookup so UI code can resolve competency metadata quickly. */
export function getCompetencyMap(competencies: Competency[]) {
  return competencies.reduce<Record<string, Competency>>((map, competency) => {
    map[competency.id] = competency;
    return map;
  }, {});
}

/** Builds an id lookup for time codes used throughout scheduler and metrics UIs. */
export function getTimeCodeMap(timeCodes: TimeCode[]) {
  return timeCodes.reduce<Record<string, TimeCode>>((map, timeCode) => {
    map[timeCode.id] = timeCode;
    return map;
  }, {});
}

/** Flattens all shift rosters into a single employee lookup keyed by employee id. */
export function getEmployeeMap(schedules: Schedule[]) {
  return schedules.flatMap((schedule) => schedule.employees).reduce<Record<string, Employee>>((map, employee) => {
    map[employee.id] = employee;
    return map;
  }, {});
}
