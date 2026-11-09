import { entryAt } from '../../contracts/column-read';
import { RowFlag, UNCOMMITTED_COLOUR, UNKNOWN_INDEX } from '../../contracts/index';
import type { GraphPage, LayoutRows } from '../../contracts/index';
import type { RepositoryPage } from '../../ports/index';
import { layoutPage, openUncommittedLine } from '../layout/index';
import type { LayoutState } from '../layout/index';

import { continuesBlock } from './continues-block';
import { appendRows, markHeadRow, markStashRows, NO_UNCOMMITTED_LINE } from './row-block';
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
 * The prepended row is what `src/contracts/layout.ts` describes: row 0, lane 0,
 * one segment from lane 0 to lane 0, its vertex and its segment in
 * `UNCOMMITTED_COLOUR`, and the flags `Uncommitted | ClipAboveVertex`, with
 * `ClipBelowVertex` as well when the block was laid out with no line from it
 * (`layoutReading`). Lane 0 and the segment's two lanes are zero, which the
 * freshly allocated columns already hold, so only the colours and the flags are
 * written. Until E04-M01-S14 the colour was 0 and the line stopped at the row's
 * bottom edge whatever was below it, which is `test/e2e/graph-table.spec.ts`'s
 * hand-built row still; since then the rows below continue it in lane 0 down to
 * HEAD's dot.
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
    const lineless = block.uncommittedHead === NO_UNCOMMITTED_LINE ? RowFlag.ClipBelowVertex : 0;
    flags[0] = RowFlag.Uncommitted | RowFlag.ClipAboveVertex | lineless;
    colourIndex[0] = UNCOMMITTED_COLOUR;
    segmentColour[0] = UNCOMMITTED_COLOUR;
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
 * One page, start to finish: append its rows, mark HEAD and the stashes, and
 * produce it.
 *
 * The order matters and is not arbitrary. HEAD and the stash rows are marked
 * **after** the append because the rows they name may be among the rows just
 * added, and **before** the page is produced because the page is a copy of the
 * block and a bit written afterwards would be written into the wrong one of the
 * two.
 */
export function addPage(block: RowBlock, rows: LayoutRows, read: RepositoryPage): GraphPage {
  appendRows(block, rows);
  markHeadRow(block, read.workingTree.headCommitIndex);
  markStashRows(block, read.refs);
  return graphPageOf(block, read);
}

/**
 * The row the uncommitted row's line runs down to in `read`, which is HEAD's
 * commit's, or {@link NO_UNCOMMITTED_LINE} when it has none.
 *
 * It has none when the page shows no uncommitted row, and when HEAD's commit is
 * not a row of the page. The second is not an inference about where the line
 * would go: `WorkingTree.headCommitIndex` is `UNKNOWN_INDEX` both for a HEAD
 * whose commit is past the page and for an unborn branch, which has no commit at
 * all, and a line laid out towards the first would run down every page of the
 * second. So the uncommitted row is drawn as a ring alone until a Load More
 * reaches HEAD's commit, and that reading lays the rows out again, because it
 * does not continue the block ({@link continuesReading}).
 */
export function uncommittedLineEnd(read: RepositoryPage): number {
  const { hasChanges, headCommitIndex } = read.workingTree;
  return hasChanges && headCommitIndex !== UNKNOWN_INDEX ? headCommitIndex : NO_UNCOMMITTED_LINE;
}

/**
 * Lay out the new rows of `read`, which is the layout pass's work, telling it of
 * the uncommitted row's line when the block is empty and `read` has one.
 *
 * This is the one mechanism E04-M01-S14 gives a row the page adds and joins to a
 * row it shows: the stash rows are commits of the page joined to the commit each
 * was made on by its first parent, and the uncommitted row's line is opened as a
 * line to HEAD's row before the first commit, so the layout keeps its lane and
 * HEAD's row knows it arrives (`openUncommittedLine` of `src/core/layout/`).
 * `block.uncommittedHead` remembers which, so a later reading that would draw it
 * differently is laid out again rather than appended ({@link continuesReading}).
 */
export function layoutReading(
  state: LayoutState,
  block: RowBlock,
  read: RepositoryPage,
): LayoutRows {
  if (block.rowCount === 0) {
    block.uncommittedHead = uncommittedLineEnd(read);
    if (block.uncommittedHead !== NO_UNCOMMITTED_LINE) {
      openUncommittedLine(state, block.uncommittedHead);
    }
  }
  return layoutPage(state, read.commits, block.rowCount);
}

/**
 * Whether `read` may be appended to the block laid out from the object names
 * `laidOutFrom`: it begins with the same commits (`continuesBlock`), and it
 * draws the uncommitted row's line to the same row, or draws none as the block
 * did. A working tree made clean or dirty, a HEAD moved, or HEAD's commit
 * reached for the first time by this reading all mean the rows above HEAD were
 * laid out for another line, and the reading is laid out whole.
 */
export function continuesReading(
  block: RowBlock,
  laidOutFrom: Uint8Array,
  read: RepositoryPage,
): boolean {
  return (
    continuesBlock(block, laidOutFrom, read.commits) &&
    block.uncommittedHead === uncommittedLineEnd(read)
  );
}
