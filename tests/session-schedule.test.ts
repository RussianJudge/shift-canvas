import assert from "node:assert/strict";
import test from "node:test";

import { resolveSessionScheduleId } from "../lib/session-schedule";

test("a moved worker gets the crew their employee record names", () => {
  // The live case: Personnel moved the leader to crew 4, the profile copy still
  // said crew 2, and every check keyed on the session saw crew 2.
  assert.equal(
    resolveSessionScheduleId({
      employeeId: "emp-mcelman",
      scheduleId: "schedule-602",
      employeeScheduleId: "schedule-604",
    }),
    "schedule-604",
  );
});

test("a profile with no linked employee keeps its own crew", () => {
  assert.equal(
    resolveSessionScheduleId({
      employeeId: null,
      scheduleId: "schedule-601",
      employeeScheduleId: null,
    }),
    "schedule-601",
  );
});

test("a linked employee with no crew resolves to none, not the stale copy", () => {
  assert.equal(
    resolveSessionScheduleId({
      employeeId: "emp-unassigned",
      scheduleId: "schedule-601",
      employeeScheduleId: null,
    }),
    null,
  );
});

test("a profile whose own crew is unset still gets the employee's", () => {
  // Alahmad's shape: a leader whose profile never carried a crew at all.
  assert.equal(
    resolveSessionScheduleId({
      employeeId: "emp-alahmad",
      scheduleId: null,
      employeeScheduleId: "schedule-d7420b27",
    }),
    "schedule-d7420b27",
  );
});

test("the two agreeing is the ordinary case", () => {
  assert.equal(
    resolveSessionScheduleId({
      employeeId: "emp-1",
      scheduleId: "schedule-601",
      employeeScheduleId: "schedule-601",
    }),
    "schedule-601",
  );
});
