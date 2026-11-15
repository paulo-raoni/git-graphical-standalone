import type { Result } from './result';

/**
 * The details of one commit, or of the uncommitted changes, as the window asks
 * for them on their own channel (`CHANNELS.commitDetails`).
 *
 * The page carries none of this on purpose: a commit's message body is absent
 * from `CommitColumns` and the uncommitted row carries counts alone
 * (`./commits.ts`, `./working-tree.ts`), because every commit of a page would pay
 * for a body and a file list that only the one commit opened is ever shown. So the
 * details are read from git when a commit is asked for, and never on open, refresh
 * or load more (E04-M01-S06, whose slice document gives the git processes each
 * request costs).
 *
 * A request names the open repository's commit by its full object name, or the
 * uncommitted changes. {@link detailsTargetOf} is the one place a request from the
 * page is checked before anything of it reaches a command line.
 */

/** What to read the details of: one commit by its full object name, or the uncommitted changes. */
export type DetailsTarget =
  | {
      readonly kind: 'commit';
      /** The commit's full object name: 40 lower-case hexadecimal digits, or 64. */
      readonly hash: string;
    }
  | { readonly kind: 'uncommitted' };

/** Read the details of {@link DetailsRequest.target} in the repository open in the window. */
export interface DetailsRequest {
  readonly target: DetailsTarget;
}

/**
 * One person of a commit and the moment they are recorded at: epoch seconds in
 * UTC and the offset from UTC they were at, in minutes, which is how git stores
 * a date and how `CommitColumns` keeps one.
 */
export interface DetailsPerson {
  readonly name: string;
  readonly email: string;
  readonly time: number;
  readonly offsetMinutes: number;
}

/**
 * What happened to a file: one of git's own statuses, spelt out, or `untracked`
 * for a file git does not track (the uncommitted changes' new files, and a
 * stash's untracked files).
 */
export type FileStatus =
  'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'type-changed' | 'untracked';

/** One changed file, in the order git lists it. */
export interface ChangedFile {
  /** The path the file has after the change, `/`-separated, relative to the repository's root. */
  readonly path: string;
  /** The path a renamed or copied file came from, or `null` for every other status. */
  readonly oldPath: string | null;
  readonly status: FileStatus;
  /** Lines added, or `null` for a binary file and wherever git gives no count. */
  readonly additions: number | null;
  /** Lines deleted, or `null` for a binary file and wherever git gives no count. */
  readonly deletions: number | null;
}

/**
 * One commit's details.
 *
 * `files` are the changes against the **first** parent, a merge included, and
 * against the empty tree for a commit with no parent, with renames detected.
 */
export interface CommitDetails {
  /** The commit's full object name, as asked for. */
  readonly hash: string;
  /** Its parents' full object names, in order: none for a root commit, two or more for a merge. */
  readonly parents: readonly string[];
  readonly author: DetailsPerson;
  readonly committer: DetailsPerson;
  /** The whole message as git stores it: the subject, then the body exactly as written. */
  readonly message: string;
  readonly files: readonly ChangedFile[];
}

/**
 * The uncommitted changes' details: every path that differs between `HEAD` and
 * the working tree, staged or not, then every untracked file. A repository with
 * no commit yet lists every path as added or untracked.
 */
export interface UncommittedDetails {
  readonly files: readonly ChangedFile[];
}

/**
 * The details asked for, or why they could not be read: a hash that is not a
 * commit of the open repository is a failure, as is a request that names neither
 * a commit by its full object name nor the uncommitted changes.
 */
export type DetailsResponse = Result<CommitDetails | UncommittedDetails>;

/** A full object name as git prints one: 40 lower-case hexadecimal digits (SHA-1) or 64 (SHA-256). */
const OBJECT_NAME = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** Whether `text` is a full object name as git prints one, and nothing else. */
export function isObjectName(text: unknown): boolean {
  return typeof text === 'string' && OBJECT_NAME.test(text);
}

/**
 * The target `value` names, or `null` when it names none: anything but an
 * object whose `kind` is `uncommitted`, or whose `kind` is `commit` and whose
 * `hash` is a full object name ({@link isObjectName}). The answer is a new
 * object holding those fields alone.
 *
 * It is what keeps a request from the page off a command line until it is one
 * of the two things a request may be: a hash that is not forty or sixty-four
 * lower-case hexadecimal digits, such as `--output=x` or `HEAD~1`, names
 * nothing.
 */
export function detailsTargetOf(value: unknown): DetailsTarget | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { kind, hash } = value as { readonly kind?: unknown; readonly hash?: unknown };
  if (kind === 'uncommitted') {
    return { kind };
  }
  if (kind === 'commit' && isObjectName(hash)) {
    return { kind, hash: hash as string };
  }
  return null;
}
