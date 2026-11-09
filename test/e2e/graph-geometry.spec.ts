import { expect, test } from '@playwright/test';

import { entryAt } from '../../src/contracts/column-read';
import { HASH_BYTE_LENGTH, RowFlag, UNCOMMITTED_COLOUR } from '../../src/contracts/index';
import type { CommitColumns, LayoutRows } from '../../src/contracts/index';
import { createLayoutState, layoutPage, openUncommittedLine } from '../../src/core/layout/index';
import { appendRows, createRowBlock, layoutRowsOf } from '../../src/core/page/index';
import {
  drawnRowCount,
  firstDrawnRow,
  graphColumnWidth,
  GRAPH_PADDING,
  laneCentreX,
  LANE_WIDTH,
  OVERSCAN_ROWS,
  ROW_HEIGHT,
  rowInSlot,
  rowPoolSize,
  rowTopY,
  segmentLines,
  uncommittedArrival,
  vertexRowAt,
  visibleRowCount,
} from '../../src/ui/geometry';
import { laneColour, LANE_COLOUR_COUNT, UNCOMMITTED_GREY } from '../../src/ui/palette';

/**
 * The arithmetic the view is made of, with no window anywhere near it.
 *
 * **Why these are here and not beside the code they test.** They belong in
 * `src/ui/*.test.ts`, which is what E01-M01-S05's task asked for, and S05
 * could not put them there: `.dependency-cruiser.cjs` then let `src/ui/` name
 * `src/contracts/` and `src/ui/` and nothing else, with no carve-out for a
 * colocated test of the kind `core/` and `contracts/` each had, so a
 * `src/ui/geometry.test.ts` importing `vitest` failed `gates:boundaries` —
 * measured by S05's lane, one error — and that rule's file was outside S05's
 * boundary. E01-M01-S06 has since added the carve-out,
 * `ui-tests-only-the-runner`, so such a file now passes the gate, and moving
 * these suites home is scheduled in `docs/PLAN.md`'s table *Gate work deferred
 * past the first milestone*. Until then they run on Playwright's runner,
 * against the same modules, and need no browser:
 * `src/ui/geometry.ts` and `src/ui/palette.ts` hold no DOM reference, which is
 * the property that makes this possible and is stated in both files.
 */

/** Three rows in three lanes, which is all a hit test needs to be wrong about. */
const THREE_ROWS: LayoutRows = {
  rowCount: 3,
  laneIndex: Uint16Array.of(0, 2, 1),
  colourIndex: Uint8Array.of(0, 2, 1),
  flags: new Uint8Array(3),
  maxLane: 2,
  segmentOffsets: Uint32Array.of(0, 1, 2, 3),
  segmentFromLane: Uint16Array.of(0, 2, 1),
  segmentToLane: Uint16Array.of(0, 2, 1),
  segmentColour: Uint8Array.of(0, 2, 1),
};

test('the pool is the viewport plus its overscan, and knows nothing of the page', () => {
  expect(visibleRowCount(10 * ROW_HEIGHT)).toBe(11);
  expect(visibleRowCount(10 * ROW_HEIGHT + 1)).toBe(12);
  expect(rowPoolSize(10 * ROW_HEIGHT)).toBe(11 + 2 * OVERSCAN_ROWS);
  expect(rowPoolSize(0)).toBe(1 + 2 * OVERSCAN_ROWS);
});

test('the drawn window is clamped at the top of the page and at its foot', () => {
  const height = 10 * ROW_HEIGHT;
  const size = rowPoolSize(height);
  expect(firstDrawnRow(0, height, 1000)).toBe(0);
  expect(firstDrawnRow(ROW_HEIGHT, height, 1000)).toBe(0);
  expect(firstDrawnRow(20 * ROW_HEIGHT, height, 1000)).toBe(20 - OVERSCAN_ROWS);
  expect(firstDrawnRow(999 * ROW_HEIGHT, height, 1000)).toBe(1000 - size);
  expect(firstDrawnRow(0, height, 5)).toBe(0);
  expect(drawnRowCount(0, height, 5)).toBe(5);
  expect(drawnRowCount(1000 - size, height, 1000)).toBe(size);
});

test('every slot holds one row of the drawn window, and the rest hold none', () => {
  const size = 7;
  for (const first of [0, 1, 6, 7, 13]) {
    const held = Array.from({ length: size }, (_unused, slot) =>
      rowInSlot(slot, first, size, size),
    );
    expect([...held].sort((left, right) => left - right)).toEqual(
      Array.from({ length: size }, (_unused, at) => first + at),
    );
  }
  const short = Array.from({ length: size }, (_unused, slot) => rowInSlot(slot, 3, 2, size));
  expect(short.filter((row) => row >= 0)).toEqual([3, 4]);
  expect(short.filter((row) => row === -1)).toHaveLength(size - 2);
});

test('the graph column is as wide as its page needs, between two bounds', () => {
  expect(graphColumnWidth(3)).toBe(2 * GRAPH_PADDING + 3 * LANE_WIDTH);
  expect(graphColumnWidth(0)).toBe(64);
  expect(graphColumnWidth(400)).toBe(320);
  expect(laneCentreX(0)).toBe(GRAPH_PADDING);
  expect(laneCentreX(3)).toBe(GRAPH_PADDING + 3 * LANE_WIDTH);
});

/** One row, its vertex in lane 0, carrying the given segments and flags. */
function oneRow(flags: number, segments: readonly (readonly [number, number])[]): LayoutRows {
  return {
    rowCount: 1,
    laneIndex: Uint16Array.of(0),
    colourIndex: Uint8Array.of(0),
    flags: Uint8Array.of(flags),
    maxLane: 2,
    segmentOffsets: Uint32Array.of(0, segments.length),
    segmentFromLane: Uint16Array.from(segments.map(([from]) => from)),
    segmentToLane: Uint16Array.from(segments.map(([, to]) => to)),
    segmentColour: new Uint8Array(segments.length),
  };
}

/**
 * Every half `segmentLines` writes for a page drawn from scroll offset 0, as
 * the row it is painted in and its four points: start, two control points, end.
 */
function halvesOf(rows: LayoutRows): { row: number; points: number[] }[] {
  const into = new Array<number>(14).fill(0);
  const halves: { row: number; points: number[] }[] = [];
  for (let row = 0; row < rows.rowCount; row += 1) {
    const last = entryAt(rows.segmentOffsets, row + 1);
    for (let segment = entryAt(rows.segmentOffsets, row); segment < last; segment += 1) {
      const count = segmentLines(into, rows, row, segment, rowTopY(row, 0));
      for (let half = 0; half < count; half += 1) {
        const at = 2 + 6 * half;
        halves.push({ row, points: [...into.slice(at - 2, at), ...into.slice(at, at + 6)] });
      }
    }
  }
  return halves;
}

/** The halves that are not straight, which are the halves of every curve drawn. */
function curvesOf(rows: LayoutRows): { row: number; points: number[] }[] {
  return inOrder(halvesOf(rows).filter(({ points }) => points[0] !== points[6]));
}

/** Halves by row, then by their points, so that two lists can be compared. */
function inOrder(halves: { row: number; points: number[] }[]): { row: number; points: number[] }[] {
  const key = ({ row, points }: { row: number; points: number[] }): string =>
    [String(row).padStart(4, '0'), ...points.map(String)].join(' ');
  return [...halves].sort((left, right) => key(left).localeCompare(key(right)));
}

/**
 * The curve the reference extension was seen to draw for a change of lane, cut
 * at its middle into the half each of two rows paints.
 *
 * From the centre of row `row` in `fromLane` to the centre of the next row in
 * `toLane`, with its two control points straight below its start and straight
 * above its end at the height of the boundary between the rows: vertical at both
 * ends, symmetric about its middle, one row high however wide. The two halves are
 * de Casteljau's cut at one half, computed here from the whole curve's four
 * points rather than from any formula in `src/ui/geometry.ts`.
 */
function sCurve(
  row: number,
  fromLane: number,
  toLane: number,
): { row: number; points: number[] }[] {
  const ya = rowTopY(row, 0) + ROW_HEIGHT / 2;
  const yb = ya + ROW_HEIGHT;
  const boundary = (ya + yb) / 2;
  const p = [
    [laneCentreX(fromLane), ya],
    [laneCentreX(fromLane), boundary],
    [laneCentreX(toLane), boundary],
    [laneCentreX(toLane), yb],
  ];
  const mid = (a: number[], b: number[]): number[] =>
    a.map((value, at) => (value + (b[at] ?? 0)) / 2);
  const [p0 = [], p1 = [], p2 = [], p3 = []] = p;
  const p01 = mid(p0, p1);
  const p12 = mid(p1, p2);
  const p23 = mid(p2, p3);
  const p012 = mid(p01, p12);
  const p123 = mid(p12, p23);
  const centre = mid(p012, p123);
  return [
    { row, points: [...p0, ...p01, ...p012, ...centre] },
    { row: row + 1, points: [...centre, ...p123, ...p23, ...p3] },
  ];
}

/**
 * A page built from its parent lists alone and laid out by the real layout pass,
 * which reads nothing else (`src/core/layout/lane-layout.test.ts` builds its
 * fixtures the same way).
 */
function laidOut(parents: readonly (readonly number[])[]): LayoutRows {
  return layoutPage(createLayoutState(), columnsOf(parents), 0);
}

/** The commits of a page built from its parent lists alone. */
function columnsOf(parents: readonly (readonly number[])[]): CommitColumns {
  const count = parents.length;
  const parentOffsets = new Uint32Array(count + 1);
  parents.forEach(
    (list, row) => (parentOffsets[row + 1] = entryAt(parentOffsets, row) + list.length),
  );
  const columns: CommitColumns = {
    count,
    hashes: new Uint8Array(count * HASH_BYTE_LENGTH),
    parentOffsets,
    parentIndices: Uint32Array.from(parents.flat()),
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
  return columns;
}

test('a straight segment spans the band, and the vertex lane obeys the clip bits', () => {
  const into = new Array<number>(14).fill(0);
  const top = 100;
  const middle = top + ROW_HEIGHT / 2;
  const foot = top + ROW_HEIGHT;
  const both = RowFlag.ClipAboveVertex | RowFlag.ClipBelowVertex;
  const x = laneCentreX(2);
  expect(segmentLines(into, oneRow(both, [[2, 2]]), 0, 0, top)).toBe(2);
  expect(into).toEqual([
    x,
    top,
    x,
    top + 3,
    x,
    top + 6,
    x,
    middle,
    x,
    middle + 6,
    x,
    foot - 3,
    x,
    foot,
  ]);
  const centre = laneCentreX(0);
  expect(segmentLines(into, oneRow(0, [[0, 0]]), 0, 0, top)).toBe(2);
  expect([into[0], into[1], into[6], into[7], into[12], into[13]]).toEqual([
    centre,
    top,
    centre,
    middle,
    centre,
    foot,
  ]);
  expect(segmentLines(into, oneRow(RowFlag.ClipAboveVertex, [[0, 0]]), 0, 0, top)).toBe(1);
  expect([into[0], into[1], into[6], into[7]]).toEqual([centre, middle, centre, foot]);
  expect(segmentLines(into, oneRow(RowFlag.ClipBelowVertex, [[0, 0]]), 0, 0, top)).toBe(1);
  expect([into[0], into[1], into[6], into[7]]).toEqual([centre, top, centre, middle]);
  expect(segmentLines(into, oneRow(both, [[0, 0]]), 0, 0, top)).toBe(0);
});

test('a line arriving at a vertex or born at one stops at its centre', () => {
  const into = new Array<number>(14).fill(0);
  const top = 48;
  const middle = top + ROW_HEIGHT / 2;
  expect(segmentLines(into, oneRow(0, [[2, 0]]), 0, 0, top)).toBe(1);
  expect([into[6], into[7]]).toEqual([laneCentreX(0), middle]);
  expect(segmentLines(into, oneRow(0, [[0, 2]]), 0, 0, top)).toBe(1);
  expect([into[0], into[1]]).toEqual([laneCentreX(0), middle]);
  expect(segmentLines(into, oneRow(0, [[1, 2]]), 0, 0, top)).toBe(2);
});

test("a merge's line curves out in the gap below the merge's dot, then runs straight", () => {
  // Row 0 merges row 4, which sits in lane 1; rows 1 to 3 are the first parents.
  const rows = laidOut([[1, 4], [2], [3], [5], [5], []]);
  expect([...rows.laneIndex]).toEqual([0, 0, 0, 0, 1, 0]);
  expect(curvesOf(rows)).toEqual(inOrder([...sCurve(0, 0, 1), ...sCurve(4, 1, 0)]));
});

test('a branch curves into the commit it forks from in the gap above that commit', () => {
  // Rows 1 to 4 are a branch in lane 1 that forks from row 5; row 0 is in lane 0.
  const rows = laidOut([[5], [2], [3], [4], [5], []]);
  expect([...rows.laneIndex]).toEqual([0, 1, 1, 1, 1, 0]);
  expect(curvesOf(rows)).toEqual(sCurve(4, 1, 0));
});

test('a move across three lanes is one row high, as a move across one is, and only wider', () => {
  // Tips in lanes 0 to 3; the line of lane 3 joins lane 0's commit at row 4.
  const rows = laidOut([[4], [5], [5], [4], [5], []]);
  expect([...rows.laneIndex]).toEqual([0, 1, 2, 3, 0, 0]);
  const curves = curvesOf(rows);
  expect(curves).toEqual(inOrder([...sCurve(3, 3, 0), ...sCurve(4, 1, 0), ...sCurve(4, 2, 0)]));
  for (const { points } of curves) {
    expect(Math.abs((points[7] ?? 0) - (points[1] ?? 0))).toBe(ROW_HEIGHT / 2);
  }
});

test('a vertex is hit by arithmetic, and only where one is drawn', () => {
  const scrollTop = 2 * ROW_HEIGHT;
  const centreY = 1 * ROW_HEIGHT - scrollTop + ROW_HEIGHT / 2;
  const centreX = laneCentreX(2);
  expect(vertexRowAt(centreX, centreY, scrollTop, THREE_ROWS)).toBe(1);
  expect(vertexRowAt(centreX + 8, centreY, scrollTop, THREE_ROWS)).toBe(-1);
  expect(vertexRowAt(laneCentreX(0), centreY, scrollTop, THREE_ROWS)).toBe(-1);
  expect(vertexRowAt(centreX, -100, scrollTop, THREE_ROWS)).toBe(-1);
  expect(vertexRowAt(centreX, 10 * ROW_HEIGHT, scrollTop, THREE_ROWS)).toBe(-1);
});

test('the palette repeats past its end and never answers with nothing', () => {
  expect(laneColour(0)).toMatch(/^#[0-9a-f]{6}$/);
  expect(laneColour(LANE_COLOUR_COUNT)).toBe(laneColour(0));
  expect(laneColour(255)).toMatch(/^#[0-9a-f]{6}$/);
  const distinct = new Set(
    Array.from({ length: LANE_COLOUR_COUNT }, (_unused, at) => laneColour(at)),
  );
  expect(distinct.size).toBe(LANE_COLOUR_COUNT);
});

/**
 * The page rows a dirty working tree gives: the uncommitted row on top of rows
 * laid out under its line, opened to `head` (E04-M01-S14), assembled as
 * `src/core/page/` assembles a page.
 */
function laidOutUnder(parents: readonly (readonly number[])[], head: number): LayoutRows {
  const state = createLayoutState();
  openUncommittedLine(state, head);
  const block = createRowBlock();
  appendRows(block, layoutPage(state, columnsOf(parents), 0));
  block.uncommittedHead = head;
  return layoutRowsOf(block, true);
}

test("the uncommitted row's line runs from its ring into HEAD's dot, past a stash beside it", () => {
  // Row 1 is a stash made on row 2, HEAD's commit; row 3 is HEAD's parent.
  const rows = laidOutUnder([[1], [2], []], 1);
  expect([...rows.laneIndex]).toEqual([0, 1, 0, 0]);
  const x = laneCentreX(0);
  const lane0 = halvesOf(rows).filter(({ points }) => points[0] === x && points[6] === x);
  // From the ring's centre, which the painter clears, down to the top of HEAD's row.
  expect(lane0.filter(({ row }) => row < 2)).toEqual([
    { row: 0, points: [x, 12, x, 18, x, 21, x, 24] },
    { row: 1, points: [x, 24, x, 27, x, 30, x, 36] },
    { row: 1, points: [x, 36, x, 42, x, 45, x, 48] },
  ]);
  // HEAD's row holds the rest, from its top edge to its dot, and no segment does.
  const into = new Array<number>(4).fill(0);
  expect(uncommittedArrival(into, rows, 2, rowTopY(2, 0))).toBe(true);
  expect(into).toEqual([x, 48, x, 60]);
  for (const row of [0, 1, 3]) {
    expect(uncommittedArrival(into, rows, row, rowTopY(row, 0))).toBe(false);
  }
  expect(lane0.filter(({ row }) => row === 2)).toEqual([
    { row: 2, points: [x, 60, x, 66, x, 69, x, 72] },
  ]);
  // The stash's line leaves its ring downwards, curves into HEAD's dot, and
  // nothing is drawn above the ring.
  expect(curvesOf(rows)).toEqual(sCurve(1, 1, 0));
  const ring = laneCentreX(1);
  const aboveRing = halvesOf(rows).filter(
    ({ row, points }) => row === 1 && points[0] === ring && points[1] === 24,
  );
  expect(aboveRing).toEqual([]);
});

test("the uncommitted row's ring has no line below it while HEAD's commit is not loaded", () => {
  const block = createRowBlock();
  appendRows(block, laidOut([[1], []]));
  const rows = layoutRowsOf(block, true);
  expect(entryAt(rows.flags, 0) & RowFlag.ClipBelowVertex).toBe(RowFlag.ClipBelowVertex);
  expect(halvesOf(rows).filter(({ row }) => row === 0)).toEqual([]);
  expect(entryAt(rows.colourIndex, 0)).toBe(UNCOMMITTED_COLOUR);
  expect(laneColour(UNCOMMITTED_COLOUR)).toBe(UNCOMMITTED_GREY);
});
