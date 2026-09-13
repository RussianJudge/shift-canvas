import assert from "node:assert/strict";
import test from "node:test";

import { resolveDefaultClaimingEmployeeId } from "../lib/overtime";

const roster = [{ id: "emp-aguirre" }, { id: "emp-bursey" }, { id: "emp-wood" }];

test("an admin acts as themselves, not the first name on the roster", () => {
  const viewer = { role: "admin" as const, employeeId: "emp-bursey" };

  assert.equal(resolveDefaultClaimingEmployeeId(viewer, roster), "emp-bursey");
});

test("a leader acts as themselves", () => {
  const viewer = { role: "leader" as const, employeeId: "emp-wood" };

  assert.equal(resolveDefaultClaimingEmployeeId(viewer, roster), "emp-wood");
});

test("a worker always resolves to their own record", () => {
  const viewer = { role: "worker" as const, employeeId: "emp-wood" };

  assert.equal(resolveDefaultClaimingEmployeeId(viewer, roster), "emp-wood");
});

test("an admin with no employee record of their own falls back to the roster", () => {
  const viewer = { role: "admin" as const, employeeId: null };

  assert.equal(resolveDefaultClaimingEmployeeId(viewer, roster), "emp-aguirre");
});

test("an admin whose employee record is outside the visible roster falls back", () => {
  const viewer = { role: "admin" as const, employeeId: "emp-not-in-scope" };

  assert.equal(resolveDefaultClaimingEmployeeId(viewer, roster), "emp-aguirre");
});

test("an empty roster resolves to no one rather than throwing", () => {
  assert.equal(resolveDefaultClaimingEmployeeId({ role: "admin", employeeId: "emp-bursey" }, []), "");
  assert.equal(resolveDefaultClaimingEmployeeId({ role: "worker", employeeId: null }, []), "");
});
