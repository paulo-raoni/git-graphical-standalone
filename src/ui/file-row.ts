import type { FileAction, FileRow, FileTreeRow, FolderRow } from '../contracts/index';

/**
 * The icons and the rows of the changed-files pane (E04-M01-S10). The icons are **drawn for this project**:
 * a folder shut and open, a file, two sheets for copying, a file with an arrow
 * leaving it, the two shapes of the pane and a set of sliders for its options.
 *
 * Each is a few strokes on a 16-unit grid, written here as path data. No icon
 * file of the reference extension or of any icon set was opened to make them;
 * the reference's pane was seen to show a folder, a file and small icons on
 * hover, and that is the whole of what they rest on (clean room,
 * `AGENTS.md` §1). They are built from elements, as every row is, and take
 * their colour from `currentColor`, so the stylesheet decides it.
 */

const SVG = 'http://www.w3.org/2000/svg';

/** The outlines of every icon, by name. */
const DRAWINGS = {
  folder: 'M1.5 3.5h4.5l1.5 1.5h7v7.5h-13z',
  folderOpen: 'M1.5 12.5v-9h4.5l1.5 1.5h6v2 M1.5 12.5l2-5.5h12l-2 5.5z',
  file: 'M3.5 1.5h6l3 3v10h-9z M9.5 1.5v3h3',
  copy: 'M5.5 5.5h8v9h-8z M3.5 10.5v-9h8',
  open: 'M9 2.5h4.5v4.5 M13.5 2.5 7 9 M11.5 9.5v4h-9v-9h4',
  tree: 'M2 3h5 M5 7.5h9 M5 12h9 M3.5 3v9 M3.5 7.5h1.5 M3.5 12h1.5',
  list: 'M2 4h12 M2 8h12 M2 12h12',
  options: 'M2 4h3 M8 4h6 M2 8h7 M12 8h2 M2 12h2 M7 12h7 M6.5 2.5v3 M10.5 6.5v3 M5.5 10.5v3',
} as const;

/** The name of a drawing. */
export type IconName = keyof typeof DRAWINGS;

/** A new icon, sized by the stylesheet. */
export function icon(name: IconName): SVGSVGElement {
  const made = document.createElementNS(SVG, 'svg');
  made.setAttribute('viewBox', '0 0 16 16');
  made.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', DRAWINGS[name]);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.3');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('stroke-linecap', 'round');
  made.append(path);
  return made;
}

/** One row's height, in pixels: a row is one line of this height, and a longer name is clipped. */
export const FILE_ROW_HEIGHT = 22;

/** How far a level of the tree indents a row, in pixels. */
const INDENT = 14;

/** One element of the pane's pool: the cells of a row, built once and rewritten in place. */
export interface PoolRow {
  readonly root: HTMLElement;
  readonly shut: SVGElement;
  readonly open: SVGElement;
  readonly file: SVGElement;
  readonly letter: HTMLElement;
  readonly name: HTMLElement;
  readonly counts: HTMLElement;
  readonly plus: HTMLElement;
  readonly minus: HTMLElement;
  readonly openAction: HTMLElement;
}

/** A new element with a class. */
export function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  made.className = className;
  return made;
}

function action(name: FileAction, title: string, drawing: IconName): HTMLButtonElement {
  const button = make('button', 'files__act');
  button.type = 'button';
  button.title = title;
  button.ariaLabel = title;
  button.dataset['action'] = name;
  button.append(icon(drawing));
  return button;
}

/** Build one pool row, once per pool slot. */
export function createPoolRow(): PoolRow {
  const root = make('div', 'files__row');
  const [shut, open, file] = [icon('folder'), icon('folderOpen'), icon('file')];
  const [letter, name] = [make('span', 'files__letter'), make('span', 'files__name')];
  const counts = make('span', 'files__counts');
  const [plus, minus] = [make('span', 'files__plus'), make('span', 'files__minus')];
  counts.append('(', plus, ' | ', minus, ')');
  const actions = make('span', 'files__acts');
  const openAction = action('open-file', 'Open File', 'open');
  actions.append(action('copy-absolute-path', 'Copy Absolute File Path to Clipboard', 'copy'));
  actions.append(openAction);
  root.append(shut, open, file, letter, name, counts, actions);
  return { root, shut, open, file, letter, name, counts, plus, minus, openAction };
}

function show(element: SVGElement, shown: boolean): void {
  element.style.display = shown ? '' : 'none';
}

function writeFolder(made: PoolRow, row: FolderRow): void {
  made.root.className = 'files__row files__row--folder';
  made.root.title = row.label;
  show(made.shut, row.collapsed);
  show(made.open, !row.collapsed);
  show(made.file, false);
  made.letter.hidden = true;
  made.counts.hidden = true;
  made.openAction.hidden = true;
}

function writeFile(made: PoolRow, row: FileRow): void {
  made.root.className = `files__row files__row--file files__row--${row.tone}`;
  made.root.title = row.tooltip;
  show(made.shut, false);
  show(made.open, false);
  show(made.file, true);
  made.letter.textContent = row.letter ?? '';
  made.letter.hidden = row.letter === null;
  made.counts.hidden = row.counts === null;
  made.plus.textContent = row.counts?.plus ?? '';
  made.minus.textContent = row.counts?.minus ?? '';
  made.openAction.hidden = !row.actions.includes('open-file');
}

/** Put `row` in `made` and move it to the `at`-th line. */
export function writeRow(made: PoolRow, row: FileTreeRow, at: number): void {
  made.root.style.transform = `translateY(${String(at * FILE_ROW_HEIGHT)}px)`;
  made.root.style.paddingLeft = `${String(4 + row.depth * INDENT)}px`;
  made.name.textContent = row.label;
  if (row.kind === 'folder') {
    writeFolder(made, row);
  } else {
    writeFile(made, row);
  }
}
