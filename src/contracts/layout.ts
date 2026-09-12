/**
 * Bits of one {@link LayoutRows.flags} entry. Combined with bitwise or, tested
 * with bitwise and. Always written through one of these names.
 */
export const RowFlag = Object.freeze({
  /** The row's commit has more than one parent. */
  Merge: 1,
  /** The row is a stash entry rather than an ordinary commit. */
  Stash: 2,
  /** The row's commit is what HEAD resolves to. */
  Head: 4,
  /** The row is the uncommitted-changes row, which has no commit of its own. */
  Uncommitted: 8,
} as const);

/** The value of one bit of a {@link LayoutRows.flags} entry. */
export type RowFlag = (typeof RowFlag)[keyof typeof RowFlag];

/**
 * The complete drawing instruction set for the graph column: what the layout
 * pass produces and what the painter consumes. Nothing else crosses that seam,
 * and the painter answers no question of its own — "which lane is this commit
 * in" is decided here, never in the renderer.
 *
 * A **segment** is one line crossing the vertical band of a single row. A line
 * that passes straight through a row it does not touch is a segment whose
 * `segmentFromLane` and `segmentToLane` are equal. A line that moves to another
 * lane over the height of one row is a segment whose two lanes differ. That is
 * the whole vocabulary: there are no curves, no multi-row edges and no scene
 * graph, so painting a viewport is a walk over a slice of these arrays.
 *
 * Colours are palette **indices**, never colour values, so that a theme change
 * repaints without recomputing the layout.
 *
 * Invariants:
 * - `laneIndex`, `colourIndex` and `flags` have `rowCount` entries;
 * - `segmentOffsets` has `rowCount + 1` entries, is non-decreasing and starts at
 *   0; row `i`'s segments span `[segmentOffsets[i], segmentOffsets[i + 1])`;
 * - `segmentFromLane`, `segmentToLane` and `segmentColour` all have
 *   `segmentOffsets[rowCount]` entries;
 * - `maxLane` is the largest value appearing in `laneIndex` or in either segment
 *   lane array, so the column is exactly `maxLane + 1` lanes wide;
 * - row 0 is the uncommitted row when one is present, and it is the only row
 *   that may carry `RowFlag.Uncommitted`;
 * - rows are index-aligned with the page's `CommitColumns` offset by that
 *   uncommitted row, which is what makes appending a page a pure append.
 */
export interface LayoutRows {
  /** One row per commit, plus the uncommitted row when the tree is dirty. */
  readonly rowCount: number;
  /** The lane each row's vertex sits in. */
  readonly laneIndex: Uint16Array;
  /** Palette index of each row's vertex. Not a colour. */
  readonly colourIndex: Uint8Array;
  /** One bitwise or of {@link RowFlag} values per row. */
  readonly flags: Uint8Array;
  /** Widest lane used in this page, which decides the graph column's width. */
  readonly maxLane: number;
  /** Offsets into the three segment arrays, `rowCount + 1` entries. */
  readonly segmentOffsets: Uint32Array;
  /** Lane each segment's line enters at the top edge of its row. */
  readonly segmentFromLane: Uint16Array;
  /** Lane each segment's line leaves at the bottom edge of its row. */
  readonly segmentToLane: Uint16Array;
  /** Palette index of each segment. Not a colour. */
  readonly segmentColour: Uint8Array;
}
