import { describe, expect, it } from 'vitest';

import {
  HASH_BYTE_LENGTH,
  RefKind,
  RowFlag,
  UNCOMMITTED_COLOUR,
  UNKNOWN_INDEX,
} from '../../contracts/index';
import type { CommitColumns, LayoutRows, Refs, WorkingTree } from '../../contracts/index';
import type { RepositoryPage } from '../../ports/index';
import { createLayoutState } from '../layout/index';

import {
  addPage,
  continuesReading,
  layoutReading,
  layoutRowsOf,
  uncommittedLineEnd,
} from './graph-page';
import { appendRows, createRowBlock, markStashRows, NO_UNCOMMITTED_LINE } from './row-block';
import type { RowBlock } from './row-block';

/**
 * The two rows a page puts on that are not plain commits (E04-M01-S14): the
 * stash rows, marked from the page's stash references, and the uncommitted row
 * with its line down to HEAD's row, which the layout is told of and which decides
 * whether a further reading continues the block.
 *
 * The fixtures are `graph-page.test.ts`'s, written out again rather than
 * imported, because importing a test module registers its suites here too.
 */

/** Three rows in two lanes, with a merge. */
function threeRows(): LayoutRows {
  return {
    rowCount: 3,
    laneIndex: Uint16Array.of(0, 1, 0),
    colourIndex: Uint8Array.of(0, 1, 0),
    flags: Uint8Array.of(RowFlag.Merge | RowFlag.ClipAboveVertex, 0, RowFlag.ClipBelowVertex),
    maxLane: 1,
    segmentOffsets: Uint32Array.of(0, 2, 3, 3),
    segmentFromLane: Uint16Array.of(0, 0, 1),
    segmentToLane: Uint16Array.of(0, 1, 1),
    segmentColour: Uint8Array.of(0, 1, 1),
  };
}

function blockOfThreeRows(): RowBlock {
  const block = createRowBlock();
  appendRows(block, threeRows());
  return block;
}

const ONE_REF: Refs = {
  count: 1,
  kind: Uint8Array.of(RefKind.LocalHead),
  commitIndex: Uint32Array.of(0),
  nameOffsets: Uint32Array.of(0, 4),
  names: 'main',
  flags: new Uint8Array(1),
};

function commitsOf(count: number): CommitColumns {
  return {
    count,
    hashes: new Uint8Array(0),
    parentOffsets: new Uint32Array(count + 1),
    parentIndices: new Uint32Array(0),
    authorId: new Uint32Array(count),
    committerId: new Uint32Array(count),
    authorTime: new Float64Array(count),
    commitTime: new Float64Array(count),
    authorTzMinutes: new Int16Array(count),
    commitTzMinutes: new Int16Array(count),
    subjectOffsets: new Uint32Array(count + 1),
    subjects: '',
    people: { names: [], emails: [] },
  };
}

function workingTree(hasChanges: boolean, headCommitIndex: number): WorkingTree {
  return {
    hasChanges,
    changedFileCount: hasChanges ? 2 : 0,
    untrackedFileCount: hasChanges ? 1 : 0,
    headCommitIndex,
    headRefName: 'main',
    isDetached: false,
  };
}

function readingOf(count: number, dirty: boolean, head: number): RepositoryPage {
  return {
    commits: commitsOf(count),
    refs: ONE_REF,
    workingTree: workingTree(dirty, head),
    hasMore: false,
  };
}

/** The flags of an uncommitted row with no line to draw: a ring alone. */
const LINELESS = RowFlag.Uncommitted | RowFlag.ClipAboveVertex | RowFlag.ClipBelowVertex;

describe('the stash rows', () => {
  it('marks nothing for a stash reference past the rows of the block', () => {
    const block = blockOfThreeRows();
    const past: Refs = {
      ...ONE_REF,
      kind: Uint8Array.of(RefKind.Stash),
      commitIndex: Uint32Array.of(3),
    };
    expect(() => {
      markStashRows(block, past);
    }).not.toThrow();
    expect([...block.flags.subarray(0, 3)].map((flags) => flags & RowFlag.Stash)).toEqual([
      0, 0, 0,
    ]);
  });

  it('marks the row every loaded stash points at as a stash, and no other row', () => {
    const stashes: Refs = {
      count: 3,
      kind: Uint8Array.of(RefKind.Stash, RefKind.LocalHead, RefKind.Stash),
      commitIndex: Uint32Array.of(1, 0, UNKNOWN_INDEX),
      nameOffsets: Uint32Array.of(0, 9, 13, 22),
      names: 'stash@{0}mainstash@{1}',
      flags: new Uint8Array(3),
    };
    const block = createRowBlock();
    const page = addPage(block, threeRows(), { ...readingOf(3, false, 2), refs: stashes });
    const marked = [...page.layout.flags].map((flag) => flag & RowFlag.Stash);
    expect(marked).toEqual([0, RowFlag.Stash, 0]);
    const further = addPage(block, threeRows(), { ...readingOf(6, false, 2), refs: stashes });
    expect([...further.layout.flags].map((flag) => flag & RowFlag.Stash)).toEqual([
      0,
      RowFlag.Stash,
      0,
      0,
      0,
      0,
    ]);
  });
});

describe("the uncommitted row's own segment", () => {
  it('draws its line on down when the block was laid out with one, and clips it when not', () => {
    const block = blockOfThreeRows();
    block.uncommittedHead = 0;
    expect(layoutRowsOf(block, true).flags[0]).toBe(RowFlag.Uncommitted | RowFlag.ClipAboveVertex);
    block.uncommittedHead = NO_UNCOMMITTED_LINE;
    expect(layoutRowsOf(block, true).flags[0]).toBe(LINELESS);
  });
});

/**
 * A reading of commits that each have the next as their parent, the last a
 * root, with object names that differ by their first byte.
 */
function chainOf(count: number, dirty: boolean, head: number): RepositoryPage {
  const base = commitsOf(count);
  const hashes = new Uint8Array(count * HASH_BYTE_LENGTH);
  const parentOffsets = new Uint32Array(count + 1);
  for (let row = 0; row < count; row += 1) {
    hashes[row * HASH_BYTE_LENGTH] = row + 1;
    parentOffsets[row + 1] = Math.min(row + 1, count - 1);
  }
  const parentIndices = Uint32Array.from({ length: count - 1 }, (_unused, row) => row + 1);
  return {
    ...readingOf(count, dirty, head),
    commits: { ...base, hashes, parentOffsets, parentIndices },
  };
}

describe("the uncommitted row's line", () => {
  it("runs to HEAD's row when the page shows the row and HEAD's commit, and nowhere else", () => {
    expect(uncommittedLineEnd(readingOf(3, true, 2))).toBe(2);
    expect(uncommittedLineEnd(readingOf(3, true, 0))).toBe(0);
    expect(uncommittedLineEnd(readingOf(3, false, 2))).toBe(NO_UNCOMMITTED_LINE);
    expect(uncommittedLineEnd(readingOf(3, true, UNKNOWN_INDEX))).toBe(NO_UNCOMMITTED_LINE);
  });

  it("is laid out down lane zero to HEAD's row, which the row above passes beside", () => {
    // Row 0 is a tip whose parent is row 2; row 1 is HEAD, whose parent is row 2.
    const read = { ...chainOf(3, true, 1) };
    const commits = {
      ...read.commits,
      parentOffsets: Uint32Array.of(0, 1, 2, 2),
      parentIndices: Uint32Array.of(2, 2),
    };
    const block = createRowBlock();
    const rows = layoutReading(createLayoutState(), block, { ...read, commits });
    expect(block.uncommittedHead).toBe(1);
    expect([...rows.laneIndex]).toEqual([1, 0, 0]);
    expect(rows.flags[1]).toBe(RowFlag.ClipAboveVertex | RowFlag.UncommittedAbove);
    const page = addPage(block, rows, { ...read, commits });
    expect(page.layout.flags[0]).toBe(RowFlag.Uncommitted | RowFlag.ClipAboveVertex);
    expect([...page.layout.segmentColour].slice(0, 2)).toEqual([
      UNCOMMITTED_COLOUR,
      UNCOMMITTED_COLOUR,
    ]);
  });

  it('is opened for the first page only, and laid out with none on a clean tree', () => {
    const state = createLayoutState();
    const block = createRowBlock();
    const first = chainOf(2, true, 0);
    addPage(block, layoutReading(state, block, first), first);
    const more = chainOf(4, true, 0);
    const rows = layoutReading(state, block, more);
    expect(rows.rowCount).toBe(2);
    expect(block.uncommittedHead).toBe(0);
    const clean = createRowBlock();
    const plain = layoutReading(createLayoutState(), clean, chainOf(2, false, 0));
    expect(clean.uncommittedHead).toBe(NO_UNCOMMITTED_LINE);
    expect(plain.flags[0]).toBe(RowFlag.ClipAboveVertex);
    expect([...plain.laneIndex]).toEqual([0, 0]);
  });
});

describe('a further reading under the uncommitted row', () => {
  it('decides whether a further reading continues the block, beside its commits', () => {
    const block = createRowBlock();
    const first = chainOf(2, true, 0);
    addPage(block, layoutReading(createLayoutState(), block, first), first);
    const laidOutFrom = first.commits.hashes;
    expect(continuesReading(block, laidOutFrom, chainOf(4, true, 0))).toBe(true);
    expect(continuesReading(block, laidOutFrom, chainOf(4, false, 0))).toBe(false);
    expect(continuesReading(block, laidOutFrom, chainOf(4, true, 1))).toBe(false);
    const moved = chainOf(4, true, 0);
    moved.commits.hashes[0] = 9;
    expect(continuesReading(block, laidOutFrom, moved)).toBe(false);
  });
});
