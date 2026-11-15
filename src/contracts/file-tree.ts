import type { ChangedFile, FileStatus } from './commit-details';
import type { FileAction } from './file-action';

/**
 * The rows of the changed-files pane, and every rule that decides them
 * (E04-M01-S10).
 *
 * `src/ui/` holds no rule (`docs/ADR-0002-architecture-and-performance.md`
 * decision 1) and may import this ring alone, so the order of the files, which
 * folders are one row, what a collapsed folder hides, and what a file's row says
 * about its status are decided here, under unit tests and the mutation gate. The
 * pane only draws the rows it is handed.
 *
 * The rules are a reading of the reference extension's pane, observed on
 * 2026-10-25 and 2026-11-11, and the orchestrator's choice where the task file
 * says so: the comparison of two names, the colour and letter of a copied and a
 * type-changed file, the spelling of the counts, and the tooltip's wording.
 */

/** The two shapes of the pane. */
export type FileView = 'tree' | 'list';

/** What decides the rows besides the files. */
export interface FileViewOptions {
  readonly view: FileView;
  /** A folder holding a single folder is one row with it (tree only). */
  readonly compact: boolean;
  /** Whether each file's row carries a status letter. */
  readonly letters: boolean;
  /**
   * The folders collapsed, by {@link FolderRow.key}: a collapsed folder's
   * descendants are not rows (tree only).
   */
  readonly collapsed: ReadonlySet<string>;
}

/** How a file's name is coloured: added and deleted are coloured, the rest are ordinary. */
export type FileTone = 'added' | 'deleted' | 'plain';

/** The counts of a file, spelt: `+3` and `-1`. */
export interface FileCounts {
  readonly plus: string;
  readonly minus: string;
}

/** One folder row of the tree. */
export interface FolderRow {
  readonly kind: 'folder';
  /** The path of the deepest folder of the row; it is what a collapse is recorded by. */
  readonly key: string;
  /** The folder's name, or the names of a compacted chain joined by {@link CHAIN_SEPARATOR}. */
  readonly label: string;
  /** How many folder rows enclose this one. */
  readonly depth: number;
  readonly collapsed: boolean;
}

/** One file row. */
export interface FileRow {
  readonly kind: 'file';
  /** The file's place in the reply's `files`, so that a click can name the file. */
  readonly index: number;
  readonly depth: number;
  /** The file's name in the tree and its full path in the list. */
  readonly label: string;
  readonly path: string;
  readonly oldPath: string | null;
  readonly status: FileStatus;
  readonly tone: FileTone;
  /** `null` where the pane shows none: added, deleted, untracked, or a count git did not give. */
  readonly counts: FileCounts | null;
  /** `A`, `M`, `D`, `R` or `U` when the letters are on, and `null` otherwise. */
  readonly letter: string | null;
  /** The full path, then the status spelt out, on a second line. */
  readonly tooltip: string;
  /** What the menu offers, in its order. */
  readonly actions: readonly FileAction[];
}

export type FileTreeRow = FolderRow | FileRow;

/** What joins the names of a compacted chain of folders. */
export const CHAIN_SEPARATOR = ' / ';

/** The tone and the letter of each status: a copy makes a new path and a change of type changes the file. */
const STATUS: Readonly<Record<FileStatus, readonly [FileTone, string]>> = {
  added: ['added', 'A'],
  copied: ['added', 'A'],
  untracked: ['added', 'U'],
  deleted: ['deleted', 'D'],
  modified: ['plain', 'M'],
  'type-changed': ['plain', 'M'],
  renamed: ['plain', 'R'],
};

/** The tone of a status. */
export function toneOf(status: FileStatus): FileTone {
  return STATUS[status][0];
}

/** The letter of a status. A copy and a change of type take the letter of their tone. */
export function letterOf(status: FileStatus): string {
  return STATUS[status][1];
}

/** The status spelt out for the tooltip. */
function statusText(file: ChangedFile): string {
  const from = `(${file.oldPath ?? ''} → ${file.path})`;
  switch (file.status) {
    case 'renamed':
      return `Renamed ${from}`;
    case 'copied':
      return `Copied ${from}`;
    case 'type-changed':
      return 'Type Changed';
    default:
      return file.status.charAt(0).toUpperCase() + file.status.slice(1);
  }
}

/** Statuses whose row shows no counts. */
const NO_COUNTS: ReadonlySet<FileStatus> = new Set(['added', 'deleted', 'untracked']);

/** The counts a row shows, or `null`. */
function countsOf(file: ChangedFile): FileCounts | null {
  if (NO_COUNTS.has(file.status) || file.additions === null || file.deletions === null) {
    return null;
  }
  return { plus: `+${String(file.additions)}`, minus: `-${String(file.deletions)}` };
}

/** What a file offers: a deleted file has nothing to open. */
export function actionsOf(status: FileStatus): readonly FileAction[] {
  return status === 'deleted'
    ? ['copy-absolute-path', 'copy-relative-path']
    : ['open-file', 'copy-absolute-path', 'copy-relative-path'];
}

function fileRow(
  file: ChangedFile,
  index: number,
  depth: number,
  label: string,
  letters: boolean,
): FileRow {
  return {
    kind: 'file',
    index,
    depth,
    label,
    path: file.path,
    oldPath: file.oldPath,
    status: file.status,
    tone: toneOf(file.status),
    counts: countsOf(file),
    letter: letters ? letterOf(file.status) : null,
    tooltip: `${file.path}\n${statusText(file)}`,
    actions: actionsOf(file.status),
  };
}

/** Two names in the order of the pane: lower-cased, then as they are, in UTF-16 code units. */
function compareNames(left: string, right: string): number {
  const order = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);
  return order(left.toLowerCase(), right.toLowerCase()) || order(left, right);
}

/** One file of the tree being built: its name in its folder and its place in the reply. */
interface Leaf {
  readonly name: string;
  readonly index: number;
  readonly file: ChangedFile;
}

/** What holds folders and files: the root of the tree being built, or a folder of it. */
interface Branch {
  readonly folders: Map<string, Folder>;
  readonly files: Leaf[];
}

/** A folder of the tree being built, with its path from the root. */
interface Folder extends Branch {
  readonly name: string;
  readonly path: string;
}

function newFolder(name: string, path: string): Folder {
  return { name, path, folders: new Map(), files: [] };
}

/** The tree of `files`: every path split at its slashes. */
function treeOf(files: readonly ChangedFile[]): Branch {
  const root: Branch = { folders: new Map(), files: [] };
  for (const [index, file] of files.entries()) {
    const parts = file.path.split('/');
    const name = parts.pop() as string;
    let folder: Branch = root;
    let path = '';
    for (const part of parts) {
      path = path === '' ? part : `${path}/${part}`;
      let next = folder.folders.get(part);
      if (next === undefined) {
        next = newFolder(part, path);
        folder.folders.set(part, next);
      }
      folder = next;
    }
    folder.files.push({ name, index, file });
  }
  return root;
}

function sortedFolders(folder: Branch): Folder[] {
  return [...folder.folders.values()].sort((a, b) => compareNames(a.name, b.name));
}

function sortedFiles(folder: Branch): Leaf[] {
  // `sort` is stable, so two files of one name stay in the reply's order.
  return [...folder.files].sort((a, b) => compareNames(a.name, b.name));
}

/** The only child of a folder that holds nothing else, which compaction joins to it. */
function loneFolder(folder: Branch): Folder | null {
  if (folder.files.length > 0 || folder.folders.size !== 1) {
    return null;
  }
  return [...folder.folders.values()][0] as Folder;
}

/** Walk `folder`'s children, folders first, appending rows. */
function walk(folder: Branch, depth: number, options: FileViewOptions, rows: FileTreeRow[]): void {
  for (const child of sortedFolders(folder)) {
    let deepest = child;
    let label = child.name;
    for (let next = options.compact ? loneFolder(deepest) : null; next !== null;) {
      deepest = next;
      label += CHAIN_SEPARATOR + next.name;
      next = loneFolder(deepest);
    }
    const collapsed = options.collapsed.has(deepest.path);
    rows.push({ kind: 'folder', key: deepest.path, label, depth, collapsed });
    if (!collapsed) {
      walk(deepest, depth + 1, options, rows);
    }
  }
  for (const { name, index, file } of sortedFiles(folder)) {
    rows.push(fileRow(file, index, depth, name, options.letters));
  }
}

/** The list's rows: the tree's order, flattened, every folder expanded, each with its full path. */
function listOf(folder: Branch, options: FileViewOptions): FileRow[] {
  const rows: FileRow[] = [];
  const visit = (at: Branch): void => {
    for (const child of sortedFolders(at)) {
      visit(child);
    }
    for (const { index, file } of sortedFiles(at)) {
      rows.push(fileRow(file, index, 0, file.path, options.letters));
    }
  };
  visit(folder);
  return rows;
}

/**
 * The rows the pane shows for `files` under `options`, in order.
 *
 * Computed once per reply, per collapse or expand and per change of option, and
 * never per scroll or per frame.
 */
export function fileRowsOf(
  files: readonly ChangedFile[],
  options: FileViewOptions,
): readonly FileTreeRow[] {
  const root = treeOf(files);
  if (options.view === 'list') {
    return listOf(root, options);
  }
  const rows: FileTreeRow[] = [];
  walk(root, 0, options, rows);
  return rows;
}
