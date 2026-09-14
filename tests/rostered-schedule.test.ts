import assert from "node:assert/strict";
import test from "node:test";

import { buildRosteredScheduleLookup } from "../lib/scheduling";

const EMPLOYEES = [
  { id: "emp-1", scheduleId: "schedule-602" },
  { id: "emp-2", scheduleId: "schedule-601" },
];

function row(employeeId: string, scheduleId: string, date: string) {
  return { employeeId, scheduleId, date };
}

test("a transferred worker's earlier days belong to the crew they worked", () => {
  // The shape found in live data: every September row on 604, current crew 602.
  const resolve = buildRosteredScheduleLookup(EMPLOYEES, [
    row("emp-1", "schedule-604", "2026-09-05"),
    row("emp-1", "schedule-604", "2026-09-06"),
  ]);

  assert.equal(resolve("emp-1", "2026-09-05", "schedule-604"), "schedule-604");
});

test("days from the transfer onward belong to the new crew", () => {
  const resolve = buildRosteredScheduleLookup(EMPLOYEES, [
    row("emp-1", "schedule-604", "2026-09-05"),
    row("emp-1", "schedule-602", "2026-09-20"),
    row("emp-1", "schedule-602", "2026-09-21"),
  ]);

  assert.equal(resolve("emp-1", "2026-09-05", "schedule-604"), "schedule-604");
  assert.equal(resolve("emp-1", "2026-09-20", "schedule-602"), "schedule-602");
  assert.equal(resolve("emp-1", "2026-09-21", "schedule-602"), "schedule-602");
});

test("a borrowed day still resolves to the worker's own crew", () => {
  // They keep working 601 either side of the loan, so the move date is the
  // start of the window and the borrowed day stays overtime.
  const resolve = buildRosteredScheduleLookup(EMPLOYEES, [
    row("emp-2", "schedule-601", "2026-09-01"),
    row("emp-2", "schedule-604", "2026-09-10"),
    row("emp-2", "schedule-601", "2026-09-15"),
  ]);

  assert.equal(resolve("emp-2", "2026-09-10", "schedule-604"), "schedule-601");
});

test("a worker borrowed after transferring is still on their new crew", () => {
  const resolve = buildRosteredScheduleLookup(EMPLOYEES, [
    row("emp-1", "schedule-604", "2026-09-05"),
    row("emp-1", "schedule-602", "2026-09-20"),
    row("emp-1", "schedule-604", "2026-09-25"),
  ]);

  assert.equal(resolve("emp-1", "2026-09-25", "schedule-604"), "schedule-602");
});

test("with no rows on the current crew every day belongs to the crew worked", () => {
  const resolve = buildRosteredScheduleLookup(EMPLOYEES, [row("emp-1", "schedule-604", "2026-09-05")]);

  assert.equal(resolve("emp-1", "2026-09-05", "schedule-604"), "schedule-604");
});

test("a row with no schedule of its own falls back to the current crew", () => {
  const resolve = buildRosteredScheduleLookup(EMPLOYEES, []);

  assert.equal(resolve("emp-1", "2026-09-05", null), "schedule-602");
});

test("an unknown employee resolves to the crew the row was written against", () => {
  const resolve = buildRosteredScheduleLookup(EMPLOYEES, []);

  assert.equal(resolve("emp-gone", "2026-09-05", "schedule-604"), "schedule-604");
});
