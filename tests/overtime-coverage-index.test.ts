import assert from "node:assert/strict";
import test from "node:test";

import { buildOvertimeCoverageIndex, resolveClaimCoverageCompetencyId } from "../lib/overtime";

/*
 * The live case this was found on: Larocque claimed post 5 (comp-2df724da) on
 * schedule-603 for 2026-09-21, but the overtime existed to cover post 1
 * (comp-bf3a865b) and Forbister was swapped onto post 5. Post 1 was later
 * filled by a regular worker, and the claim still read as needed because it
 * was being measured against post 5.
 */
const SWAP_NOTE =
  "OT|claimant:emp-e4efbfc4|claim:comp-2df724da|coverage:comp-bf3a865b|swap:emp-cb618558";

const CLAIM = {
  scheduleId: "schedule-603",
  employeeId: "emp-e4efbfc4",
  competencyId: "comp-2df724da",
  date: "2026-09-21",
};

test("a swap claim resolves to the post it covers", () => {
  const index = buildOvertimeCoverageIndex([
    { scheduleId: "schedule-603", date: "2026-09-21", notes: SWAP_NOTE },
  ]);

  assert.equal(resolveClaimCoverageCompetencyId(CLAIM, index), "comp-bf3a865b");
});

test("both rows a swap writes agree on the covered post", () => {
  // The claimant's row and the swapped worker's row carry the same pair.
  const index = buildOvertimeCoverageIndex([
    { scheduleId: "schedule-603", date: "2026-09-21", notes: SWAP_NOTE },
    { scheduleId: "schedule-603", date: "2026-09-21", notes: `${SWAP_NOTE}|orig:comp-2df724da` },
  ]);

  assert.equal(index.size, 1);
  assert.equal(resolveClaimCoverageCompetencyId(CLAIM, index), "comp-bf3a865b");
});

test("a direct claim resolves to the post it names", () => {
  const index = buildOvertimeCoverageIndex([
    {
      scheduleId: "schedule-603",
      date: "2026-09-21",
      notes: "OT|claimant:emp-55f27657|claim:comp-3a87da8f|coverage:comp-3a87da8f",
    },
  ]);

  assert.equal(
    resolveClaimCoverageCompetencyId(
      { scheduleId: "schedule-603", employeeId: "emp-55f27657", competencyId: "comp-3a87da8f", date: "2026-09-21" },
      index,
    ),
    "comp-3a87da8f",
  );
});

test("a claim with no matching row keeps its own post", () => {
  assert.equal(resolveClaimCoverageCompetencyId(CLAIM, new Map()), "comp-2df724da");
});

test("another date's swap does not answer for this one", () => {
  const index = buildOvertimeCoverageIndex([
    { scheduleId: "schedule-603", date: "2026-09-22", notes: SWAP_NOTE },
  ]);

  assert.equal(resolveClaimCoverageCompetencyId(CLAIM, index), "comp-2df724da");
});

test("another crew's swap does not answer for this one", () => {
  const index = buildOvertimeCoverageIndex([
    { scheduleId: "schedule-601", date: "2026-09-21", notes: SWAP_NOTE },
  ]);

  assert.equal(resolveClaimCoverageCompetencyId(CLAIM, index), "comp-2df724da");
});

test("rows that are not overtime are ignored", () => {
  const index = buildOvertimeCoverageIndex([
    { scheduleId: "schedule-603", date: "2026-09-21", notes: null },
    { scheduleId: "schedule-603", date: "2026-09-21", notes: "MUT|posting:p1|target:schedule-603" },
    { scheduleId: "schedule-603", date: "2026-09-21", notes: "LOAN|id:l1|role:target" },
  ]);

  assert.equal(index.size, 0);
});

test("a claim missing a schedule or post is left alone", () => {
  const index = buildOvertimeCoverageIndex([
    { scheduleId: "schedule-603", date: "2026-09-21", notes: SWAP_NOTE },
  ]);

  assert.equal(resolveClaimCoverageCompetencyId({ ...CLAIM, scheduleId: null }, index), "comp-2df724da");
  assert.equal(resolveClaimCoverageCompetencyId({ ...CLAIM, competencyId: null }, index), null);
});
