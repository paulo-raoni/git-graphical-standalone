import { describe, expect, it } from 'vitest';

import { entryAt } from '../../contracts/column-read';
import {
  HASH_BYTE_LENGTH,
  RowFlag,
  UNCOMMITTED_COLOUR,
  UNKNOWN_INDEX,
} from '../../contracts/index';
import type { CommitColumns, LayoutRows, PersonTable } from '../../contracts/index';

import { createLayoutState, layoutPage, openUncommittedLine } from './lane-layout';

/**
 * The uncommitted row's line in the layout pass (E04-M01-S14): lane 0 held for
 * it from the first row down to HEAD's, a grey segment on every row it crosses,
 * and `RowFlag.UncommittedAbove` on HEAD's row.
 *
 * The fixture builder is `lane-layout.test.ts`'s again, written out rather than
 * imported, for the reason `lane-layout-pages.test.ts` gives: importing a test
 * module registers its suites here as well.
 */
const NOBODY: PersonTable = { names: [], emails: [] };

function page(parents: readonly (readonly number[])[]): CommitColumns {
  const count = parents.length;
  const parentOffsets = new Uint32Array(count + 1);
  const flat: number[] = [];
  for (const [row, list] of parents.entries()) {
    flat.push(...list.map((parent) => (parent >= count ? UNKNOWN_INDEX : parent)));
    parentOffsets[row + 1] = flat.length;
  }
  return {
    count,
    hashes: new Uint8Array(count * HASH_BYTE_LENGTH),
    parentOffsets,
    parentIndices: Uint32Array.from(flat),
    authorId: new Uint32Array(count),
    committerId: new Uint32Array(count),
    authorTime: new Float64Array(count),
    commitTime: new Float64Array(count),
    authorTzMinutes: new Int16Array(count),
    commitTzMinutes: new Int16Array(count),
    subjectOffsets: new Uint32Array(count + 1),
    subjects: '',
    people: NOBODY,
  };
}

function laidOut(parents: readonly (readonly number[])[]): LayoutRows {
  return layoutPage(createLayoutState(), page(parents), 0);
}

/** One row's segments as `[from, to, colour]`, in the order they were emitted. */
function segmentsOf(rows: LayoutRows, row: number): number[][] {
  const segments: number[][] = [];
  const end = entryAt(rows.segmentOffsets, row + 1);
  for (let at = entryAt(rows.segmentOffsets, row); at < end; at += 1) {
    segments.push([
      entryAt(rows.segmentFromLane, at),
      entryAt(rows.segmentToLane, at),
      entryAt(rows.segmentColour, at),
    ]);
  }
  return segments;
}

/** A page laid out under the uncommitted row's line, opened to `headRow`. */
function laidOutUnder(parents: readonly (readonly number[])[], headRow: number): LayoutRows {
  const state = createLayoutState();
  openUncommittedLine(state, headRow);
  return layoutPage(state, page(parents), 0);
}

describe("the uncommitted row's line", () => {
  it('ends in the first row when HEAD is the first commit, with HEAD in lane zero', () => {
    const rows = laidOutUnder([[1], []], 0);
    expect([...rows.laneIndex]).toEqual([0, 0]);
    expect(segmentsOf(rows, 0)).toEqual([[0, 0, 0]]);
    expect([...rows.flags]).toEqual([
      RowFlag.ClipAboveVertex | RowFlag.UncommittedAbove,
      RowFlag.ClipBelowVertex,
    ]);
  });

  it('keeps lane zero, grey, past a stash above HEAD, which curves into HEAD from lane one', () => {
    // Row 0 is a stash made on row 1, HEAD's commit; row 2 is HEAD's parent.
    const rows = laidOutUnder([[1], [2], []], 1);
    expect([...rows.laneIndex]).toEqual([1, 0, 0]);
    expect(segmentsOf(rows, 0)).toEqual([
      [0, 0, UNCOMMITTED_COLOUR],
      [1, 1, 1],
    ]);
    expect(segmentsOf(rows, 1)).toEqual([
      [1, 0, 1],
      [0, 0, 0],
    ]);
    expect([...rows.flags]).toEqual([
      RowFlag.ClipAboveVertex,
      RowFlag.ClipAboveVertex | RowFlag.UncommittedAbove,
      RowFlag.ClipBelowVertex,
    ]);
  });

  it('gives lane zero back once HEAD is reached, in its own colour again', () => {
    // Row 0 is a branch tip whose parent is row 3; row 1 is HEAD, whose line
    // runs on through row 2 to row 3, where both meet.
    const rows = laidOutUnder([[3], [2], [3], []], 1);
    expect([...rows.laneIndex]).toEqual([1, 0, 0, 0]);
    expect(segmentsOf(rows, 2)).toEqual([
      [0, 0, 0],
      [1, 1, 1],
    ]);
    expect([...rows.colourIndex]).toEqual([1, 0, 0, 0]);
    const marked = [...rows.flags].map((flags) => flags & RowFlag.UncommittedAbove);
    expect(marked).toEqual([0, RowFlag.UncommittedAbove, 0, 0]);
  });
});

describe("opening the uncommitted row's line", () => {
  it('is never opened after a row is laid out, twice, or to a HEAD not loaded', () => {
    const late = createLayoutState();
    layoutPage(late, page([[]]), 0);
    expect(() => {
      openUncommittedLine(late, 0);
    }).toThrow(new RangeError('the uncommitted line is opened before any line or row is laid out'));
    const twice = createLayoutState();
    openUncommittedLine(twice, 0);
    expect(() => {
      openUncommittedLine(twice, 0);
    }).toThrow(new RangeError('the uncommitted line is opened before any line or row is laid out'));
    expect(() => {
      openUncommittedLine(createLayoutState(), UNKNOWN_INDEX);
    }).toThrow(new RangeError("the uncommitted line is opened only to a loaded HEAD's row"));
  });

  it('marks no row when it is not opened', () => {
    const rows = laidOut([[1], [2], []]);
    expect([...rows.flags].some((flags) => (flags & RowFlag.UncommittedAbove) !== 0)).toBe(false);
  });
});
