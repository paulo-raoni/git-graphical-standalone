import { describe, expect, it } from 'vitest';

import { RowFlag, UNKNOWN_INDEX } from '../../contracts/index';
import type { CommitColumns, LayoutRows, PersonTable } from '../../contracts/index';
import { createLayoutState, layoutPage } from '../layout/index';

import { appendRows, createRowBlock, markHeadRow, NO_HEAD_ROW } from './row-block';
import type { RowBlock } from './row-block';

/**
 * The accumulation, checked against the thing it accumulates.
 *
 * Two kinds of fixture, and both are here on purpose. The hand-built
 * `LayoutRows` below let a case name exactly which entry has to land where,
 * which is what pins the offset arithmetic. The second half of the file feeds
 * the **real layout engine** a page in one piece and then in two, and requires
 * the block to come out identical either way: that is the property the whole
 * design rests on, and no hand-built fixture can state it, because a fixture
 * built by hand is a second opinion about what the engine does.
 */

/** One row of a hand-built page: its lane, its flags, and its segments. */
interface RowSpec {
  readonly lane: number;
  readonly flags: number;
  readonly segments: readonly (readonly [number, number, number])[];
}

function rowsOf(rows: readonly RowSpec[]): LayoutRows {
  const segmentOffsets = new Uint32Array(rows.length + 1);
  const from: number[] = [];
  const to: number[] = [];
  const colour: number[] = [];
  let maxLane = 0;
  rows.forEach((row, at) => {
    for (const [segmentFrom, segmentTo, segmentColour] of row.segments) {
      from.push(segmentFrom);
      to.push(segmentTo);
      colour.push(segmentColour);
      maxLane = Math.max(maxLane, segmentFrom, segmentTo);
    }
    segmentOffsets[at + 1] = from.length;
    maxLane = Math.max(maxLane, row.lane);
  });
  return {
    rowCount: rows.length,
    laneIndex: Uint16Array.from(rows.map((row) => row.lane)),
    colourIndex: Uint8Array.from(rows.map((row) => row.lane)),
    flags: Uint8Array.from(rows.map((row) => row.flags)),
    maxLane,
    segmentOffsets,
    segmentFromLane: Uint16Array.from(from),
    segmentToLane: Uint16Array.from(to),
    segmentColour: Uint8Array.from(colour),
  };
}

/** A straight chain of `count` rows in lane 0, each with one segment. */
function chainOf(count: number, lane = 0): LayoutRows {
  return rowsOf(
    Array.from({ length: count }, () => ({
      lane,
      flags: 0,
      segments: [[lane, lane, lane]] as const,
    })),
  );
}

/** The used prefix of every column, as plain arrays a comparison can print. */
interface BlockContents {
  readonly laneIndex: readonly number[];
  readonly colourIndex: readonly number[];
  readonly flags: readonly number[];
  readonly segmentOffsets: readonly number[];
  readonly segmentFromLane: readonly number[];
  readonly segmentToLane: readonly number[];
  readonly segmentColour: readonly number[];
}

function contentsOf(block: RowBlock): BlockContents {
  return {
    laneIndex: [...block.laneIndex.subarray(0, block.rowCount)],
    colourIndex: [...block.colourIndex.subarray(0, block.rowCount)],
    flags: [...block.flags.subarray(0, block.rowCount)],
    segmentOffsets: [...block.segmentOffsets.subarray(0, block.rowCount + 1)],
    segmentFromLane: [...block.segmentFromLane.subarray(0, block.segmentCount)],
    segmentToLane: [...block.segmentToLane.subarray(0, block.segmentCount)],
    segmentColour: [...block.segmentColour.subarray(0, block.segmentCount)],
  };
}

describe('the accumulated row block', () => {
  it('starts holding nothing, with an offset table of one zero', () => {
    const block = createRowBlock();
    expect(block.rowCount).toBe(0);
    expect(block.segmentCount).toBe(0);
    expect(block.maxLane).toBe(0);
    expect(block.headRow).toBe(NO_HEAD_ROW);
    expect(contentsOf(block).segmentOffsets).toEqual([0]);
  });

  it('copies a page in, row for row and segment for segment', () => {
    const block = createRowBlock();
    appendRows(
      block,
      rowsOf([
        { lane: 0, flags: RowFlag.ClipAboveVertex, segments: [[0, 0, 0]] },
        {
          lane: 0,
          flags: RowFlag.Merge,
          segments: [
            [0, 0, 0],
            [0, 1, 1],
          ],
        },
        {
          lane: 1,
          flags: 0,
          segments: [
            [0, 0, 0],
            [1, 1, 1],
          ],
        },
      ]),
    );
    expect(block.rowCount).toBe(3);
    expect(block.maxLane).toBe(1);
    expect(contentsOf(block)).toEqual({
      laneIndex: [0, 0, 1],
      colourIndex: [0, 0, 1],
      flags: [RowFlag.ClipAboveVertex, RowFlag.Merge, 0],
      segmentOffsets: [0, 1, 3, 5],
      segmentFromLane: [0, 0, 0, 0, 1],
      segmentToLane: [0, 0, 1, 0, 1],
      segmentColour: [0, 0, 1, 0, 1],
    });
  });
});

describe('a second page', () => {
  it('is appended without moving anything the first put there', () => {
    const block = createRowBlock();
    appendRows(
      block,
      rowsOf([
        {
          lane: 0,
          flags: RowFlag.Merge,
          segments: [
            [0, 0, 0],
            [0, 2, 2],
          ],
        },
      ]),
    );
    const first = contentsOf(block);
    appendRows(
      block,
      rowsOf([
        { lane: 2, flags: 0, segments: [[2, 2, 2]] },
        { lane: 0, flags: RowFlag.ClipBelowVertex, segments: [] },
      ]),
    );
    const both = contentsOf(block);
    expect(both.laneIndex.slice(0, 1)).toEqual(first.laneIndex);
    expect(both.segmentOffsets.slice(0, 2)).toEqual(first.segmentOffsets);
    expect(both.segmentFromLane.slice(0, 2)).toEqual(first.segmentFromLane);
    expect(both.segmentOffsets).toEqual([0, 2, 3, 3]);
    expect(both.laneIndex).toEqual([0, 2, 0]);
    expect(both.segmentFromLane).toEqual([0, 0, 2]);
    expect(block.rowCount).toBe(3);
    expect(block.segmentCount).toBe(3);
  });

  it('appending nothing changes nothing, and does not reallocate', () => {
    const block = createRowBlock();
    appendRows(block, chainOf(6));
    const columns = block.laneIndex;
    const before = contentsOf(block);
    appendRows(block, chainOf(1));
    expect(block.laneIndex).toBe(columns);
    appendRows(block, rowsOf([]));
    expect(block.rowCount).toBe(7);
    expect(contentsOf(block).segmentOffsets).toEqual([...before.segmentOffsets, 7]);
  });
});

describe('the columns under the block', () => {
  it('grow geometrically and keep every entry across the growth', () => {
    const block = createRowBlock();
    const pages = 4;
    const perPage = 75;
    for (let page = 0; page < pages; page += 1) {
      appendRows(block, chainOf(perPage, page));
    }
    const total = pages * perPage;
    expect(block.rowCount).toBe(total);
    expect(block.laneIndex.length).toBeGreaterThanOrEqual(total);
    expect(block.laneIndex.length).toBeLessThanOrEqual(Math.ceil((total * 5) / 4));
    expect(block.segmentFromLane.length).toBeLessThanOrEqual(Math.ceil((total * 5) / 4));
    expect(block.segmentOffsets.length).toBeGreaterThan(block.laneIndex.length);
    const lanes = contentsOf(block).laneIndex;
    expect(lanes[0]).toBe(0);
    expect(lanes[perPage]).toBe(1);
    expect(lanes[total - 1]).toBe(pages - 1);
    expect(contentsOf(block).segmentOffsets[total]).toBe(total);
  });

  it('remembers the widest lane any page reached, whichever page reached it', () => {
    const widest = createRowBlock();
    appendRows(widest, chainOf(1, 5));
    appendRows(widest, chainOf(1, 1));
    expect(widest.maxLane).toBe(5);
    const later = createRowBlock();
    appendRows(later, chainOf(1, 1));
    appendRows(later, chainOf(1, 5));
    expect(later.maxLane).toBe(5);
  });
});

/** Three rows carrying three different flag sets, so a change to one shows. */
function threeFlaggedRows(): RowBlock {
  const block = createRowBlock();
  appendRows(
    block,
    rowsOf([
      { lane: 0, flags: RowFlag.Merge, segments: [] },
      { lane: 0, flags: 0, segments: [] },
      { lane: 0, flags: RowFlag.ClipBelowVertex, segments: [] },
    ]),
  );
  return block;
}

describe('the head row', () => {
  it('marks the row it is given, leaving the flags already there alone', () => {
    const block = threeFlaggedRows();
    markHeadRow(block, 0);
    expect(block.headRow).toBe(0);
    expect([...block.flags.subarray(0, 3)]).toEqual([
      RowFlag.Merge | RowFlag.Head,
      0,
      RowFlag.ClipBelowVertex,
    ]);
  });

  it('moves the mark rather than adding a second one', () => {
    const block = threeFlaggedRows();
    markHeadRow(block, 0);
    markHeadRow(block, 2);
    expect(block.headRow).toBe(2);
    expect([...block.flags.subarray(0, 3)]).toEqual([
      RowFlag.Merge,
      0,
      RowFlag.ClipBelowVertex | RowFlag.Head,
    ]);
  });

  it('marks no row when the commit is not one of the rows loaded', () => {
    const block = threeFlaggedRows();
    markHeadRow(block, 1);
    markHeadRow(block, UNKNOWN_INDEX);
    expect(block.headRow).toBe(NO_HEAD_ROW);
    expect([...block.flags.subarray(0, 3)]).toEqual([RowFlag.Merge, 0, RowFlag.ClipBelowVertex]);
    markHeadRow(block, 3);
    expect(block.headRow).toBe(NO_HEAD_ROW);
    markHeadRow(block, -1);
    expect(block.headRow).toBe(NO_HEAD_ROW);
  });

  it('marks a row a later page added', () => {
    const block = threeFlaggedRows();
    markHeadRow(block, 4);
    appendRows(block, chainOf(2));
    markHeadRow(block, 4);
    expect(block.headRow).toBe(4);
    expect([...block.flags.subarray(0, 5)]).toEqual([
      RowFlag.Merge,
      0,
      RowFlag.ClipBelowVertex,
      0,
      RowFlag.Head,
    ]);
  });
});

/**
 * The commits of a page, built from parent lists alone.
 *
 * The layout pass reads `count`, `parentOffsets` and `parentIndices` and nothing
 * else, so everything a commit otherwise carries is left empty. A parent past
 * the end of the page is `UNKNOWN_INDEX`, which is what the store writes for a
 * parent it has not loaded and what makes a short page a page rather than a
 * different history.
 */
const NO_PEOPLE: PersonTable = { names: [], emails: [] };

/** Every column the layout pass never reads, empty, so a fixture names three. */
const UNREAD_COLUMNS = {
  hashes: new Uint8Array(0),
  authorId: new Uint32Array(0),
  committerId: new Uint32Array(0),
  authorTime: new Float64Array(0),
  commitTime: new Float64Array(0),
  authorTzMinutes: new Int16Array(0),
  commitTzMinutes: new Int16Array(0),
  subjectOffsets: new Uint32Array(1),
  subjects: '',
  people: NO_PEOPLE,
};

function commitsOf(parents: readonly (readonly number[])[], count: number): CommitColumns {
  const offsets = new Uint32Array(count + 1);
  const indices: number[] = [];
  for (let row = 0; row < count; row += 1) {
    for (const parent of parents[row] ?? []) {
      indices.push(parent < count ? parent : UNKNOWN_INDEX);
    }
    offsets[row + 1] = indices.length;
  }
  return {
    ...UNREAD_COLUMNS,
    count,
    parentOffsets: offsets,
    parentIndices: Uint32Array.from(indices),
  };
}

/** A mainline with a branch off every fifth row, rejoining three rows down. */
const BRAIDED: readonly (readonly number[])[] = Array.from({ length: 24 }, (_unused, row) =>
  row % 5 === 0 ? [row + 1, row + 3] : [row + 1],
);

describe('a block filled by the real layout engine', () => {
  it('is the same block whether the page arrived whole or in two halves', () => {
    const whole = createRowBlock();
    appendRows(whole, layoutPage(createLayoutState(), commitsOf(BRAIDED, 24), 0));

    const halves = createRowBlock();
    const state = createLayoutState();
    appendRows(halves, layoutPage(state, commitsOf(BRAIDED, 10), 0));
    const afterFirst = contentsOf(halves);
    appendRows(halves, layoutPage(state, commitsOf(BRAIDED, 24), 10));

    expect(halves.rowCount).toBe(whole.rowCount);
    expect(halves.segmentCount).toBe(whole.segmentCount);
    expect(halves.maxLane).toBe(whole.maxLane);
    expect(contentsOf(halves)).toEqual(contentsOf(whole));
    // And the first half's entries are the ones the whole page has there, which
    // is what "appended and never recomputed" has to mean to be worth anything.
    expect(afterFirst.laneIndex).toEqual(contentsOf(whole).laneIndex.slice(0, 10));
    expect(afterFirst.segmentOffsets).toEqual(contentsOf(whole).segmentOffsets.slice(0, 11));
  });
});
