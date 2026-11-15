import { DEFAULT_DETAILS_LAYOUT, DEFAULT_DETAILS_OPTIONS, FailureKind } from '../contracts/index';
import type {
  DetailsLayout,
  DetailsOptions,
  DetailsPlace,
  DetailsResponse,
  DetailsTarget,
  GraphPage,
} from '../contracts/index';

import { LOADING_NOTE, writeDetails, writeNote } from './details-area';
import type { DetailsArea } from './details-area';
import type { Settings } from './file-menu';
import { NO_ROW, ROW_HEIGHT } from './geometry';
import { detailsTargetAt, rowOfTarget } from './row-model';

/**
 * Opening, closing and answering the details of a row (E04-M01-S09): the state
 * that says which row is open and what was asked for it, and the functions that
 * change it. `./graph-table` holds the pool and the canvas and calls these.
 *
 * Nothing here reads a repository: the view says what it wants read through the
 * listener it was given, and draws what it is handed back.
 */

/**
 * Called when a row's details open and when they must be read again: the
 * target to read, and the function to hand the reply to. A reply handed to an
 * `answer` the view has since superseded, because the area was closed or another
 * row opened or the same details were asked for again, is never drawn.
 */
export type DetailsListener = (
  target: DetailsTarget,
  answer: (reply: DetailsResponse) => void,
) => void;

/** The elements the details are drawn with. */
export interface PanelParts {
  readonly view: HTMLElement;
  readonly scroll: HTMLElement;
  readonly spacer: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly area: DetailsArea;
}

/** What the details change. */
export interface PanelState {
  page: GraphPage | null;
  /** The layout row whose details are open, or `NO_ROW`. */
  open: number;
  /** What the open row's details are of, or `null` while none are open. */
  target: DetailsTarget | null;
  /** Which request the open area waits for: a reply to any other is stale. */
  asked: number;
  details: DetailsListener | null;
  /** Where the area opens (E04-M01-S12): under its row, or docked at the bottom of the view. */
  place: DetailsPlace;
  /** Whether opening a row centres it; off, it is scrolled in by the smallest amount. */
  autoCenter: boolean;
  /** The area's height in force, in whole pixels: the one number every row below it is moved by. */
  height: number;
  /** The left pane's share of the two panes' width. */
  divider: number;
  /** The files pane's three options, as the pane last said them. */
  settings: Settings;
  /** The layout kept for the open repository, which a drag or a view button changes. */
  layout: DetailsLayout;
  optionsListener: ((options: DetailsOptions) => void) | null;
  layoutListener: ((layout: DetailsLayout) => void) | null;
  /** Ask for a frame, once however often it is called before the frame runs. */
  schedule: () => void;
  /** Mark every pool slot as holding no row, so that the next frame writes them all. */
  forget: () => void;
  /**
   * Draw now, in place of the frame that is pending, which is cancelled: still one
   * redraw, and the pool holds every row where it belongs when the task ends.
   */
  flush: () => void;
}

/** What the state holds before anything is open: the defaults of the contract. */
export function initialDetails(): Omit<PanelState, 'schedule' | 'forget' | 'flush'> {
  return {
    page: null,
    open: NO_ROW,
    target: null,
    asked: 0,
    details: null,
    place: DEFAULT_DETAILS_OPTIONS.place,
    autoCenter: DEFAULT_DETAILS_OPTIONS.autoCenter,
    height: DEFAULT_DETAILS_LAYOUT.height,
    divider: DEFAULT_DETAILS_LAYOUT.divider,
    settings: {
      defaultView: DEFAULT_DETAILS_OPTIONS.defaultFileView,
      compact: DEFAULT_DETAILS_OPTIONS.compactFolders,
      letters: DEFAULT_DETAILS_OPTIONS.statusLetters,
    },
    layout: DEFAULT_DETAILS_LAYOUT,
    optionsListener: null,
    layoutListener: null,
  };
}

/**
 * The row the geometry opens a gap under, which is the open row only while the
 * area is inline: docked, no row moves and the graph is the closed graph, so the
 * geometry is told no row is open (E04-M01-S12). **The line that gives a docked
 * area no gap.** The open row keeps its band either way (`state.open`).
 */
export function gapRow(state: Pick<PanelState, 'open' | 'place'>): number {
  return state.place === 'inline' ? state.open : NO_ROW;
}

/**
 * Write the area's height and the two panes' shares onto the view, where the
 * stylesheet reads them. The shares are in thousandths of a flex unit, so the two
 * never sum to less than one, which a grid reads as less than the whole room.
 */
export function writeSizes(parts: PanelParts, state: PanelState): void {
  parts.view.style.setProperty('--details-height', `${String(state.height)}px`);
  parts.view.style.setProperty('--details-left', `${String(state.divider * 1000)}fr`);
  parts.view.style.setProperty('--details-right', `${String((1 - state.divider) * 1000)}fr`);
}

/**
 * Put the area under the open row, or docked at the foot of the view, or hide
 * it, and size the scroll range for it.
 *
 * The same one element is moved between the scrolling content and the view, never
 * a second. Docked, the list, its sticky head and its canvas end at the panel's
 * top edge (the stylesheet, on `graph--docked`), so the last row and Load More
 * are reached by scrolling the list.
 *
 * Every row is written again by the next frame, because every row after the open
 * one may have moved: `forget` hides the pool for the length of this task, which
 * no frame is drawn inside.
 */
export function placeArea(parts: PanelParts, state: PanelState): void {
  const open = state.open >= 0;
  const docked = open && state.place === 'docked';
  const rows = state.page?.layout.rowCount ?? 0;
  const home = docked ? parts.view : parts.spacer;
  if (parts.area.root.parentElement !== home) {
    home.append(parts.area.root);
  }
  parts.area.root.hidden = !open;
  parts.area.root.classList.toggle('details--docked', docked);
  parts.view.classList.toggle('graph--docked', docked);
  parts.area.root.style.transform = docked
    ? ''
    : `translateY(${String((state.open + 1) * ROW_HEIGHT)}px)`;
  writeSizes(parts, state);
  const gap = open && !docked ? state.height : 0;
  parts.spacer.style.height = `${String(rows * ROW_HEIGHT + gap)}px`;
  state.forget();
}

/** Close the open details, and make a reply still on its way stale. */
export function closeDetails(parts: PanelParts, state: PanelState): void {
  if (state.open < 0) {
    return;
  }
  state.open = NO_ROW;
  state.target = null;
  state.asked += 1;
  parts.area.pane.closeMenu();
  placeArea(parts, state);
  // Drawn at once: `placeArea` hid the pool, and a closed area must not leave the
  // rows hidden until a frame, for whoever reads the document in between.
  state.flush();
}

/**
 * Ask for the open details and draw the reply when it is the one waited for.
 *
 * `keep` leaves what the area shows while it waits, for a read that repeats one
 * already drawn. The area is otherwise opened at once, at its full height, saying
 * that it is loading.
 */
export function askDetails(parts: PanelParts, state: PanelState, keep: boolean): void {
  const target = state.target;
  if (target === null) {
    return;
  }
  state.asked += 1;
  const mine = state.asked;
  if (!keep) {
    writeNote(parts.area, LOADING_NOTE);
  }
  state.details?.(target, (reply) => {
    if (mine === state.asked) {
      drawReply(parts, state, reply);
    }
  });
}

/** Draw a reply: the details, the failure's message, or nothing at all for a cancellation. */
function drawReply(parts: PanelParts, state: PanelState, reply: DetailsResponse): void {
  const page = state.page;
  if (page === null) {
    return;
  }
  if (!reply.ok) {
    if (reply.kind === FailureKind.Cancelled) {
      closeDetails(parts, state);
    } else {
      writeNote(parts.area, reply.message);
    }
    return;
  }
  const rowOf = (hash: string): number => rowOfTarget(page, { kind: 'commit', hash });
  writeDetails(
    parts.area,
    reply.value,
    (hash) => rowOf(hash) >= 0,
    (hash) => {
      toggleDetails(parts, state, rowOf(hash));
    },
  );
}

/**
 * Scroll so that the open row, and its area when it is inline, as one block, are
 * in view in the list below the sticky head. The browser clamps the offset at
 * both ends of the scroll range, which `placeArea` has already grown.
 *
 * - Auto Center on: the block sits in the middle of the list; a block taller than
 *   the list puts the row at the top (E04-M01-S09). Docked, the block is the row
 *   alone, centred in the list above the panel.
 * - Auto Center off: the smallest scroll that shows the whole block, none when it
 *   is shown already, and the row at the top when the block is taller than the
 *   list. Chosen by the orchestrator, because the reference was not seen with it
 *   off (E04-M01-S12, items 5 and 6).
 */
export function keepInView(parts: PanelParts, state: PanelState, row: number): void {
  const block = ROW_HEIGHT + (state.place === 'inline' ? state.height : 0);
  const list = parts.canvas.clientHeight;
  const top = row * ROW_HEIGHT;
  if (state.autoCenter) {
    parts.scroll.scrollTop = block >= list ? top : top + (block - list) / 2;
  } else {
    const foot = top + block - list;
    parts.scroll.scrollTop =
      block >= list ? top : Math.min(Math.max(parts.scroll.scrollTop, foot), top);
  }
}

/**
 * Open the details of `row` under it and ask for them, and keep the row in view.
 * Any other row's are closed by opening this one: there is only ever one area.
 *
 * **This is the one place a row's opening keeps it in view** (`keepInView`), for
 * a click, a followed parent link and a key alike (E04-M01-S11). Auto Center on
 * centres the block; off, it scrolls by the smallest amount that shows it
 * (E04-M01-S12).
 *
 * It never closes: the row that is open already is left as it is. One call is one
 * redraw, however often it is called before the frame: `placeArea` hides the pool
 * for the length of the task and `schedule` asks for one frame.
 */
export function openDetails(parts: PanelParts, state: PanelState, row: number): void {
  const page = state.page;
  if (page === null || row < 0 || row >= page.layout.rowCount || row === state.open) {
    return;
  }
  state.open = row;
  state.target = detailsTargetAt(page, row);
  placeArea(parts, state);
  keepInView(parts, state, row);
  askDetails(parts, state, false);
  state.schedule();
}

/**
 * Open the details of `row` under it, or close them when they are `row`'s already:
 * what a click on the row does.
 */
export function toggleDetails(parts: PanelParts, state: PanelState, row: number): void {
  if (row === state.open) {
    closeDetails(parts, state);
    return;
  }
  openDetails(parts, state, row);
}

/**
 * Keep the open details through a page drawn at the current offset when the new
 * page still has their row, and close them when it has not.
 */
export function keepDetails(state: PanelState, page: GraphPage): void {
  const row = state.target === null ? NO_ROW : rowOfTarget(page, state.target);
  state.open = row;
  if (row < 0) {
    state.target = null;
    state.asked += 1;
  }
}

/**
 * Move the open area to `place` at once, showing what it showed and asking for
 * nothing again, and keep its row in view by the rule of {@link keepInView}.
 * With no area open only the place changes (E04-M01-S12).
 */
export function setPlace(parts: PanelParts, state: PanelState, place: DetailsPlace): void {
  if (place === state.place) {
    return;
  }
  state.place = place;
  if (state.open >= 0) {
    placeArea(parts, state);
    keepInView(parts, state, state.open);
    state.schedule();
  }
}
