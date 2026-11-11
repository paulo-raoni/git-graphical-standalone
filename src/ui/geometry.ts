import { entryAt } from '../contracts/column-read';
import { RowFlag } from '../contracts/index';
import type { LayoutRows } from '../contracts/index';

/**
 * Every number the view is made of, as arithmetic over one scroll offset.
 *
 * This module holds **no DOM reference of any kind**, and that is load-bearing
 * twice over. It is what makes the recycling scheme testable without a window,
 * and it is what lets `test/e2e/` import it into a plain Node test. Its pure
 * tests are there, on Playwright's runner, because E01-M01-S05 could not put
 * them beside it: `.dependency-cruiser.cjs` then had no carve-out for a
 * colocated test under `src/ui/`, and S05's lane measured one
 * `gates:boundaries` error for such a file. E01-M01-S06 added that carve-out,
 * `ui-tests-only-the-runner`, and a `src/ui/*.test.ts` that imports `vitest`
 * now passes the gate; moving these tests home is scheduled in
 * `docs/PLAN.md`'s table *Gate work deferred past the first milestone*.
 *
 * The cost model these numbers exist to keep is
 * `docs/ADR-0002-architecture-and-performance.md` decision 5: **what is drawn is
 * a function of the viewport and the scroll offset, and of nothing that grows
 * with the page.** Every function below takes the row count only to clamp
 * against the end of the list; none of them is proportional to it.
 */

/**
 * The height of one row, in CSS pixels.
 *
 * It is spelled here and nowhere else: `mountGraphTable` writes it onto the view
 * as the `--row-height` custom property and the stylesheet reads it from there,
 * so the arithmetic below and the element it positions cannot disagree. A
 * stylesheet holding its own copy is the version of this that breaks silently —
 * the rows would still be laid out, half a row out of step with the canvas.
 */
export const ROW_HEIGHT = 24;

/**
 * The height of the details area that opens under a row, in CSS pixels, its
 * border included (E04-M01-S09). The same for every row: the reference
 * extension's was read at about 10.4 rows, 249 pixels against a 24-pixel row, and
 * the orchestrator's choice is 250. `mountGraphTable` writes it onto the view as
 * `--details-height`, for the reason {@link ROW_HEIGHT} gives.
 */
export const DETAILS_HEIGHT = 250;

/**
 * The row that has its details open is a layout row index, or `NO_ROW` for none.
 * Every function below that places a row takes it as `open`, and moves every row
 * after the open one down by {@link DETAILS_HEIGHT}; the rows up to and
 * including it stay where they were.
 */
export const NO_ROW = -1;

/** The top edge of a row inside the scrolling content, the open area counted. */
export function rowOffsetY(row: number, open = NO_ROW): number {
  return row * ROW_HEIGHT + (open >= 0 && row > open ? DETAILS_HEIGHT : 0);
}

/** The row whose band, or whose open area, holds the content offset `y`. */
function rowAtOffset(y: number, open: number): number {
  const row = Math.floor(Math.max(y, 0) / ROW_HEIGHT);
  return open < 0 || row <= open
    ? row
    : Math.max(open, Math.floor((y - DETAILS_HEIGHT) / ROW_HEIGHT));
}

/**
 * Rows kept above and below the viewport.
 *
 * It buys two things: a row entering the view is already written and positioned
 * rather than being written during the frame that reveals it, and a scroll of up
 * to four rows in one frame reveals nothing blank. The pool is
 * `visibleRowCount + 2 × OVERSCAN_ROWS` elements, which is the count
 * `docs/ADR-0002-architecture-and-performance.md` decision 6 budgets, so raising
 * this raises that budget and is a commit that says why.
 */
export const OVERSCAN_ROWS = 4;

/** Horizontal distance between the centres of two neighbouring lanes. */
export const LANE_WIDTH = 14;

/** From the graph column's left edge to the centre of lane zero. */
export const GRAPH_PADDING = 12;

/** Radius of a commit's dot. */
export const VERTEX_RADIUS = 3.5;

/**
 * Radius of the filled disc at the centre of a stash's ring: a third of the
 * ring's width across, as the reference extension was seen to draw it
 * (E04-M01-S14). The ring itself is drawn at {@link VERTEX_RADIUS}.
 */
export const STASH_CENTRE_RADIUS = VERTEX_RADIUS / 3;

/**
 * How near a vertex a pointer counts as being on it.
 *
 * Larger than the dot that is drawn, because a 3.5-pixel target is not one a
 * person can hit; twice the drawn radius is still comfortably inside half a lane
 * (7 pixels), so two neighbouring vertices can never both answer.
 */
export const VERTEX_HIT_RADIUS = VERTEX_RADIUS * 2;

/**
 * The narrowest and widest the graph column is allowed to be drawn.
 *
 * The floor is not about the graph, which needs 38 pixels for a page one lane
 * wide: it is the column's own heading. At 48 pixels the head read `Gra…` in
 * the window this lane looked at, so the floor is the width that lets `Graph`
 * fit beside the eight pixels of padding each row's cells carry.
 */
const MIN_GRAPH_WIDTH = 64;
const MAX_GRAPH_WIDTH = 320;

/**
 * Rows a viewport of this height can show at once.
 *
 * One more than the height divides into, because a scroll offset that is not a
 * whole number of rows leaves a partial row at the top **and** at the bottom.
 */
export function visibleRowCount(viewportHeight: number): number {
  return Math.ceil(Math.max(viewportHeight, 0) / ROW_HEIGHT) + 1;
}

/**
 * Row elements the view keeps alive at this viewport height.
 *
 * This is the whole of the budget in
 * `docs/ADR-0002-architecture-and-performance.md` decision 6 — "live DOM row
 * elements ≤ viewport rows + 2 × overscan, independent of commits loaded" — and
 * the row count is deliberately not a parameter, so the guarantee is a property
 * of the signature rather than of the body.
 */
export function rowPoolSize(viewportHeight: number): number {
  return visibleRowCount(viewportHeight) + 2 * OVERSCAN_ROWS;
}

/**
 * The first row the view draws at this scroll offset.
 *
 * Clamped at both ends: never below zero, and never so far down that the pool
 * would hang off the end of the list. The upper clamp is what keeps every pool
 * element in use near the foot of a long page instead of leaving a band of
 * hidden elements there.
 *
 * With the details of row `open` showing, the row at the top of the view is the
 * one `rowAtOffset` finds, `open` itself while the view is inside its area. The
 * area only takes room from the rows, so the view still shows no more rows than
 * {@link visibleRowCount} counts and the pool still covers them.
 */
export function firstDrawnRow(
  scrollTop: number,
  viewportHeight: number,
  rowCount: number,
  open = NO_ROW,
): number {
  const lastStart = Math.max(0, rowCount - rowPoolSize(viewportHeight));
  const wanted = rowAtOffset(scrollTop, open) - OVERSCAN_ROWS;
  return Math.min(Math.max(wanted, 0), lastStart);
}

/** How many rows the view draws, which is the pool unless the page is shorter. */
export function drawnRowCount(first: number, viewportHeight: number, rowCount: number): number {
  return Math.max(0, Math.min(rowPoolSize(viewportHeight), rowCount - first));
}

/**
 * The row a pool element holds, or `-1` when it holds none.
 *
 * The assignment is `row modulo pool size`, which is what makes scrolling cheap:
 * the slot a row lands in does not depend on the scroll offset, so a scroll of
 * *k* rows rewrites *k* elements and leaves the rest untouched, whatever *k* is.
 * Over any window no longer than the pool the mapping is a bijection, which is
 * why `firstDrawnRow` clamps the window to the pool's length and never exceeds
 * it.
 */
export function rowInSlot(slot: number, first: number, count: number, size: number): number {
  const row = first + ((((slot - first) % size) + size) % size);
  return row < first + count ? row : -1;
}

/**
 * The top edge of a row, in viewport coordinates, the open area counted.
 *
 * **One of the two places the guarantee of E04-M01-S09 hangs on:** the canvas
 * takes a row's top from here and the DOM takes the same row's top from
 * {@link rowOffsetY}, the function this one subtracts the scroll offset from, so
 * the two cannot disagree about where the rows below an open area are.
 */
export function rowTopY(row: number, scrollTop: number, open = NO_ROW): number {
  return rowOffsetY(row, open) - scrollTop;
}

/** The centre of a lane, measured from the graph column's left edge. */
export function laneCentreX(lane: number): number {
  return GRAPH_PADDING + lane * LANE_WIDTH;
}

/**
 * How wide the graph column is drawn for a page this many lanes wide.
 *
 * Columns have fixed widths in this slice (E01-M02 owns resizing), so this is
 * settled once per page rather than per frame, and it is the one number about
 * the column that the page gets to decide. It is clamped at both ends: a
 * one-lane repository still gets a column wide enough to read, and a graph wider
 * than twenty lanes stops widening and has its right-hand lanes clipped by the
 * canvas rather than squeezing every text column off the window.
 */
export function graphColumnWidth(maxLane: number): number {
  const wanted = 2 * GRAPH_PADDING + Math.max(maxLane, 0) * LANE_WIDTH;
  return Math.min(Math.max(wanted, MIN_GRAPH_WIDTH), MAX_GRAPH_WIDTH);
}

/** Half a row: from a row's edge to its centre height. */
const HALF_ROW = ROW_HEIGHT / 2;

/**
 * The lane a segment's line is in at its row's centre height.
 *
 * A line arriving at the vertex is in the vertex's lane there, because that is
 * where it ends; every other line is in the lane it entered the band in, which
 * for a line born at the vertex is the vertex's lane too.
 */
function centreLane(rows: LayoutRows, segment: number, vertexLane: number): number {
  const toLane = entryAt(rows.segmentToLane, segment);
  return toLane === vertexLane ? vertexLane : entryAt(rows.segmentFromLane, segment);
}

/**
 * The lane, at the centre height of `row`, of the line that crosses `row`'s
 * bottom edge in `lane` (when `edge` is `segmentToLane`, asked of the row above)
 * or its top edge in `lane` (when `edge` is `segmentFromLane`, asked of the row
 * below).
 *
 * At most one line crosses an edge in a lane other than the vertex's: the layout
 * gives a line a lane of its own, a line born at the vertex starts at the centre
 * and not at the top edge, and a line arriving at the vertex ends at the centre
 * and not at the bottom edge. So the first segment of the row whose lane at that
 * edge is `lane` is the line's. Outside the rows, or in the vertex's own lane,
 * the answer is the lane itself: a line there meets the vertex in its own lane.
 */
function neighbourLane(rows: LayoutRows, row: number, lane: number, edge: Uint16Array): number {
  if (row < 0 || row >= rows.rowCount || lane === entryAt(rows.laneIndex, row)) {
    return lane;
  }
  const vertexLane = entryAt(rows.laneIndex, row);
  const last = entryAt(rows.segmentOffsets, row + 1);
  for (let segment = entryAt(rows.segmentOffsets, row); segment < last; segment += 1) {
    if (entryAt(edge, segment) === lane) {
      return centreLane(rows, segment, vertexLane);
    }
  }
  return lane;
}

/** No area is open beside this row, or the row is not next to one. */
export const GAP_NONE = 0;
/** The row is the open one: its details are under it. */
export const GAP_BELOW = 1;
/** The row is the one after the open one: the details are over it. */
export const GAP_ABOVE = 2;

/** Which side of an open area, if any, `row` is on. */
export function gapSide(row: number, open: number): number {
  if (open < 0) {
    return GAP_NONE;
  }
  return row === open ? GAP_BELOW : row === open + 1 ? GAP_ABOVE : GAP_NONE;
}

/** Whether the segment's line crosses the upper half of its row's band. */
function reachesTop(rows: LayoutRows, row: number, segment: number): boolean {
  const vertexLane = entryAt(rows.laneIndex, row);
  return (
    entryAt(rows.segmentFromLane, segment) !== vertexLane ||
    (entryAt(rows.segmentToLane, segment) === vertexLane &&
      (entryAt(rows.flags, row) & RowFlag.ClipAboveVertex) === 0)
  );
}

/** Whether the segment's line crosses the lower half of its row's band. */
function reachesBottom(rows: LayoutRows, row: number, segment: number): boolean {
  const vertexLane = entryAt(rows.laneIndex, row);
  return (
    entryAt(rows.segmentToLane, segment) !== vertexLane ||
    (entryAt(rows.segmentFromLane, segment) === vertexLane &&
      (entryAt(rows.flags, row) & RowFlag.ClipBelowVertex) === 0)
  );
}

/**
 * The second half of an S-curve, from the boundary above `top` to the centre of
 * the row at `top`: it starts half-way between `other` and `x` and ends vertical
 * in `x`'s lane.
 */
function upperHalf(into: number[], x: number, other: number, top: number): void {
  into[0] = (x + other) / 2;
  into[1] = top;
  piece(into, 2, (3 * x + other) / 4, top + HALF_ROW / 4, x, top + HALF_ROW / 2, x, top + HALF_ROW);
}

/** The first half of an S-curve, from the centre of the row at `top` to its foot. */
function lowerHalf(into: number[], at: number, x: number, other: number, top: number): void {
  const bottom = top + ROW_HEIGHT;
  piece(
    into,
    at,
    x,
    top + HALF_ROW + HALF_ROW / 2,
    (3 * x + other) / 4,
    bottom - HALF_ROW / 4,
    (x + other) / 2,
    bottom,
  );
}

/**
 * Turn one segment of `row` into the path that is painted, and return how many
 * halves it has: none, one or two.
 *
 * **What is written.** A start point, `x, y`, and then per half the three points
 * of one cubic Bézier piece, `c1x, c1y, c2x, c2y, x, y`, each piece starting
 * where the one before it ends. The upper half runs from the top edge to the
 * centre height and is written first; the lower half from the centre height to
 * the bottom edge. A half whose two ends share an `x` is straight, and its
 * control points lie on it. It writes into a caller's array, at most fourteen
 * numbers, because it is called once per segment per visible row per frame.
 *
 * **Which halves exist.** The segment's line crosses the top edge unless it is
 * born at the vertex, and the bottom edge unless it dies there; in the vertex's
 * own lane a straight segment is the arriving and the departing line in one, so
 * there the clip bits decide, exactly as `src/contracts/layout.ts` requires.
 * Every other lane's line crosses the whole band, whatever the clip bits say.
 *
 * **The shape (E04-M01-S15).** The reference extension draws every change of
 * lane as one S-curve from the centre height of one row to the centre height of
 * the next, vertical at both ends, with its middle on the boundary between the
 * two rows. That is a cubic from `(xa, ya)` to `(xb, yb)` whose control points are
 * `(xa, m)` and `(xb, m)`, `m` the boundary's height. A row paints the half of it
 * that lies in its band, which is the curve cut at its middle: the lower half of
 * the row above's band holds its first half, the upper half of this band its
 * second. Each half is written here exactly as that cut gives it, so the two
 * halves, painted by two rows, are one curve. The lane at the other end comes
 * from the neighbouring row's segments ({@link neighbourLane}); the layout says
 * nothing new, and a line whose two centres share a lane is straight.
 *
 * **Beside an open area (E04-M01-S09).** `side` says whether the details of the
 * row above or of this row are open. A change of lane then stays one row tall and
 * fixed to one dot, so the half of the curve that would have lain in the
 * neighbouring band is drawn by {@link gapLines}, and the half this row paints is
 * straight wherever the curve is not its own. The curve is the lower row's (the
 * line *joins* a dot below the area) when the lane the layout gives the line at
 * the boundary is the lane it has at the upper row's centre, and the upper row's
 * (the line *leaves* a dot above the area) in every other case. This is the
 * second of the two places the guarantee of that slice hangs on. Without an open
 * area `side` is {@link GAP_NONE} and nothing here differs from S15.
 */
export function segmentLines(
  into: number[],
  rows: LayoutRows,
  row: number,
  segment: number,
  rowTop: number,
  side = GAP_NONE,
): number {
  const x = laneCentreX(centreLane(rows, segment, entryAt(rows.laneIndex, row)));
  into[0] = x;
  into[1] = rowTop + HALF_ROW;
  let halves = 0;
  if (reachesTop(rows, row, segment)) {
    const fromLane = entryAt(rows.segmentFromLane, segment);
    let other = laneCentreX(neighbourLane(rows, row - 1, fromLane, rows.segmentToLane));
    if (side === GAP_ABOVE && laneCentreX(fromLane) !== other) {
      other = x;
    }
    upperHalf(into, x, other, rowTop);
    halves = 1;
  }
  if (reachesBottom(rows, row, segment)) {
    const toLane = entryAt(rows.segmentToLane, segment);
    let other = laneCentreX(neighbourLane(rows, row + 1, toLane, rows.segmentFromLane));
    if (side === GAP_BELOW && laneCentreX(toLane) === x) {
      other = x;
    }
    lowerHalf(into, 2 + 6 * halves, x, other, rowTop);
    halves += 1;
  }
  return halves;
}

/**
 * The part of one line that lies in the open area under `row`, written like
 * {@link segmentLines} writes a segment, and the number of its halves: none when
 * the segment's line does not cross the foot of `row`, otherwise two.
 *
 * `gapTop` is the area's top edge, which is `row`'s foot, in the same
 * coordinates as the row tops. The line runs the whole of the area's height
 * between `row`'s centre and the next row's, and a change of lane in it is one
 * row tall, **fixed to one dot** as the reference extension was seen to draw it
 * (E04-M01-S09, item 5):
 *
 * - *Leaving* `row`'s dot (a merge's further parent): the second half of the
 *   S-curve first, from the area's top edge to one half row inside it, then
 *   straight down the lane of the dot below.
 * - *Joining* the dot below (a branch or a stash into its parent): straight down
 *   the lane it is in, then the first half of the S-curve over the last half row
 *   of the area.
 *
 * Which of the two is {@link segmentLines}'s rule, so the halves the two rows
 * paint and the ones written here meet at the area's edges. A line in one lane
 * throughout is written as two straight halves.
 */
export function gapLines(
  into: number[],
  rows: LayoutRows,
  row: number,
  segment: number,
  gapTop: number,
): number {
  if (!reachesBottom(rows, row, segment)) {
    return 0;
  }
  const toLane = entryAt(rows.segmentToLane, segment);
  const x = laneCentreX(centreLane(rows, segment, entryAt(rows.laneIndex, row)));
  const other = laneCentreX(neighbourLane(rows, row + 1, toLane, rows.segmentFromLane));
  const bottom = gapTop + DETAILS_HEIGHT;
  if (laneCentreX(toLane) === x && x !== other) {
    const meet = bottom - HALF_ROW;
    into[0] = x;
    into[1] = gapTop;
    piece(into, 2, x, meet, x, meet, x, meet);
    lowerHalf(into, 8, x, other, bottom - ROW_HEIGHT);
  } else {
    upperHalf(into, other, x, gapTop);
    piece(into, 8, other, bottom, other, bottom, other, bottom);
  }
  return 2;
}

/**
 * The half of the uncommitted row's line that `row` paints, when it is the row
 * the line ends at: from the top edge straight down the vertex's lane to the
 * centre, written into `into` as the `x, y` of its start and of its end.
 *
 * That row carries `RowFlag.UncommittedAbove`, and is HEAD's (E04-M01-S14); the
 * answer is whether `row` is it, and a row that is not paints nothing here.
 * Every row above it down to the uncommitted row carries the line as an
 * ordinary straight segment, so this is the one half the segments do not hold.
 */
export function uncommittedArrival(
  into: number[],
  rows: LayoutRows,
  row: number,
  rowTop: number,
): boolean {
  if ((entryAt(rows.flags, row) & RowFlag.UncommittedAbove) === 0) {
    return false;
  }
  const x = laneCentreX(entryAt(rows.laneIndex, row));
  into[0] = x;
  into[1] = rowTop;
  into[2] = x;
  into[3] = rowTop + HALF_ROW;
  return true;
}

function piece(
  into: number[],
  at: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x: number,
  y: number,
): void {
  into[at] = x1;
  into[at + 1] = y1;
  into[at + 2] = x2;
  into[at + 3] = y2;
  into[at + 4] = x;
  into[at + 5] = y;
}

/**
 * The row whose vertex covers a point of the graph column, or `-1`.
 *
 * Arithmetic, not a scene graph: the row falls out of the y coordinate and the
 * lane comes from the layout, so the cost is one division and one comparison
 * however many commits are loaded
 * (`docs/ADR-0002-architecture-and-performance.md` decision 5). Both coordinates
 * are in the canvas's own frame, which is the viewport's.
 *
 * Nothing calls it yet — selection is E03 and tooltips are E01-M02 — and it is
 * here because it is the arithmetic the recycling scheme is judged against from
 * the other direction: a vertex is drawn where this says it is, or one of the two
 * is wrong. With the details of row `open` showing (E04-M01-S09) the point is
 * placed among the rows as `rowAtOffset` does, so a point inside the area is
 * the open row's and is far from its vertex, and a point under the area is on
 * the row it is drawn on.
 */
export function vertexRowAt(
  x: number,
  y: number,
  scrollTop: number,
  rows: LayoutRows,
  open = NO_ROW,
): number {
  const row = rowAtOffset(y + scrollTop, open);
  if (row < 0 || row >= rows.rowCount) {
    return -1;
  }
  const dx = x - laneCentreX(entryAt(rows.laneIndex, row));
  const dy = y - (rowTopY(row, scrollTop, open) + ROW_HEIGHT / 2);
  return dx * dx + dy * dy <= VERTEX_HIT_RADIUS * VERTEX_HIT_RADIUS ? row : -1;
}
