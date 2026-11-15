import type { FileView } from './file-tree';

/**
 * The rules of the Commit Details View's size, place and options, kept across
 * restarts (E04-M01-S12): the defaults, the limits, which stored value is a
 * layout or a set of options at all, and what a drag gives.
 *
 * **Why this ring.** Each of these is a decision that can be wrong, and
 * `docs/ADR-0002-architecture-and-performance.md` decision 1 keeps every decision
 * out of `src/ui/` and `src/app/`. The window measures and calls these; the main
 * process reads and writes the records and calls the checks. This ring keeps its
 * other rule: it imports only its siblings and keeps nothing between calls.
 *
 * Every limit and every default here is the orchestrator's choice, not a reading
 * of the reference extension, which was never seen dragged (the slice document,
 * `docs/plan/E04-commit-details-comparison-and-diff/M01-commit-details-view/S12-panel-size-place-and-options.md`).
 */

/** Where the Commit Details View opens: under its row, or docked at the bottom of the view. */
export type DetailsPlace = 'inline' | 'docked';

/** The options of the Commit Details View: the application's, kept across restarts. */
export interface DetailsOptions {
  readonly place: DetailsPlace;
  readonly autoCenter: boolean;
  readonly defaultFileView: FileView;
  readonly compactFolders: boolean;
  readonly statusLetters: boolean;
}

/** What one repository keeps of the view, across restarts. */
export interface DetailsLayout {
  /** The area's height in whole CSS pixels, border included, inline and docked alike. */
  readonly height: number;
  /** The left pane's share of the width the two panes share, from 0.2 to 0.8. */
  readonly divider: number;
  /** The view a view button chose on this repository, or `null` when none was pressed. */
  readonly fileView: FileView | null;
}

/** The options a person who never chose one has. */
export const DEFAULT_DETAILS_OPTIONS: DetailsOptions = /* @__PURE__ */ Object.freeze({
  place: 'inline',
  autoCenter: true,
  defaultFileView: 'tree',
  compactFolders: true,
  statusLetters: false,
});

/** The height of the area, 250 pixels, and the two equal panes of a repository that kept nothing. */
export const DEFAULT_DETAILS_LAYOUT: DetailsLayout = /* @__PURE__ */ Object.freeze({
  height: 250,
  divider: 0.5,
  fileView: null,
});

/** The least height of the area: five rows, with room for the controls column's four buttons. */
export const MIN_DETAILS_HEIGHT = 120;
/** The most height a record may claim. A bound on a record, not a limit a drag reaches. */
export const MAX_KEPT_HEIGHT = 4096;
/** The narrowest and widest share the left pane may have of the two panes' width. */
export const MIN_DIVIDER = 0.2;
export const MAX_DIVIDER = 0.8;
/** Rows the sticky head and the rows kept above a docked panel take: the head and three rows. */
const DOCKED_ROWS_ABOVE = 4;

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return values.includes(value as T);
}

/** Whether `value` is a whole number of pixels from the minimum to the most a record may claim. */
function isKeptHeight(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_DETAILS_HEIGHT &&
    value <= MAX_KEPT_HEIGHT
  );
}

/** Whether `value` is a finite share from {@link MIN_DIVIDER} to {@link MAX_DIVIDER}. */
function isKeptDivider(value: unknown): value is number {
  return typeof value === 'number' && value >= MIN_DIVIDER && value <= MAX_DIVIDER;
}

/**
 * The options `value` holds, or `null` when it is not exactly options this
 * application writes: each field of its own type and in its own set. The answer
 * is a new object holding those fields alone.
 *
 * It is how a record read from the disk is checked, and how options that arrived
 * from the page are checked before they are written: neither is trusted.
 */
export function keptDetailsOptions(value: unknown): DetailsOptions | null {
  const { place, autoCenter, defaultFileView, compactFolders, statusLetters } = (value ??
    {}) as Partial<Record<string, unknown>>;
  if (
    !isOneOf(['inline', 'docked'], place) ||
    typeof autoCenter !== 'boolean' ||
    !isOneOf(['tree', 'list'], defaultFileView) ||
    typeof compactFolders !== 'boolean' ||
    typeof statusLetters !== 'boolean'
  ) {
    return null;
  }
  return { place, autoCenter, defaultFileView, compactFolders, statusLetters };
}

/**
 * The layout `value` holds, or `null` when it is not one this application
 * writes: a height that is a whole number from {@link MIN_DETAILS_HEIGHT} to
 * {@link MAX_KEPT_HEIGHT}, a divider that is a finite number from
 * {@link MIN_DIVIDER} to {@link MAX_DIVIDER}, and a file view that is `null`,
 * `tree` or `list`. The answer is a new object holding those fields alone.
 */
export function keptDetailsLayout(value: unknown): DetailsLayout | null {
  const { height, divider, fileView } = (value ?? {}) as Partial<Record<string, unknown>>;
  if (
    !isKeptHeight(height) ||
    !isKeptDivider(divider) ||
    (fileView !== null && !isOneOf(['tree', 'list'], fileView))
  ) {
    return null;
  }
  return { height, divider, fileView };
}

/**
 * The most height a drag may give the area, never under the minimum.
 *
 * Inline, `available` is the list's visible height and one row is left, so the
 * open row and its whole area fit on screen together. Docked, `available` is the
 * view's height and the sticky head and three rows are left above the panel.
 */
export function heightRoom(place: DetailsPlace, available: number, row: number): number {
  const left = place === 'inline' ? row : DOCKED_ROWS_ABOVE * row;
  return Math.min(MAX_KEPT_HEIGHT, Math.max(MIN_DETAILS_HEIGHT, available - left));
}

/** The height a drag gives: `wanted` rounded to a whole pixel, then held from the minimum to `room`. */
export function draggedHeight(wanted: number, room: number): number {
  return Math.min(Math.max(Math.round(wanted), MIN_DETAILS_HEIGHT), room);
}

/**
 * The share a drag gives the left pane: where the pointer is in the two panes'
 * width, held from {@link MIN_DIVIDER} to {@link MAX_DIVIDER}. `left` is where
 * the two panes start and `width` how wide they are together.
 */
export function draggedDivider(pointer: number, left: number, width: number): number {
  if (width <= 0) {
    return DEFAULT_DETAILS_LAYOUT.divider;
  }
  return Math.min(Math.max((pointer - left) / width, MIN_DIVIDER), MAX_DIVIDER);
}
