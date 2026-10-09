/**
 * Merging a changed server payload into a panel's local draft.
 *
 * Panels hold the viewer's unsaved work in local state and receive the server's
 * version as props. Those props are a new object on every revalidation —
 * including the ones the panel's own autosave triggers — so adopting them
 * wholesale discarded whatever the viewer had in hand. These helpers adopt the
 * parts the server owns and leave the rest alone.
 */

/**
 * Rows the viewer has edited stay theirs, rows the server has never seen
 * survive, and rows awaiting a delete are not resurrected.
 *
 * Local-only rows lead, because both panels add a new row at the top.
 */
export function mergeServerRows<T>(input: {
  serverRows: T[];
  localRows: T[];
  baselineRows: T[];
  getId: (row: T) => string;
  isEdited: (local: T, baseline: T | null) => boolean;
  removalPendingIds?: Iterable<string>;
}) {
  const { serverRows, localRows, baselineRows, getId, isEdited } = input;
  const serverIds = new Set(serverRows.map((row) => getId(row)));
  const baselineById = new Map(baselineRows.map((row) => [getId(row), row]));
  const localById = new Map(localRows.map((row) => [getId(row), row]));
  const removalPending = new Set(input.removalPendingIds ?? []);

  const adopted = serverRows
    .filter((row) => !removalPending.has(getId(row)))
    .map((row) => {
      const local = localById.get(getId(row));

      return local && isEdited(local, baselineById.get(getId(row)) ?? null) ? local : row;
    });

  // Never server-known, so absence from the payload is not a deletion.
  const localOnly = localRows.filter((row) => !serverIds.has(getId(row)) && !baselineById.has(getId(row)));

  return [...localOnly, ...adopted];
}

/**
 * Adopts a new baseline cell by cell, keeping the cells the viewer has changed
 * and not yet saved — including ones they cleared, which is why the comparison
 * is against the previous baseline rather than against emptiness.
 */
export function mergeDraftCells<T>(input: {
  previousBaseline: Record<string, T>;
  nextBaseline: Record<string, T>;
  draft: Record<string, T>;
  cloneCell: (cell: T) => T;
}) {
  const { previousBaseline, nextBaseline, draft, cloneCell } = input;
  const merged: Record<string, T> = Object.fromEntries(
    Object.entries(nextBaseline).map(([key, cell]) => [key, cloneCell(cell)]),
  );

  for (const key of new Set([...Object.keys(previousBaseline), ...Object.keys(draft)])) {
    if (JSON.stringify(draft[key] ?? null) === JSON.stringify(previousBaseline[key] ?? null)) {
      continue;
    }

    if (draft[key]) {
      merged[key] = cloneCell(draft[key]);
    } else {
      delete merged[key];
    }
  }

  return merged;
}
