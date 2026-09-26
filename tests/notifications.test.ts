import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOvertimePostingNotification,
  buildOvertimePostingNotificationId,
  buildMutualApprovalNotification,
  buildMutualApprovalNotificationId,
  buildMutualApprovalNotificationPrefix,
  buildOvertimeRemovedNotificationId,
  buildShortfallNotificationIdPrefix,
  buildShortfallPostingId,
  countUnread,
  describeDateRange,
  formatNotificationAge,
  groupNotificationsByAge,
} from "../lib/notifications";
import { buildShortfallKey } from "../lib/overtime-shortfalls";

test("the id is derived from the posting and the recipient", () => {
  const first = buildOvertimePostingNotificationId("manual-ot-1", "emp-1");
  const again = buildOvertimePostingNotificationId("manual-ot-1", "emp-1");
  const other = buildOvertimePostingNotificationId("manual-ot-1", "emp-2");

  // Retrying the same enqueue collides with the row it already wrote.
  assert.equal(first, again);
  assert.notEqual(first, other);
});

test("a notification names the post, the crew and the dates", () => {
  const row = buildOvertimePostingNotification({
    postingId: "manual-ot-1",
    employeeId: "emp-1",
    assignmentLabel: "OPS",
    scheduleName: "Shift 2",
    dates: ["2026-09-05"],
    month: "2026-09",
  });

  assert.equal(row.recipient_employee_id, "emp-1");
  assert.equal(row.type, "overtime_posted");
  assert.equal(row.title, "Overtime available: OPS");
  assert.match(row.body, /Shift 2/);
  assert.match(row.body, /5 September/);
  assert.equal(row.href, "/overtime?month=2026-09");
});

test("a notification never mentions hours or times", () => {
  const row = buildOvertimePostingNotification({
    postingId: "manual-ot-1",
    employeeId: "emp-1",
    assignmentLabel: "OPS",
    scheduleName: "Shift 2",
    dates: ["2026-09-05", "2026-09-06"],
    month: "2026-09",
  });

  // No field in this data model carries them, so they must not appear.
  assert.doesNotMatch(`${row.title} ${row.body}`, /\bh\b|hours|[0-9]{1,2}:[0-9]{2}|AM|PM/);
});

test("dates read as a day, a run, or a count", () => {
  assert.equal(describeDateRange(["2026-09-05"]), "5 September");
  assert.equal(describeDateRange(["2026-09-05", "2026-09-06", "2026-09-07"]), "5–7 September");
  assert.equal(describeDateRange(["2026-09-05", "2026-09-09"]), "2 dates from 5 September");
  assert.equal(describeDateRange([]), "an upcoming shift");
});

test("duplicate and unsorted dates are handled", () => {
  assert.equal(describeDateRange(["2026-09-06", "2026-09-05", "2026-09-06"]), "5–6 September");
});

test("age reads in the largest useful unit", () => {
  const now = "2026-09-14T12:00:00.000Z";

  assert.equal(formatNotificationAge("2026-09-14T11:59:40.000Z", now), "Just now");
  assert.equal(formatNotificationAge("2026-09-14T11:45:00.000Z", now), "15m ago");
  assert.equal(formatNotificationAge("2026-09-14T09:00:00.000Z", now), "3h ago");
  assert.equal(formatNotificationAge("2026-09-12T12:00:00.000Z", now), "2d ago");
  assert.equal(formatNotificationAge("2026-08-01T12:00:00.000Z", now), "1 August");
});

test("unread is counted from the read timestamp", () => {
  assert.equal(
    countUnread([{ readAt: null }, { readAt: "2026-09-14T00:00:00.000Z" }, { readAt: null }]),
    2,
  );
  assert.equal(countUnread([]), 0);
});

test("notifications group by age", () => {
  const groups = groupNotificationsByAge(
    [
      { createdAt: "2026-09-14T08:00:00.000Z" },
      { createdAt: "2026-09-11T08:00:00.000Z" },
      { createdAt: "2026-08-20T08:00:00.000Z" },
    ],
    "2026-09-14",
  );

  assert.deepEqual(
    groups.map((group) => [group.label, group.items.length]),
    [
      ["Today", 1],
      ["Earlier this week", 1],
      ["Older", 1],
    ],
  );
});

test("empty groups are left out", () => {
  const groups = groupNotificationsByAge([{ createdAt: "2026-09-14T08:00:00.000Z" }], "2026-09-14");

  assert.deepEqual(groups.map((group) => group.label), ["Today"]);
});

test("a removed-overtime id is derived from the claim it releases", () => {
  assert.equal(
    buildOvertimeRemovedNotificationId("claim-42"),
    "notification-overtime_removed-claim-42",
  );
});

test("the same claim always produces the same removed-overtime id", () => {
  // The cleanup sweep can re-detect a release after an early return, and the
  // repeat has to collide with the row it already wrote.
  assert.equal(
    buildOvertimeRemovedNotificationId("claim-42"),
    buildOvertimeRemovedNotificationId("claim-42"),
  );
});

test("different claims produce different removed-overtime ids", () => {
  assert.notEqual(
    buildOvertimeRemovedNotificationId("claim-42"),
    buildOvertimeRemovedNotificationId("claim-43"),
  );
});

test("removed and posted ids cannot collide", () => {
  assert.notEqual(
    buildOvertimeRemovedNotificationId("posting-1-emp-1"),
    buildOvertimePostingNotificationId("posting-1", "emp-1"),
  );
});

test("a generated-overtime notice id starts with its month's prefix", () => {
  // The server skips slots already announced by fetching ids with this prefix,
  // so every id it writes for the month has to match it.
  const key = buildShortfallKey({
    scheduleId: "schedule-602",
    competencyId: "comp-bhl",
    segmentStart: "2026-09-25",
    slotIndex: 1,
  });
  const notification = buildOvertimePostingNotification({
    postingId: buildShortfallPostingId(key),
    employeeId: "emp-1",
    assignmentLabel: "BHL",
    scheduleName: "Shift 2",
    dates: ["2026-09-25"],
    month: "2026-09",
  });

  assert.ok(notification.id.startsWith(buildShortfallNotificationIdPrefix("2026-09")));
  assert.ok(!notification.id.startsWith(buildShortfallNotificationIdPrefix("2026-10")));
});

test("generated and manual posting notices cannot collide", () => {
  const generated = buildOvertimePostingNotificationId(buildShortfallPostingId("2026-09:s:c:2026-09-25:0"), "emp-1");
  const manual = buildOvertimePostingNotificationId("manual-ot-1", "emp-1");

  assert.notEqual(generated, manual);
  assert.ok(!manual.startsWith(buildShortfallNotificationIdPrefix("2026-09")));
});

test("both leaders of a crew get their own approval notice for the same swap", () => {
  const first = buildMutualApprovalNotificationId("mutual-1", "owner", "emp-1");
  const second = buildMutualApprovalNotificationId("mutual-1", "owner", "emp-2");

  assert.notEqual(first, second);
  assert.ok(first.startsWith(buildMutualApprovalNotificationPrefix("mutual-1", "owner")));
  assert.ok(second.startsWith(buildMutualApprovalNotificationPrefix("mutual-1", "owner")));
});

test("the two sides of one swap are retired independently", () => {
  const ownerPrefix = buildMutualApprovalNotificationPrefix("mutual-1", "owner");
  const applicantId = buildMutualApprovalNotificationId("mutual-1", "applicant", "emp-3");

  // Approving the owner's side must not clear the applicant crew's notice.
  assert.ok(!applicantId.startsWith(ownerPrefix));
  assert.ok(applicantId.startsWith(buildMutualApprovalNotificationPrefix("mutual-1")));
});

test("a retried accept writes the same id rather than a second notice", () => {
  assert.equal(
    buildMutualApprovalNotificationId("mutual-1", "owner", "emp-1"),
    buildMutualApprovalNotificationId("mutual-1", "owner", "emp-1"),
  );
});

test("one posting's notices are never retired by another's", () => {
  assert.ok(
    !buildMutualApprovalNotificationId("mutual-2", "owner", "emp-1").startsWith(
      buildMutualApprovalNotificationPrefix("mutual-1"),
    ),
  );
});

test("an approval notice names the crew, the pair and the dates", () => {
  const notification = buildMutualApprovalNotification({
    postingId: "mutual-1",
    side: "owner",
    employeeId: "emp-1",
    scheduleName: "2",
    ownerName: "Adam Bursey",
    applicantName: "Jeff O'Neil",
    dates: ["2026-10-05", "2026-10-06"],
    month: "2026-10",
  });

  assert.equal(notification.title, "Mutual awaiting approval: Shift 2");
  assert.match(notification.body, /Adam Bursey and Jeff O'Neil/);
  assert.match(notification.body, /5–6 October/);
  assert.equal(notification.href, "/mutuals?month=2026-10");
  assert.equal(notification.recipient_employee_id, "emp-1");
});
