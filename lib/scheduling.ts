import type {
  Competency,
  Employee,
  ScheduleCode,
  SchedulerSnapshot,
  ShiftKind,
  StoredAssignment,
  Team,
} from "@/lib/types";

const BASE_ROTATION: ShiftKind[] = [
  "DAY",
  "DAY",
  "DAY",
  "NIGHT",
  "NIGHT",
  "NIGHT",
  "OFF",
  "OFF",
  "OFF",
  "OFF",
  "OFF",
  "OFF",
];

const SCHEDULE_OFFSETS: Record<ScheduleCode, number> = {
  "601": 0,
  "602": 3,
  "603": 6,
  "604": 9,
};

const ROTATION_REFERENCE = Date.UTC(2026, 0, 1);

export interface MonthDay {
  date: string;
  dayNumber: number;
  dayName: string;
  isWeekend: boolean;
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

export function shiftForDate(
  scheduleCode: ScheduleCode,
  isoDate: string,
  rotationAnchor = 0,
) {
  const current = new Date(`${isoDate}T00:00:00Z`).getTime();
  const dayDelta = Math.floor((current - ROTATION_REFERENCE) / 86_400_000);
  const index =
    (dayDelta + SCHEDULE_OFFSETS[scheduleCode] + rotationAnchor + BASE_ROTATION.length * 8) %
    BASE_ROTATION.length;

  return BASE_ROTATION[index];
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

  const dayOffset = Math.floor(
    (new Date(`${isoDate}T00:00:00Z`).getTime() - ROTATION_REFERENCE) / 86_400_000,
  );

  return employee.competencyIds[(dayOffset + employee.rotationAnchor) % employee.competencyIds.length];
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

export function getTeamById(snapshot: SchedulerSnapshot, teamId: string) {
  return snapshot.teams.find((team) => team.id === teamId) ?? snapshot.teams[0];
}

export function getCompetencyMap(competencies: Competency[]) {
  return competencies.reduce<Record<string, Competency>>((map, competency) => {
    map[competency.id] = competency;
    return map;
  }, {});
}

export function getEmployeeMap(teams: Team[]) {
  return teams.flatMap((team) => team.employees).reduce<Record<string, Employee>>((map, employee) => {
    map[employee.id] = employee;
    return map;
  }, {});
}

export function countShiftCoverage(
  team: Team,
  monthDays: MonthDay[],
  assignments: Record<string, string | null>,
) {
  const dayShiftCount = monthDays.reduce((count, day) => {
    return (
      count +
      team.employees.filter(
        (employee) => shiftForDate(employee.scheduleCode, day.date, employee.rotationAnchor) === "DAY",
      ).length
    );
  }, 0);

  const nightShiftCount = monthDays.reduce((count, day) => {
    return (
      count +
      team.employees.filter(
        (employee) => shiftForDate(employee.scheduleCode, day.date, employee.rotationAnchor) === "NIGHT",
      ).length
    );
  }, 0);

  const assignedCount = Object.entries(assignments).filter(([key, competencyId]) => {
    if (!competencyId) {
      return false;
    }

    return team.employees.some((employee) => key.startsWith(`${employee.id}:`));
  }).length;

  return {
    dayShiftCount,
    nightShiftCount,
    assignedCount,
  };
}
