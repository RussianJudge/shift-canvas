import assert from "node:assert/strict";
import test from "node:test";

import { findWeekIndexForDate, getWeeksForMonth } from "../lib/scheduling";

test("every week runs Monday to Sunday", () => {
  for (const monthKey of ["2026-01", "2026-02", "2026-09", "2026-11"]) {
    for (const week of getWeeksForMonth(monthKey)) {
      assert.equal(week.days.length, 7);
      assert.equal(week.days[0].dayName, "Mon");
      assert.equal(week.days[6].dayName, "Sun");
      assert.equal(week.start, week.days[0].date);
      assert.equal(week.end, week.days[6].date);
    }
  }
});

test("weeks cover the whole month and nothing is skipped", () => {
  const weeks = getWeeksForMonth("2026-09");
  const covered = new Set(weeks.flatMap((week) => week.days.map((day) => day.date)));

  for (let day = 1; day <= 30; day += 1) {
    assert.ok(covered.has(`2026-09-${String(day).padStart(2, "0")}`), `missing day ${day}`);
  }

  const dates = weeks.flatMap((week) => week.days.map((day) => day.date));
  assert.equal(new Set(dates).size, dates.length, "weeks must not overlap");
});

test("days from a neighbouring month are flagged, days inside it are not", () => {
  // September 2026 opens on a Tuesday, so the first week reaches back into August.
  const weeks = getWeeksForMonth("2026-09");
  const firstWeek = weeks[0];

  assert.equal(firstWeek.days[0].date, "2026-08-31");
  assert.equal(firstWeek.days[0].isOutsideMonth, true);
  assert.equal(firstWeek.days[1].date, "2026-09-01");
  assert.equal(firstWeek.days[1].isOutsideMonth, false);

  const lastWeek = weeks[weeks.length - 1];
  assert.ok(lastWeek.days.some((day) => day.isOutsideMonth), "trailing week reaches into October");
  assert.ok(lastWeek.days.some((day) => !day.isOutsideMonth));
});

test("a month starting on a Monday needs no leading spill", () => {
  // June 2026 starts on a Monday.
  const weeks = getWeeksForMonth("2026-06");

  assert.equal(weeks[0].days[0].date, "2026-06-01");
  assert.equal(weeks[0].days.every((day) => !day.isOutsideMonth), true);
});

test("weekends are Saturday and Sunday only", () => {
  for (const week of getWeeksForMonth("2026-09")) {
    assert.deepEqual(
      week.days.filter((day) => day.isWeekend).map((day) => day.dayName),
      ["Sat", "Sun"],
    );
  }
});

test("a date resolves to the week that contains it", () => {
  const weeks = getWeeksForMonth("2026-09");
  const index = findWeekIndexForDate(weeks, "2026-09-06");

  assert.ok(index >= 0);
  const week = weeks[index];
  assert.ok("2026-09-06" >= week.start && "2026-09-06" <= week.end);
  assert.equal(week.days.some((day) => day.date === "2026-09-06"), true);
});

test("a date outside the month's weeks resolves to no week", () => {
  const weeks = getWeeksForMonth("2026-09");

  assert.equal(findWeekIndexForDate(weeks, "2026-12-25"), -1);
  assert.equal(findWeekIndexForDate(weeks, null), -1);
});

test("February in a leap year is covered", () => {
  const weeks = getWeeksForMonth("2028-02");
  const covered = new Set(weeks.flatMap((week) => week.days.map((day) => day.date)));

  assert.ok(covered.has("2028-02-29"));
});
