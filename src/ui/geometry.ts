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
 * `gates:boundaries` error for such a file. E01-M01-S06 added that carve-out, `ui-tests-only-the-runner`, and a
 * `src/ui/*.test.ts` that imports `vitest` now passes the gate; moving these
 * tests home is scheduled in `docs/PLAN.md`'s table *Gate work deferred past
 * the first milestone*.
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
 */
export function firstDrawnRow(scrollTop: number, viewportHeight: number, rowCount: number): number {
  const lastStart = Math.max(0, rowCount - rowPoolSize(viewportHeight));
  const wanted = Math.floor(Math.max(scrollTop, 0) / ROW_HEIGHT) - OVERSCAN_ROWS;
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

/** The top edge of a row, in viewport coordinates. */
export function rowTopY(row: number, scrollTop: number): number {
  return row * ROW_HEIGHT - scrollTop;
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

/**
 * Turn one segment into the lines that are actually painted, writing
 * `x0, y0, x1, y1` quadruples into `into` and returning how many it wrote.
 *
 * It writes into a caller's array rather than returning one, because it is
 * called once per segment per visible row per frame and a fresh array each time
 * is garbage the 8 ms frame budget does not need to collect.
 *
 * A segment spans the whole band unless the row says otherwise, so there are
 * four cases and the vertex decides three of them:
 *
 * - **a straight segment in a lane that is not the vertex's** crosses the whole
 *   band, whatever the clip bits say. They are about the vertex's lane only;
 *   `src/contracts/layout.ts` is explicit that a painter which clips on the
 *   segments instead leaves a gap at the foot of every page;
 * - **a straight segment in the vertex's own lane** is the arriving line and the
 *   departing line as one segment, so it is painted as two halves and each half
 *   is painted only when its clip bit is clear. That is the difference between a
 *   branch tip and a line continuing off the page, and neither bit is advice;
 * - **a segment whose lower end is the vertex's lane** is a line dying at this
 *   commit. It leans from where it entered the band down to the vertex, and
 *   stops there — drawing it to the bottom edge would put a stub below a dot it
 *   has already reached;
 * - **a segment whose upper end is the vertex's lane** is a line born at this
 *   commit, a merge's further parent. It starts at the vertex and leans out to
 *   the lane it will descend in.
 *
 * A leaning segment touching neither — which the pass in `src/core/layout/`
 * does not emit, its every lane change having one end at the vertex — is drawn
 * corner to corner, so that a future layout cannot make this function silently
 * paint nothing.
 */
export function segmentLines(
  into: number[],
  fromLane: number,
  toLane: number,
  vertexLane: number,
  flags: number,
  rowTop: number,
): number {
  const middle = rowTop + ROW_HEIGHT / 2;
  const bottom = rowTop + ROW_HEIGHT;
  const xFrom = laneCentreX(fromLane);
  const xTo = laneCentreX(toLane);
  if (fromLane !== toLane) {
    const arriving = toLane === vertexLane;
    const departing = fromLane === vertexLane;
    write(into, 0, xFrom, departing ? middle : rowTop, xTo, arriving ? middle : bottom);
    return 1;
  }
  if (fromLane !== vertexLane) {
    write(into, 0, xFrom, rowTop, xFrom, bottom);
    return 1;
  }
  let written = 0;
  if ((flags & RowFlag.ClipAboveVertex) === 0) {
    write(into, written++, xFrom, rowTop, xFrom, middle);
  }
  if ((flags & RowFlag.ClipBelowVertex) === 0) {
    write(into, written++, xFrom, middle, xFrom, bottom);
  }
  return written;
}

function write(into: number[], line: number, x0: number, y0: number, x1: number, y1: number): void {
  into[line * 4] = x0;
  into[line * 4 + 1] = y0;
  into[line * 4 + 2] = x1;
  into[line * 4 + 3] = y1;
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
 * Nothing in this slice calls it — selection is E03 and tooltips are E01-M02 —
 * and it is here because it is the arithmetic the recycling scheme is judged
 * against from the other direction: a vertex is drawn where this says it is, or
 * one of the two is wrong.
 */
export function vertexRowAt(x: number, y: number, scrollTop: number, rows: LayoutRows): number {
  const row = Math.floor((y + scrollTop) / ROW_HEIGHT);
  if (row < 0 || row >= rows.rowCount) {
    return -1;
  }
  const dx = x - laneCentreX(entryAt(rows.laneIndex, row));
  const dy = y - (rowTopY(row, scrollTop) + ROW_HEIGHT / 2);
  return dx * dx + dy * dy <= VERTEX_HIT_RADIUS * VERTEX_HIT_RADIUS ? row : -1;
}
