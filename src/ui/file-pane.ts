import { fileRowsOf } from '../contracts/index';
import type {
  ChangedFile,
  DetailsTarget,
  FileAction,
  FileActionRequest,
  FileActionResponse,
  FileRow,
  FileTreeRow,
  FileView,
} from '../contracts/index';

import { createPoolRow, FILE_ROW_HEIGHT, icon, make, writeRow } from './file-row';
import type { PoolRow } from './file-row';
import { createFileMenu, optionEntries, optionGroups } from './file-menu';
import type { FileMenu, MenuEntry, OptionGroup, Settings } from './file-menu';

/**
 * The changed-files pane of the details area (E04-M01-S10): the files as a tree
 * or a list, each with its status, counts and actions, and the controls that
 * choose how.
 *
 * It holds **no rule**: which rows exist and what each says is
 * `fileRowsOf` of `src/contracts/file-tree.ts`, asked once per reply, per
 * collapse or expand and per change of view or option, and never per scroll or
 * per frame. This module draws them, and does it for the rows inside its own
 * height alone (`docs/ADR-0002-architecture-and-performance.md` decision 5): a
 * fixed pool of row elements, moved and rewritten in place on the pane's own
 * scroll, so a commit of fifty thousand files costs the elements twenty rows do.
 * Like every row of this window the pool is built from elements and
 * `textContent`, so no path is ever read as markup.
 */

/** Rows kept above and below the pane's own height, written before they are revealed. */
export const FILE_OVERSCAN = 4;

/** What a slot holds before it has been written: not a row, and not the hidden mark either. */
const UNSET = -2;

export type { OptionChoice, OptionGroup } from './file-menu';

/** What the pane calls to do a file action, and is told the outcome of. */
export type ActionListener = (request: FileActionRequest) => Promise<FileActionResponse>;

/** What the area builds the pane's surroundings from, and drives it with. */
export interface FilePane {
  /** The pane itself, to put in the area's files cell. */
  readonly root: HTMLElement;
  /** The buttons that go in the area's controls column, in order. */
  readonly controls: readonly HTMLElement[];
  /** The one menu element, to put where `position: fixed` is relative to the window. */
  readonly menu: HTMLElement;
  /** Show a reply's files; `target` is what they were listed in. */
  readonly show: (files: readonly ChangedFile[], target: DetailsTarget) => void;
  /** Close the menu, if it is open: the area closing does, and leaves the files where they are. */
  readonly closeMenu: () => void;
  /** Whether the menu is open. */
  readonly menuOpen: () => boolean;
  /** Move the menu's focus down (`1`) or up (`-1`) one entry (E04-M01-S11). */
  readonly stepMenu: (delta: number) => void;
  /** Show no file, and close the menu. */
  readonly clear: () => void;
  /** Say which repository is open: the key its view is kept by. */
  readonly setRepository: (path: string | null) => void;
  readonly onAction: (listener: ActionListener) => void;
  /** Add an option and its values to the options menu. */
  readonly addOptions: (group: OptionGroup) => void;
}

interface Parts {
  readonly root: HTMLElement;
  readonly error: HTMLElement;
  readonly scroll: HTMLElement;
  readonly spacer: HTMLElement;
  readonly menu: FileMenu;
  readonly tree: HTMLButtonElement;
  readonly list: HTMLButtonElement;
  readonly options: HTMLButtonElement;
}

interface State {
  files: readonly ChangedFile[];
  target: DetailsTarget | null;
  rows: readonly FileTreeRow[];
  collapsed: Set<string>;
  settings: Settings;
  /** The view a person pressed, by the path the repository was opened by. */
  views: Map<string, FileView>;
  repository: string | null;
  pool: PoolRow[];
  slotRows: Int32Array;
  frame: number | null;
  listener: ActionListener | null;
  groups: OptionGroup[];
}

function viewOf(state: State): FileView {
  return state.views.get(state.repository ?? '') ?? state.settings.defaultView;
}

/** Grow or shrink the pool to `size`, which is when the pane's height changes and at no other time. */
function resizePool(parts: Parts, state: State, size: number): void {
  while (state.pool.length > size) {
    state.pool.pop()?.root.remove();
  }
  while (state.pool.length < size) {
    const made = createPoolRow();
    state.pool.push(made);
    parts.spacer.append(made.root);
  }
  state.slotRows = new Int32Array(size).fill(UNSET);
}

/** One frame: read the pane's height and offset, then write the rows inside them. */
function paint(parts: Parts, state: State): void {
  state.frame = null;
  const [top, height] = [parts.scroll.scrollTop, parts.scroll.clientHeight];
  const size = height === 0 ? 0 : Math.ceil(height / FILE_ROW_HEIGHT) + 2 * FILE_OVERSCAN;
  if (state.pool.length !== size) {
    resizePool(parts, state, size);
  }
  const room = Math.max(0, state.rows.length - size);
  const first = Math.min(room, Math.max(0, Math.floor(top / FILE_ROW_HEIGHT) - FILE_OVERSCAN));
  for (const [slot, made] of state.pool.entries()) {
    const offset = (slot - (first % size) + size) % size;
    const row = first + offset < state.rows.length ? first + offset : -1;
    if (state.slotRows[slot] === row) {
      continue;
    }
    state.slotRows[slot] = row;
    made.root.hidden = row < 0;
    const shown = state.rows[row];
    if (shown !== undefined) {
      writeRow(made, shown, row);
    }
  }
}

function schedule(parts: Parts, state: State): void {
  state.frame ??= requestAnimationFrame(() => {
    paint(parts, state);
  });
}

/** Compute the rows again and draw them: the one place the rules are asked. */
function rebuild(parts: Parts, state: State): void {
  state.rows = fileRowsOf(state.files, {
    view: viewOf(state),
    compact: state.settings.compact,
    letters: state.settings.letters,
    collapsed: state.collapsed,
  });
  parts.spacer.style.height = `${String(state.rows.length * FILE_ROW_HEIGHT)}px`;
  state.slotRows.fill(UNSET);
  const list = viewOf(state) === 'list';
  parts.tree.classList.toggle('details__tool--active', !list);
  parts.list.classList.toggle('details__tool--active', list);
  parts.tree.ariaPressed = String(!list);
  parts.list.ariaPressed = String(list);
  schedule(parts, state);
}

/** A change of view or option: everything is expanded again. */
function restart(parts: Parts, state: State): void {
  state.collapsed.clear();
  rebuild(parts, state);
}

function showError(parts: Parts, text: string): void {
  parts.error.textContent = text;
  parts.error.hidden = text === '';
}

function perform(parts: Parts, state: State, name: FileAction, file: FileRow): void {
  showError(parts, '');
  if (state.target === null || state.listener === null) {
    return;
  }
  const done = state.listener({ action: name, target: state.target, path: file.path });
  void done.then(
    (reply) => {
      showError(parts, reply.ok ? '' : reply.message);
    },
    (error: unknown) => {
      showError(parts, error instanceof Error ? error.message : String(error));
    },
  );
}

const MENU_LABELS: Readonly<Record<FileAction, string>> = {
  'open-file': 'Open File',
  'copy-absolute-path': 'Copy Absolute File Path',
  'copy-relative-path': 'Copy Relative File Path',
};

/** The row an event happened on, with its slot's row. */
function rowOf(state: State, event: Event): FileTreeRow | null {
  const found = event.target instanceof Element ? event.target.closest('.files__row') : null;
  const slot = state.pool.findIndex((made) => made.root === found);
  return state.rows[state.slotRows[slot] ?? -1] ?? null;
}

function clicked(parts: Parts, state: State, event: MouseEvent): void {
  const row = rowOf(state, event);
  if (row === null) {
    return;
  }
  const button = event.target instanceof Element ? event.target.closest('.files__act') : null;
  if (row.kind === 'folder') {
    state.collapsed[row.collapsed ? 'delete' : 'add'](row.key);
    rebuild(parts, state);
  } else if (button instanceof HTMLElement) {
    perform(parts, state, button.dataset['action'] as FileAction, row);
  }
}

function contextOf(parts: Parts, state: State, event: MouseEvent): void {
  const row = rowOf(state, event);
  if (row?.kind !== 'file') {
    return;
  }
  event.preventDefault();
  const entries: MenuEntry[] = row.actions.map((name) => ({
    label: MENU_LABELS[name],
    run: (): void => {
      perform(parts, state, name, row);
    },
  }));
  parts.menu.open(entries, event.clientX, event.clientY, event);
}

function tool(title: string, drawing: 'tree' | 'list' | 'options'): HTMLButtonElement {
  const button = make('button', 'details__tool');
  button.type = 'button';
  button.title = title;
  button.ariaLabel = title;
  button.append(icon(drawing));
  return button;
}

function buildParts(): Parts {
  const root = make('div', 'files');
  const error = make('div', 'files__error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const scroll = make('div', 'files__scroll');
  const spacer = make('div', 'files__spacer');
  scroll.append(spacer);
  root.append(error, scroll);
  const [tree, list] = [tool('File Tree View', 'tree'), tool('File List View', 'list')];
  return {
    root,
    error,
    scroll,
    spacer,
    menu: createFileMenu(),
    tree,
    list,
    options: tool('Options', 'options'),
  };
}

function listen(parts: Parts, state: State): void {
  const again = (): void => {
    schedule(parts, state);
  };
  parts.scroll.addEventListener('scroll', again, { passive: true });
  parts.scroll.addEventListener('click', (event) => {
    clicked(parts, state, event);
  });
  parts.scroll.addEventListener('contextmenu', (event) => {
    contextOf(parts, state, event);
  });
  new ResizeObserver(again).observe(parts.scroll);
  const choose = (name: FileView): void => {
    state.views.set(state.repository ?? '', name);
    restart(parts, state);
  };
  parts.tree.addEventListener('click', () => {
    choose('tree');
  });
  parts.list.addEventListener('click', () => {
    choose('list');
  });
  parts.options.addEventListener('click', (event) => {
    const wasOpen = parts.menu.isOpen();
    parts.menu.close();
    if (!wasOpen) {
      const box = parts.options.getBoundingClientRect();
      parts.menu.open(optionEntries(state.groups), box.right, box.bottom, event);
    }
  });
}

/** Nothing shown, the tree and compact folders chosen, no letters. */
function initialState(): State {
  return {
    files: [],
    target: null,
    rows: [],
    collapsed: new Set(),
    settings: { defaultView: 'tree', compact: true, letters: false },
    views: new Map(),
    repository: null,
    pool: [],
    slotRows: new Int32Array(0),
    frame: null,
    listener: null,
    groups: [],
  };
}

/** Build the pane, with no file in it. */
export function createFilePane(): FilePane {
  const parts = buildParts();
  const state = initialState();
  state.groups.push(
    ...optionGroups(state.settings, () => {
      restart(parts, state);
    }),
  );
  listen(parts, state);
  rebuild(parts, state);
  const reset = (files: readonly ChangedFile[], target: DetailsTarget | null): void => {
    parts.menu.close();
    showError(parts, '');
    parts.scroll.scrollTop = 0;
    state.files = files;
    state.target = target;
    restart(parts, state);
  };
  return {
    root: parts.root,
    controls: [parts.tree, parts.list, parts.options],
    menu: parts.menu.root,
    show: reset,
    closeMenu: parts.menu.close,
    menuOpen: parts.menu.isOpen,
    stepMenu: parts.menu.step,
    clear: (): void => {
      reset([], null);
    },
    setRepository: (path: string | null): void => {
      state.repository = path;
    },
    onAction: (listener: ActionListener): void => {
      state.listener = listener;
    },
    addOptions: (group: OptionGroup): void => {
      state.groups.push(group);
    },
  };
}
