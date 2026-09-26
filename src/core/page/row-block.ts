import { entryAt } from '../../contracts/column-read';
import { RowFlag } from '../../contracts/index';
import type { LayoutRows } from '../../contracts/index';

/**
 * The rows of every page loaded so far, as one growing block.
 *
 * `src/core/layout/` returns the **new** rows of each page and never the ones
 * before them, which is what makes appending a page cost the page rather than
 * the view (`docs/ADR-0002-architecture-and-performance.md` decision 4). Something
 * has to hold the accumulation, and this is it: nine columns that are appended
 * to and never rewritten, so a row laid out on the first page is written once and
 * read thereafter.
 *
 * The one row that is *not* appended here is the uncommitted-changes row. It is
 * not a commit, the layout pass never sees it, and it sits at row 0 — so holding
 * it in this block would make every append a shift. It is put on at the moment a
 * `GraphPage` is produced instead; see `./graph-page`.
 *
 * ### The growth, and why these four helpers are a copy
 *
 * The columns grow by five quarters, the ratio `src/core/store/growth.ts` argues
 * for and `src/core/layout/open-lanes.ts` repeats: it is geometric, so appending
 * stays amortised constant, and it caps the unused part of a column at a quarter
 * rather than at a whole. The store's own helpers are **deliberately not
 * re-exported** from `src/core/store/index.ts` — its header says so — and
 * `src/core/store/` is outside this task's boundary, so hoisting them into one
 * home is a later slice's work and this folder carries its own. Two of the four
 * below (`copiedUint8`, `copiedUint32`) are that folder's twelve lines again;
 * `copiedUint16` is not, because the lane column is the one width the store has
 * no column of. The condition for removing this copy is the one
 * `docs/plan/E01-commit-graph/M01-first-graph/S04-lane-layout.md` records for the
 * last one: a slice whose boundary holds both folders hoists them, and it costs
 * one import line here.
 *
 * There is no initial capacity constant. A block starts empty and the first
 * append grows it to fit that append, with at most a quarter of slack, which is
 * the same rule every later append follows — so a five-commit repository costs
 * five rows and not a page's worth.
 */

/** The growth factor, as an exact ratio so that no float rounding enters it. */
const GROWTH_NUMERATOR = 5;
const GROWTH_DENOMINATOR = 4;

/** `block.headRow` when no loaded row is the commit HEAD resolves to. */
export const NO_HEAD_ROW = -1;

/**
 * The capacity to grow to so that `required` entries fit.
 *
 * The factor is applied repeatedly rather than jumping straight to `required`,
 * so that a caller asking for one more entry than fits still gets room for the
 * ones after it.
 */
function nextCapacity(current: number, required: number): number {
  let capacity = Math.max(1, current);
  while (capacity < required) {
    capacity = Math.ceil((capacity * GROWTH_NUMERATOR) / GROWTH_DENOMINATOR);
  }
  return capacity;
}

function copiedUint8(source: Uint8Array, used: number, length: number): Uint8Array {
  const target = new Uint8Array(length);
  target.set(source.subarray(0, used));
  return target;
}

function copiedUint16(source: Uint16Array, used: number, length: number): Uint16Array {
  const target = new Uint16Array(length);
  target.set(source.subarray(0, used));
  return target;
}

function copiedUint32(source: Uint32Array, used: number, length: number): Uint32Array {
  const target = new Uint32Array(length);
  target.set(source.subarray(0, used));
  return target;
}

/**
 * Every row laid out so far, in the columns `LayoutRows` is made of.
 *
 * `rowCount` and `segmentCount` are how much of each column is used; the columns
 * themselves are longer. `segmentOffsets` holds `rowCount + 1` used entries and
 * its values are absolute over the whole block, not relative to a page.
 */
export interface RowBlock {
  /** Commit rows accumulated. The uncommitted row is not one of them. */
  rowCount: number;
  /** Segments accumulated, which is `segmentOffsets[rowCount]`. */
  segmentCount: number;
  /** The widest lane any page reached, which decides the column's width. */
  maxLane: number;
  /** The row carrying {@link RowFlag.Head}, or {@link NO_HEAD_ROW}. */
  headRow: number;
  laneIndex: Uint16Array;
  colourIndex: Uint8Array;
  flags: Uint8Array;
  segmentOffsets: Uint32Array;
  segmentFromLane: Uint16Array;
  segmentToLane: Uint16Array;
  segmentColour: Uint8Array;
}

/** A block holding no row, which is what an opened repository starts from. */
export function createRowBlock(): RowBlock {
  return {
    rowCount: 0,
    segmentCount: 0,
    maxLane: 0,
    headRow: NO_HEAD_ROW,
    laneIndex: new Uint16Array(0),
    colourIndex: new Uint8Array(0),
    flags: new Uint8Array(0),
    segmentOffsets: new Uint32Array(1),
    segmentFromLane: new Uint16Array(0),
    segmentToLane: new Uint16Array(0),
    segmentColour: new Uint8Array(0),
  };
}

/** Make room for `required` rows, keeping the rows already there. */
function ensureRowCapacity(block: RowBlock, required: number): void {
  if (block.laneIndex.length >= required) {
    return;
  }
  const capacity = nextCapacity(block.laneIndex.length, required);
  block.laneIndex = copiedUint16(block.laneIndex, block.rowCount, capacity);
  block.colourIndex = copiedUint8(block.colourIndex, block.rowCount, capacity);
  block.flags = copiedUint8(block.flags, block.rowCount, capacity);
  block.segmentOffsets = copiedUint32(block.segmentOffsets, block.rowCount + 1, capacity + 1);
}

/** Make room for `required` segments, keeping the segments already there. */
function ensureSegmentCapacity(block: RowBlock, required: number): void {
  if (block.segmentFromLane.length >= required) {
    return;
  }
  const capacity = nextCapacity(block.segmentFromLane.length, required);
  block.segmentFromLane = copiedUint16(block.segmentFromLane, block.segmentCount, capacity);
  block.segmentToLane = copiedUint16(block.segmentToLane, block.segmentCount, capacity);
  block.segmentColour = copiedUint8(block.segmentColour, block.segmentCount, capacity);
}

/**
 * Append the rows of one page, exactly as `src/core/layout/` returned them.
 *
 * Nothing already in the block is read or rewritten. The one thing that is not a
 * straight copy is `segmentOffsets`: a page's offsets start at zero and the
 * block's are absolute, so each one is written on with the segments already
 * held added to it.
 */
export function appendRows(block: RowBlock, rows: LayoutRows): void {
  const added = rows.rowCount;
  const addedSegments = entryAt(rows.segmentOffsets, added);
  ensureRowCapacity(block, block.rowCount + added);
  ensureSegmentCapacity(block, block.segmentCount + addedSegments);
  block.laneIndex.set(rows.laneIndex.subarray(0, added), block.rowCount);
  block.colourIndex.set(rows.colourIndex.subarray(0, added), block.rowCount);
  block.flags.set(rows.flags.subarray(0, added), block.rowCount);
  for (let row = 0; row < added; row += 1) {
    block.segmentOffsets[block.rowCount + row + 1] =
      block.segmentCount + entryAt(rows.segmentOffsets, row + 1);
  }
  block.segmentFromLane.set(rows.segmentFromLane.subarray(0, addedSegments), block.segmentCount);
  block.segmentToLane.set(rows.segmentToLane.subarray(0, addedSegments), block.segmentCount);
  block.segmentColour.set(rows.segmentColour.subarray(0, addedSegments), block.segmentCount);
  block.rowCount += added;
  block.segmentCount += addedSegments;
  block.maxLane = Math.max(block.maxLane, rows.maxLane);
}

/**
 * Put {@link RowFlag.Head} on the row `row` names, and on no other row.
 *
 * `src/core/layout/` is not told which commit HEAD resolves to, so this bit is
 * the caller's (S04's slice document, *What this lane does not set*). It is
 * written here rather than at the moment the page is produced because the row it
 * belongs to is usually in the **prefix** — HEAD is near the top of the log — and
 * a page is produced from the block without touching the rows in it.
 *
 * `row` is a `CommitColumns` index, so it may be `UNKNOWN_INDEX`, which is
 * larger than any row and therefore names none. Any index outside the rows
 * loaded so far clears the bit and leaves the block with no head row, which is
 * what an unborn branch and a HEAD below the loaded page both look like.
 */
export function markHeadRow(block: RowBlock, row: number): void {
  if (block.headRow >= 0) {
    block.flags[block.headRow] = entryAt(block.flags, block.headRow) & ~RowFlag.Head;
  }
  block.headRow = row >= 0 && row < block.rowCount ? row : NO_HEAD_ROW;
  if (block.headRow >= 0) {
    block.flags[block.headRow] = entryAt(block.flags, block.headRow) | RowFlag.Head;
  }
}
