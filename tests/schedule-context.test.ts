import assert from "node:assert/strict";
import test from "node:test";

import {
  buildScheduleHref,
  canAccessScheduleContext,
  parseScheduleContextParam,
  resolveScheduleContext,
  scheduleContextToParam,
} from "../lib/schedule-context";

const SUBS = ["sub-schedule-1a2b3c4d", "sub-schedule-9f8e7d6c"];

test("parses the three context kinds", () => {
  assert.deepEqual(parseScheduleContextParam("all"), { kind: "all" });
  assert.deepEqual(parseScheduleContextParam("schedule-601"), { kind: "main", scheduleId: "schedule-601" });
  assert.deepEqual(parseScheduleContextParam("sub:sub-schedule-1a2b3c4d"), {
    kind: "sub",
    subScheduleId: "sub-schedule-1a2b3c4d",
  });
});

test("a real sub-schedule id is never mistaken for a prefixed one", () => {
  // Ids are generated as `sub-schedule-<uuid>`; only "sub:" marks the context.
  assert.deepEqual(parseScheduleContextParam("sub-schedule-1a2b3c4d"), {
    kind: "main",
    scheduleId: "sub-schedule-1a2b3c4d",
  });
});

test("empty and blank values yield nothing to act on", () => {
  for (const value of [null, undefined, "", "   "]) {
    assert.equal(parseScheduleContextParam(value), null, JSON.stringify(value));
  }
});

test("a bare sub: is the sub-schedule area with nothing selected", () => {
  // This is how an empty workspace reaches the create and manage controls.
  for (const value of ["sub:", "sub:   "]) {
    assert.deepEqual(parseScheduleContextParam(value), { kind: "sub", subScheduleId: "" }, value);
  }
});

test("any non-worker may open the area itself", () => {
  const area = { kind: "sub", subScheduleId: "" } as const;

  assert.equal(canAccessScheduleContext(area, { role: "admin" }, []), true);
  assert.equal(canAccessScheduleContext(area, { role: "leader" }, []), true);
  assert.equal(canAccessScheduleContext(area, { role: "worker" }, []), false);
});

test("the area round-trips through the URL", () => {
  assert.equal(scheduleContextToParam({ kind: "sub", subScheduleId: "" }), "sub:");
  assert.equal(buildScheduleHref("2026-09", { kind: "sub", subScheduleId: "" }), "/schedule?month=2026-09&schedule=sub%3A");
});

test("serializing round-trips every kind", () => {
  for (const param of ["all", "schedule-601", "sub:sub-schedule-1a2b3c4d"]) {
    assert.equal(scheduleContextToParam(parseScheduleContextParam(param)!), param);
  }
});

test("a link keeps the month alongside the context", () => {
  assert.equal(
    buildScheduleHref("2026-09", { kind: "sub", subScheduleId: "sub-schedule-1a2b3c4d" }),
    "/schedule?month=2026-09&schedule=sub%3Asub-schedule-1a2b3c4d",
  );
  assert.equal(buildScheduleHref("2026-09", { kind: "all" }), "/schedule?month=2026-09&schedule=all");
});

test("workers cannot reach a sub-schedule, whatever the id", () => {
  const worker = { role: "worker" };

  assert.equal(canAccessScheduleContext({ kind: "sub", subScheduleId: SUBS[0] }, worker, SUBS), false);
  // The main roster and All shifts stay open to them.
  assert.equal(canAccessScheduleContext({ kind: "all" }, worker, SUBS), true);
  assert.equal(canAccessScheduleContext({ kind: "main", scheduleId: "schedule-601" }, worker, SUBS), true);
});

test("admins and leaders reach only sub-schedules in their scope", () => {
  for (const role of ["admin", "leader"]) {
    const viewer = { role };

    assert.equal(canAccessScheduleContext({ kind: "sub", subScheduleId: SUBS[0] }, viewer, SUBS), true);
    assert.equal(
      canAccessScheduleContext({ kind: "sub", subScheduleId: "sub-schedule-out-of-scope" }, viewer, SUBS),
      false,
      role,
    );
  }
});

test("an inaccessible sub-schedule falls back to the viewer's own roster", () => {
  const resolved = resolveScheduleContext({
    param: "sub:sub-schedule-out-of-scope",
    viewer: { role: "admin" },
    accessibleSubScheduleIds: SUBS,
    fallbackScheduleId: "schedule-601",
  });

  assert.deepEqual(resolved, { kind: "main", scheduleId: "schedule-601" });
});

test("a worker following a sub-schedule link lands on their own roster", () => {
  const resolved = resolveScheduleContext({
    param: `sub:${SUBS[0]}`,
    viewer: { role: "worker" },
    accessibleSubScheduleIds: SUBS,
    fallbackScheduleId: "schedule-604",
  });

  assert.deepEqual(resolved, { kind: "main", scheduleId: "schedule-604" });
});

test("with no roster of their own the fallback is All shifts", () => {
  const resolved = resolveScheduleContext({
    param: "sub:sub-schedule-gone",
    viewer: { role: "leader" },
    accessibleSubScheduleIds: [],
    fallbackScheduleId: null,
  });

  assert.deepEqual(resolved, { kind: "all" });
});

test("an accessible context is returned untouched", () => {
  assert.deepEqual(
    resolveScheduleContext({
      param: `sub:${SUBS[1]}`,
      viewer: { role: "leader" },
      accessibleSubScheduleIds: SUBS,
      fallbackScheduleId: "schedule-601",
    }),
    { kind: "sub", subScheduleId: SUBS[1] },
  );

  assert.deepEqual(
    resolveScheduleContext({
      param: "all",
      viewer: { role: "worker" },
      accessibleSubScheduleIds: [],
      fallbackScheduleId: "schedule-601",
    }),
    { kind: "all" },
  );
});

test("no parameter at all resolves to the viewer's roster", () => {
  assert.deepEqual(
    resolveScheduleContext({
      param: undefined,
      viewer: { role: "admin" },
      accessibleSubScheduleIds: SUBS,
      fallbackScheduleId: "schedule-602",
    }),
    { kind: "main", scheduleId: "schedule-602" },
  );
});
