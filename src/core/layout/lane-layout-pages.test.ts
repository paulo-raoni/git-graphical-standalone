import { describe, expect, it } from 'vitest';

import { entryAt } from '../../contracts/column-read';
import { HASH_BYTE_LENGTH, RowFlag, UNKNOWN_INDEX } from '../../contracts/index';
import type { CommitColumns, LayoutRows, PersonTable } from '../../contracts/index';

import {
  colourOfLane,
  createLayoutState,
  layoutPage,
  layoutStateByteLength,
  layoutWork,
} from './lane-layout';

/**
 * The same fixture builder as `lane-layout.test.ts`, written out again rather
 * than imported from it: importing a test module registers its suites inside
 * this one as well, which would report every shape twice and pay for them twice
 * on every mutant.
 */
const NOBODY: PersonTable = { names: [], emails: [] };

function pageTo(parents: readonly (readonly number[])[], count: number): CommitColumns {
  const parentOffsets = new Uint32Array(count + 1);
  const flat: number[] = [];
  for (const [row, list] of parents.slice(0, count).entries()) {
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

function page(parents: readonly (readonly number[])[]): CommitColumns {
  return pageTo(parents, parents.length);
}

/** A straight line of `count` commits, each the child of the one below it. */
function chain(count: number): number[][] {
  return Array.from({ length: count }, (_unused, row) => (row + 1 === count ? [] : [row + 1]));
}

/**
 * One row drawn as three lines: what crosses the upper half of its band, its own
 * level, and what crosses the lower half.
 *
 * Straight lines are drawn first and a crossing takes whichever of its two lanes
 * is still empty, because one character per lane cannot show two lines in one
 * lane; and a crossing wider than one lane shows only its ends. Both are limits
 * of the picture, not of the layout.
 */
function drawnRow(rows: LayoutRows, row: number, width: number): string[] {
  const above = new Array<string>(width).fill(' ');
  const level = new Array<string>(width).fill(' ');
  const below = new Array<string>(width).fill(' ');
  const first = entryAt(rows.segmentOffsets, row);
  const end = entryAt(rows.segmentOffsets, row + 1);
  for (let at = first; at < end; at += 1) {
    const lane = entryAt(rows.segmentFromLane, at);
    above[lane] = '|';
    if (lane === entryAt(rows.segmentToLane, at)) {
      level[lane] = '|';
      below[lane] = '|';
    }
  }
  for (let at = first; at < end; at += 1) {
    const from = entryAt(rows.segmentFromLane, at);
    const to = entryAt(rows.segmentToLane, at);
    const mark = from < to ? '\\' : '/';
    const lane = below[to] === ' ' ? to : from;
    if (from !== to && below[lane] === ' ') {
      below[lane] = mark;
    }
  }
  level[entryAt(rows.laneIndex, row)] =
    (entryAt(rows.flags, row) & RowFlag.Merge) === 0 ? '*' : 'M';
  return [above.join('').trimEnd(), level.join('').trimEnd(), below.join('').trimEnd()];
}

/**
 * The whole layout drawn as text. It is here to be **read**, not only asserted:
 * a layout can satisfy every assertion in this folder and still draw a graph
 * nobody can follow, and no assertion catches that.
 */
function drawn(rows: LayoutRows): string {
  const lines: string[] = [];
  for (let row = 0; row < rows.rowCount; row += 1) {
    lines.push(...drawnRow(rows, row, rows.maxLane + 1));
  }
  return lines.join('\n');
}

/** Every array of `whole`, against the two calls that should append to it. */
function expectAppendsTo(whole: LayoutRows, first: LayoutRows, second: LayoutRows): void {
  expect(first.rowCount + second.rowCount).toBe(whole.rowCount);
  expect([...first.laneIndex, ...second.laneIndex]).toEqual([...whole.laneIndex]);
  expect([...first.colourIndex, ...second.colourIndex]).toEqual([...whole.colourIndex]);
  expect([...first.flags, ...second.flags]).toEqual([...whole.flags]);
  expect([...first.segmentFromLane, ...second.segmentFromLane]).toEqual([...whole.segmentFromLane]);
  expect([...first.segmentToLane, ...second.segmentToLane]).toEqual([...whole.segmentToLane]);
  expect([...first.segmentColour, ...second.segmentColour]).toEqual([...whole.segmentColour]);
  const shift = entryAt(first.segmentOffsets, first.rowCount);
  const tail = [...second.segmentOffsets].slice(1).map((offset) => offset + shift);
  expect([...first.segmentOffsets, ...tail]).toEqual([...whole.segmentOffsets]);
  expect(Math.max(first.maxLane, second.maxLane)).toBe(whole.maxLane);
}

/**
 * A branch and a merge in one page: row 0 merges in the branch that leaves it at
 * row 3, the two sides meet again at the commit they share in row 5, and below
 * that the history is one line down to its root.
 */
const BRANCHED = [[1, 3], [2], [5], [4], [5], [6], []];

/**
 * Three branches, the middle one ending at row 4 while the right-hand one runs
 * on: split after row 4 and the page below starts with a hole in its lanes,
 * which is the state a page boundary is least likely to be tested at.
 */
const HOLED = [[3], [4], [5], [6], [], [6], []];

describe('a branching and merging page, drawn', () => {
  it('reads as one branch leaving a merge and rejoining below it', () => {
    expect(drawn(layoutPage(createLayoutState(), page(BRANCHED), 0))).toBe(
      [
        '|', // row 0, the merge: its own line above, and the second parent
        'M', //        leaning out to the right into lane one
        '|\\',
        '||', // row 1
        '*|',
        '||',
        '||', // row 2
        '*|',
        '||',
        '||', // row 3, the branch's tip, in lane one
        '|*',
        '||',
        '||', // row 4
        '|*',
        '||',
        '||', // row 5, where the branch comes back into the lane it left
        '*',
        '|/',
        '|', // row 6, the root
        '*',
        '|',
      ].join('\n'),
    );
  });
});

describe('laying a page out in more than one call', () => {
  it('produces exactly what one call produces, at every split point', () => {
    for (const shape of [BRANCHED, HOLED]) {
      const whole = layoutPage(createLayoutState(), page(shape), 0);
      for (let split = 0; split <= shape.length; split += 1) {
        const state = createLayoutState();
        const first = layoutPage(state, pageTo(shape, split), 0);
        const second = layoutPage(state, page(shape), split);
        expectAppendsTo(whole, first, second);
      }
    }
  });

  it('leaves a lane waiting when the page below still has not loaded its parent', () => {
    const state = createLayoutState();
    layoutPage(state, pageTo([[9], [9]], 1), 0);
    const second = layoutPage(state, pageTo([[9], [9]], 2), 1);
    expect([...second.laneIndex]).toEqual([1]);
    expect(second.maxLane).toBe(1);
  });

  it('keeps a lane descending when its parent turns out to be a row gone past', () => {
    const state = createLayoutState();
    layoutPage(state, pageTo([[9]], 1), 0);
    const second = layoutPage(state, page([[0], []]), 1);
    expect([...second.laneIndex]).toEqual([1]);
    expect([...second.segmentOffsets]).toEqual([0, 1]);
  });

  it('refuses a page that does not start where the last one ended', () => {
    const state = createLayoutState();
    layoutPage(state, page([[]]), 0);
    expect(() => layoutPage(state, page([[], []]), 0)).toThrow(
      new RangeError('layout was told 0 rows were laid out, having laid out 1'),
    );
  });

  it('refuses a page with fewer commits than it has already laid out', () => {
    const state = createLayoutState();
    layoutPage(state, page([[], []]), 0);
    expect(() => layoutPage(state, page([[]]), 2)).toThrow(
      new RangeError('layout was given 1 commits, fewer than the 2 already laid out'),
    );
  });
});

describe('the colour of a lane', () => {
  it('is the lane itself, narrowed to what the contract can carry', () => {
    expect(colourOfLane(0)).toBe(0);
    expect(colourOfLane(7)).toBe(7);
    expect(colourOfLane(255)).toBe(255);
    expect(colourOfLane(256)).toBe(0);
    expect(colourOfLane(257)).toBe(1);
  });

  it('cycles once the graph is wider than the contract has indices', () => {
    const shape = Array.from({ length: 300 }, () => [999]);
    const rows = layoutPage(createLayoutState(), pageTo(shape, 300), 0);
    expect(rows.maxLane).toBe(299);
    expect(entryAt(rows.laneIndex, 256)).toBe(256);
    expect(entryAt(rows.colourIndex, 256)).toBe(0);
    expect(entryAt(rows.colourIndex, 257)).toBe(1);
  });
});

describe('the work counters', () => {
  it('count every row, parent, lane slot and segment the pass touched', () => {
    const state = createLayoutState();
    layoutPage(state, page([[1], [2], []]), 0);
    expect(state.counters).toEqual({ rows: 3, parentEdges: 2, laneVisits: 6, segments: 3 });
    expect(layoutWork(state)).toBe(14);
  });

  // The lane visits are what a quadratic pass would show up in, so they are
  // asserted exactly rather than as a bound, on a shape whose second lane is
  // freed in the middle: the rows below it must walk one lane, not two.
  it('narrow the walk again once the widest lane is free', () => {
    const state = createLayoutState();
    layoutPage(state, page([[4], [2], [], [4], []]), 0);
    expect(state.counters).toEqual({ rows: 5, parentEdges: 3, laneVisits: 20, segments: 9 });
  });

  // A hole opens at lane one in row 3 and the rightmost lane is freed in row 4,
  // so from row 5 the walk is one lane wide again. A table that counted the hole
  // as its edge would walk two for the rest of the page.
  it('narrow the walk past a hole the widest lane left behind', () => {
    const state = createLayoutState();
    layoutPage(state, page([[6], [3], [4], [], [], [6], []]), 0);
    expect(state.counters).toEqual({ rows: 7, parentEdges: 4, laneVisits: 36, segments: 15 });
  });

  it('count the walk that resolves a waiting lane when a page is appended', () => {
    const state = createLayoutState();
    layoutPage(state, pageTo([[1], [2], []], 2), 0);
    expect(state.counters).toEqual({ rows: 2, parentEdges: 2, laneVisits: 4, segments: 2 });
    layoutPage(state, page([[1], [2], []]), 2);
    expect(state.counters).toEqual({ rows: 3, parentEdges: 2, laneVisits: 7, segments: 3 });
  });

  // Five hundred and two thousand rather than ten and forty thousand: the
  // mutation gate runs this suite once per mutant, and a mutant that stops lanes
  // being freed makes this shape cost the square of its row count. The ratio the
  // counters give is exact at any size, and the sizes the slice document reports
  // were measured outside this suite for that reason.
  it('grow with the rows and not with their square', () => {
    const small = createLayoutState();
    layoutPage(small, page(chain(500)), 0);
    const large = createLayoutState();
    layoutPage(large, page(chain(2000)), 0);
    const ratio = layoutWork(large) / layoutWork(small);
    expect(ratio).toBeGreaterThan(3.9);
    expect(ratio).toBeLessThan(4.1);
  });

  // Eight lanes of four bytes of target and four of parent entry: the table a
  // fresh state starts with, and the one two thousand rows of a single lane
  // leave it with.
  it('carry a state proportional to the lanes, not to the rows', () => {
    const state = createLayoutState();
    expect(layoutStateByteLength(state)).toBe(64);
    layoutPage(state, page(chain(2000)), 0);
    expect(layoutStateByteLength(state)).toBe(64);
  });
});
