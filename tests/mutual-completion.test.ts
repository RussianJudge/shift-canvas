import assert from "node:assert/strict";
import test from "node:test";

import { isMutualExchangeComplete } from "../lib/mutuals";

const TODAY = "2026-09-13";

function posting(overrides: Partial<Parameters<typeof isMutualExchangeComplete>[0]> = {}) {
  return {
    status: "accepted",
    dates: ["2026-09-10"],
    acceptedApplicationId: "app-1",
    applications: [{ id: "app-1", dates: ["2026-09-11"] }],
    ...overrides,
  };
}

test("both sides in the past counts as complete", () => {
  assert.equal(isMutualExchangeComplete(posting(), TODAY), true);
});

test("the owner's shift still to come is not complete", () => {
  assert.equal(isMutualExchangeComplete(posting({ dates: ["2026-09-20"] }), TODAY), false);
});

test("the applicant's shift still to come is not complete", () => {
  const p = posting({ applications: [{ id: "app-1", dates: ["2026-09-20"] }] });

  assert.equal(isMutualExchangeComplete(p, TODAY), false);
});

test("today itself has not been worked yet", () => {
  assert.equal(isMutualExchangeComplete(posting({ dates: [TODAY] }), TODAY), false);
});

test("multi-date swaps need every date past, not just the first", () => {
  const p = posting({ dates: ["2026-09-01", "2026-09-30"] });

  assert.equal(isMutualExchangeComplete(p, TODAY), false);
  assert.equal(isMutualExchangeComplete(posting({ dates: ["2026-09-01", "2026-09-02"] }), TODAY), true);
});

test("only accepted swaps can complete", () => {
  for (const status of ["open", "pending_leader_approval", "withdrawn", "cancelled", "rejected"]) {
    assert.equal(isMutualExchangeComplete(posting({ status }), TODAY), false, status);
  }
});

test("an accepted posting with no accepted application is not complete", () => {
  assert.equal(isMutualExchangeComplete(posting({ acceptedApplicationId: null }), TODAY), false);
});

test("a missing accepted application is not treated as complete", () => {
  const p = posting({ acceptedApplicationId: "app-gone" });

  assert.equal(isMutualExchangeComplete(p, TODAY), false);
});

test("a swap with no dates at all is not complete", () => {
  const p = posting({ dates: [], applications: [{ id: "app-1", dates: [] }] });

  assert.equal(isMutualExchangeComplete(p, TODAY), false);
});
