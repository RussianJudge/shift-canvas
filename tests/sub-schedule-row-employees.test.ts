import test from "node:test";
import assert from "node:assert/strict";

import { resolveSubScheduleRowEmployeeIds } from "../lib/sub-schedules.ts";

test("members are ignored when the carry-forward toggle is off", () => {
  const result = resolveSubScheduleRowEmployeeIds({
    assignedEmployeeIds: ["emp-a"],
    memberEmployeeIds: ["emp-b"],
    addedEmployeeIds: [],
    carryWorkersAcrossMonths: false,
  });

  assert.deepEqual(result, ["emp-a"]);
});

test("members are included when the carry-forward toggle is on", () => {
  const result = resolveSubScheduleRowEmployeeIds({
    assignedEmployeeIds: ["emp-a"],
    memberEmployeeIds: ["emp-b"],
    addedEmployeeIds: [],
    carryWorkersAcrossMonths: true,
  });

  assert.deepEqual(result.sort(), ["emp-a", "emp-b"]);
});

test("an employee present in several sources appears once", () => {
  const result = resolveSubScheduleRowEmployeeIds({
    assignedEmployeeIds: ["emp-a"],
    memberEmployeeIds: ["emp-a"],
    addedEmployeeIds: ["emp-a"],
    carryWorkersAcrossMonths: true,
  });

  assert.deepEqual(result, ["emp-a"]);
});

test("assigned employees still appear after being removed from the roster", () => {
  const result = resolveSubScheduleRowEmployeeIds({
    assignedEmployeeIds: ["emp-a"],
    memberEmployeeIds: [],
    addedEmployeeIds: [],
    carryWorkersAcrossMonths: true,
  });

  assert.deepEqual(result, ["emp-a"]);
});

test("session additions appear regardless of the toggle", () => {
  const result = resolveSubScheduleRowEmployeeIds({
    assignedEmployeeIds: [],
    memberEmployeeIds: [],
    addedEmployeeIds: ["emp-c"],
    carryWorkersAcrossMonths: false,
  });

  assert.deepEqual(result, ["emp-c"]);
});
