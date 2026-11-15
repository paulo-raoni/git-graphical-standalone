import { rowAfterMove } from '../contracts/index';
import type { RowMove } from '../contracts/index';

import { closeDetails, openDetails } from './details-panel';
import type { PanelParts, PanelState } from './details-panel';

/**
 * The keys of the open details (E04-M01-S11): one `keydown` listener on the
 * document, registered once when the view is mounted.
 *
 * It holds no rule. Which row an arrow goes to is `rowAfterMove` of
 * `src/contracts/row-moves.ts`; this module decides only whether a key is its
 * own, and hands the row on to `openDetails`, which is what a click on another
 * row does (one redraw, the row kept in view, the reply guarded).
 *
 * **A key goes to the control that has it first.** One that is not handled does
 * nothing, consumes nothing and schedules nothing:
 *
 * - a key whose default action an inner control has already withheld
 *   (`defaultPrevented`: the Branches list moves its own focus on the arrows and
 *   closes on Escape), or whose target is a form control or editable (the theme
 *   control changes on ArrowUp);
 * - a key with Alt held, and Shift without Ctrl;
 * - an arrow with no details open: what the window already does with it stays
 *   (the view scrolling by arrows is E01-M03's).
 *
 * Ctrl is `ctrlKey` or `metaKey` on every platform, so that Cmd works on macOS
 * without a platform test.
 */

/** The moves of one arrow: alone, with Ctrl, and with Ctrl and Shift. */
type ArrowMoves = readonly [RowMove, RowMove, RowMove];

const ARROWS: Readonly<Record<string, ArrowMoves>> = {
  ArrowUp: ['up', 'child', 'other-child'],
  ArrowDown: ['down', 'parent', 'other-parent'],
};

/** The move a key press asks for, or `null` when it asks for none. */
function moveOf(event: KeyboardEvent): RowMove | null {
  const moves = ARROWS[event.key];
  if (moves === undefined) {
    return null;
  }
  if (event.ctrlKey || event.metaKey) {
    return event.shiftKey ? moves[2] : moves[1];
  }
  return event.shiftKey ? null : moves[0];
}

/** Whether a key pressed on `target` is the target's own: a form control or editable text. */
function isField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest('input, select, textarea') !== null)
  );
}

/** Escape: close the topmost thing, the files menu before the details. */
function escape(parts: PanelParts, state: PanelState, event: KeyboardEvent): void {
  if (parts.area.pane.menuOpen()) {
    parts.area.pane.closeMenu();
  } else if (state.open >= 0) {
    closeDetails(parts, state);
  } else {
    return;
  }
  event.preventDefault();
}

/** While the files menu is open the arrows move its focus and nothing else. */
function inMenu(parts: PanelParts, event: KeyboardEvent): void {
  const plain = !event.ctrlKey && !event.metaKey && !event.shiftKey;
  if (plain && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    parts.area.pane.stepMenu(event.key === 'ArrowDown' ? 1 : -1);
    event.preventDefault();
  }
}

/** Whether the key is not the view's: withheld by an inner control, in a field, or with Alt. */
function ignored(event: KeyboardEvent): boolean {
  return event.defaultPrevented || event.altKey || isField(event.target);
}

/** Open the row an arrow goes to, and withhold the arrow whether or not it goes anywhere. */
function move(parts: PanelParts, state: PanelState, event: KeyboardEvent): void {
  const which = moveOf(event);
  if (which === null || state.page === null) {
    return;
  }
  // So that an arrow at the edge does not scroll the open row away.
  event.preventDefault();
  const row = rowAfterMove(state.page, state.open, which);
  if (row >= 0) {
    openDetails(parts, state, row);
  }
}

/** Handle one key press, or leave it alone. */
function pressed(parts: PanelParts, state: PanelState, event: KeyboardEvent): void {
  if (ignored(event)) {
    return;
  }
  if (event.key === 'Escape') {
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
      escape(parts, state, event);
    }
  } else if (parts.area.pane.menuOpen()) {
    inMenu(parts, event);
  } else if (state.open >= 0) {
    move(parts, state, event);
  }
}

/** Register the one listener. */
export function listenKeys(parts: PanelParts, state: PanelState): void {
  document.addEventListener('keydown', (event) => {
    pressed(parts, state, event);
  });
}
