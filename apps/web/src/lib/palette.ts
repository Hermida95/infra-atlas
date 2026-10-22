/**
 * Selection in the ⌘K list. It is kept as a concept id, not a position: meaning results
 * arrive after the keystroke and reorder the list, and a position would then point at
 * another concept.
 */

type Row = { node: { id: string } };

/** Position of the selected concept in the current list; the first row when it is gone. */
export function activeIndex(rows: readonly Row[], selectedId: string | null): number {
  if (selectedId === null) return 0;
  const i = rows.findIndex((r) => r.node.id === selectedId);
  return i === -1 ? 0 : i;
}

/** Id of the row `step` away from the selected one, clamped to the ends of the list. */
export function moveSelection(rows: readonly Row[], selectedId: string | null, step: 1 | -1): string | null {
  if (!rows.length) return null;
  const next = Math.min(Math.max(activeIndex(rows, selectedId) + step, 0), rows.length - 1);
  return rows[next].node.id;
}
