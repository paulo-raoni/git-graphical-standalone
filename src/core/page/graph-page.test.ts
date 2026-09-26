import { describe, expect, it } from 'vitest';

import { RefKind, RowFlag, UNKNOWN_INDEX } from '../../contracts/index';
import type { CommitColumns, LayoutRows, Refs, WorkingTree } from '../../contracts/index';
import type { RepositoryPage } from '../../ports/index';

import { addPage, graphPageOf, layoutRowsOf } from './graph-page';
import { FIRST_PAGE_COMMITS, FURTHER_PAGE_COMMITS } from './page-sizes';
import { appendRows, createRowBlock } from './row-block';
import type { RowBlock } from './row-block';

/**
 * Producing a page, and the one row that is not a commit.
 *
 * The cases below assert `src/contracts/layout.ts`'s own invariants over the
 * result — row 0 is the only row that may carry `RowFlag.Uncommitted`, the
 * offsets are non-decreasing and start at zero, the three segment columns are as
 * long as the last offset — rather than comparing against a second
 * implementation of the shift. A fixture that builds the answer the same way the
 * code does agrees with the code by construction.
 */

/** Three rows in two lanes, with a merge, which is enough shape to shift. */
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

const NO_REFS: Refs = {
  count: 0,
  kind: new Uint8Array(0),
  commitIndex: new Uint32Array(0),
  nameOffsets: new Uint32Array(1),
  names: '',
  flags: new Uint8Array(0),
};

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

function readingOf(count: number, dirty: boolean, head: number, hasMore = false): RepositoryPage {
  return {
    commits: commitsOf(count),
    refs: count > 0 ? ONE_REF : NO_REFS,
    workingTree: workingTree(dirty, head),
    hasMore,
  };
}

/** Every invariant `src/contracts/layout.ts` states about a `LayoutRows`. */
function expectWellFormed(rows: LayoutRows): void {
  expect(rows.laneIndex.length).toBe(rows.rowCount);
  expect(rows.colourIndex.length).toBe(rows.rowCount);
  expect(rows.flags.length).toBe(rows.rowCount);
  expect(rows.segmentOffsets.length).toBe(rows.rowCount + 1);
  const offsets = [...rows.segmentOffsets];
  expect(offsets[0]).toBe(0);
  expect(offsets).toEqual([...offsets].sort((left, right) => left - right));
  const segments = offsets[rows.rowCount];
  expect(rows.segmentFromLane.length).toBe(segments);
  expect(rows.segmentToLane.length).toBe(segments);
  expect(rows.segmentColour.length).toBe(segments);
  const uncommitted = [...rows.flags].flatMap((flag, row) =>
    (flag & RowFlag.Uncommitted) === 0 ? [] : [row],
  );
  expect(uncommitted.every((row) => row === 0)).toBe(true);
}

describe('the page a clean working tree produces', () => {
  it('is the block itself, cut to the rows it holds', () => {
    const rows = layoutRowsOf(blockOfThreeRows(), false);
    expectWellFormed(rows);
    expect(rows.rowCount).toBe(3);
    expect(rows.maxLane).toBe(1);
    expect([...rows.laneIndex]).toEqual([0, 1, 0]);
    expect([...rows.colourIndex]).toEqual([0, 1, 0]);
    expect([...rows.flags]).toEqual([
      RowFlag.Merge | RowFlag.ClipAboveVertex,
      0,
      RowFlag.ClipBelowVertex,
    ]);
    expect([...rows.segmentOffsets]).toEqual([0, 2, 3, 3]);
    expect([...rows.segmentFromLane]).toEqual([0, 0, 1]);
    expect([...rows.segmentToLane]).toEqual([0, 1, 1]);
    expect([...rows.segmentColour]).toEqual([0, 1, 1]);
  });

  it('carries none of the slack the growing block keeps', () => {
    const block = blockOfThreeRows();
    expect(block.laneIndex.length).toBeGreaterThan(0);
    const rows = layoutRowsOf(block, false);
    expect(rows.laneIndex.length).toBe(block.rowCount);
    expect(rows.segmentFromLane.length).toBe(block.segmentCount);
  });
});

describe('the page a dirty working tree produces', () => {
  it('puts the uncommitted row first and moves every other row along by one', () => {
    const rows = layoutRowsOf(blockOfThreeRows(), true);
    expectWellFormed(rows);
    expect(rows.rowCount).toBe(4);
    expect(rows.maxLane).toBe(1);
    expect(rows.flags[0]).toBe(RowFlag.Uncommitted | RowFlag.ClipAboveVertex);
    expect(rows.laneIndex[0]).toBe(0);
    expect(rows.colourIndex[0]).toBe(0);
    expect([...rows.laneIndex]).toEqual([0, 0, 1, 0]);
    expect([...rows.colourIndex]).toEqual([0, 0, 1, 0]);
    expect([...rows.flags].slice(1)).toEqual([
      RowFlag.Merge | RowFlag.ClipAboveVertex,
      0,
      RowFlag.ClipBelowVertex,
    ]);
  });

  it('gives it one segment of its own, in lane zero, and moves the rest along', () => {
    const rows = layoutRowsOf(blockOfThreeRows(), true);
    expect([...rows.segmentOffsets]).toEqual([0, 1, 3, 4, 4]);
    expect([...rows.segmentFromLane]).toEqual([0, 0, 0, 1]);
    expect([...rows.segmentToLane]).toEqual([0, 0, 1, 1]);
    expect([...rows.segmentColour]).toEqual([0, 0, 1, 1]);
  });

  it('is one row and one segment when no commit has been loaded at all', () => {
    const rows = layoutRowsOf(createRowBlock(), true);
    expectWellFormed(rows);
    expect(rows.rowCount).toBe(1);
    expect(rows.maxLane).toBe(0);
    expect([...rows.segmentOffsets]).toEqual([0, 1]);
    expect(rows.flags[0]).toBe(RowFlag.Uncommitted | RowFlag.ClipAboveVertex);
  });

  it('is no row at all when the tree is clean and nothing has been loaded', () => {
    const rows = layoutRowsOf(createRowBlock(), false);
    expectWellFormed(rows);
    expect(rows.rowCount).toBe(0);
    expect([...rows.segmentOffsets]).toEqual([0]);
  });
});

describe('the assembled page', () => {
  it('passes the reading through and keeps the row count the contract asks for', () => {
    const read = readingOf(3, false, 0, true);
    const page = graphPageOf(blockOfThreeRows(), read);
    expect(page.commits).toBe(read.commits);
    expect(page.refs).toBe(read.refs);
    expect(page.workingTree).toBe(read.workingTree);
    expect(page.hasMore).toBe(true);
    expect(page.layout.rowCount).toBe(page.commits.count);
  });

  it('has one row more than it has commits when the working tree is dirty', () => {
    const read = readingOf(3, true, 0);
    const page = graphPageOf(blockOfThreeRows(), read);
    expect(page.hasMore).toBe(false);
    expect(page.layout.rowCount).toBe(page.commits.count + 1);
    expect(page.layout.flags[0]).toBe(RowFlag.Uncommitted | RowFlag.ClipAboveVertex);
  });

  it('appends, marks HEAD and produces, in that order', () => {
    const block = createRowBlock();
    const first = addPage(block, threeRows(), readingOf(3, false, 2));
    expect(block.rowCount).toBe(3);
    expect(block.headRow).toBe(2);
    expect([...first.layout.flags]).toEqual([
      RowFlag.Merge | RowFlag.ClipAboveVertex,
      0,
      RowFlag.ClipBelowVertex | RowFlag.Head,
    ]);

    const second = addPage(block, threeRows(), readingOf(6, true, 0));
    expect(block.rowCount).toBe(6);
    expect(block.headRow).toBe(0);
    expect(second.layout.rowCount).toBe(7);
    expect([...second.layout.flags]).toEqual([
      RowFlag.Uncommitted | RowFlag.ClipAboveVertex,
      RowFlag.Merge | RowFlag.ClipAboveVertex | RowFlag.Head,
      0,
      RowFlag.ClipBelowVertex,
      RowFlag.Merge | RowFlag.ClipAboveVertex,
      0,
      RowFlag.ClipBelowVertex,
    ]);
  });

  it('marks no row when HEAD is not on the page', () => {
    const block = createRowBlock();
    const page = addPage(block, threeRows(), readingOf(3, false, UNKNOWN_INDEX));
    expect([...page.layout.flags].some((flag) => (flag & RowFlag.Head) !== 0)).toBe(false);
  });
});

/**
 * The two page sizes, held to the two properties their own doc comment argues
 * for. Neither assertion is about the number 300: both would still hold if the
 * decision moved, and both fail if the decision is lost.
 *
 * The first is that a page is worth drawing. The window opens at 800 pixels tall
 * and a row is 24 of them, so a first page shorter than 34 rows would open on a
 * view that is already asking for more. The 800 and the 24 are copies, written
 * here as literals because a file in `src/core/` may import neither `src/ui/`
 * nor `src/app/` (`.dependency-cruiser.cjs`): they copy `src/ui/geometry.ts`'s
 * `ROW_HEIGHT` and `src/app/window.ts`'s `INITIAL_HEIGHT`, and nothing ties them
 * to those sources. If either moves, this bound stays green and goes on testing
 * the old numbers.
 *
 * The second is that the two sizes are equal, which is what makes the *n*th
 * press of Load More read *n + 1* pages under the re-read this slice chose.
 *
 * They are in this file rather than beside `./page-sizes.ts` because a test file
 * is not free: the mutation gate runs this suite once per mutant, so whatever a
 * file costs is paid once per mutant too. The S06 lane measured it on
 * 2026-09-19, as the message of commit `2020aee` records, with the suite still
 * on vitest's default 5 000 ms test timeout and running its files in parallel,
 * which is before E01-M01-S09 set `fileParallelism: false` and a 15 000 ms
 * timeout: four more files took the gate's per-mutant command from 3.65–3.88 s
 * to 6.08–7.07 s on an idle machine, the cost being transform and import rather
 * than the tests, and the gate's clock-share clause read 25.2 per cent against
 * its cap of 25. Those numbers belong to that condition. Under S09's settings
 * the clause read 3.5 per cent at `6356c68`, with no kill carrying vitest's
 * test timeout, over four full runs, three by the S06 lane and one by review
 * round 15. Three assertions still do not need a file.
 */
describe('the page sizes', () => {
  it('are whole numbers of commits', () => {
    expect(Number.isSafeInteger(FIRST_PAGE_COMMITS)).toBe(true);
    expect(Number.isSafeInteger(FURTHER_PAGE_COMMITS)).toBe(true);
  });

  it('open on more than the first window can show', () => {
    expect(FIRST_PAGE_COMMITS).toBeGreaterThan(Math.ceil(800 / 24));
  });

  it('add as much as they opened with', () => {
    expect(FURTHER_PAGE_COMMITS).toBe(FIRST_PAGE_COMMITS);
  });
});
