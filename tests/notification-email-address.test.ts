import assert from "node:assert/strict";
import test from "node:test";

import {
  isPlausibleEmail,
  isTokenExpired,
  normalizeNotificationEmail,
  resolveNotificationAddress,
} from "../lib/notification-email-address";

const PERSONNEL = "adabursey@suncor.com";
const CHOSEN = "adambursey@hotmail.com";

test("with no override, mail goes to the personnel address", () => {
  const result = resolveNotificationAddress({ employeeEmail: PERSONNEL, override: null });

  assert.deepEqual(result, { email: PERSONNEL, source: "personnel", pendingEmail: null });
});

test("a confirmed override wins", () => {
  const result = resolveNotificationAddress({
    employeeEmail: PERSONNEL,
    override: { email: CHOSEN, verifiedAt: "2026-09-26T10:00:00Z", tokenExpiresAt: null },
  });

  assert.equal(result.email, CHOSEN);
  assert.equal(result.source, "chosen");
  assert.equal(result.pendingEmail, null);
});

test("an unconfirmed override does not divert mail", () => {
  // The whole point of confirming: a mistyped address must not silence anyone.
  const result = resolveNotificationAddress({
    employeeEmail: PERSONNEL,
    override: { email: "adambursey@hotmial.com", verifiedAt: null, tokenExpiresAt: "2026-09-27T10:00:00Z" },
  });

  assert.equal(result.email, PERSONNEL);
  assert.equal(result.source, "personnel");
  assert.equal(result.pendingEmail, "adambursey@hotmial.com");
});

test("a chosen address is normalised like the personnel one", () => {
  const result = resolveNotificationAddress({
    employeeEmail: "  ADABursey@Suncor.com ",
    override: { email: "  ADAMBursey@Hotmail.COM ", verifiedAt: "2026-09-26T10:00:00Z", tokenExpiresAt: null },
  });

  assert.equal(result.email, CHOSEN);
});

test("an employee with no address anywhere resolves to nothing", () => {
  const result = resolveNotificationAddress({ employeeEmail: null, override: null });

  assert.equal(result.email, null);
  assert.equal(result.pendingEmail, null);
});

test("a confirmed override covers an employee with no personnel address", () => {
  const result = resolveNotificationAddress({
    employeeEmail: null,
    override: { email: CHOSEN, verifiedAt: "2026-09-26T10:00:00Z", tokenExpiresAt: null },
  });

  assert.equal(result.email, CHOSEN);
  assert.equal(result.source, "chosen");
});

test("a blank override is ignored rather than treated as an address", () => {
  const result = resolveNotificationAddress({
    employeeEmail: PERSONNEL,
    override: { email: "   ", verifiedAt: "2026-09-26T10:00:00Z", tokenExpiresAt: null },
  });

  assert.equal(result.email, PERSONNEL);
  assert.equal(result.pendingEmail, null);
});

test("a token is expired once its moment has passed, and a missing one is never valid", () => {
  assert.equal(isTokenExpired("2026-09-27T10:00:00Z", "2026-09-26T10:00:00Z"), false);
  assert.equal(isTokenExpired("2026-09-26T10:00:00Z", "2026-09-26T10:00:00Z"), true);
  assert.equal(isTokenExpired("2026-09-25T10:00:00Z", "2026-09-26T10:00:00Z"), true);
  assert.equal(isTokenExpired(null, "2026-09-26T10:00:00Z"), true);
});

test("obvious non-addresses are rejected before anything is sent", () => {
  for (const value of ["adambursey", "adambursey@", "@hotmail.com", "a b@c.com", "adam@hotmail"]) {
    assert.equal(isPlausibleEmail(value), false, value);
  }

  for (const value of [CHOSEN, "a.b+tag@sub.example.co.uk"]) {
    assert.equal(isPlausibleEmail(value), true, value);
  }
});

test("normalizeNotificationEmail rejects blanks", () => {
  assert.equal(normalizeNotificationEmail("  "), null);
  assert.equal(normalizeNotificationEmail(null), null);
  assert.equal(normalizeNotificationEmail(" A@B.com "), "a@b.com");
});
