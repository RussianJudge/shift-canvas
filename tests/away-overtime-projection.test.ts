import assert from "node:assert/strict";
import test from "node:test";

import { buildAwayOvertimeAssignments } from "../lib/overtime";
import type { Schedule, StoredAssignment } from "../lib/types";

const HOME: Schedule = {
  id: "schedule-1",
  name: "Shift 1",
  startDate: "2026-09-01",
  dayShiftDays: 2,
  nightShiftDays: 2,
  offDays: 4,
  isActive: true,
  competencyIds: [],
  employees: [
    {
      id: "emp-1",
      name: "Bursey, Adam",
      firstName: "Adam",
      lastName: "Bursey",
      email: "adam@example.com",
      role: "Operator",
      scheduleId: "schedule-1",
      competencyIds: [],
    },
  ],
};

const SCHEDULE_NAMES = { "schedule-1": "Shift 1", "schedule-2": "Shift 2" };

function awayRow(overrides: Partial<StoredAssignment> = {}): StoredAssignment {
  return {
    employeeId: "emp-1",
    scheduleId: "schedule-2",
    date: "2026-09-05",
    competencyId: "comp-ops",
    timeCodeId: null,
    notes: "OT|claimant:emp-1|claim:comp-ops",
    shiftKind: "DAY",
    ...overrides,
  };
}

test("projects an away overtime row onto the home schedule", () => {
  const [projected] = buildAwayOvertimeAssignments({
    schedule: HOME,
    awayAssignments: [awayRow()],
    homeAssignments: [],
    scheduleNames: SCHEDULE_NAMES,
  });

  assert.equal(projected.scheduleId, "schedule-1");
  assert.equal(projected.employeeId, "emp-1");
  assert.equal(projected.date, "2026-09-05");
  assert.equal(projected.sourceType, "away-overtime");
  assert.equal(projected.awayScheduleId, "schedule-2");
  assert.equal(projected.awayScheduleName, "Shift 2");
});

test("the stored competency and time code stay null so coverage cannot count an absent employee", () => {
  const [projected] = buildAwayOvertimeAssignments({
    schedule: HOME,
    awayAssignments: [awayRow({ competencyId: "comp-ops", timeCodeId: "code-x" })],
    homeAssignments: [],
    scheduleNames: SCHEDULE_NAMES,
  });

  assert.equal(projected.competencyId, null);
  assert.equal(projected.timeCodeId, null);
  assert.equal(projected.projectedCompetencyId, "comp-ops");
  assert.equal(projected.projectedTimeCodeId, "code-x");
});

test("a real home assignment on the same date wins", () => {
  const projected = buildAwayOvertimeAssignments({
    schedule: HOME,
    awayAssignments: [awayRow()],
    homeAssignments: [
      awayRow({ scheduleId: "schedule-1", competencyId: "comp-home", notes: null }),
    ],
    scheduleNames: SCHEDULE_NAMES,
  });

  assert.deepEqual(projected, []);
});

test("mutual and loan rows are left to their own workflows", () => {
  const projected = buildAwayOvertimeAssignments({
    schedule: HOME,
    awayAssignments: [
      awayRow({ date: "2026-09-05", notes: "MUT|posting:p1|target:schedule-2" }),
      awayRow({ date: "2026-09-06", notes: "LOAN|id:l1|role:target|target:schedule-2" }),
    ],
    homeAssignments: [],
    scheduleNames: SCHEDULE_NAMES,
  });

  assert.deepEqual(projected, []);
});

test("overtime worked on the employee's own schedule is not projected", () => {
  const projected = buildAwayOvertimeAssignments({
    schedule: HOME,
    awayAssignments: [awayRow({ scheduleId: "schedule-1" })],
    homeAssignments: [],
    scheduleNames: SCHEDULE_NAMES,
  });

  assert.deepEqual(projected, []);
});

test("rows for employees outside the displayed schedule are ignored", () => {
  const projected = buildAwayOvertimeAssignments({
    schedule: HOME,
    awayAssignments: [awayRow({ employeeId: "emp-visitor" })],
    homeAssignments: [],
    scheduleNames: SCHEDULE_NAMES,
  });

  assert.deepEqual(projected, []);
});

test("one date away on two schedules projects a single cell", () => {
  const projected = buildAwayOvertimeAssignments({
    schedule: HOME,
    awayAssignments: [awayRow(), awayRow({ scheduleId: "schedule-3" })],
    homeAssignments: [],
    scheduleNames: SCHEDULE_NAMES,
  });

  assert.equal(projected.length, 1);
  assert.equal(projected[0].awayScheduleId, "schedule-2");
});

test("the shift kind comes from the home rotation, not the crew worked", () => {
  const [projected] = buildAwayOvertimeAssignments({
    schedule: HOME,
    // 2026-09-05 is the fifth day of the pattern: DAY DAY NIGHT NIGHT OFF...
    awayAssignments: [awayRow({ date: "2026-09-05", shiftKind: "NIGHT" })],
    homeAssignments: [],
    scheduleNames: SCHEDULE_NAMES,
  });

  assert.equal(projected.shiftKind, "OFF");
});

test("an unknown away schedule still projects, without a name", () => {
  const [projected] = buildAwayOvertimeAssignments({
    schedule: HOME,
    awayAssignments: [awayRow({ scheduleId: "schedule-gone" })],
    homeAssignments: [],
    scheduleNames: SCHEDULE_NAMES,
  });

  assert.equal(projected.awayScheduleName, null);
});
