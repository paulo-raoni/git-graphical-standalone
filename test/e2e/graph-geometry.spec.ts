import { expect, test } from '@playwright/test';

import { RowFlag } from '../../src/contracts/index';
import type { LayoutRows } from '../../src/contracts/index';
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
  segmentLines,
  vertexRowAt,
  visibleRowCount,
} from '../../src/ui/geometry';
import { laneColour, LANE_COLOUR_COUNT } from '../../src/ui/palette';

/**
 * The arithmetic the view is made of, with no window anywhere near it.
 *
 * **Why these are here and not beside the code they test.** They belong in
 * `src/ui/*.test.ts`, which is what E01-M01-S05's task asks for.
 * `.dependency-cruiser.cjs` forbids it: `ui-only-contracts` lets `src/ui/` name
 * `src/contracts/` and `src/ui/` and nothing else, with no carve-out for a
 * colocated test of the kind `core/` and `contracts/` each have, so a
 * `src/ui/geometry.test.ts` importing `vitest` fails `gates:boundaries` —
 * measured in this lane, one error, and that rule's file is outside the task's
 * boundary. `AUDIT-S05-graph-table-renderer.md` raises it. They run on
 * Playwright's runner instead, against the same modules, and need no browser:
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

test('a straight segment spans the band, and the vertex lane obeys the clip bits', () => {
  const into = [0, 0, 0, 0, 0, 0, 0, 0];
  const top = 100;
  const middle = top + ROW_HEIGHT / 2;
  const foot = top + ROW_HEIGHT;
  expect(segmentLines(into, 2, 2, 0, RowFlag.ClipAboveVertex | RowFlag.ClipBelowVertex, top)).toBe(
    1,
  );
  expect(into.slice(0, 4)).toEqual([laneCentreX(2), top, laneCentreX(2), foot]);
  expect(segmentLines(into, 0, 0, 0, 0, top)).toBe(2);
  const centre = laneCentreX(0);
  expect(into.slice(0, 8)).toEqual([centre, top, centre, middle, centre, middle, centre, foot]);
  expect(segmentLines(into, 0, 0, 0, RowFlag.ClipAboveVertex, top)).toBe(1);
  expect(into.slice(0, 4)).toEqual([centre, middle, centre, foot]);
  expect(segmentLines(into, 0, 0, 0, RowFlag.ClipBelowVertex, top)).toBe(1);
  expect(into.slice(0, 4)).toEqual([centre, top, centre, middle]);
  const both = RowFlag.ClipAboveVertex | RowFlag.ClipBelowVertex;
  expect(segmentLines(into, 0, 0, 0, both, top)).toBe(0);
});

test('a leaning segment stops at the vertex it arrives at or leaves', () => {
  const into = [0, 0, 0, 0, 0, 0, 0, 0];
  const top = 48;
  const middle = top + ROW_HEIGHT / 2;
  expect(segmentLines(into, 2, 0, 0, 0, top)).toBe(1);
  expect(into.slice(0, 4)).toEqual([laneCentreX(2), top, laneCentreX(0), middle]);
  expect(segmentLines(into, 0, 2, 0, 0, top)).toBe(1);
  expect(into.slice(0, 4)).toEqual([laneCentreX(0), middle, laneCentreX(2), top + ROW_HEIGHT]);
  expect(segmentLines(into, 1, 2, 0, 0, top)).toBe(1);
  expect(into.slice(0, 4)).toEqual([laneCentreX(1), top, laneCentreX(2), top + ROW_HEIGHT]);
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
