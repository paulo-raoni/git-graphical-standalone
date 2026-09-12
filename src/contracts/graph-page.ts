import type { CommitColumns } from './commits';
import type { LayoutRows } from './layout';
import type { Refs } from './refs';
import type { WorkingTree } from './working-tree';

/**
 * Everything the renderer needs to draw the table once: the commits loaded so
 * far, the references that decorate them, the working tree that decides the top
 * row, and the layout those three produced.
 *
 * This is the unit that crosses the IPC boundary. A "Load More Commits" reply
 * is a whole page again rather than a delta, because the buffers are grown and
 * reused on the producing side and shipped as transferables: sending the grown
 * page costs a memcpy, while a delta would cost the renderer a merge step and a
 * second representation to keep correct.
 *
 * Invariants:
 * - `layout.rowCount` is `commits.count`, plus one when
 *   `workingTree.hasChanges` is true;
 * - every index in `refs` and `workingTree` is an index into `commits` or
 *   `UNKNOWN_INDEX`;
 * - `hasMore` is false only when the producer has reached the repository's
 *   root commits, so the Load More control can be hidden rather than guessed at.
 */
export interface GraphPage {
  /** The commits loaded so far, oldest last, in the order git returned them. */
  readonly commits: CommitColumns;
  /** Every reference of the repository, pointing into `commits`. */
  readonly refs: Refs;
  /** The working tree state that decides the uncommitted row. */
  readonly workingTree: WorkingTree;
  /** The drawing instructions for `commits` plus the uncommitted row. */
  readonly layout: LayoutRows;
  /** Whether more commits exist beyond this page. */
  readonly hasMore: boolean;
}
