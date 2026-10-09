import assert from "node:assert/strict";
import test from "node:test";

import { getSetAwareDateBounds, shiftForDate } from "../lib/scheduling";

// 2 day / 2 night / 4 off. The start date decides where October's edges fall in
// the rotation, so each fixture below puts a different edge mid-set.
function rotation(startDate: string) {
  return { startDate, dayShiftDays: 2, nightShiftDays: 2, offDays: 4 };
}

const MONTH = "2026-10";

test("a month whose edges both fall on off days needs no extension", () => {
  const schedule = rotation("2026-09-01");

  assert.equal(shiftForDate(schedule, "2026-10-01"), "OFF");
  assert.equal(shiftForDate(schedule, "2026-10-31"), "OFF");
  assert.deepEqual(getSetAwareDateBounds(MONTH, [schedule]), {
    monthStart: "2026-10-01",
    monthEnd: "2026-10-31",
  });
});

test("a set running past the month end pulls the window with it", () => {
  const schedule = rotation("2026-09-03");

  assert.equal(shiftForDate(schedule, "2026-10-01"), "OFF");
  assert.notEqual(shiftForDate(schedule, "2026-10-31"), "OFF");
  assert.deepEqual(getSetAwareDateBounds(MONTH, [schedule]), {
    monthStart: "2026-10-01",
    monthEnd: "2026-11-01",
  });
});

test("a set running into the month start pulls the window back", () => {
  const schedule = rotation("2026-09-06");

  assert.notEqual(shiftForDate(schedule, "2026-10-01"), "OFF");
  assert.equal(shiftForDate(schedule, "2026-10-31"), "OFF");
  assert.deepEqual(getSetAwareDateBounds(MONTH, [schedule]), {
    monthStart: "2026-09-30",
    monthEnd: "2026-10-31",
  });
});

test("several crews union to the widest straddle at each edge", () => {
  const bounds = getSetAwareDateBounds(MONTH, [
    rotation("2026-09-01"),
    rotation("2026-09-03"),
    rotation("2026-09-05"),
  ]);

  // The 5 September crew starts a set on 31 October, so the union reaches
  // further than either of the other two on its own.
  assert.deepEqual(bounds, { monthStart: "2026-09-29", monthEnd: "2026-11-03" });
});

test("the order crews are given in does not change the window", () => {
  const schedules = [rotation("2026-09-05"), rotation("2026-09-03")];

  assert.deepEqual(
    getSetAwareDateBounds(MONTH, schedules),
    getSetAwareDateBounds(MONTH, [...schedules].reverse()),
  );
});

test("no crews falls back to the plain month", () => {
  assert.deepEqual(getSetAwareDateBounds(MONTH, []), {
    monthStart: "2026-10-01",
    monthEnd: "2026-10-31",
  });
});

test("the window never ends up narrower than the month it renders", () => {
  for (let day = 1; day <= 28; day += 1) {
    const schedule = rotation(`2026-09-${String(day).padStart(2, "0")}`);
    const bounds = getSetAwareDateBounds(MONTH, [schedule]);

    assert.ok(bounds.monthStart <= "2026-10-01", `start too late for day ${day}`);
    assert.ok(bounds.monthEnd >= "2026-10-31", `end too early for day ${day}`);
  }
});

function dayNumber(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);

  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

/**
 * The straddle cannot exceed one set, less the day already inside the month —
 * the worst case is a month edge landing on a set's first or last day. That is
 * what keeps this window a few days wider than the month rather than a month
 * wider, so it is worth holding as an invariant and not just a fixture.
 */
test("the extension never exceeds a set length either side, for any rotation", () => {
  // The live rotation, then the edges of what the schema allows: a one-day set,
  // a long symmetric one, a long lopsided one, and a single day off.
  const patterns = [
    { dayShiftDays: 2, nightShiftDays: 2, offDays: 4 },
    { dayShiftDays: 1, nightShiftDays: 0, offDays: 1 },
    { dayShiftDays: 7, nightShiftDays: 7, offDays: 7 },
    { dayShiftDays: 14, nightShiftDays: 7, offDays: 10 },
    { dayShiftDays: 4, nightShiftDays: 4, offDays: 1 },
  ];

  for (const { dayShiftDays, nightShiftDays, offDays } of patterns) {
    const setLength = dayShiftDays + nightShiftDays;

    // Every phase of the longest cycle the list contains.
    for (let start = 1; start <= 31; start += 1) {
      const schedule = {
        startDate: `2026-08-${String(start).padStart(2, "0")}`,
        dayShiftDays,
        nightShiftDays,
        offDays,
      };
      const bounds = getSetAwareDateBounds(MONTH, [schedule]);
      const pattern = `${dayShiftDays}/${nightShiftDays}/${offDays} from ${schedule.startDate}`;

      assert.ok(
        dayNumber(bounds.monthEnd) - dayNumber("2026-10-31") <= setLength - 1,
        `${pattern} reached ${bounds.monthEnd}`,
      );
      assert.ok(
        dayNumber("2026-10-01") - dayNumber(bounds.monthStart) <= setLength - 1,
        `${pattern} reached ${bounds.monthStart}`,
      );
    }
  }
});

/**
 * A rotation with no rostered days off is legal — the schema only requires
 * `off_days >= 0` and the pattern total to be positive — and it has no set
 * boundary to find. The walk then returns the whole extended window, which is
 * what the board read before. Padding by a set length instead would cut a
 * continuous set in half and undercount its coverage.
 */
test("a pattern with no off days widens to the extended window rather than guessing", () => {
  const continuous = { startDate: "2026-09-01", dayShiftDays: 4, nightShiftDays: 4, offDays: 0 };

  assert.deepEqual(getSetAwareDateBounds(MONTH, [continuous]), {
    monthStart: "2026-09-01",
    monthEnd: "2026-11-30",
  });
});
