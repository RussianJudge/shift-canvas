import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAcceptedMutualAssignmentRows,
  parseMutualAssignmentNote,
} from "../lib/mutuals.ts";

test("accepted mutuals create mirrored M rows on both schedules and preserve original cells", () => {
  const rows = buildAcceptedMutualAssignmentRows({
    postingId: "mutual-post-1",
    mutualTimeCodeId: "tc-mutual",
    originalWorkerId: "emp-owner",
    originalWorkerScheduleId: "schedule-601",
    originalDates: [
      { date: "2026-04-10", shiftKind: "DAY" },
      { date: "2026-04-11", shiftKind: "DAY" },
    ],
    applicantEmployeeId: "emp-applicant",
    applicantScheduleId: "schedule-602",
    applicantDates: [
      { date: "2026-05-02", shiftKind: "NIGHT" },
    ],
    existingAssignments: new Map([
      ["emp-owner:2026-04-10", { competency_id: "comp-1", time_code_id: null }],
      ["emp-owner:2026-04-11", { competency_id: "comp-1", time_code_id: null }],
      ["emp-applicant:2026-04-10", { competency_id: "comp-12", time_code_id: null }],
      ["emp-applicant:2026-04-11", { competency_id: "comp-12", time_code_id: null }],
      ["emp-applicant:2026-05-02", { competency_id: "comp-5", time_code_id: null }],
      ["emp-owner:2026-05-02", { competency_id: "comp-14", time_code_id: null }],
    ]),
  });

  assert.equal(rows.length, 6);
  assert(rows.every((row) => row.time_code_id === "tc-mutual"));
  assert(rows.every((row) => row.competency_id === null));

  const ownerOnOwnShift = rows.filter(
    (row) => row.employee_id === "emp-owner" && row.assignment_date.startsWith("2026-04"),
  );
  const applicantBorrowedToOwnerShift = rows.filter(
    (row) => row.employee_id === "emp-applicant" && row.assignment_date.startsWith("2026-04"),
  );
  const applicantOnOwnShift = rows.filter(
    (row) => row.employee_id === "emp-applicant" && row.assignment_date === "2026-05-02",
  );
  const ownerBorrowedToApplicantShift = rows.filter(
    (row) => row.employee_id === "emp-owner" && row.assignment_date === "2026-05-02",
  );

  assert.equal(ownerOnOwnShift.length, 2);
  assert.equal(applicantBorrowedToOwnerShift.length, 2);
  assert.equal(applicantOnOwnShift.length, 1);
  assert.equal(ownerBorrowedToApplicantShift.length, 1);

  const borrowedAprilNote = parseMutualAssignmentNote(applicantBorrowedToOwnerShift[0]?.notes);
  assert.equal(borrowedAprilNote.targetScheduleId, "schedule-601");
  assert.equal(borrowedAprilNote.partnerEmployeeId, "emp-owner");
  assert.equal(borrowedAprilNote.originalCompetencyId, "comp-12");

  const borrowedMayNote = parseMutualAssignmentNote(ownerBorrowedToApplicantShift[0]?.notes);
  assert.equal(borrowedMayNote.targetScheduleId, "schedule-602");
  assert.equal(borrowedMayNote.partnerEmployeeId, "emp-applicant");
  assert.equal(borrowedMayNote.originalCompetencyId, "comp-14");
});
