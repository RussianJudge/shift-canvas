import test from "node:test";
import assert from "node:assert/strict";

import {
  getCompletedSetDatesForMonth,
  getExtendedMonthDays,
  getMonthDays,
  getWorkedSetDays,
  isCompletedSetRange,
  toggleCompletedSetEntries,
} from "../lib/scheduling.ts";
import type { Schedule } from "../lib/types.ts";

test("cross-month sets complete and reopen across both months", () => {
  const schedule: Pick<
    Schedule,
    "id" | "startDate" | "dayShiftDays" | "nightShiftDays" | "offDays"
  > = {
    id: "schedule-601",
    startDate: "2026-03-30",
    dayShiftDays: 3,
    nightShiftDays: 3,
    offDays: 6,
  };

  const workedSet = getWorkedSetDays(
    schedule,
    getExtendedMonthDays("2026-03"),
    "2026-03-31",
  );

  assert.deepEqual(
    workedSet.map((day) => day.date),
    [
      "2026-03-30",
      "2026-03-31",
      "2026-04-01",
      "2026-04-02",
      "2026-04-03",
      "2026-04-04",
    ],
  );

  const completedSets = toggleCompletedSetEntries(
    [],
    schedule.id,
    workedSet[0].date,
    workedSet[workedSet.length - 1].date,
    true,
  );

  assert.deepEqual(
    completedSets.map((entry) => entry.month),
    ["2026-03", "2026-04"],
  );
  assert.equal(
    isCompletedSetRange(
      completedSets,
      schedule.id,
      workedSet[0].date,
      workedSet[workedSet.length - 1].date,
    ),
    true,
  );

  const marchDates = getCompletedSetDatesForMonth(
    completedSets,
    schedule.id,
    getMonthDays("2026-03"),
  );
  const aprilDates = getCompletedSetDatesForMonth(
    completedSets,
    schedule.id,
    getMonthDays("2026-04"),
  );

  assert.deepEqual(Array.from(marchDates), ["2026-03-30", "2026-03-31"]);
  assert.deepEqual(
    Array.from(aprilDates),
    ["2026-04-01", "2026-04-02", "2026-04-03", "2026-04-04"],
  );

  const reopenedSets = toggleCompletedSetEntries(
    completedSets,
    schedule.id,
    workedSet[0].date,
    workedSet[workedSet.length - 1].date,
    false,
  );

  assert.equal(
    isCompletedSetRange(
      reopenedSets,
      schedule.id,
      workedSet[0].date,
      workedSet[workedSet.length - 1].date,
    ),
    false,
  );
  assert.equal(
    getCompletedSetDatesForMonth(reopenedSets, schedule.id, getMonthDays("2026-03")).size,
    0,
  );
  assert.equal(
    getCompletedSetDatesForMonth(reopenedSets, schedule.id, getMonthDays("2026-04")).size,
    0,
  );
});
