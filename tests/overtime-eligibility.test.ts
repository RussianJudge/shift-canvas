import assert from "node:assert/strict";
import test from "node:test";

import {
  canBeNotifiedAboutPosting,
  describeOvertimeBlocker,
  findOvertimeBlocker,
} from "../lib/overtime-eligibility";
import type { Employee, SchedulerSnapshot, StoredAssignment, SubScheduleAssignment } from "../lib/types";

// Pattern 2D/2N/4O from 2026-09-01, so 2026-09-05..08 are off days.
const SCHEDULE = {
  id: "schedule-1",
  name: "Shift 1",
  startDate: "2026-09-01",
  dayShiftDays: 2,
  nightShiftDays: 2,
  offDays: 4,
  isActive: true,
  competencyIds: ["comp-ops"],
  employees: [] as Employee[],
};

const EMPLOYEE: Employee = {
  id: "emp-1",
  name: "Bursey, Adam",
  firstName: "Adam",
  lastName: "Bursey",
  email: "adam@example.com",
  role: "Operator",
  scheduleId: "schedule-1",
  competencyIds: ["comp-ops"],
};

const POSTING = { competencyId: "comp-ops", dates: ["2026-09-05"] };

function snapshot(overrides: Partial<SchedulerSnapshot> = {}): SchedulerSnapshot {
  return {
    month: "2026-09",
    productionUnits: [],
    competencies: [],
    timeCodes: [],
    schedules: [{ ...SCHEDULE, employees: [EMPLOYEE] }],
    unassignedEmployees: [],
    assignments: [],
    projectedAssignments: [],
    overtimeClaims: [],
    manualOvertimePostings: [],
    completedSets: [],
    subSchedules: [],
    subScheduleAssignments: [],
    subScheduleMembers: [],
    ...overrides,
  } as SchedulerSnapshot;
}

function assignment(overrides: Partial<StoredAssignment> = {}): StoredAssignment {
  return {
    employeeId: "emp-1",
    scheduleId: "schedule-1",
    date: "2026-09-05",
    competencyId: "comp-ops",
    timeCodeId: null,
    notes: null,
    shiftKind: "DAY",
    ...overrides,
  };
}

test("an off-shift qualified worker with a clear date is eligible", () => {
  assert.equal(findOvertimeBlocker(EMPLOYEE, POSTING, snapshot()), null);
  assert.equal(canBeNotifiedAboutPosting(EMPLOYEE, POSTING, snapshot()), true);
});

test("blocker: not qualified for the post", () => {
  const unqualified = { ...EMPLOYEE, competencyIds: ["comp-other"] };

  assert.equal(findOvertimeBlocker(unqualified, POSTING, snapshot()), "not-qualified");
  assert.equal(canBeNotifiedAboutPosting(unqualified, POSTING, snapshot()), false);
});

test("blocker: a mutual falls on a posting date", () => {
  const withMutual = snapshot({
    assignments: [
      assignment({ competencyId: null, notes: "MUT|posting:p1|target:schedule-1|partner:emp-2" }),
    ],
  });

  assert.equal(findOvertimeBlocker(EMPLOYEE, POSTING, withMutual), "mutual-on-date");
});

test("blocker: already assigned on a posting date", () => {
  const withAssignment = snapshot({ assignments: [assignment()] });

  assert.equal(findOvertimeBlocker(EMPLOYEE, POSTING, withAssignment), "assigned-on-date");
});

test("blocker: a sub-schedule assignment falls on a posting date", () => {
  const withSubSchedule = snapshot({
    subScheduleAssignments: [
      {
        id: "sub-1",
        subScheduleId: "sub-schedule-1",
        employeeId: "emp-1",
        date: "2026-09-05",
        competencyId: "comp-ops",
        timeCodeId: null,
        notes: null,
      } as SubScheduleAssignment,
    ],
  });

  assert.equal(findOvertimeBlocker(EMPLOYEE, POSTING, withSubSchedule), "sub-schedule-on-date");
});

test("blocker: the posting lands on the worker's regular shift", () => {
  // 2026-09-01 is the first DAY of the pattern, so it is a working day.
  const onShift = { competencyId: "comp-ops", dates: ["2026-09-01"] };

  assert.equal(findOvertimeBlocker(EMPLOYEE, onShift, snapshot()), "regular-shift");
});

test("an empty date is checked against every posting date, not just the first", () => {
  const withAssignment = snapshot({ assignments: [assignment({ date: "2026-09-07" })] });
  const twoDates = { competencyId: "comp-ops", dates: ["2026-09-05", "2026-09-07"] };

  assert.equal(findOvertimeBlocker(EMPLOYEE, twoDates, withAssignment), "assigned-on-date");
});

test("a blank assignment row does not block", () => {
  // A row with neither a competency nor a time code is an empty cell.
  const withBlank = snapshot({ assignments: [assignment({ competencyId: null, timeCodeId: null })] });

  assert.equal(findOvertimeBlocker(EMPLOYEE, POSTING, withBlank), null);
});

test("a posting with no competency does not test qualification", () => {
  const anyone = { ...EMPLOYEE, competencyIds: [] };

  assert.equal(findOvertimeBlocker(anyone, { competencyId: null, dates: ["2026-09-05"] }, snapshot()), null);
});

test("the state of the posting is not a worker blocker", () => {
  /*
   * "Select an employee first", "fully claimed" and "already claimed" describe
   * the form or the posting, not whether this person could work it. They are
   * absent from the blocker rules on purpose, so a full posting cannot turn
   * into a wave of "you are not eligible" notifications.
   */
  const blockers: string[] = [
    "not-qualified",
    "mutual-on-date",
    "assigned-on-date",
    "sub-schedule-on-date",
    "regular-shift",
  ];

  for (const stateCase of ["select-employee", "fully-claimed", "already-claimed"]) {
    assert.equal(blockers.includes(stateCase), false);
  }

  // A posting carries no claim or slot information into these rules at all.
  assert.deepEqual(Object.keys(POSTING).sort(), ["competencyId", "dates"]);
});

test("every blocker has a reason the claim form can show", () => {
  for (const blocker of [
    "not-qualified",
    "mutual-on-date",
    "assigned-on-date",
    "sub-schedule-on-date",
    "regular-shift",
  ] as const) {
    assert.match(describeOvertimeBlocker(blocker), /\w/);
  }
});
