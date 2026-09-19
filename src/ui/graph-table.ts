import { entryAt } from '../contracts/column-read';
import type { GraphPage } from '../contracts/index';

import {
  drawnRowCount,
  firstDrawnRow,
  graphColumnWidth,
  rowInSlot,
  rowPoolSize,
  ROW_HEIGHT,
} from './geometry';
import { paintGraph, resizeCanvas } from './graph-canvas';
import { createRowElement, writeRow } from './row-element';
import type { RowElement } from './row-element';
import { rowViewAt } from './row-model';

/**
 * The virtualised table: a fixed pool of row elements over a spacer, and one
 * viewport-sized canvas for the graph column.
 *
 * **Three invariants, and the whole slice rests on them.**
 *
 * 1. *Live elements are a function of the viewport.* The pool holds
 *    `rowPoolSize(viewport height)` elements and is rebuilt only when that
 *    number changes, which is a resize. Nothing in `paint` creates or destroys
 *    one, so scrolling a page of two hundred thousand rows holds the same
 *    forty-odd elements as scrolling a page of twenty.
 * 2. *One redraw per frame at most.* Every trigger calls the view's `schedule`,
 *    which requests an animation frame only when one is not already pending, so
 *    two scroll events in a frame paint once. The half that matters more is the
 *    other one: **nothing schedules anything when nothing happens.** There is no
 *    interval, no polling and no animation loop, so an idle window does no work
 *    at all, which is a budget of
 *    `docs/ADR-0002-architecture-and-performance.md` decision 6 and not a
 *    preference.
 * 3. *Read, then write.* `paint` takes every measurement it needs from the DOM
 *    before it writes anything, and writes nothing it then reads back. The
 *    alternation is what turns a scroll handler into a forced layout per row.
 *
 * The functions below take their state as a parameter rather than closing over
 * it, so that each one is short enough to read whole; `mountGraphTable` is the
 * only place the two halves are tied together.
 */

/** The product's display name, as the window shows it. */
const APPLICATION_NAME = 'Git Graphical Standalone';

/** What the window says when it has nothing to draw. */
const EMPTY_STATE_MESSAGE = 'No repository is open.';

/** What the control below the last row says. */
const LOAD_MORE_LABEL = 'Load More Commits';

/** The five column headings, left to right. */
const HEADINGS = ['Graph', 'Description', 'Date', 'Author', 'Commit'];

/**
 * What this module hands S06.
 *
 * Deliberately two functions and no state of the caller's: S06 owns the page,
 * asks for it to be drawn, and is told when the user wants more. The view
 * answers no question about a repository and reaches for nothing — it holds no
 * bridge, no channel and no loader — which is what lets this slice be judged on
 * what it draws.
 */
export interface GraphTableView {
  /** Draw this page, replacing whatever is on screen. */
  readonly showPage: (page: GraphPage) => void;
  /** Register the listener the Load More Commits control calls. */
  readonly onLoadMore: (listener: () => void) => void;
}

/** The elements the view is made of, found once so that no frame looks them up. */
interface TableParts {
  readonly empty: HTMLElement;
  readonly view: HTMLElement;
  readonly scroll: HTMLElement;
  readonly spacer: HTMLElement;
  readonly more: HTMLButtonElement;
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
}

/** Everything that changes. */
interface TableState {
  page: GraphPage | null;
  pool: RowElement[];
  /** The row each pool slot currently holds, or `-1`. Sized with the pool. */
  slotRows: Int32Array;
  /** The animation frame already requested, or `null`. */
  frame: number | null;
  listener: (() => void) | null;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  made.className = className;
  return made;
}

/**
 * The empty state, unchanged from the window S01 landed.
 *
 * Built from elements and `textContent` for the same reason every row is: no
 * path in the renderer may interpret data as markup.
 */
function buildEmptyState(): HTMLElement {
  const container = element('section', 'empty-state');
  const title = element('h1', 'empty-state__title');
  title.textContent = APPLICATION_NAME;
  const message = element('p', 'empty-state__message');
  message.textContent = EMPTY_STATE_MESSAGE;
  container.append(title, message);
  return container;
}

/** The column headings, sharing the rows' grid so that the two line up exactly. */
function buildHead(): HTMLElement {
  const head = element('div', 'graph__head');
  for (const heading of HEADINGS) {
    const cell = element('div', 'row__cell');
    cell.textContent = heading;
    head.append(cell);
  }
  return head;
}

/**
 * Build both states of the view into `root`, with the table hidden.
 *
 * Both now rather than the table when a page arrives: building it later would
 * put element creation on the path between a repository opening and its first
 * frame, which is the 800 ms budget of
 * `docs/ADR-0002-architecture-and-performance.md` decision 6.
 *
 * The head sits **inside** the scrolling element, stuck to its top. That is what
 * makes the headings share the rows' width exactly: outside it they would span
 * the scrollbar as well, and every column would be a scrollbar's width out of
 * true. It also puts the head in the flow above the spacer, so a row's offset
 * inside the spacer and its offset on the canvas differ by the head's height at
 * every scroll position — which cancels, because the canvas starts below the
 * head too.
 */
function buildParts(root: HTMLElement): TableParts {
  const empty = buildEmptyState();
  const view = element('div', 'graph');
  const scroll = element('div', 'graph__scroll');
  const spacer = element('div', 'graph__spacer');
  const more = element('button', 'graph__more');
  const canvas = element('canvas', 'graph__canvas');
  more.type = 'button';
  more.textContent = LOAD_MORE_LABEL;
  more.hidden = true;
  scroll.append(buildHead(), spacer, more);
  view.append(scroll, canvas);
  view.hidden = true;
  view.style.setProperty('--row-height', `${String(ROW_HEIGHT)}px`);
  root.replaceChildren(empty, view);
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('This window has no 2D canvas context, so the graph cannot be drawn.');
  }
  return { empty, view, scroll, spacer, more, canvas, context };
}

/**
 * Grow or shrink the pool to `size`.
 *
 * Called when the view is mounted and when a resize changes how many rows fit,
 * and at no other time. Every slot is marked as holding no row, because the
 * modulo assignment in `./geometry` is relative to the pool's length and a
 * different length puts every row in a different slot.
 */
function resizePool(parts: TableParts, state: TableState, size: number): void {
  while (state.pool.length > size) {
    const removed = state.pool.pop();
    if (removed !== undefined) {
      removed.root.remove();
    }
  }
  while (state.pool.length < size) {
    const made = createRowElement();
    state.pool.push(made);
    parts.spacer.append(made.root);
  }
  state.slotRows = new Int32Array(size);
  forgetRows(state);
}

/**
 * Mark every slot as holding no row, and hide what it is showing.
 *
 * **Hiding is half of this and is not tidiness.** `writeRows` leaves a slot
 * alone when the row it should hold is the row it already holds, so recording
 * "no row" without hiding the element leaves it on screen, unwritten, for as
 * long as it stays outside the drawn window. Found by looking at a short page
 * drawn after a long one: rows 20 to 37 of the page before it were still there,
 * with their text, under a graph that had correctly stopped at row 19. Every
 * assertion still passed, because each was about a row that was supposed to be
 * there. `graph-table.spec.ts` now counts the visible rows of a complete page.
 */
function forgetRows(state: TableState): void {
  for (const made of state.pool) {
    made.root.hidden = true;
  }
  state.slotRows.fill(-1);
}

/**
 * Put the right row in every slot, rewriting only the slots whose row changed.
 *
 * A scroll of one row changes one slot, whatever the viewport holds, because
 * `rowInSlot` assigns a row to a slot by its own index and not by its distance
 * from the top of the view.
 */
function writeRows(state: TableState, page: GraphPage, first: number, count: number): void {
  for (const [slot, made] of state.pool.entries()) {
    const row = rowInSlot(slot, first, count, state.pool.length);
    if (entryAt(state.slotRows, slot) === row) {
      continue;
    }
    state.slotRows[slot] = row;
    made.root.hidden = row < 0;
    if (row >= 0) {
      writeRow(made, rowViewAt(page, row), row * ROW_HEIGHT);
    }
  }
}

/** One frame: read every measurement, then write the rows and the canvas. */
function paint(parts: TableParts, state: TableState): void {
  state.frame = null;
  const page = state.page;
  if (page === null) {
    return;
  }
  const scrollTop = parts.scroll.scrollTop;
  const height = parts.canvas.clientHeight;
  const width = parts.canvas.clientWidth;
  const ratio = devicePixelRatio;
  const rowCount = page.layout.rowCount;
  const size = rowPoolSize(height);
  if (state.pool.length !== size) {
    resizePool(parts, state, size);
  }
  const first = firstDrawnRow(scrollTop, height, rowCount);
  const count = drawnRowCount(first, height, rowCount);
  writeRows(state, page, first, count);
  resizeCanvas(parts.canvas, Math.round(width * ratio), Math.round(height * ratio));
  paintGraph(parts.context, page, first, count, scrollTop, ratio);
}

/** Show a page: size the spacer and the graph column, then ask for a frame. */
function showPage(parts: TableParts, state: TableState, page: GraphPage): void {
  state.page = page;
  parts.empty.hidden = true;
  parts.view.hidden = false;
  parts.view.style.setProperty(
    '--graph-width',
    `${String(graphColumnWidth(page.layout.maxLane))}px`,
  );
  parts.spacer.style.height = `${String(page.layout.rowCount * ROW_HEIGHT)}px`;
  parts.more.hidden = !page.hasMore;
  forgetRows(state);
}

/**
 * Repaint when the display's pixel ratio changes.
 *
 * A media query rather than a timer: the listener is registered once per
 * distinct ratio, fires when the window moves to a display that scales
 * differently or the user zooms, and wakes nothing in between. `once` is what
 * lets it re-arm against the new ratio instead of accumulating listeners.
 */
function watchPixelRatio(schedule: () => void): void {
  matchMedia(`(resolution: ${String(devicePixelRatio)}dppx)`).addEventListener(
    'change',
    () => {
      watchPixelRatio(schedule);
      schedule();
    },
    { once: true },
  );
}

/** Mount the view into `root` and return what S06 drives it with. */
export function mountGraphTable(root: HTMLElement): GraphTableView {
  const parts = buildParts(root);
  const state: TableState = {
    page: null,
    pool: [],
    slotRows: new Int32Array(0),
    frame: null,
    listener: null,
  };
  const schedule = (): void => {
    state.frame ??= requestAnimationFrame(() => {
      paint(parts, state);
    });
  };
  parts.scroll.addEventListener('scroll', schedule, { passive: true });
  parts.more.addEventListener('click', () => state.listener?.());
  new ResizeObserver(schedule).observe(parts.view);
  watchPixelRatio(schedule);
  return {
    showPage: (page: GraphPage): void => {
      showPage(parts, state, page);
      schedule();
    },
    onLoadMore: (listener: () => void): void => {
      state.listener = listener;
    },
  };
}
