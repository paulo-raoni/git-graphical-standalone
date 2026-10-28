import {
  boxText,
  isChecked,
  matchingEntries,
  sameEntries,
  SHOW_ALL_LABEL,
} from '../contracts/index';
import type { BranchEntry, BranchMenu } from '../contracts/index';

/**
 * The bar's Branches dropdown and its Show Remote Branches checkbox, as
 * elements.
 *
 * **It decides nothing about the selection.** Which entries are listed, in what
 * order, which are checked, what a click does and what the closed box says are
 * all `src/contracts/branch-menu.ts`'s; this module draws what it is handed and
 * reports which entry was pressed. What it does hold is the list's own state as
 * a widget — open or closed, the filter's text, which entry has the focus — and
 * that is the whole of it.
 *
 * **The list is built when it opens and dropped when it closes**, so a closed
 * list of a thousand branches costs the document nothing, and a press that only
 * changes what is checked rewrites one attribute per row rather than the rows.
 *
 * Everything is built from elements and `textContent`, never from a markup
 * string, so a branch name cannot be interpreted as markup.
 */

/** The `id`s the box is named by: the visible label, then its own text. */
const LABEL_ID = 'bar-branches-label';
const BOX_ID = 'bar-branches';

/** The elements of the control, found once. */
interface Parts {
  readonly label: HTMLElement;
  readonly picker: HTMLElement;
  readonly box: HTMLButtonElement;
  readonly text: HTMLElement;
  readonly popup: HTMLElement;
  readonly filter: HTMLInputElement;
  readonly list: HTMLElement;
  readonly remotesLabel: HTMLLabelElement;
  readonly remotes: HTMLInputElement;
  readonly measure: CanvasRenderingContext2D | null;
}

/** What the control was handed and whom it reports to, held between events. */
interface ControlState {
  entries: readonly BranchEntry[];
  menu: BranchMenu;
  /** The entries the open list shows after Show All, which the filter decides. */
  shown: readonly BranchEntry[];
  showAll: (clicks: number) => void;
  branch: (name: string) => void;
}

/** What `./shell.ts` hands `./renderer.ts` to drive the control with. */
export interface BranchControl {
  /** The elements the bar shows, in order. */
  readonly parts: readonly HTMLElement[];
  /** Show Remote Branches. Disabled until {@link BranchControl.enable}. */
  readonly remotes: HTMLInputElement;
  /** Show these entries, checked as `menu` says, in the box and in the open list. */
  readonly show: (entries: readonly BranchEntry[], menu: BranchMenu) => void;
  /** Make the box and the checkbox usable, once a repository is shown. */
  readonly enable: () => void;
  /** Register what a press of Show All calls, with the press's count in its gesture. */
  readonly onShowAll: (listener: (clicks: number) => void) => void;
  /** Register what a press of a branch calls, with its full name. */
  readonly onBranch: (listener: (name: string) => void) => void;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  made.className = className;
  return made;
}

/** The closed box: a button named by the visible label and by what it says. */
function buildBox(): { box: HTMLButtonElement; text: HTMLElement } {
  const box = element('button', 'branches__box');
  box.type = 'button';
  box.id = BOX_ID;
  box.disabled = true;
  box.setAttribute('aria-haspopup', 'listbox');
  box.setAttribute('aria-expanded', 'false');
  box.setAttribute('aria-labelledby', `${LABEL_ID} ${BOX_ID}`);
  const text = element('span', 'branches__text');
  box.append(text);
  return { box, text };
}

/** The open list: the filter field, then the rows, scrolling together. */
function buildPopup(): { popup: HTMLElement; filter: HTMLInputElement; list: HTMLElement } {
  const popup = element('div', 'branches__popup');
  popup.hidden = true;
  popup.tabIndex = -1;
  const filter = element('input', 'branches__filter');
  filter.type = 'text';
  filter.placeholder = 'Filter branches…';
  filter.setAttribute('aria-label', 'Filter branches');
  const list = element('div', 'branches__list');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-multiselectable', 'true');
  list.setAttribute('aria-label', 'Branches');
  popup.append(filter, list);
  return { popup, filter, list };
}

function buildParts(): Parts {
  const label = element('span', 'bar__label');
  label.id = LABEL_ID;
  label.textContent = 'Branches:';
  const { box, text } = buildBox();
  const { popup, filter, list } = buildPopup();
  const picker = element('div', 'branches');
  picker.append(box, popup);
  const remotesLabel = element('label', 'bar__label');
  const remotes = document.createElement('input');
  remotes.type = 'checkbox';
  remotes.checked = true;
  remotes.disabled = true;
  remotesLabel.append(remotes, 'Show Remote Branches');
  const measure = document.createElement('canvas').getContext('2d');
  return { label, picker, box, text, popup, filter, list, remotesLabel, remotes, measure };
}

/** One row of the list. Its full text is also its tooltip, for a name cut short. */
function option(text: string, checked: boolean): HTMLElement {
  const item = element('div', 'branches__option');
  item.setAttribute('role', 'option');
  item.setAttribute('aria-selected', String(checked));
  item.tabIndex = -1;
  item.title = text;
  item.textContent = text;
  return item;
}

/** Where `target` is among the list's rows, Show All being 0, or -1. */
function indexOf(parts: Parts, target: unknown): number {
  return Array.prototype.indexOf.call(parts.list.children, target);
}

function focusRow(parts: Parts, at: number): void {
  (parts.list.children[at] as HTMLElement | undefined)?.focus();
}

/** Build the open list's rows from the entries and the filter. */
function render(parts: Parts, state: ControlState): void {
  state.shown = matchingEntries(state.entries, parts.filter.value);
  parts.list.replaceChildren(
    option(SHOW_ALL_LABEL, state.menu.showAll),
    ...state.shown.map((entry) => option(entry.label, isChecked(state.menu, entry.name))),
  );
}

/** Rewrite which rows say they are checked, leaving the rows and the focus alone. */
function recheck(parts: Parts, state: ControlState): void {
  const rows = parts.list.children;
  rows[0]?.setAttribute('aria-selected', String(state.menu.showAll));
  state.shown.forEach((entry, at) => {
    rows[at + 1]?.setAttribute('aria-selected', String(isChecked(state.menu, entry.name)));
  });
}

/**
 * The box is as wide as its widest entry, up to the stylesheet's limit, so it
 * narrows when remote branches are hidden. Measured with the box's own font.
 */
function fit(parts: Parts, state: ControlState): void {
  const measure = parts.measure;
  if (measure === null) {
    return;
  }
  measure.font = getComputedStyle(parts.text).font;
  const widest = [SHOW_ALL_LABEL, ...state.entries.map((entry) => entry.label)].reduce(
    (most, text) => Math.max(most, measure.measureText(text).width),
    0,
  );
  parts.picker.style.setProperty('--branches-width', `${String(Math.ceil(widest))}px`);
}

/** Open the list scrolled to its top, with an empty filter that has the focus. */
function open(parts: Parts, state: ControlState): void {
  parts.filter.value = '';
  render(parts, state);
  parts.popup.hidden = false;
  parts.box.setAttribute('aria-expanded', 'true');
  parts.popup.scrollTop = 0;
  parts.filter.focus();
}

function close(parts: Parts, focusBox: boolean): void {
  parts.popup.hidden = true;
  parts.box.setAttribute('aria-expanded', 'false');
  parts.list.replaceChildren();
  if (focusBox) {
    parts.box.focus();
  }
}

/** Report a press of row `at`, `clicks` being its count within one gesture. */
function press(state: ControlState, at: number, clicks: number): void {
  const entry = state.shown[at - 1];
  if (at === 0) {
    state.showAll(clicks);
  } else if (entry !== undefined) {
    state.branch(entry.name);
  }
}

/**
 * A key inside the open list. Escape closes it and gives the box the focus; Tab
 * does too, and then moves the focus on from the box; the arrows move between the filter and
 * the rows; Enter and Space press the row with the focus. Answers whether the
 * key was the list's, so that its default action is withheld.
 */
function onKey(parts: Parts, state: ControlState, key: string): boolean {
  const at = indexOf(parts, document.activeElement);
  if (key === 'Escape' || key === 'Tab') {
    close(parts, true);
    return key === 'Escape';
  }
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    const next = at + (key === 'ArrowDown' ? 1 : -1);
    if (next < 0) parts.filter.focus();
    else focusRow(parts, next);
    return true;
  }
  if ((key === 'Enter' || key === ' ') && at >= 0) {
    press(state, at, 1);
    return true;
  }
  return false;
}

function wire(parts: Parts, state: ControlState): void {
  parts.box.addEventListener('click', () => {
    if (parts.popup.hidden) open(parts, state);
    else close(parts, false);
  });
  // A press anywhere outside the control closes the list; a press on a row never does.
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!parts.popup.hidden && !parts.picker.contains(event.target as Node)) close(parts, false);
    },
    true,
  );
  parts.filter.addEventListener('input', () => {
    render(parts, state);
  });
  parts.list.addEventListener('click', (event) => {
    const row = (event.target as Element).closest('[role="option"]');
    press(state, indexOf(parts, row), Math.max(event.detail, 1));
  });
  parts.popup.addEventListener('keydown', (event) => {
    if (onKey(parts, state, event.key)) event.preventDefault();
  });
}

/** Show `entries` checked as `menu` says: the box at once, and the list if it is open. */
function show(
  parts: Parts,
  state: ControlState,
  entries: readonly BranchEntry[],
  menu: BranchMenu,
): void {
  const changed = !sameEntries(state.entries, entries);
  state.entries = entries;
  state.menu = menu;
  const text = boxText(menu, entries);
  parts.text.textContent = text;
  parts.box.title = text;
  if (changed) fit(parts, state);
  if (parts.popup.hidden) return;
  if (!changed) {
    recheck(parts, state);
    return;
  }
  const focused = indexOf(parts, document.activeElement);
  render(parts, state);
  focusRow(parts, focused);
}

/**
 * Build the control. Its elements are disabled, and its list closed and empty,
 * until a repository is shown.
 */
export function mountBranchControl(): BranchControl {
  const parts = buildParts();
  const state: ControlState = {
    entries: [],
    menu: { showAll: true, branches: [], pressedFromEvery: false },
    shown: [],
    showAll: () => undefined,
    branch: () => undefined,
  };
  wire(parts, state);
  return {
    parts: [parts.label, parts.picker, parts.remotesLabel],
    remotes: parts.remotes,
    show: (entries: readonly BranchEntry[], menu: BranchMenu): void => {
      show(parts, state, entries, menu);
    },
    enable: (): void => {
      parts.box.disabled = false;
      parts.remotes.disabled = false;
    },
    onShowAll: (listener: (clicks: number) => void): void => {
      state.showAll = listener;
    },
    onBranch: (listener: (name: string) => void): void => {
      state.branch = listener;
    },
  };
}
