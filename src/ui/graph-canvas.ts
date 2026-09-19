import { entryAt } from '../contracts/column-read';
import type { GraphPage, LayoutRows } from '../contracts/index';

import { laneCentreX, rowTopY, ROW_HEIGHT, segmentLines, VERTEX_RADIUS } from './geometry';
import { laneColour } from './palette';

/**
 * The graph column, painted on **one canvas the size of the viewport**.
 *
 * Not the size of the content: a canvas as tall as two hundred thousand rows is
 * a texture no machine will allocate, and one canvas per row is the
 * element-per-row cost this whole design exists to avoid (`docs/ADR-0001-stack.md`
 * Axis 2, `docs/ADR-0002-architecture-and-performance.md` decision 5). So the
 * canvas does not scroll. It is positioned over the scrolling area and repainted
 * from the layout buffers with the scroll offset subtracted, which is why
 * `paintGraph` takes `scrollTop` and why every y below is in viewport
 * coordinates.
 *
 * The cost of one paint is the rows on screen times their segments, and nothing
 * else is read: no row above the viewport is touched, and a page ten times
 * longer paints the same number of lines.
 *
 * **The stylesheet gives the canvas an explicit height, and must.** A canvas is
 * a replaced element, so with `height: auto` it takes its intrinsic size and
 * `bottom` is ignored: measured in this lane, a canvas stretched between
 * `top: 24px` and `bottom: 0` inside a 681-pixel box came out **100 by 50**,
 * its default 2:1 ratio against the width it was given. Everything downstream
 * still worked and was simply wrong — ten pool elements instead of thirty-seven,
 * a viewport the arithmetic believed was one row tall — which is why the
 * end-to-end gate asserts the live row count against a bound it computes from
 * the measured height rather than against a number written down here.
 */

/** Width of a drawn line, in CSS pixels. */
const LINE_WIDTH = 1.6;

/**
 * Scratch for `segmentLines`, which writes at most two lines of four numbers.
 *
 * Module-level and reused, which is the one piece of state in this file. It is
 * safe because a paint runs synchronously from its first line to its last and
 * nothing it calls can re-enter it, and it is here because the alternative — a
 * fresh array per segment per row per frame — is a few thousand short-lived
 * allocations a second while a finger is on the wheel.
 */
const scratch: number[] = [0, 0, 0, 0, 0, 0, 0, 0];

/**
 * Match the canvas's backing store to its box and to the display.
 *
 * `devicePixelRatio` is read on every paint rather than watched, because it is
 * one property read and it is the only thing correct under every way it can
 * move: a window dragged to a second monitor, an operating-system scaling change
 * and a browser zoom all land here, and not all three need fire a resize of the
 * element. Assigning `width` or `height` also clears the canvas and resets its
 * transform, so both are assigned only when they are actually wrong.
 */
export function resizeCanvas(canvas: HTMLCanvasElement, width: number, height: number): void {
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

/** Every line of one row, in its lanes' colours. */
function paintRow(
  context: CanvasRenderingContext2D,
  rows: LayoutRows,
  row: number,
  top: number,
): void {
  const vertexLane = entryAt(rows.laneIndex, row);
  const flags = entryAt(rows.flags, row);
  const last = entryAt(rows.segmentOffsets, row + 1);
  for (let segment = entryAt(rows.segmentOffsets, row); segment < last; segment += 1) {
    const lines = segmentLines(
      scratch,
      entryAt(rows.segmentFromLane, segment),
      entryAt(rows.segmentToLane, segment),
      vertexLane,
      flags,
      top,
    );
    context.strokeStyle = laneColour(entryAt(rows.segmentColour, segment));
    context.beginPath();
    for (let line = 0; line < lines; line += 1) {
      context.moveTo(entryAt(scratch, line * 4), entryAt(scratch, line * 4 + 1));
      context.lineTo(entryAt(scratch, line * 4 + 2), entryAt(scratch, line * 4 + 3));
    }
    context.stroke();
  }
}

/**
 * The commit's own dot.
 *
 * Filled for a commit and hollow for the uncommitted-changes row. The reference
 * behaviour this task carries says only that the uncommitted row sits above
 * every commit, so the distinction is this lane's: an outline reads as a place
 * where a commit is not yet, and it costs nothing a filled dot would not.
 *
 * Which row that is comes from `workingTree.hasChanges`, not from
 * `RowFlag.Uncommitted`, for the reason `./row-model` gives: `hasChanges` is
 * what `src/contracts/graph-page.ts` makes the two row counts differ by, and the
 * flag belongs to the caller that prepends the row. Reading the two differently
 * is how the dot and the description end up disagreeing about the same row.
 */
function paintVertex(
  context: CanvasRenderingContext2D,
  rows: LayoutRows,
  row: number,
  top: number,
  uncommitted: boolean,
): void {
  const colour = laneColour(entryAt(rows.colourIndex, row));
  context.beginPath();
  context.arc(
    laneCentreX(entryAt(rows.laneIndex, row)),
    top + ROW_HEIGHT / 2,
    VERTEX_RADIUS,
    0,
    Math.PI * 2,
  );
  if (uncommitted) {
    context.strokeStyle = colour;
    context.stroke();
    return;
  }
  context.fillStyle = colour;
  context.fill();
}

/**
 * Paint `count` rows starting at `first`, and nothing else.
 *
 * The caller has already decided which rows those are, from the scroll offset
 * and the viewport height (`./geometry`), so this reads exactly that slice of
 * the layout arrays. It is the whole of the drawing cost, and it is proportional
 * to the viewport.
 */
export function paintGraph(
  context: CanvasRenderingContext2D,
  page: GraphPage,
  first: number,
  count: number,
  scrollTop: number,
  ratio: number,
): void {
  const rows = page.layout;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, context.canvas.width / ratio, context.canvas.height / ratio);
  context.lineWidth = LINE_WIDTH;
  context.lineCap = 'round';
  for (let row = first; row < first + count; row += 1) {
    const top = rowTopY(row, scrollTop);
    paintRow(context, rows, row, top);
    paintVertex(context, rows, row, top, row === 0 && page.workingTree.hasChanges);
  }
}
