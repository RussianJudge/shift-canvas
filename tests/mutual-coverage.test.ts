import assert from "node:assert/strict";
import test from "node:test";

import {
  findBestMutualCoverageCompetency,
  type StaffingAssignment,
  type StaffingCompetency,
  type StaffingOvertimeClaim,
} from "../lib/mutual-coverage";

const POST_11: StaffingCompetency = { id: "comp-11", code: "11", requiredStaff: 1 };
const POST_22: StaffingCompetency = { id: "comp-22", code: "22", requiredStaff: 1 };
const SCHEDULE = { id: "schedule-1", competencyIds: ["comp-11", "comp-22"] };
const DATE = "2026-10-08";

function find(input: {
  competencies?: StaffingCompetency[];
  assignments?: StaffingAssignment[];
  overtimeClaims?: StaffingOvertimeClaim[];
  employeeCompetencyIds?: string[];
  pendingFillCounts?: Map<string, number>;
}) {
  return findBestMutualCoverageCompetency({
    schedule: SCHEDULE,
    employeeCompetencyIds: input.employeeCompetencyIds ?? ["comp-11", "comp-22"],
    date: DATE,
    competencies: input.competencies ?? [POST_11, POST_22],
    assignments: input.assignments ?? [],
    overtimeClaims: input.overtimeClaims ?? [],
    pendingFillCounts: input.pendingFillCounts ?? new Map(),
  });
}

test("an open post is taken ahead of one somebody claimed overtime on", () => {
  /*
   * The reported case: post 11 was covered by a claimed overtime shift and post
   * 22 was genuinely open. Placing the mutual's worker on 11 released that
   * person's overtime, cleared them from the schedule, and reopened the
   * shortfall on 22 — so the overtime moved rather than disappearing, and a
   * third party lost a shift they had claimed.
   */
  const chosen = find({
    assignments: [
      { scheduleId: "schedule-1", date: DATE, competencyId: "comp-11", notes: "OT|claimant:emp-9|claim:comp-11" },
    ],
    overtimeClaims: [{ scheduleId: "schedule-1", date: DATE, competencyId: "comp-11" }],
  });

  assert.equal(chosen, "comp-22");
});

test("a claimed-overtime post is still used when nothing else is open", () => {
  // Better placed than unplaced: the preference is an ordering, not a ban.
  const chosen = find({
    assignments: [
      { scheduleId: "schedule-1", date: DATE, competencyId: "comp-11", notes: "OT|claimant:emp-9|claim:comp-11" },
      { scheduleId: "schedule-1", date: DATE, competencyId: "comp-22", notes: null },
    ],
    overtimeClaims: [{ scheduleId: "schedule-1", date: DATE, competencyId: "comp-11" }],
  });

  assert.equal(chosen, "comp-11");
});

test("overtime cover does not count a post as filled", () => {
  // The worker arrives on regular time, so a post held open by overtime still
  // has room for them.
  const chosen = find({
    competencies: [POST_11],
    assignments: [
      { scheduleId: "schedule-1", date: DATE, competencyId: "comp-11", notes: "OT|claimant:emp-9|claim:comp-11" },
    ],
    overtimeClaims: [{ scheduleId: "schedule-1", date: DATE, competencyId: "comp-11" }],
  });

  assert.equal(chosen, "comp-11");
});

test("a post the worker is not qualified for is never chosen", () => {
  assert.equal(find({ employeeCompetencyIds: ["comp-22"] }), "comp-22");
  assert.equal(find({ employeeCompetencyIds: ["comp-other"] }), null);
});

test("a post the crew does not require is never chosen", () => {
  const chosen = findBestMutualCoverageCompetency({
    schedule: { id: "schedule-1", competencyIds: ["comp-22"] },
    employeeCompetencyIds: ["comp-11", "comp-22"],
    date: DATE,
    competencies: [POST_11, POST_22],
    assignments: [],
    overtimeClaims: [],
    pendingFillCounts: new Map(),
  });

  assert.equal(chosen, "comp-22");
});

test("a fully staffed crew leaves nowhere to place them", () => {
  const chosen = find({
    assignments: [
      { scheduleId: "schedule-1", date: DATE, competencyId: "comp-11", notes: null },
      { scheduleId: "schedule-1", date: DATE, competencyId: "comp-22", notes: null },
    ],
  });

  assert.equal(chosen, null);
});

test("places already promised to an earlier row in the same swap are counted", () => {
  // pendingFillCounts carries the rows this run has written but not yet saved.
  const chosen = find({
    pendingFillCounts: new Map([[`schedule-1:${DATE}:comp-22`, 1]]),
  });

  assert.equal(chosen, "comp-11");
});

test("the emptier post wins when neither has overtime on it", () => {
  const chosen = find({
    competencies: [{ ...POST_11, requiredStaff: 3 }, POST_22],
  });

  assert.equal(chosen, "comp-11");
});

test("another crew's assignments and claims are ignored", () => {
  const chosen = find({
    competencies: [POST_11],
    assignments: [{ scheduleId: "schedule-2", date: DATE, competencyId: "comp-11", notes: null }],
    overtimeClaims: [{ scheduleId: "schedule-2", date: DATE, competencyId: "comp-11" }],
  });

  assert.equal(chosen, "comp-11");
});
