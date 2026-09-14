import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPersonalMonth,
  buildUpcomingAssignments,
  findNextAssignment,
  formatPersonalDate,
  formatRelativeDay,
  formatUpcomingDayNumbers,
  formatUpcomingWeekdays,
  getShiftLabel,
} from "../lib/personal-schedule";
import type { Competency, StoredAssignment, TimeCode } from "../lib/types";

const COMPETENCIES = [
  { id: "comp-ops", code: "OPS", label: "Operations", colorToken: "TEAL", requiredStaff: 1 },
] as Competency[];

const TIME_CODES = [
  { id: "code-pro", code: "PRO", label: "Project", colorToken: "TEAL", workStatus: "working", usageMode: "manual" },
  { id: "code-off", code: "OFF", label: "Days off", colorToken: "SLATE", workStatus: "off", usageMode: "manual" },
  { id: "code-v", code: "V", label: "Vacation", colorToken: "ROSE", workStatus: "off", usageMode: "manual" },
] as TimeCode[];

function days(dates: string[]) {
  return dates.map((date) => ({
    date,
    isWeekend: [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()),
  }));
}

function row(overrides: Partial<StoredAssignment>): StoredAssignment {
  return {
    employeeId: "emp-1",
    scheduleId: "schedule-1",
    date: "2026-09-08",
    competencyId: null,
    timeCodeId: "code-pro",
    notes: null,
    shiftKind: "DAY",
    ...overrides,
  };
}

function build(assignments: StoredAssignment[], projected: StoredAssignment[] = []) {
  return buildPersonalMonth({
    employeeId: "emp-1",
    scheduleId: "schedule-1",
    monthDays: days(["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"]),
    assignments,
    projectedAssignments: projected,
    competencies: COMPETENCIES,
    timeCodes: TIME_CODES,
  });
}

test("a day with nothing stored stays blank rather than showing the rotation", () => {
  const [seventh] = build([]);

  assert.equal(seventh.code, "");
  assert.equal(seventh.isWorking, false);
});

test("a stored time code supplies the pill and the shift label", () => {
  const month = build([row({ date: "2026-09-08", timeCodeId: "code-pro", shiftKind: "DAY" })]);
  const eighth = month.find((day) => day.date === "2026-09-08");

  assert.equal(eighth?.code, "PRO");
  assert.equal(eighth?.shiftLabel, "Day shift");
  assert.equal(eighth?.colorToken, "TEAL");
  assert.equal(eighth?.isWorking, true);
});

test("a competency day shows the competency code", () => {
  const month = build([row({ date: "2026-09-09", timeCodeId: null, competencyId: "comp-ops" })]);

  assert.equal(month.find((day) => day.date === "2026-09-09")?.code, "OPS");
});

test("an off code is not working time", () => {
  const month = build([row({ date: "2026-09-12", timeCodeId: "code-off", shiftKind: "OFF" })]);
  const twelfth = month.find((day) => day.date === "2026-09-12");

  assert.equal(twelfth?.isWorking, false);
  assert.equal(twelfth?.shiftLabel, "Days off");
});

test("time away keeps its own label instead of the rotation's", () => {
  // Vacation booked over a night in the pattern is Vacation, not "Night shift".
  const month = build([row({ date: "2026-09-11", timeCodeId: "code-v", shiftKind: "NIGHT" })]);
  const eleventh = month.find((day) => day.date === "2026-09-11");

  assert.equal(eleventh?.code, "V");
  assert.equal(eleventh?.shiftLabel, "Vacation");
  assert.equal(eleventh?.isWorking, false);
});

test("another employee's rows are ignored", () => {
  const month = build([row({ date: "2026-09-08", employeeId: "emp-other" })]);

  assert.equal(month.find((day) => day.date === "2026-09-08")?.code, "");
});

test("rows from another schedule are ignored", () => {
  const month = build([row({ date: "2026-09-08", scheduleId: "schedule-2" })]);

  assert.equal(month.find((day) => day.date === "2026-09-08")?.code, "");
});

test("a projected day reads its code from the projected fields", () => {
  const month = build(
    [],
    [
      row({
        date: "2026-09-10",
        timeCodeId: null,
        competencyId: null,
        projectedCompetencyId: "comp-ops",
        awayScheduleName: "4",
        sourceType: "away-overtime",
        shiftKind: "NIGHT",
      }),
    ],
  );
  const tenth = month.find((day) => day.date === "2026-09-10");

  assert.equal(tenth?.code, "OPS");
  assert.equal(tenth?.awayScheduleName, "4");
  assert.equal(tenth?.shiftLabel, "Night shift");
});

test("a projection covers a stored row for the same day, as on the team grid", () => {
  const month = build(
    [row({ date: "2026-09-08", timeCodeId: "code-pro" })],
    [row({ date: "2026-09-08", timeCodeId: null, projectedTimeCodeId: "code-v", subScheduleName: "Bag House" })],
  );

  assert.equal(month.find((day) => day.date === "2026-09-08")?.code, "V");
});

test("the next assignment is the first working day from today", () => {
  const month = build([
    row({ date: "2026-09-07", timeCodeId: "code-off", shiftKind: "OFF" }),
    row({ date: "2026-09-09", timeCodeId: "code-pro" }),
  ]);

  assert.equal(findNextAssignment(month, "2026-09-07")?.date, "2026-09-09");
});

test("a month with no working days ahead has no next assignment", () => {
  assert.equal(findNextAssignment(build([]), "2026-09-07"), null);
});

test("consecutive identical days collapse into one upcoming row", () => {
  const month = build([
    row({ date: "2026-09-09", timeCodeId: "code-pro" }),
    row({ date: "2026-09-12", timeCodeId: "code-off", shiftKind: "OFF" }),
    row({ date: "2026-09-13", timeCodeId: "code-off", shiftKind: "OFF" }),
  ]);
  const upcoming = buildUpcomingAssignments({ days: month, fromDate: "2026-09-08" });

  assert.equal(upcoming.length, 2);
  assert.deepEqual(
    upcoming.map((entry) => [entry.code, entry.startDate, entry.endDate, entry.dayCount]),
    [
      ["PRO", "2026-09-09", "2026-09-09", 1],
      ["OFF", "2026-09-12", "2026-09-13", 2],
    ],
  );
});

test("a gap breaks the run even when the code matches", () => {
  const month = build([
    row({ date: "2026-09-09", timeCodeId: "code-off", shiftKind: "OFF" }),
    row({ date: "2026-09-11", timeCodeId: "code-off", shiftKind: "OFF" }),
  ]);
  const upcoming = buildUpcomingAssignments({ days: month, fromDate: "2026-09-08" });

  assert.equal(upcoming.length, 2);
});

test("upcoming starts after the day it is anchored to", () => {
  const month = build([
    row({ date: "2026-09-08", timeCodeId: "code-pro" }),
    row({ date: "2026-09-09", timeCodeId: "code-pro" }),
  ]);
  const upcoming = buildUpcomingAssignments({ days: month, fromDate: "2026-09-08" });

  assert.equal(upcoming.length, 1);
  assert.equal(upcoming[0].startDate, "2026-09-09");
});

test("dates read the way the mockup writes them", () => {
  assert.equal(formatPersonalDate("2026-09-08"), "Tuesday, September 8");
  assert.equal(formatRelativeDay("2026-09-08", "2026-09-07"), "Tomorrow");
  assert.equal(formatRelativeDay("2026-09-07", "2026-09-07"), "Today");
  assert.equal(formatRelativeDay("2026-09-10", "2026-09-07"), null);
});

test("relative days cross a month boundary", () => {
  assert.equal(formatRelativeDay("2026-10-01", "2026-09-30"), "Tomorrow");
});

test("an upcoming run reads as a weekday range", () => {
  assert.equal(formatUpcomingWeekdays("2026-09-09", "2026-09-09"), "WED");
  assert.equal(formatUpcomingWeekdays("2026-09-12", "2026-09-13"), "SAT – SUN");
  assert.equal(formatUpcomingDayNumbers("2026-09-09", "2026-09-09"), "9");
  assert.equal(formatUpcomingDayNumbers("2026-09-12", "2026-09-13"), "12 – 13");
});

test("shift labels come from the shift kind", () => {
  assert.equal(getShiftLabel("DAY"), "Day shift");
  assert.equal(getShiftLabel("NIGHT"), "Night shift");
  assert.equal(getShiftLabel("OFF"), "Days off");
});
