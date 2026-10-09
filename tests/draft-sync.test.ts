import assert from "node:assert/strict";
import test from "node:test";

import { mergeDraftCells, mergeServerRows } from "../lib/draft-sync";

type Row = { id: string; name: string };

function mergeRows(input: {
  serverRows: Row[];
  localRows: Row[];
  baselineRows: Row[];
  removalPendingIds?: string[];
}) {
  return mergeServerRows({
    ...input,
    getId: (row: Row) => row.id,
    isEdited: (local, baseline) => JSON.stringify(local) !== JSON.stringify(baseline),
  });
}

test("adopts the server row when the viewer has not touched it", () => {
  const merged = mergeRows({
    serverRows: [{ id: "a", name: "Renamed on the server" }],
    localRows: [{ id: "a", name: "Original" }],
    baselineRows: [{ id: "a", name: "Original" }],
  });

  assert.deepEqual(merged, [{ id: "a", name: "Renamed on the server" }]);
});

test("keeps the viewer's unsaved edit rather than the server's version", () => {
  const merged = mergeRows({
    serverRows: [{ id: "a", name: "Renamed on the server" }],
    localRows: [{ id: "a", name: "Half-typed name" }],
    baselineRows: [{ id: "a", name: "Original" }],
  });

  assert.deepEqual(merged, [{ id: "a", name: "Half-typed name" }]);
});

test("keeps a row the server has never seen", () => {
  const merged = mergeRows({
    serverRows: [{ id: "a", name: "Existing" }],
    localRows: [
      { id: "new", name: "New sub-schedule" },
      { id: "a", name: "Existing" },
    ],
    baselineRows: [{ id: "a", name: "Existing" }],
  });

  assert.deepEqual(merged, [
    { id: "new", name: "New sub-schedule" },
    { id: "a", name: "Existing" },
  ]);
});

test("drops a row the server deleted, since the baseline knew it", () => {
  const merged = mergeRows({
    serverRows: [{ id: "a", name: "Existing" }],
    localRows: [
      { id: "a", name: "Existing" },
      { id: "gone", name: "Deleted elsewhere" },
    ],
    baselineRows: [
      { id: "a", name: "Existing" },
      { id: "gone", name: "Deleted elsewhere" },
    ],
  });

  assert.deepEqual(merged, [{ id: "a", name: "Existing" }]);
});

test("does not resurrect a row whose removal is waiting on autosave", () => {
  const merged = mergeRows({
    serverRows: [
      { id: "a", name: "Existing" },
      { id: "removed", name: "Removed by the viewer" },
    ],
    localRows: [{ id: "a", name: "Existing" }],
    baselineRows: [
      { id: "a", name: "Existing" },
      { id: "removed", name: "Removed by the viewer" },
    ],
    removalPendingIds: ["removed"],
  });

  assert.deepEqual(merged, [{ id: "a", name: "Existing" }]);
});

test("an unchanged payload merges to itself", () => {
  const rows = [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
  ];

  assert.deepEqual(mergeRows({ serverRows: rows, localRows: rows, baselineRows: rows }), rows);
});

type Cell = { timeCodeId: string | null };

function mergeCells(input: {
  previousBaseline: Record<string, Cell>;
  nextBaseline: Record<string, Cell>;
  draft: Record<string, Cell>;
}) {
  return mergeDraftCells({ ...input, cloneCell: (cell: Cell) => ({ ...cell }) });
}

test("adopts a server cell the viewer has not edited", () => {
  const merged = mergeCells({
    previousBaseline: { "emp-1|2026-10-01": { timeCodeId: "day" } },
    nextBaseline: { "emp-1|2026-10-01": { timeCodeId: "night" } },
    draft: { "emp-1|2026-10-01": { timeCodeId: "day" } },
  });

  assert.deepEqual(merged, { "emp-1|2026-10-01": { timeCodeId: "night" } });
});

test("keeps an unsaved cell edit over the incoming baseline", () => {
  const merged = mergeCells({
    previousBaseline: { "emp-1|2026-10-01": { timeCodeId: "day" } },
    nextBaseline: { "emp-1|2026-10-01": { timeCodeId: "night" } },
    draft: { "emp-1|2026-10-01": { timeCodeId: "lead" } },
  });

  assert.deepEqual(merged, { "emp-1|2026-10-01": { timeCodeId: "lead" } });
});

test("a cell the viewer cleared stays cleared", () => {
  const merged = mergeCells({
    previousBaseline: { "emp-1|2026-10-01": { timeCodeId: "day" } },
    nextBaseline: { "emp-1|2026-10-01": { timeCodeId: "day" } },
    draft: {},
  });

  assert.deepEqual(merged, {});
});

test("a cell the viewer filled in survives a baseline that still has it empty", () => {
  const merged = mergeCells({
    previousBaseline: {},
    nextBaseline: {},
    draft: { "emp-1|2026-10-02": { timeCodeId: "day" } },
  });

  assert.deepEqual(merged, { "emp-1|2026-10-02": { timeCodeId: "day" } });
});

test("a cell added on the server appears without disturbing the draft's own", () => {
  const merged = mergeCells({
    previousBaseline: {},
    nextBaseline: { "emp-2|2026-10-03": { timeCodeId: "night" } },
    draft: { "emp-1|2026-10-02": { timeCodeId: "day" } },
  });

  assert.deepEqual(merged, {
    "emp-1|2026-10-02": { timeCodeId: "day" },
    "emp-2|2026-10-03": { timeCodeId: "night" },
  });
});

test("merged cells are copies, so editing one does not reach the baseline", () => {
  const nextBaseline = { "emp-1|2026-10-01": { timeCodeId: "day" } };
  const merged = mergeCells({ previousBaseline: {}, nextBaseline, draft: {} });

  merged["emp-1|2026-10-01"].timeCodeId = "night";

  assert.equal(nextBaseline["emp-1|2026-10-01"].timeCodeId, "day");
});
