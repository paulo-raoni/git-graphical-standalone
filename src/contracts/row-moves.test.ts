import { describe, expect, it } from 'vitest';

import { NO_MOVE, rowAfterMove, UNKNOWN_INDEX } from './index';
import type { GraphPage, RowMove } from './index';

const NONE = NO_MOVE;
const UNLOADED = UNKNOWN_INDEX;

/** The six moves, in the order `movesFrom` lists their answers. */
const MOVES: readonly RowMove[] = ['up', 'down', 'parent', 'child', 'other-parent', 'other-child'];

/** The commits of a page written by hand: the parent list of each, as commit indices or `UNLOADED`. */
function commitsOf(parents: readonly (readonly number[])[]): GraphPage['commits'] {
  const offsets = [0];
  for (const list of parents) {
    offsets.push((offsets.at(-1) ?? 0) + list.length);
  }
  return {
    count: parents.length,
    hashes: new Uint8Array(parents.length * 20),
    parentOffsets: Uint32Array.from(offsets),
    parentIndices: Uint32Array.from(parents.flat()),
    authorId: new Uint32Array(parents.length),
    committerId: new Uint32Array(parents.length),
    authorTime: new Float64Array(parents.length),
    commitTime: new Float64Array(parents.length),
    authorTzMinutes: new Int16Array(parents.length),
    commitTzMinutes: new Int16Array(parents.length),
    subjectOffsets: new Uint32Array(parents.length + 1),
    subjects: '',
    people: { names: [], emails: [] },
  };
}

/** A layout that says nothing but the lane of each row. */
function layoutOf(lanes: readonly number[]): GraphPage['layout'] {
  return {
    rowCount: lanes.length,
    laneIndex: Uint16Array.from(lanes),
    colourIndex: new Uint8Array(lanes.length),
    flags: new Uint8Array(lanes.length),
    maxLane: Math.max(0, ...lanes),
    segmentOffsets: new Uint32Array(lanes.length + 1),
    segmentFromLane: new Uint16Array(0),
    segmentToLane: new Uint16Array(0),
    segmentColour: new Uint8Array(0),
  };
}

/**
 * A page written by hand: the parent list of each commit, the lane of each
 * layout row, and, for a dirty tree, the index of HEAD's commit. `lanes` has one
 * entry per layout row, so one more than there are commits when `head` is given.
 */
function pageOf(
  parents: readonly (readonly number[])[],
  lanes: readonly number[],
  head?: number,
): GraphPage {
  const dirty = head !== undefined;
  return {
    commits: commitsOf(parents),
    refs: {
      count: 0,
      kind: new Uint8Array(0),
      commitIndex: new Uint32Array(0),
      nameOffsets: Uint32Array.of(0),
      names: '',
      flags: new Uint8Array(0),
    },
    workingTree: {
      hasChanges: dirty,
      changedFileCount: dirty ? 1 : 0,
      untrackedFileCount: 0,
      headCommitIndex: head ?? UNKNOWN_INDEX,
      headRefName: null,
      isDetached: false,
    },
    layout: layoutOf(lanes),
    hasMore: false,
  };
}

/** What every move answers from `row`: up, down, parent, child, other parent, other child. */
function movesFrom(page: GraphPage, row: number): number[] {
  return MOVES.map((move) => rowAfterMove(page, row, move));
}

/** The answers from every row of the page, in row order. */
function everyRow(page: GraphPage): number[][] {
  return Array.from({ length: page.layout.rowCount }, (_, row) => movesFrom(page, row));
}

describe('rowAfterMove on a linear history', () => {
  // Four commits, each the parent of the one above, all in lane 0.
  const page = pageOf([[1], [2], [3], []], [0, 0, 0, 0]);

  it('answers the neighbours, the parent and the child at every row', () => {
    expect(everyRow(page)).toEqual([
      [NONE, 1, 1, NONE, 1, NONE],
      [0, 2, 2, 0, 2, 0],
      [1, 3, 3, 1, 3, 1],
      [2, NONE, NONE, 2, NONE, 2],
    ]);
  });

  it('answers nothing for a row the page does not have', () => {
    expect(movesFrom(page, -1)).toEqual([NONE, NONE, NONE, NONE, NONE, NONE]);
    expect(movesFrom(page, 4)).toEqual([NONE, NONE, NONE, NONE, NONE, NONE]);
    expect(movesFrom(page, 1.5)).toEqual([NONE, NONE, NONE, NONE, NONE, NONE]);
    expect(movesFrom(page, Number.NaN)).toEqual([NONE, NONE, NONE, NONE, NONE, NONE]);
  });
});

describe('rowAfterMove at a fork', () => {
  it('takes the child in the commit lane, and the nearest other child for Other child', () => {
    // Row 4 is the fork. Rows 1 (lane 0) and 3 (lane 1) both name it as first
    // parent; row 4 is in lane 0, so Child is row 1 and Other child is row 3.
    const page = pageOf([[1], [4], [3], [4], []], [0, 0, 1, 1, 0]);
    expect(movesFrom(page, 4)).toEqual([3, NONE, NONE, 1, NONE, 3]);
  });

  it('takes the nearest first-parent child when none is in the lane', () => {
    // The same fork with the two children in lanes 1 and 2: Child is the nearer
    // (row 3), Other child the one beyond it (row 1).
    const page = pageOf([[1], [4], [3], [4], []], [0, 1, 1, 2, 0]);
    expect(movesFrom(page, 4)).toEqual([3, NONE, NONE, 3, NONE, 1]);
  });

  it('does not stop at the nearest child when a farther one is in the lane', () => {
    // Three children: rows 1 (lane 2), 2 (lane 0, the fork lane) and 4 (lane 1).
    const page = pageOf([[1], [5], [5], [4], [5], []], [0, 2, 0, 1, 1, 0]);
    expect(movesFrom(page, 5)).toEqual([4, NONE, NONE, 2, NONE, 4]);
  });

  it('prefers a first-parent child to a nearer merge', () => {
    // Row 3 is the first parent of row 1 (lane 2) and the second parent of the
    // nearer row 2, a merge. Child is row 1, the first-parent child; Other child
    // is the merge.
    const page = pageOf([[1], [3], [4, 3], [4], []], [0, 2, 1, 0, 0]);
    expect(movesFrom(page, 3)).toEqual([2, 4, 4, 1, 4, 2]);
  });
});

describe('rowAfterMove when the answer is the first row', () => {
  it('takes the child in the lane at row 0', () => {
    expect(movesFrom(pageOf([[2], [2], []], [0, 1, 0]), 2)).toEqual([1, NONE, NONE, 0, NONE, 1]);
  });

  it('takes the first-parent child at row 0 before a merge nearer', () => {
    // Row 0 (lane 1) is the first-parent child of row 2; row 1 merges it as a second parent.
    expect(movesFrom(pageOf([[2], [3, 2], [3], []], [1, 0, 0, 0]), 2)).toEqual([1, 3, 3, 0, 3, 1]);
  });

  it('takes the other child at row 0', () => {
    expect(movesFrom(pageOf([[2], [2], []], [1, 0, 0]), 2)).toEqual([1, NONE, NONE, 1, NONE, 0]);
  });
});

describe('rowAfterMove at a merge', () => {
  // Row 0 merges row 1 (its first parent) and row 2, the tip of a side branch.
  const page = pageOf([[1, 2], [3], [3], []], [0, 0, 1, 0]);

  it('opens the first and the second parent of the merge', () => {
    expect(movesFrom(page, 0)).toEqual([NONE, 1, 1, NONE, 2, NONE]);
  });

  it('goes from the tip of the merged branch into the merge, with one child', () => {
    expect(movesFrom(page, 2)).toEqual([1, 3, 3, 0, 3, 0]);
  });

  it('answers the first parent and the nearest other child at the base of both', () => {
    expect(movesFrom(page, 3)).toEqual([2, NONE, NONE, 1, NONE, 2]);
  });

  it('takes the second parent of a merge of three, and no later one', () => {
    const octopus = pageOf([[1, 2, 3], [4], [4], [4], []], [0, 0, 1, 2, 0]);
    expect(movesFrom(octopus, 0)).toEqual([NONE, 1, 1, NONE, 2, NONE]);
  });

  it('answers nothing when the second parent is not loaded, and not the first', () => {
    const open = pageOf([[1, UNLOADED], []], [0, 0]);
    expect(movesFrom(open, 0)).toEqual([NONE, 1, 1, NONE, NONE, NONE]);
  });

  it('answers nothing when the first parent is not loaded, and not the second', () => {
    const open = pageOf([[UNLOADED, 1], []], [0, 0]);
    expect(movesFrom(open, 0)).toEqual([NONE, 1, NONE, NONE, 1, NONE]);
  });
});

describe('rowAfterMove at the edge of the page', () => {
  it('answers nothing for a parent past the page', () => {
    const page = pageOf([[UNLOADED], [UNLOADED]], [0, 0]);
    expect(everyRow(page)).toEqual([
      [NONE, 1, NONE, NONE, NONE, NONE],
      [0, NONE, NONE, NONE, NONE, NONE],
    ]);
  });

  it('answers nothing for a parent index beyond the loaded commits', () => {
    const page = pageOf([[2], []], [0, 0]);
    expect(movesFrom(page, 0)).toEqual([NONE, 1, NONE, NONE, NONE, NONE]);
  });
});

describe('rowAfterMove with uncommitted changes', () => {
  it('goes from the uncommitted row to HEAD, and from HEAD back to it', () => {
    // Row 0 is the uncommitted row; rows 1 to 3 are commits 0 to 2, HEAD is commit 0.
    const page = pageOf([[1], [2], []], [0, 0, 0, 0], 0);
    expect(everyRow(page)).toEqual([
      [NONE, 1, 1, NONE, 1, NONE],
      [0, 2, 2, 0, 2, 0],
      [1, 3, 3, 1, 3, 1],
      [2, NONE, NONE, 2, NONE, 2],
    ]);
  });

  it('puts the uncommitted row above a HEAD that is not the newest commit', () => {
    // HEAD is commit 1 (row 2); commit 0 (row 1) is another branch's tip on the same base.
    const page = pageOf([[2], [2], []], [0, 1, 0, 0], 1);
    expect(everyRow(page)).toEqual([
      [NONE, 1, 2, NONE, 2, NONE],
      [0, 2, 3, NONE, 3, NONE],
      [1, 3, 3, 0, 3, 0],
      [2, NONE, NONE, 2, NONE, 1],
    ]);
  });

  it('answers nothing from the uncommitted row when HEAD is not loaded', () => {
    const page = pageOf([[1], []], [0, 0, 0], UNLOADED);
    expect(movesFrom(page, 0)).toEqual([NONE, 1, NONE, NONE, NONE, NONE]);
  });
});

describe('rowAfterMove on a stash row', () => {
  it('goes to the base, which sees the stash as one of its children', () => {
    // Row 0 is a stash on the base (row 2), in lane 1; row 1 is the branch tip in lane 0.
    const page = pageOf([[2], [2], []], [1, 0, 0]);
    expect(movesFrom(page, 0)).toEqual([NONE, 1, 2, NONE, 2, NONE]);
    expect(movesFrom(page, 2)).toEqual([1, NONE, NONE, 1, NONE, 0]);
  });
});
