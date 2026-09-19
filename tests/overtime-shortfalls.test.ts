import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCompletedSetCoverage,
  buildShortfallKey,
  findOvertimeShortfalls,
  getOpenSlotDates,
} from "../lib/overtime-shortfalls";
import type { CompletedSet, SchedulerSnapshot, StoredAssignment } from "../lib/types";

// 2 day / 2 night / 4 off from 1 September: the first set is 1–4 September,
// days on the 1st and 2nd, nights on the 3rd and 4th.
const SCHEDULE = {
  id: "schedule-1",
  name: "1",
  startDate: "2026-09-01",
  dayShiftDays: 2,
  nightShiftDays: 2,
  offDays: 4,
  isActive: true,
  competencyIds: ["comp-ops"],
  employees: [],
};

const COMPETENCY = {
  id: "comp-ops",
  code: "OPS",
  label: "Operator",
  colorToken: "blue",
  requiredStaff: 2,
};

const FIRST_SET: CompletedSet = {
  scheduleId: "schedule-1",
  month: "2026-09",
  startDate: "2026-09-01",
  endDate: "2026-09-04",
};

function staffed(date: string, count: number): StoredAssignment[] {
  return Array.from({ length: count }, (_, index) => ({
    employeeId: `emp-${date}-${index}`,
    scheduleId: "schedule-1",
    date,
    competencyId: "comp-ops",
    timeCodeId: null,
    notes: null,
    shiftKind: "DAY" as const,
  }));
}

function snapshot(overrides: Partial<SchedulerSnapshot> = {}): SchedulerSnapshot {
  return {
    month: "2026-09",
    productionUnits: [],
    competencies: [COMPETENCY],
    timeCodes: [],
    schedules: [SCHEDULE],
    unassignedEmployees: [],
    // Day 1 is one short, day 2 two short, both nights fully staffed.
    assignments: [...staffed("2026-09-01", 1), ...staffed("2026-09-03", 2), ...staffed("2026-09-04", 2)],
    projectedAssignments: [],
    overtimeClaims: [],
    manualOvertimePostings: [],
    completedSets: [FIRST_SET],
    subSchedules: [],
    subScheduleAssignments: [],
    subScheduleMembers: [],
    ...overrides,
  } as SchedulerSnapshot;
}

function firstSetCoverage(source: SchedulerSnapshot) {
  return buildCompletedSetCoverage(source).filter((entry) => entry.dates[0] <= "2026-09-04");
}

test("a completed set reports each segment's shortfall per date", () => {
  const [day, night] = firstSetCoverage(snapshot());

  assert.equal(day.shiftKind, "DAY");
  assert.deepEqual(day.dates, ["2026-09-01", "2026-09-02"]);
  assert.deepEqual(day.missingSlotsByDate, [1, 2]);
  assert.equal(day.maxMissing, 2);
  assert.equal(day.staffedPeople, 0.5);

  assert.equal(night.shiftKind, "NIGHT");
  assert.equal(night.maxMissing, 0);
});

test("an incomplete set is still work in progress, not overtime", () => {
  assert.deepEqual(buildCompletedSetCoverage(snapshot({ completedSets: [] })), []);
});

test("slots stack: the deeper slot covers only the dates short that many people", () => {
  const [day] = firstSetCoverage(snapshot());

  assert.deepEqual(getOpenSlotDates(day, 0), ["2026-09-01", "2026-09-02"]);
  assert.deepEqual(getOpenSlotDates(day, 1), ["2026-09-02"]);
});

test("shortfalls list every open slot once", () => {
  const shortfalls = findOvertimeShortfalls(snapshot(), "2026-09-01");

  assert.deepEqual(
    shortfalls.map((shortfall) => [shortfall.slotIndex, shortfall.dates]),
    [
      [0, ["2026-09-01", "2026-09-02"]],
      [1, ["2026-09-02"]],
    ],
  );
  assert.equal(shortfalls[0].competencyCode, "OPS");
  assert.equal(shortfalls[0].scheduleName, "1");
});

test("past dates are dropped, and a slot entirely in the past disappears", () => {
  const shortfalls = findOvertimeShortfalls(snapshot(), "2026-09-02");

  assert.deepEqual(
    shortfalls.map((shortfall) => [shortfall.slotIndex, shortfall.dates]),
    [
      [0, ["2026-09-02"]],
      [1, ["2026-09-02"]],
    ],
  );
  assert.deepEqual(findOvertimeShortfalls(snapshot(), "2026-09-03"), []);
});

test("a slot keeps its key while the dates it covers change", () => {
  // Someone is added on the 1st, so slot 0 now covers only the 2nd. It is still
  // the same open slot and must not read as a new one to announce.
  const before = findOvertimeShortfalls(snapshot(), "2026-09-01")[0];
  const after = findOvertimeShortfalls(
    snapshot({ assignments: [...staffed("2026-09-01", 2), ...staffed("2026-09-03", 2), ...staffed("2026-09-04", 2)] }),
    "2026-09-01",
  )[0];

  assert.deepEqual(after.dates, ["2026-09-02"]);
  assert.equal(after.key, before.key);
});

test("a newly deeper gap is a new slot with its own key", () => {
  const keys = findOvertimeShortfalls(snapshot(), "2026-09-01").map((shortfall) => shortfall.key);

  assert.equal(new Set(keys).size, 2);
});

test("the key leads with the month so one month's notices can be fetched together", () => {
  const key = buildShortfallKey({
    scheduleId: "schedule-1",
    competencyId: "comp-ops",
    segmentStart: "2026-09-01",
    slotIndex: 0,
  });

  assert.equal(key, "2026-09:schedule-1:comp-ops:2026-09-01:0");
});

test("a fully staffed completed set has no shortfalls", () => {
  const full = snapshot({
    assignments: ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"].flatMap((date) => staffed(date, 2)),
  });

  assert.deepEqual(findOvertimeShortfalls(full, "2026-09-01"), []);
});

test("competencies the schedule does not require are ignored", () => {
  const other = { ...COMPETENCY, id: "comp-other", code: "OTH" };
  const shortfalls = findOvertimeShortfalls(snapshot({ competencies: [COMPETENCY, other] }), "2026-09-01");

  assert.ok(shortfalls.every((shortfall) => shortfall.competencyId === "comp-ops"));
});
