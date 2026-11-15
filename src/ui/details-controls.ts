import {
  DEFAULT_DETAILS_LAYOUT,
  draggedDivider,
  draggedHeight,
  heightRoom,
} from '../contracts/index';
import type {
  DetailsLayout,
  DetailsOptions,
  DetailsPlace,
  Failure,
  FileView,
  Result,
} from '../contracts/index';

import { placeArea, setPlace, writeSizes } from './details-panel';
import type { PanelParts, PanelState } from './details-panel';
import type { OptionChoice, Settings } from './file-menu';
import { ROW_HEIGHT } from './geometry';

/**
 * What a person changes about the details area (E04-M01-S12): its height and the
 * divider between its two panes, by two drags; where it opens and whether opening
 * a row centres it, by two groups of the options menu; and the report of each
 * change to the caller, which keeps it.
 *
 * It holds no rule. How far a pointer may take either size is `heightRoom`,
 * `draggedHeight` and `draggedDivider` of `src/contracts/details-layout.ts`; this
 * module measures, calls them and writes what they answer.
 *
 * **A drag follows the pointer** (pointer capture, so it goes on outside the area
 * and the window, and ends on the release or on a cancel) and **costs one redraw
 * a frame at most**: a move changes the state and asks for a frame, and any
 * number of moves before the frame cost that one. It never scrolls the view; the
 * offset changes only where the browser clamps it to a shorter scroll range. The
 * layout is reported **when the pointer is released**, once, and only if it
 * changed, so a drag does not write the disk at the pointer's rate.
 */

/** What a drag began with, to say whether it changed anything. */
interface Start {
  readonly pointer: number;
  /** How far the pointer was from the divider's edge when pressed, which a drag keeps. */
  readonly grab: number;
  readonly height: number;
  readonly divider: number;
}

/** The height a pointer at `clientY` gives: the edge is the foot inline and the top docked. */
function heightAt(parts: PanelParts, state: PanelState, start: Start, clientY: number): number {
  const delta = clientY - start.pointer;
  const inline = state.place === 'inline';
  const available = inline ? parts.canvas.clientHeight : parts.view.clientHeight;
  return draggedHeight(
    start.height + (inline ? delta : -delta),
    heightRoom(state.place, available, ROW_HEIGHT),
  );
}

/** The share a pointer at `clientX` gives the left pane, measured over the two panes. */
function dividerAt(parts: PanelParts, start: Start, clientX: number): number {
  const left = parts.area.info.getBoundingClientRect().left;
  const right = parts.area.files.getBoundingClientRect().right;
  return draggedDivider(clientX - start.grab, left, right - left);
}

/**
 * Make `handle` drag: `change` is given where the drag began and the event and
 * writes the new size, and `done` is told at the release when anything changed.
 */
function drag(
  handle: HTMLElement,
  state: PanelState,
  change: (start: Start, event: PointerEvent) => void,
  done: () => void,
): void {
  let start: Start | null = null;
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }
    handle.setPointerCapture(event.pointerId);
    start = {
      pointer: handle.classList.contains('details__divider') ? event.clientX : event.clientY,
      grab: event.clientX - handle.getBoundingClientRect().left,
      height: state.height,
      divider: state.divider,
    };
    event.preventDefault();
  });
  handle.addEventListener('pointermove', (event) => {
    if (start !== null) {
      change(start, event);
    }
  });
  const end = (): void => {
    const began = start;
    start = null;
    if (began !== null && (began.height !== state.height || began.divider !== state.divider)) {
      done();
    }
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

/** The options in force, as the main process keeps them. */
function optionsOf(state: PanelState): DetailsOptions {
  return {
    place: state.place,
    autoCenter: state.autoCenter,
    defaultFileView: state.settings.defaultView,
    compactFolders: state.settings.compact,
    statusLetters: state.settings.letters,
  };
}

function reportOptions(state: PanelState): void {
  state.optionsListener?.(optionsOf(state));
}

function reportLayout(state: PanelState, layout: Partial<DetailsLayout>): void {
  state.layout = { ...state.layout, ...layout };
  state.layoutListener?.(state.layout);
}

/** Add Location and Auto Center to the files pane's options menu, after its own three. */
function addOptionGroups(parts: PanelParts, state: PanelState): void {
  const where = (place: DetailsPlace, label: string): OptionChoice => ({
    label,
    selected: () => state.place === place,
    choose: (): void => {
      setPlace(parts, state, place);
      reportOptions(state);
    },
  });
  const centre = (on: boolean): OptionChoice => ({
    label: on ? 'On' : 'Off',
    selected: () => state.autoCenter === on,
    choose: (): void => {
      state.autoCenter = on;
      reportOptions(state);
    },
  });
  const { pane } = parts.area;
  pane.addOptions({
    title: 'Location',
    choices: [where('inline', 'Inline'), where('docked', 'Docked to Bottom')],
  });
  pane.addOptions({ title: 'Auto Center', choices: [centre(true), centre(false)] });
}

/** Apply the repository's layout, which an open brings with its page. */
function setLayout(
  parts: PanelParts,
  state: PanelState,
  path: string | null,
  layout: DetailsLayout,
): void {
  state.layout = layout;
  state.height = layout.height;
  state.divider = layout.divider;
  writeSizes(parts, state);
  parts.area.pane.setRepository(path, layout.fileView);
}

/** Apply the options kept for the application, which are read before the first page. */
function setOptions(parts: PanelParts, state: PanelState, options: DetailsOptions): void {
  state.autoCenter = options.autoCenter;
  state.settings = {
    defaultView: options.defaultFileView,
    compact: options.compactFolders,
    letters: options.statusLetters,
  };
  parts.area.pane.setSettings(state.settings);
  setPlace(parts, state, options.place);
}

/** Register the two drags, the two option groups and the pane's reports, once, when the view is mounted. */
export function listenControls(parts: PanelParts, state: PanelState): void {
  const kept = (): void => {
    reportLayout(state, { height: state.height, divider: state.divider });
  };
  drag(
    parts.area.edge,
    state,
    (start, event) => {
      const height = heightAt(parts, state, start, event.clientY);
      if (height !== state.height) {
        state.height = height;
        placeArea(parts, state);
        state.schedule();
      }
    },
    kept,
  );
  drag(
    parts.area.divider,
    state,
    (start, event) => {
      const divider = dividerAt(parts, start, event.clientX);
      if (divider !== state.divider) {
        state.divider = divider;
        writeSizes(parts, state);
      }
    },
    kept,
  );
  addOptionGroups(parts, state);
  parts.area.pane.on.view = (fileView: FileView): void => {
    reportLayout(state, { fileView });
  };
  parts.area.pane.on.settings = (settings: Settings): void => {
    state.settings = settings;
    reportOptions(state);
  };
}

/** The members of the view that size, place and keep the details area (E04-M01-S12). */
export interface ControlsView {
  /**
   * Say which repository is open, the key the files pane's view is kept by, and
   * the layout kept for it: its height, its divider and the file view a button
   * chose on it. Without one, the defaults.
   */
  readonly setRepository: (path: string | null, layout?: DetailsLayout) => void;
  /** Apply the options of the view: where it opens, Auto Center and the files pane's three. */
  readonly setOptions: (options: DetailsOptions) => void;
  /** Register what is told the options after a person chose one from the menu. */
  readonly onOptions: (listener: (options: DetailsOptions) => void) => void;
  /**
   * Register what is told the open repository's layout after a person released a
   * drag or pressed a view button: once for each, never while a pointer moves.
   */
  readonly onLayout: (listener: (layout: DetailsLayout) => void) => void;
}

/** The view's members for the controls, over the parts and the state. */
export function controlsOf(parts: PanelParts, state: PanelState): ControlsView {
  return {
    setRepository: (path, layout = DEFAULT_DETAILS_LAYOUT): void => {
      setLayout(parts, state, path, layout);
    },
    setOptions: (options): void => {
      setOptions(parts, state, options);
    },
    onOptions: (listener): void => {
      state.optionsListener = listener;
    },
    onLayout: (listener): void => {
      state.layoutListener = listener;
    },
  };
}

/**
 * Tell the main process what a person chose or dragged, to keep it for the next
 * start: `keeping` is handed each request and shows why one failed. The layout
 * is kept for the repository opened last, `path` says which.
 */
export function connectKept(
  view: ControlsView,
  path: () => string | null,
  keeping: (work: Promise<Result<unknown>>) => void,
): void {
  view.onOptions((options) => {
    keeping(window.gitGraphical.chooseDetailsOptions(options));
  });
  view.onLayout((layout) => {
    const opened = path();
    if (opened !== null) {
      keeping(window.gitGraphical.keepDetailsLayout({ path: opened, layout }));
    }
  });
}

/** Apply the options the main process kept, or say why it could not: before any page is drawn. */
export async function showStoredOptions(
  view: ControlsView,
  report: (failure: Failure) => void,
): Promise<void> {
  const reply = await window.gitGraphical.detailsOptions();
  if (reply.ok) {
    view.setOptions(reply.value);
  } else {
    report(reply);
  }
}
