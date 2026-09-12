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
  /**
   * Paint nothing in the half band **above this row's vertex**, in the vertex's
   * own lane: the line starts here.
   *
   * Set when **no loaded row above this one names this commit as a parent**, so
   * the segment this row carries in the vertex's lane is the commit's departing
   * line and nothing arrives from above. A painter that draws that segment
   * across the whole band puts a stub above the dot, where no line exists.
   *
   * It is **final on any page**. Git emits children before parents, so a commit
   * whose children are all absent from the rows loaded so far can never acquire
   * one from a page loaded later, and the bit never has to be revised.
   *
   * It says nothing about the other lanes of the row: lines passing through
   * lanes the vertex is not in cross the whole band as they always did.
   */
  ClipAboveVertex: 16,
  /**
   * Paint nothing in the half band **below this row's vertex**, in the vertex's
   * own lane: the line ends here.
   *
   * Set when the commit has **no parent entry at all** —
   * `parentOffsets[row + 1] === parentOffsets[row]` — which is a root.
   *
   * **Not** set when the commit has a parent whose entry is `UNKNOWN_INDEX`:
   * that parent exists and has simply not been loaded, so its line continues
   * off the bottom of the page and into the page below. The two are spelled
   * identically everywhere else in this contract, which is why this bit reads
   * the parent **count** and never the parent values: setting it for an unloaded
   * parent clips the last row of every page a repository is too large to fit in
   * one of, and clearing it for a root draws a stub below every root.
   *
   * As with {@link RowFlag.ClipAboveVertex}, it is about the vertex's lane only.
   */
  ClipBelowVertex: 32,
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
 * A segment spans the **whole** band unless the row says otherwise. A branch tip
 * has no line above its dot and a root has none below, so each occupies half of
 * its band, and the segment alone cannot say which half: both are spelled
 * `(V, V)` in the vertex's lane. That is what
 * {@link RowFlag.ClipAboveVertex} and {@link RowFlag.ClipBelowVertex} are for,
 * and they are the only way to tell a root from a page that ran out of commits.
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
 *   uncommitted row, which is what makes appending a page a pure append;
 * - **a row carries exactly one vertex**, in the lane `laneIndex` names, so the
 *   two clip bits are properties of the row and need no lane of their own;
 * - `RowFlag.ClipAboveVertex` is set when no loaded row above names this row's
 *   commit as a parent, and `RowFlag.ClipBelowVertex` when the commit has no
 *   parent entry at all. A parent entry of `UNKNOWN_INDEX` is a parent that
 *   exists and is not loaded, and **does not** set `ClipBelowVertex`;
 * - **the painter is required to clip on them**: in the vertex's own lane it
 *   paints the upper half of the band only when `ClipAboveVertex` is clear and
 *   the lower half only when `ClipBelowVertex` is clear, and it paints every
 *   other lane's segment across the whole band regardless. Neither bit is
 *   advice: `core/` cannot draw, so a painter that ignores them draws a stub
 *   above every tip and below every root, and one that clips on the segments
 *   instead leaves a gap at the foot of every page.
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
