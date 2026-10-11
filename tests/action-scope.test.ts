import assert from "node:assert/strict";
import test from "node:test";

import { canAccessScope } from "../lib/action-scope";
import type { AppRole, AppSession } from "../lib/types";

function session(role: AppRole, overrides: Partial<AppSession> = {}): AppSession {
  return {
    role,
    companyId: "company-suncor",
    siteId: "site-mildred-lake",
    businessAreaId: "business-area-sgd",
    ...overrides,
  } as AppSession;
}

const SGD = {
  companyId: "company-suncor",
  siteId: "site-mildred-lake",
  businessAreaId: "business-area-sgd",
};
const WTC = { ...SGD, businessAreaId: "business-area-wtc" };
const OTHER_SITE = { ...SGD, siteId: "site-elsewhere" };
const OTHER_COMPANY = { ...SGD, companyId: "company-other" };

test("an admin reaches another business area in their own company", () => {
  assert.equal(canAccessScope(session("admin"), WTC), true);
});

test("an admin reaches another site in their own company", () => {
  assert.equal(canAccessScope(session("admin"), OTHER_SITE), true);
});

test("an admin stops at the company boundary", () => {
  assert.equal(canAccessScope(session("admin"), OTHER_COMPANY), false);
});

test("a leader reaches their own business area", () => {
  assert.equal(canAccessScope(session("leader"), SGD), true);
});

test("a leader does not reach a neighbouring business area", () => {
  assert.equal(canAccessScope(session("leader"), WTC), false);
});

test("a worker is bounded the same way a leader is", () => {
  assert.equal(canAccessScope(session("worker"), SGD), true);
  assert.equal(canAccessScope(session("worker"), WTC), false);
});

test("no session reaches nothing", () => {
  assert.equal(canAccessScope(null, SGD), false);
  assert.equal(canAccessScope(undefined, SGD), false);
});

/**
 * A session without a company is the dangerous case: `applySessionScope`
 * returns an unfiltered query for one, so a mutation that trusted it would
 * cross tenants.
 */
test("a session with no company reaches nothing, for any role", () => {
  for (const role of ["admin", "leader", "worker"] as AppRole[]) {
    assert.equal(canAccessScope(session(role, { companyId: undefined }), SGD), false);
  }
});
