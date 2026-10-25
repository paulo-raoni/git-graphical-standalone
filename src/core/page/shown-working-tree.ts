import { UNKNOWN_INDEX } from '../../contracts/index';
import type { BranchSelection, WorkingTree } from '../../contracts/index';

/**
 * Whether a page shows the working tree at all, which is the decision behind the
 * uncommitted-changes row once a person can choose which branches are shown.
 *
 * **The rule.** On every branch, the working tree is shown as it is, wherever
 * HEAD's commit lands — on this page or past it — which is what the window did
 * before selections existed. Under a selection it is shown only when HEAD's
 * commit is **among the commits read**; otherwise the page withholds it, carrying
 * it as having nothing uncommitted, as `src/contracts/working-tree.ts` states.
 * The reference extension was observed showing the uncommitted row exactly when
 * the current branch's commit was in the graph shown, and not otherwise
 * (`docs/plan/E03-branch-filtering-and-find/M01-branches-dropdown/S09-branch-selection-reaches-git.md`).
 *
 * "Among the commits read" is the page's own `headCommitIndex`, so the rule costs
 * no further question of git: HEAD's commit is either a row of the page or it is
 * `UNKNOWN_INDEX`. The price is stated rather than hidden: a selected branch
 * whose history reaches HEAD's commit only below the first page shows the row
 * once a Load More has read that far, not before.
 *
 * It is here and not in the view because it is a decision that can be wrong
 * (`docs/ADR-0002-architecture-and-performance.md` decision 1), and here and not
 * in the adapter because the adapter holds no rule about what git's output means.
 *
 * **Why withholding is spelled with the fields the contract already had.** The
 * view draws the row from `hasChanges` alone, and a working tree whose counts
 * are 0 keeps the invariant that `hasChanges` is true exactly when a count is
 * not; so a withheld working tree draws correctly with no change to the view and
 * no field whose absence would have to mean something.
 */
export function shownWorkingTree(
  tree: WorkingTree,
  selection: BranchSelection | undefined,
): WorkingTree {
  if (selection === undefined || selection.branches === null) {
    return tree;
  }
  if (tree.headCommitIndex !== UNKNOWN_INDEX) {
    return tree;
  }
  return { ...tree, hasChanges: false, changedFileCount: 0, untrackedFileCount: 0 };
}
