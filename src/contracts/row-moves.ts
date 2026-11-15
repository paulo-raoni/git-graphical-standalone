import { entryAt } from './column-read';
import { parentsOf } from './commit-columns';
import type { GraphPage } from './graph-page';
import { UNKNOWN_INDEX } from './indices';

/**
 * Which row a key goes to (E04-M01-S11): the rule the window calls when the
 * details of a row are open and a person presses an arrow.
 *
 * `src/ui/` holds no rule (`docs/ADR-0002-architecture-and-performance.md`
 * decision 1), so the answer is computed here from a page, the open layout row
 * and one of six moves, and the window only opens the row it is told.
 *
 * **"The same branch" is this project's definition, not the reference's.** The
 * reference extension's Marketplace page says only "child or parent commit on the
 * same branch" and "the alternative branch" (the orchestrator's reading of
 * 2026-11-12), so a branch continues from a commit to a child that names it as
 * its *first* parent, and where two do, the one drawn in the commit's own lane is
 * the one a person sees as the same line.
 *
 * **Nothing is kept.** The children of a row are found by walking the loaded rows
 * above it, because the log is read in `--date-order`, which git documents as
 * showing no parent before all its children, so a child always sits above. The
 * walk is at most `row` rows, once per key press and never per frame, and no table
 * of children is built per page, for the reason `src/ui/row-model.ts` gives for
 * keeping nothing per loaded row.
 *
 * **Nothing here loads anything.** A parent past the loaded page and the row
 * after the last loaded one answer "none".
 */

/** The six moves, by the key that makes each. */
export type RowMove =
  /** Up: the row above. */
  | 'up'
  /** Down: the row below. */
  | 'down'
  /** Ctrl+Up: the child on the same branch. */
  | 'child'
  /** Ctrl+Down: the first parent. */
  | 'parent'
  /** Ctrl+Shift+Up: the nearest other child at a fork. */
  | 'other-child'
  /** Ctrl+Shift+Down: the second parent at a merge. */
  | 'other-parent';

/** What a move answers when there is no row to go to. */
export const NO_MOVE = -1;

/** The commit that layout row `row` is: `-1` for the Uncommitted Changes row. */
function commitOf(page: GraphPage, row: number): number {
  return row - (page.workingTree.hasChanges ? 1 : 0);
}

/** How many parent entries layout row `row` has, the unloaded ones included. */
function parentCount(page: GraphPage, row: number): number {
  const commit = commitOf(page, row);
  return commit < 0 ? 1 : parentsOf(page.commits, commit).length;
}

/**
 * The layout row of the `which`-th parent entry of layout row `row`, or `NO_MOVE`
 * when there is no such entry or it is not a loaded row. The Uncommitted Changes
 * row has one parent, HEAD's commit. `UNKNOWN_INDEX` is beyond every page, so one
 * test covers a parent not loaded and an index past the page.
 */
function parentRow(page: GraphPage, row: number, which: number): number {
  const commit = commitOf(page, row);
  const index =
    commit < 0
      ? page.workingTree.headCommitIndex
      : (parentsOf(page.commits, commit)[which] ?? UNKNOWN_INDEX);
  return index < page.commits.count ? index + row - commit : NO_MOVE;
}

/**
 * `2` when layout row `child` has `row` as its first parent, `1` when as a later
 * one, else `0`. `row` is a commit, because it has rows above it.
 */
function kinshipOf(page: GraphPage, child: number, row: number): number {
  const commit = commitOf(page, child);
  const parents = commit < 0 ? [page.workingTree.headCommitIndex] : parentsOf(page.commits, commit);
  const at = parents.indexOf(commitOf(page, row));
  if (at < 0) {
    return 0;
  }
  return at === 0 ? 2 : 1;
}

/** Whether `row` is a row to open, as opposed to `NO_MOVE`. */
function isRow(row: number): boolean {
  return row >= 0;
}

/**
 * The row the Child move answers and the row the Other child move answers, for
 * the children of `row`, found by one walk over the rows above it, from the top
 * down, so that the last child met is the nearest.
 */
function childrenOf(page: GraphPage, row: number): { child: number; other: number } {
  const lane = entryAt(page.layout.laneIndex, row);
  let nearest = NO_MOVE;
  let second = NO_MOVE;
  let nearestFirst = NO_MOVE;
  let inLane = NO_MOVE;
  page.layout.laneIndex.subarray(0, row).forEach((laneAbove, above) => {
    const kin = kinshipOf(page, above, row);
    if (kin === 0) {
      return;
    }
    second = nearest;
    nearest = above;
    if (kin === 2) {
      nearestFirst = above;
      inLane = laneAbove === lane ? above : inLane;
    }
  });
  const child = [inLane, nearestFirst, nearest].find(isRow) ?? NO_MOVE;
  if (nearest !== child) {
    return { child, other: nearest };
  }
  return { child, other: isRow(second) ? second : child };
}

/** The second parent where there is one, else the first. */
function otherParent(page: GraphPage, row: number): number {
  return parentCount(page, row) >= 2 ? parentRow(page, row, 1) : parentRow(page, row, 0);
}

/** What each move answers, given a page and a row of it. */
const ANSWERS: Readonly<Record<RowMove, (page: GraphPage, row: number) => number>> = {
  up: (_page, row) => row - 1,
  down: (page, row) => (row + 1 < page.layout.rowCount ? row + 1 : NO_MOVE),
  parent: (page, row) => parentRow(page, row, 0),
  'other-parent': otherParent,
  child: (page, row) => childrenOf(page, row).child,
  'other-child': (page, row) => childrenOf(page, row).other,
};

/**
 * The layout row to open details on after `move` from layout row `row`, or
 * `NO_MOVE` when the move goes nowhere: the first or the last loaded row, a root,
 * a parent not loaded, or a row without a child. It never answers `row`.
 */
export function rowAfterMove(page: GraphPage, row: number, move: RowMove): number {
  if (!Number.isInteger(row) || row < 0 || row >= page.layout.rowCount) {
    return NO_MOVE;
  }
  return ANSWERS[move](page, row);
}
