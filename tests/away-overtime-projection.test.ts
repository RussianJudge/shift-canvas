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

const TIME_CODES = [
  { id: "code-x", workStatus: "working" as const },
  { id: "code-off", workStatus: "off" as const },
  { id: "code-vacation", workStatus: "off" as const },
];

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

/**
 * Proves the worker was already on this crew before the away day. Without one
 * the away day reads as work from before a transfer, which is a case of its
 * own below.
 */
const ROSTERED_HERE: StoredAssignment[] = [
  awayRow({ scheduleId: "schedule-1", date: "2026-09-01", competencyId: "comp-home", notes: null }),
];

test("projects an away overtime row onto the home schedule", () => {
  const [projected] = buildAwayOvertimeAssignments({
    schedule: HOME,
    awayAssignments: [awayRow()],
    homeAssignments: ROSTERED_HERE,
    scheduleNames: SCHEDULE_NAMES,
    timeCodes: TIME_CODES,
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
    homeAssignments: ROSTERED_HERE,
    scheduleNames: SCHEDULE_NAMES,
    timeCodes: TIME_CODES,
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
    timeCodes: TIME_CODES,
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
    homeAssignments: ROSTERED_HERE,
    scheduleNames: SCHEDULE_NAMES,
    timeCodes: TIME_CODES,
  });

  assert.deepEqual(projected, []);
});

test("overtime worked on the employee's own schedule is not projected", () => {
  const projected = buildAwayOvertimeAssignments({
    schedule: HOME,
    awayAssignments: [awayRow({ scheduleId: "schedule-1" })],
    homeAssignments: ROSTERED_HERE,
    scheduleNames: SCHEDULE_NAMES,
    timeCodes: TIME_CODES,
  });

  assert.deepEqual(projected, []);
});

test("rows for employees outside the displayed schedule are ignored", () => {
  const projected = buildAwayOvertimeAssignments({
    schedule: HOME,
    awayAssignments: [awayRow({ employeeId: "emp-visitor" })],
    homeAssignments: ROSTERED_HERE,
    scheduleNames: SCHEDULE_NAMES,
    timeCodes: TIME_CODES,
  });

  assert.deepEqual(projected, []);
});

test("one date away on two schedules projects a single cell", () => {
  const projected = buildAwayOvertimeAssignments({
    schedule: HOME,
    awayAssignments: [awayRow(), awayRow({ scheduleId: "schedule-3" })],
    homeAssignments: ROSTERED_HERE,
    scheduleNames: SCHEDULE_NAMES,
    timeCodes: TIME_CODES,
  });

  assert.equal(projected.length, 1);
  assert.equal(projected[0].awayScheduleId, "schedule-2");
});

test("the shift kind comes from the home rotation, not the crew worked", () => {
  const [projected] = buildAwayOvertimeAssignments({
    schedule: HOME,
    // 2026-09-05 is the fifth day of the pattern: DAY DAY NIGHT NIGHT OFF...
    awayAssignments: [awayRow({ date: "2026-09-05", shiftKind: "NIGHT" })],
    homeAssignments: ROSTERED_HERE,
    scheduleNames: SCHEDULE_NAMES,
    timeCodes: TIME_CODES,
  });

  assert.equal(projected.shiftKind, "OFF");
});

test("an overtime day at the very start of the window still projects", () => {
  // The live case: the loaded window opens on the overtime day itself, so the
  // worker has no earlier row on this crew to prove they are on it.
  const projected = buildAwayOvertimeAssignments({
    schedule: HOME,
    awayAssignments: [awayRow({ date: "2026-09-01" })],
    homeAssignments: [],
    scheduleNames: SCHEDULE_NAMES,
    timeCodes: TIME_CODES,
  });

  assert.equal(projected.length, 1);
  assert.equal(projected[0].date, "2026-09-01");
});

test("days off and leave marked on the old crew are not overtime", () => {
  // The live case: a mover's previous grid keeps carrying "Days off" and
  // "Vacation" rows for weeks after they land on the new crew.
  const projected = buildAwayOvertimeAssignments({
    schedule: HOME,
    awayAssignments: [
      awayRow({ date: "2026-09-10", competencyId: null, timeCodeId: "code-off", notes: null }),
      awayRow({ date: "2026-09-11", competencyId: null, timeCodeId: "code-vacation", notes: null }),
      awayRow({ date: "2026-09-12", competencyId: null, timeCodeId: null, notes: null }),
    ],
    homeAssignments: ROSTERED_HERE,
    scheduleNames: SCHEDULE_NAMES,
    timeCodes: TIME_CODES,
  });

  assert.deepEqual(projected, []);
});

test("a working time code with no competency still projects", () => {
  const projected = buildAwayOvertimeAssignments({
    schedule: HOME,
    awayAssignments: [
      awayRow({ date: "2026-09-10", competencyId: null, timeCodeId: "code-x", notes: null }),
    ],
    homeAssignments: ROSTERED_HERE,
    scheduleNames: SCHEDULE_NAMES,
    timeCodes: TIME_CODES,
  });

  assert.equal(projected.length, 1);
  assert.equal(projected[0].projectedTimeCodeId, "code-x");
});

test("an unknown away schedule still projects, without a name", () => {
  const [projected] = buildAwayOvertimeAssignments({
    schedule: HOME,
    awayAssignments: [awayRow({ scheduleId: "schedule-gone" })],
    homeAssignments: ROSTERED_HERE,
    scheduleNames: SCHEDULE_NAMES,
    timeCodes: TIME_CODES,
  });

  assert.equal(projected.awayScheduleName, null);
});
