import { FailureKind } from '../contracts/index';
import type { DetailsResponse, DetailsTarget, GraphPage } from '../contracts/index';

import { LOADING_NOTE, writeDetails, writeNote } from './details-area';
import type { DetailsArea } from './details-area';
import { DETAILS_HEIGHT, NO_ROW, ROW_HEIGHT } from './geometry';
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
  /** Ask for a frame, once however often it is called before the frame runs. */
  schedule: () => void;
  /** Mark every pool slot as holding no row, so that the next frame writes them all. */
  forget: () => void;
}

/**
 * Put the area under the open row, or hide it, and size the scroll range for it.
 *
 * Every row is written again by the next frame, because every row after the open
 * one has moved: `forget` hides the pool for the length of this task, which
 * no frame is drawn inside.
 */
export function placeArea(parts: PanelParts, state: PanelState): void {
  const open = state.open >= 0;
  const rows = state.page?.layout.rowCount ?? 0;
  parts.area.root.hidden = !open;
  parts.area.root.style.transform = `translateY(${String((state.open + 1) * ROW_HEIGHT)}px)`;
  parts.spacer.style.height = `${String(rows * ROW_HEIGHT + (open ? DETAILS_HEIGHT : 0))}px`;
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
  state.schedule();
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
 * Scroll so that the row and its area, as one block, sit in the middle of the
 * list below the sticky head; a block taller than the list puts the row at the
 * top. The browser clamps the offset at both ends of the scroll range, which
 * `placeArea` has already grown.
 */
function centreBlock(parts: PanelParts, row: number): void {
  const block = ROW_HEIGHT + DETAILS_HEIGHT;
  const list = parts.canvas.clientHeight;
  const top = row * ROW_HEIGHT;
  parts.scroll.scrollTop = block >= list ? top : top + (block - list) / 2;
}

/**
 * Open the details of `row` under it and ask for them, or close them when they
 * are `row`'s already. Any other row's are closed by opening this one: there is
 * only ever one area.
 */
export function toggleDetails(parts: PanelParts, state: PanelState, row: number): void {
  const page = state.page;
  if (page === null || row < 0 || row >= page.layout.rowCount) {
    return;
  }
  if (row === state.open) {
    closeDetails(parts, state);
    return;
  }
  state.open = row;
  state.target = detailsTargetAt(page, row);
  placeArea(parts, state);
  centreBlock(parts, row);
  askDetails(parts, state, false);
  state.schedule();
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
