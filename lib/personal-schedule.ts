import type { Competency, ShiftKind, StoredAssignment, TimeCode } from "@/lib/types";

/**
 * One day on the signed-in employee's own calendar.
 *
 * `code` is empty when nothing is stored for that date. The team grid renders
 * an unassigned cell blank rather than filling in the rotation, and this view
 * follows it: the rotation is a pattern, not a record of work.
 */
export type PersonalDay = {
  date: string;
  isWeekend: boolean;
  isOutsideMonth: boolean;
  code: string;
  /** "Day shift" / "Night shift" / "Days off", from the row's own shift kind. */
  shiftLabel: string;
  shiftKind: ShiftKind;
  colorToken: string;
  isWorking: boolean;
  notes: string | null;
  awayScheduleName: string | null;
  subScheduleName: string | null;
};

const SHIFT_LABELS: Record<ShiftKind, string> = {
  DAY: "Day shift",
  NIGHT: "Night shift",
  OFF: "Days off",
};

export function getShiftLabel(shiftKind: ShiftKind) {
  return SHIFT_LABELS[shiftKind];
}

/**
 * Builds the employee's month from the same rows the team grid renders.
 *
 * Projected rows are merged over stored ones exactly as the grid does, so a
 * sub-schedule day and a day worked on another crew both appear here with the
 * name of wherever the work belongs.
 */
export function buildPersonalMonth({
  employeeId,
  scheduleId,
  monthDays,
  assignments,
  projectedAssignments,
  competencies,
  timeCodes,
}: {
  employeeId: string;
  scheduleId: string;
  monthDays: Array<{ date: string; isWeekend: boolean; isOutsideMonth?: boolean }>;
  assignments: StoredAssignment[];
  projectedAssignments: StoredAssignment[];
  competencies: Competency[];
  timeCodes: TimeCode[];
}): PersonalDay[] {
  const competencyById = new Map(competencies.map((competency) => [competency.id, competency]));
  const timeCodeById = new Map(timeCodes.map((timeCode) => [timeCode.id, timeCode]));
  const byDate = new Map<string, StoredAssignment>();

  for (const assignment of assignments) {
    if (assignment.employeeId !== employeeId || assignment.scheduleId !== scheduleId) {
      continue;
    }

    byDate.set(assignment.date, assignment);
  }

  for (const assignment of projectedAssignments) {
    if (assignment.employeeId !== employeeId || assignment.scheduleId !== scheduleId) {
      continue;
    }

    byDate.set(assignment.date, assignment);
  }

  return monthDays.map((day) => {
    const assignment = byDate.get(day.date) ?? null;
    const competency = assignment?.competencyId ? competencyById.get(assignment.competencyId) : null;
    const timeCode = assignment?.timeCodeId ? timeCodeById.get(assignment.timeCodeId) : null;
    // An away or sub-schedule row keeps its codes in the projected fields so the
    // stored ones stay out of coverage maths; display reads them back.
    const projectedCompetency = assignment?.projectedCompetencyId
      ? competencyById.get(assignment.projectedCompetencyId)
      : null;
    const projectedTimeCode = assignment?.projectedTimeCodeId
      ? timeCodeById.get(assignment.projectedTimeCodeId)
      : null;
    const shownTimeCode = timeCode ?? projectedTimeCode ?? null;
    const shownCompetency = competency ?? projectedCompetency ?? null;
    const shiftKind = assignment?.shiftKind ?? "OFF";
    const isWorking = shownTimeCode ? shownTimeCode.workStatus !== "off" : Boolean(shownCompetency);

    return {
      date: day.date,
      isWeekend: day.isWeekend,
      isOutsideMonth: Boolean(day.isOutsideMonth),
      code: shownTimeCode?.code ?? shownCompetency?.code ?? "",
      // Time away carries its own meaning: a vacation day sitting on a night in
      // the rotation is "Vacation", never "Night shift".
      shiftLabel: isWorking
        ? SHIFT_LABELS[shiftKind]
        : shownTimeCode?.label ?? SHIFT_LABELS.OFF,
      shiftKind,
      colorToken: shownTimeCode?.colorToken ?? shownCompetency?.colorToken ?? "",
      isWorking,
      notes: assignment?.notes ?? null,
      awayScheduleName: assignment?.awayScheduleName ?? null,
      subScheduleName: assignment?.subScheduleName ?? null,
    };
  });
}

/** The first working day on or after today, which the mockup leads with. */
export function findNextAssignment(days: PersonalDay[], today: string) {
  return days.find((day) => !day.isOutsideMonth && day.date >= today && day.isWorking) ?? null;
}

export type UpcomingEntry = {
  startDate: string;
  endDate: string;
  code: string;
  shiftLabel: string;
  shiftKind: ShiftKind;
  colorToken: string;
  isWorking: boolean;
  dayCount: number;
};

/**
 * The days after the next assignment, with runs of the same thing collapsed.
 *
 * A weekend off reads as one "Days off" row spanning both dates rather than two
 * identical rows, which is how the mockup shows 12–13.
 */
export function buildUpcomingAssignments({
  days,
  fromDate,
  limit = 4,
}: {
  days: PersonalDay[];
  fromDate: string;
  limit?: number;
}): UpcomingEntry[] {
  const entries: UpcomingEntry[] = [];

  for (const day of days) {
    if (day.isOutsideMonth || day.date <= fromDate || !day.code) {
      continue;
    }

    const previous = entries[entries.length - 1];
    const isSameRun =
      previous && previous.code === day.code && previous.endDate === previousDate(day.date);

    if (isSameRun) {
      previous.endDate = day.date;
      previous.dayCount += 1;
      continue;
    }

    entries.push({
      startDate: day.date,
      endDate: day.date,
      code: day.code,
      shiftLabel: day.shiftLabel,
      shiftKind: day.shiftKind,
      colorToken: day.colorToken,
      isWorking: day.isWorking,
      dayCount: 1,
    });
  }

  return entries.slice(0, limit);
}

/** "Tuesday, September 8" — the heading over the next assignment. */
export function formatPersonalDate(isoDate: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

/** "Today" / "Tomorrow", or null when a plain date reads better. */
export function formatRelativeDay(isoDate: string, today: string) {
  if (isoDate === today) {
    return "Today";
  }

  return isoDate === nextDate(today) ? "Tomorrow" : null;
}

/** "WED" / "SAT – SUN" for an upcoming row spanning one or more days. */
export function formatUpcomingWeekdays(startDate: string, endDate: string) {
  const start = weekdayLabel(startDate);
  return startDate === endDate ? start : `${start} – ${weekdayLabel(endDate)}`;
}

/** "9" / "12 – 13" to sit under the weekday. */
export function formatUpcomingDayNumbers(startDate: string, endDate: string) {
  const start = Number(startDate.slice(8, 10));
  return startDate === endDate ? String(start) : `${start} – ${Number(endDate.slice(8, 10))}`;
}

function weekdayLabel(isoDate: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" })
    .format(new Date(`${isoDate}T00:00:00Z`))
    .toUpperCase();
}

function nextDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function previousDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
