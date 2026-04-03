import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSwapOvertimeAssignmentRows,
  parseOvertimeAssignmentNote,
} from "../lib/overtime.ts";

test("swap overtime rows move the team worker to the originally required coverage competency", () => {
  const dates = ["2026-04-12", "2026-04-13", "2026-04-14"];
  const rows = buildSwapOvertimeAssignmentRows({
    claimantEmployeeId: "emp-ot",
    claimedCompetencyId: "comp-post-12",
    coverageCompetencyId: "comp-post-1",
    swapEmployeeId: "emp-team",
    dates,
    shiftKindForDate: () => "DAY",
  });

  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((row) => row.assignment_date),
    dates,
  );
  assert.deepEqual(
    rows.map((row) => row.competency_id),
    ["comp-post-1", "comp-post-1", "comp-post-1"],
  );
  assert.deepEqual(
    rows.map((row) => row.employee_id),
    ["emp-team", "emp-team", "emp-team"],
  );

  const parsed = parseOvertimeAssignmentNote(rows[0].notes);

  assert.equal(parsed.claimantEmployeeId, "emp-ot");
  assert.equal(parsed.claimedCompetencyId, "comp-post-12");
  assert.equal(parsed.coverageCompetencyId, "comp-post-1");
  assert.equal(parsed.swapEmployeeId, "emp-team");
  assert.equal(parsed.originalCompetencyId, "comp-post-12");
});
