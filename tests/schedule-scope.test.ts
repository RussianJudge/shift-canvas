import assert from "node:assert/strict";
import test from "node:test";

import {
  buildScheduleScopeHref,
  defaultScheduleScopeForRole,
  parseScheduleScope,
  resolveScheduleScope,
} from "../lib/schedule-scope";

test("only the two known values parse", () => {
  assert.equal(parseScheduleScope("mine"), "mine");
  assert.equal(parseScheduleScope("team"), "team");
  assert.equal(parseScheduleScope("everyone"), null);
  assert.equal(parseScheduleScope(""), null);
  assert.equal(parseScheduleScope(null), null);
});

test("workers open their own schedule, everyone else opens the crew", () => {
  assert.equal(defaultScheduleScopeForRole("worker"), "mine");
  assert.equal(defaultScheduleScopeForRole("leader"), "team");
  assert.equal(defaultScheduleScopeForRole("admin"), "team");
});

test("a saved preference beats the role default", () => {
  assert.equal(resolveScheduleScope({ param: null, stored: "team", role: "worker" }), "team");
  assert.equal(resolveScheduleScope({ param: null, stored: "mine", role: "admin" }), "mine");
});

test("the url wins for the visit", () => {
  assert.equal(resolveScheduleScope({ param: "mine", stored: "team", role: "admin" }), "mine");
  assert.equal(resolveScheduleScope({ param: "team", stored: "mine", role: "worker" }), "team");
});

test("a junk url value falls through to what was saved", () => {
  assert.equal(resolveScheduleScope({ param: "everyone", stored: "mine", role: "admin" }), "mine");
});

test("a junk saved value falls through to the role default", () => {
  assert.equal(resolveScheduleScope({ param: null, stored: "garbage", role: "leader" }), "team");
});

test("nothing saved and nothing asked for uses the role", () => {
  assert.equal(resolveScheduleScope({ param: null, stored: null, role: "worker" }), "mine");
  assert.equal(resolveScheduleScope({ param: undefined, stored: undefined, role: "leader" }), "team");
});

test("switching scope keeps the month and the schedule context", () => {
  assert.equal(
    buildScheduleScopeHref({ scope: "mine", month: "2026-09", schedule: "sub:sub-schedule-1a2b" }),
    "/schedule?month=2026-09&schedule=sub%3Asub-schedule-1a2b&scope=mine",
  );
});

test("no schedule context leaves the parameter out", () => {
  assert.equal(
    buildScheduleScopeHref({ scope: "team", month: "2026-09", schedule: null }),
    "/schedule?month=2026-09&scope=team",
  );
});
