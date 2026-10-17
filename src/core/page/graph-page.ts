import { entryAt } from '../../contracts/column-read';
import { RowFlag } from '../../contracts/index';
import type { GraphPage, LayoutRows } from '../../contracts/index';
import type { RepositoryPage } from '../../ports/index';

import { appendRows, markHeadRow } from './row-block';
import type { RowBlock } from './row-block';

/**
 * Turning the accumulated block and one reading of a repository into the
 * `GraphPage` the renderer draws.
 *
 * This is where the uncommitted-changes row is put on. It is not a commit, so
 * `src/core/layout/` never sees it and `src/core/page/row-block.ts` never holds
 * it; `src/contracts/graph-page.ts` puts it at row 0, which means every per-row
 * column of the page is the block's shifted by one.
 *
 * **What the shift costs, and why that is the right place to pay it.** It is one
 * copy of the block's nine columns per load — `2 + 1 + 1` bytes per row for the
 * lane, the colour and the flags, four more for the row's segment offset, and
 * `2 + 2 + 1` per segment. The 10 000-commit fixture is a straight chain, so its
 * layout emits one segment a row: 10 000 rows and 10 000 segments, counted by
 * review round 15 through the built application and by E01-M01-FIX-16 through
 * this module in Node, which makes its copy 130 000 bytes. A braided history
 * emits more segments a row; the S06 slice document, under *The page
 * assembly*, gives the range and whose measurement it rests on. The page is
 * copied once more anyway, by the structured clone that carries it out of the
 * utility process and again into the renderer
 * (`docs/ADR-0002-architecture-and-performance.md` decision 2), so the shift is
 * one more copy of the same order as a copy the page already pays, on a path
 * that runs once per load and never once per frame. What it buys is that
 * appending stays a **pure append**: the alternative, holding the uncommitted row
 * inside the block, makes every later page shift every row already laid out, and
 * that is a cost per *loaded* row rather than per *new* one, which is the one
 * thing decision 4 does not allow.
 *
 * The copy is paid on a clean working tree too, because the block's columns are
 * grown geometrically and therefore longer than the rows in them, and a page
 * carrying a quarter of slack across a process boundary would be a worse copy
 * than this one.
 */

/**
 * The block as one `LayoutRows`, with the uncommitted row on the front when the
 * working tree is dirty.
 *
 * The prepended row is exactly what `src/contracts/layout.ts` describes and what
 * `test/e2e/graph-table.spec.ts` builds by hand: row 0, lane 0, colour 0, one
 * segment from lane 0 to lane 0, and the flags `Uncommitted | ClipAboveVertex`.
 * Lane 0, colour 0 and the segment's two lanes are all zero, so they are what the
 * freshly allocated columns already hold and only the flags are written.
 *
 * Nothing is laid out again: every other entry is a copy of an entry the layout
 * pass produced, moved along by one row and by one segment.
 */
export function layoutRowsOf(block: RowBlock, withUncommittedRow: boolean): LayoutRows {
  const shift = withUncommittedRow ? 1 : 0;
  const rowCount = block.rowCount + shift;
  const segmentCount = block.segmentCount + shift;
  const laneIndex = new Uint16Array(rowCount);
  const colourIndex = new Uint8Array(rowCount);
  const flags = new Uint8Array(rowCount);
  const segmentOffsets = new Uint32Array(rowCount + 1);
  const segmentFromLane = new Uint16Array(segmentCount);
  const segmentToLane = new Uint16Array(segmentCount);
  const segmentColour = new Uint8Array(segmentCount);
  laneIndex.set(block.laneIndex.subarray(0, block.rowCount), shift);
  colourIndex.set(block.colourIndex.subarray(0, block.rowCount), shift);
  flags.set(block.flags.subarray(0, block.rowCount), shift);
  segmentFromLane.set(block.segmentFromLane.subarray(0, block.segmentCount), shift);
  segmentToLane.set(block.segmentToLane.subarray(0, block.segmentCount), shift);
  segmentColour.set(block.segmentColour.subarray(0, block.segmentCount), shift);
  for (let row = 0; row <= block.rowCount; row += 1) {
    segmentOffsets[row + shift] = entryAt(block.segmentOffsets, row) + shift;
  }
  if (withUncommittedRow) {
    flags[0] = RowFlag.Uncommitted | RowFlag.ClipAboveVertex;
  }
  return {
    rowCount,
    laneIndex,
    colourIndex,
    flags,
    maxLane: block.maxLane,
    segmentOffsets,
    segmentFromLane,
    segmentToLane,
    segmentColour,
  };
}

/**
 * The page the renderer draws: what the reader read, and the rows accumulated.
 *
 * The three columnar blocks the reader produced are passed through untouched.
 * Only the layout is this folder's, because only the layout is the thing that
 * accumulates: a reading of a repository is whole every time.
 */
export function graphPageOf(block: RowBlock, read: RepositoryPage): GraphPage {
  return {
    commits: read.commits,
    refs: read.refs,
    workingTree: read.workingTree,
    layout: layoutRowsOf(block, read.workingTree.hasChanges),
    hasMore: read.hasMore,
  };
}

/**
 * One page, start to finish: append its rows, mark HEAD, and produce it.
 *
 * The order matters and is not arbitrary. HEAD is marked **after** the append
 * because the row it names may be one of the rows just added, and **before** the
 * page is produced because the page is a copy of the block and a bit written
 * afterwards would be written into the wrong one of the two.
 */
export function addPage(block: RowBlock, rows: LayoutRows, read: RepositoryPage): GraphPage {
  appendRows(block, rows);
  markHeadRow(block, read.workingTree.headCommitIndex);
  return graphPageOf(block, read);
}
