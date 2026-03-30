import type {
  Competency,
  Employee,
  Schedule,
  SchedulerSnapshot,
  ShiftKind,
  StoredAssignment,
} from "@/lib/types";

export interface MonthDay {
  date: string;
  dayNumber: number;
  dayName: string;
  isWeekend: boolean;
}

function toUtcDayNumber(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

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

export function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

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

export function getSuggestedCompetencyId(employee: Employee, isoDate: string) {
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

export function buildAssignmentIndex(assignments: StoredAssignment[]) {
  return assignments.reduce<Record<string, string | null>>((index, assignment) => {
    index[createAssignmentKey(assignment.employeeId, assignment.date)] = assignment.competencyId;
    return index;
  }, {});
}

export function createAssignmentKey(employeeId: string, date: string) {
  return `${employeeId}:${date}`;
}

export function getScheduleById(snapshot: SchedulerSnapshot, scheduleId: string) {
  return snapshot.schedules.find((schedule) => schedule.id === scheduleId) ?? snapshot.schedules[0];
}

export function getCompetencyMap(competencies: Competency[]) {
  return competencies.reduce<Record<string, Competency>>((map, competency) => {
    map[competency.id] = competency;
    return map;
  }, {});
}

export function getEmployeeMap(schedules: Schedule[]) {
  return schedules.flatMap((schedule) => schedule.employees).reduce<Record<string, Employee>>((map, employee) => {
    map[employee.id] = employee;
    return map;
  }, {});
}

export function countShiftCoverage(
  schedule: Schedule,
  monthDays: MonthDay[],
  assignments: Record<string, string | null>,
) {
  const dayShiftCount = monthDays.reduce((count, day) => {
    return (
      count +
      schedule.employees.filter(() => shiftForDate(schedule, day.date) === "DAY").length
    );
  }, 0);

  const nightShiftCount = monthDays.reduce((count, day) => {
    return (
      count +
      schedule.employees.filter(() => shiftForDate(schedule, day.date) === "NIGHT").length
    );
  }, 0);

  const assignedCount = Object.entries(assignments).filter(([key, competencyId]) => {
    if (!competencyId) {
      return false;
    }

    return schedule.employees.some((employee) => key.startsWith(`${employee.id}:`));
  }).length;

  return {
    dayShiftCount,
    nightShiftCount,
    assignedCount,
  };
}
