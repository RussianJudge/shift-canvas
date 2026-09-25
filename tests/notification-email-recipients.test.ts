import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOptoutKey,
  normalizeRecipientEmail,
  selectEmailRecipients,
  type EmployeeContact,
  type NotificationEmailCandidate,
} from "../lib/notification-email";
import { NOTIFICATION_TYPES } from "../lib/notifications";

function candidate(overrides: Partial<NotificationEmailCandidate> = {}): NotificationEmailCandidate {
  return {
    id: "notification-overtime_posted-posting-1-emp-1",
    employeeId: "emp-1",
    type: NOTIFICATION_TYPES.overtimePosted,
    title: "Overtime available: OPS",
    body: "Shift 1 needs OPS cover on 5 September.",
    href: "/overtime?month=2026-09",
    ...overrides,
  };
}

function contacts(entries: Array<[string, EmployeeContact]>) {
  return new Map<string, EmployeeContact>(entries);
}

test("a qualified recipient with an address is selected", () => {
  const result = selectEmailRecipients({
    notifications: [candidate()],
    contactsByEmployeeId: contacts([["emp-1", { email: "adam@example.com", name: "Bursey, Adam" }]]),
    mutedKeys: new Set(),
  });

  assert.equal(result.recipients.length, 1);
  assert.equal(result.recipients[0].email, "adam@example.com");
  assert.equal(result.recipients[0].name, "Bursey, Adam");
  assert.equal(result.recipients[0].additionalCount, 0);
  assert.deepEqual(result.skipped, { noEmail: 0, muted: 0, collapsed: 0 });
});

test("an address is trimmed and lowercased to match the unique index", () => {
  const result = selectEmailRecipients({
    notifications: [candidate()],
    contactsByEmployeeId: contacts([["emp-1", { email: "  Adam@Example.COM  ", name: "Bursey, Adam" }]]),
    mutedKeys: new Set(),
  });

  assert.equal(result.recipients[0].email, "adam@example.com");
});

test("null, empty and whitespace addresses are skipped and counted", () => {
  for (const email of [null, "", "   "]) {
    const result = selectEmailRecipients({
      notifications: [candidate()],
      contactsByEmployeeId: contacts([["emp-1", { email, name: "Bursey, Adam" }]]),
      mutedKeys: new Set(),
    });

    assert.equal(result.recipients.length, 0);
    assert.equal(result.skipped.noEmail, 1);
  }
});

test("an employee with no contact row at all is skipped", () => {
  const result = selectEmailRecipients({
    notifications: [candidate()],
    contactsByEmployeeId: contacts([]),
    mutedKeys: new Set(),
  });

  assert.equal(result.recipients.length, 0);
  assert.equal(result.skipped.noEmail, 1);
});

test("a muted type is filtered while another type for the same person still sends", () => {
  const result = selectEmailRecipients({
    notifications: [
      candidate(),
      candidate({
        id: "notification-overtime_removed-claim-1",
        type: NOTIFICATION_TYPES.overtimeRemoved,
        title: "Overtime no longer needed",
      }),
    ],
    contactsByEmployeeId: contacts([["emp-1", { email: "adam@example.com", name: "Bursey, Adam" }]]),
    mutedKeys: new Set([buildOptoutKey("emp-1", NOTIFICATION_TYPES.overtimePosted)]),
  });

  assert.equal(result.recipients.length, 1);
  assert.equal(result.recipients[0].type, NOTIFICATION_TYPES.overtimeRemoved);
  assert.equal(result.skipped.muted, 1);
});

test("one person's muting does not affect anyone else", () => {
  const result = selectEmailRecipients({
    notifications: [candidate(), candidate({ id: "n2", employeeId: "emp-2" })],
    contactsByEmployeeId: contacts([
      ["emp-1", { email: "adam@example.com", name: "Bursey, Adam" }],
      ["emp-2", { email: "sam@example.com", name: "Doe, Sam" }],
    ]),
    mutedKeys: new Set([buildOptoutKey("emp-1", NOTIFICATION_TYPES.overtimePosted)]),
  });

  assert.equal(result.recipients.length, 1);
  assert.equal(result.recipients[0].employeeId, "emp-2");
});

test("several same-type notifications for one person become one email", () => {
  // A set unmark can release a whole month of claims for one worker.
  const result = selectEmailRecipients({
    notifications: [
      candidate({ id: "n1", type: NOTIFICATION_TYPES.overtimeRemoved }),
      candidate({ id: "n2", type: NOTIFICATION_TYPES.overtimeRemoved }),
      candidate({ id: "n3", type: NOTIFICATION_TYPES.overtimeRemoved }),
    ],
    contactsByEmployeeId: contacts([["emp-1", { email: "adam@example.com", name: "Bursey, Adam" }]]),
    mutedKeys: new Set(),
  });

  assert.equal(result.recipients.length, 1);
  assert.equal(result.recipients[0].notificationId, "n1");
  assert.equal(result.recipients[0].additionalCount, 2);
  assert.equal(result.skipped.collapsed, 2);
  // All three rows are covered by the one email, so all three are accounted for.
  assert.deepEqual(result.recipients[0].notificationIds, ["n1", "n2", "n3"]);
});

test("a blank name falls back rather than greeting nobody", () => {
  const result = selectEmailRecipients({
    notifications: [candidate()],
    contactsByEmployeeId: contacts([["emp-1", { email: "adam@example.com", name: "   " }]]),
    mutedKeys: new Set(),
  });

  assert.equal(result.recipients[0].name, "there");
});

test("no notifications selects nobody and counts nothing", () => {
  const result = selectEmailRecipients({
    notifications: [],
    contactsByEmployeeId: contacts([]),
    mutedKeys: new Set(),
  });

  assert.deepEqual(result.recipients, []);
  assert.deepEqual(result.skipped, { noEmail: 0, muted: 0, collapsed: 0 });
});

test("normalizeRecipientEmail rejects blanks and keeps real addresses", () => {
  assert.equal(normalizeRecipientEmail(null), null);
  assert.equal(normalizeRecipientEmail(undefined), null);
  assert.equal(normalizeRecipientEmail("  "), null);
  assert.equal(normalizeRecipientEmail(" A@B.com "), "a@b.com");
});
