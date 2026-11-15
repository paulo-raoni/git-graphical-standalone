import { detailsTargetOf } from './commit-details';
import type { DetailsTarget } from './commit-details';
import type { Result } from './result';

/**
 * What a person can do with one changed file (E04-M01-S10), and the one place a
 * request for it is checked before anything of it reaches git, the file system or
 * the clipboard.
 *
 * The window knows the path a repository was opened by, which may be a folder
 * inside it, and nothing in a page names the repository's top level. An absolute
 * path and a file's current place therefore come from git, in the utility
 * process, and the clipboard and the file manager are the main process's
 * (`docs/ADR-0002-architecture-and-performance.md` decision 2).
 */

/** What a person can do with one changed file in E04-M01. */
export type FileAction = 'open-file' | 'copy-absolute-path' | 'copy-relative-path';

export interface FileActionRequest {
  readonly action: FileAction;
  /** The details the file was listed in: a commit or a stash by its full object name, or the uncommitted changes. */
  readonly target: DetailsTarget;
  /** The file's path as the details reply carries it (`ChangedFile.path`). */
  readonly path: string;
}

/** What was done: the text written to the clipboard, or the absolute path shown in the file manager. */
export interface FileActionDone {
  readonly path: string;
}

export type FileActionResponse = Result<FileActionDone>;

const ACTIONS: readonly string[] = ['open-file', 'copy-absolute-path', 'copy-relative-path'];

/**
 * Whether `path` is a relative path a repository can hold: non-empty,
 * `/`-separated, with no empty, `.` or `..` segment, no leading `/`, no
 * backslash and no NUL.
 *
 * A backslash is refused outright although git can track a file whose name holds
 * one on a platform that allows it: the pane's path is the only thing a request
 * names, and a segment holding a backslash is one a Windows join would read as
 * two.
 */
export function isRelativeFilePath(path: unknown): path is string {
  if (typeof path !== 'string' || path.includes('\\') || path.includes('\0')) {
    return false;
  }
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/**
 * The request `value` is, or `null` when it is not one: an action that is one of
 * the three, a target {@link detailsTargetOf} accepts, and a path
 * {@link isRelativeFilePath} accepts. The answer is a new object holding those
 * three fields alone.
 */
export function fileActionRequestOf(value: unknown): FileActionRequest | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { action, target, path } = value as {
    readonly action?: unknown;
    readonly target?: unknown;
    readonly path?: unknown;
  };
  const checked = detailsTargetOf(target);
  if (!ACTIONS.includes(action as string) || checked === null) {
    return null;
  }
  if (!isRelativeFilePath(path)) {
    return null;
  }
  return { action: action as FileAction, target: checked, path };
}

/** The segments of `path` once every `.` and `..` is applied, or `null` when a `..` leaves the start. */
function resolvedSegments(path: string): string[] | null {
  const kept: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '..') {
      if (kept.pop() === undefined) {
        return null;
      }
    } else if (segment !== '.') {
      kept.push(segment);
    }
  }
  return kept;
}

/**
 * Whether `candidate` lies strictly inside `top`: both written with `/`, and
 * `candidate`, once its `.` and `..` segments are applied, is `top`'s own segments,
 * as written, followed by at least one more. A `top` that holds a `.` or `..`
 * segment is therefore never one anything lies inside.
 */
export function liesInside(top: string, candidate: string): boolean {
  const [inner, outer] = [resolvedSegments(candidate), top.split('/')];
  if (inner === null || inner.length <= outer.length) {
    return false;
  }
  return outer.every((segment, at) => inner[at] === segment);
}

/**
 * The absolute path of `relative` below the repository's top level `top`, written
 * with `separator`, or `null` when `relative` is not a relative path
 * ({@link isRelativeFilePath}), `top` is empty, or the joined path does not lie
 * inside `top` ({@link liesInside}).
 *
 * The last check is a second one on purpose: the first makes a join that leaves
 * `top` impossible, and this one is what a change to the first cannot silently
 * remove (held by `file-action.test.ts`).
 */
export function absolutePathIn(
  top: string,
  relative: string,
  separator: '/' | '\\',
): string | null {
  if (top === '' || !isRelativeFilePath(relative)) {
    return null;
  }
  const base = top.replace(/\\/g, '/').replace(/\/+$/, '');
  const joined = `${base}/${relative}`;
  if (!liesInside(base, joined)) {
    return null;
  }
  return separator === '/' ? joined : joined.replace(/\//g, '\\');
}
