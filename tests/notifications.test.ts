import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOvertimePostingNotification,
  buildOvertimePostingNotificationId,
  countUnread,
  describeDateRange,
  formatNotificationAge,
  groupNotificationsByAge,
} from "../lib/notifications";

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
