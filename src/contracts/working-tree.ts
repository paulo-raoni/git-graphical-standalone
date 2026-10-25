/**
 * The state of the working tree, which decides whether the table shows an
 * "uncommitted changes" row above the first commit and what HEAD is called.
 *
 * It is a handful of scalars rather than a file list: the first milestone only
 * needs to know that there is something to show and how much of it there is.
 * The file list belongs to the commit details view, which is a later epic.
 *
 * **What a page carries is the working tree it shows.** On a page read under a
 * branch selection (`BranchSelection.branches` not `null`) whose commits do not
 * include HEAD's commit, the working tree is **withheld**: the page carries it as
 * having nothing uncommitted — `hasChanges` false, both counts 0 — and
 * `headCommitIndex` is `UNKNOWN_INDEX`, so no uncommitted row is drawn and none
 * is counted. `headRefName` and `isDetached` are still the repository's. A page
 * read on every branch always carries the working tree as it is.
 *
 * Invariants:
 * - `hasChanges` is true exactly when `changedFileCount + untrackedFileCount`
 *   is greater than zero;
 * - `headCommitIndex` is a valid index into the page's `CommitColumns`, or
 *   `UNKNOWN_INDEX` when HEAD's commit is not on the loaded page — including an
 *   unborn branch in a repository with no commits;
 * - `headRefName` is the short name of the checked-out branch, or `null` when
 *   `isDetached` is true;
 * - `isDetached` is true exactly when `headRefName` is `null`.
 */
export interface WorkingTree {
  /** Whether the page shows anything uncommitted, tracked or not. */
  readonly hasChanges: boolean;
  /** Tracked files with staged or unstaged modifications, or 0 when withheld. */
  readonly changedFileCount: number;
  /** Files git does not track and does not ignore, or 0 when withheld. */
  readonly untrackedFileCount: number;
  /** Index of HEAD's commit in the loaded page, or `UNKNOWN_INDEX`. */
  readonly headCommitIndex: number;
  /** Short name of the checked-out branch, or `null` when HEAD is detached. */
  readonly headRefName: string | null;
  /** Whether HEAD points straight at a commit rather than at a branch. */
  readonly isDetached: boolean;
}
