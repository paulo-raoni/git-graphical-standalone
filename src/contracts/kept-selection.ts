import { branchEntries, LOCAL_PREFIX, REMOTE_PREFIX } from './branch-menu';
import type { BranchSelection } from './ipc';
import type { Refs } from './refs';

/**
 * The rules of the branch selection kept per repository: which stored value is a
 * selection at all, which selection an open reads under, and which kept branches
 * a repository still has.
 *
 * The main process keeps the selection last applied to each repository, in a
 * file of its own under the user-data directory (`src/app/selections.ts`), and
 * an open reads under it. Reading and writing the file is that module's; every
 * decision about what is in it is here.
 *
 * **Why this ring.** Each of these is a decision that can be wrong, and
 * `docs/ADR-0002-architecture-and-performance.md` decision 1 keeps every decision
 * out of `src/app/`, which may hold wiring and nothing else. This ring is inside
 * the mutation gate's scope, which `src/app/` is not, and it is the ring
 * `src/contracts/branch-menu.ts` is in, whose list of entries the last rule reuses
 * rather than restates. It keeps this ring's other rule: it imports only its
 * siblings and keeps nothing between calls.
 *
 * The behaviour is the owner's ruling of 2026-10-28, recorded in
 * `docs/plan/E03-branch-filtering-and-find/M01-branches-dropdown/S12-selection-kept-per-repository.md`.
 */

/** Whether `name` is a branch's full reference name, as {@link BranchSelection} spells it. */
function isFullName(name: unknown): boolean {
  return (
    typeof name === 'string' && (name.startsWith(LOCAL_PREFIX) || name.startsWith(REMOTE_PREFIX))
  );
}

/**
 * The selection `value` holds, or `null` when it is not one this application
 * wrote: anything but an object whose `showRemoteBranches` is a boolean and whose
 * `branches` is `null` or a list of distinct full reference names. The answer is
 * a new object holding those two fields alone.
 *
 * It is how a record read from the disk is checked, and how a selection that
 * arrived from the page is checked before it is written: neither is trusted. A
 * list may be empty; {@link survivingSelection} turns it into every branch.
 */
export function keptSelection(value: unknown): BranchSelection | null {
  const { branches, showRemoteBranches } = (value ?? {}) as Partial<Record<string, unknown>>;
  if (typeof showRemoteBranches !== 'boolean') {
    return null;
  }
  if (branches === null) {
    return { branches, showRemoteBranches };
  }
  if (
    !Array.isArray(branches) ||
    !branches.every(isFullName) ||
    new Set(branches).size !== branches.length
  ) {
    return null;
  }
  return { branches: branches as string[], showRemoteBranches };
}

/**
 * The selection an open reads under, before the repository's references are
 * known: the one kept for the repository, or every branch with remote branches
 * shown when none is kept.
 *
 * An open that says whether remote branches are shown asks for every branch with
 * that, whatever is kept: it is a caller choosing for itself, and the selection
 * kept is never read for it.
 */
export function openingSelection(
  kept: BranchSelection | null,
  showRemoteBranches: boolean | undefined,
): BranchSelection {
  if (showRemoteBranches !== undefined) {
    return { branches: null, showRemoteBranches };
  }
  return kept ?? { branches: null, showRemoteBranches: true };
}

/**
 * `selection` with every branch the list does not offer dropped: a branch deleted
 * or renamed since it was kept, a remote branch whose remote is gone, and a
 * remote branch while remote branches are hidden. When none is left, it is every
 * branch, so a stale selection never opens on an empty graph. Whether remote
 * branches are shown is kept as it is.
 *
 * "Offered" is {@link branchEntries} of the page's references, the very list the
 * control shows, so the control never has a branch checked that its list does not
 * hold. A selection of every branch is answered as it is, the same object, and
 * nothing is listed for it.
 */
export function survivingSelection(selection: BranchSelection, refs: Refs): BranchSelection {
  if (selection.branches === null) {
    return selection;
  }
  const offered = new Set(
    branchEntries(refs, selection.showRemoteBranches).map((entry) => entry.name),
  );
  const branches = selection.branches.filter((name) => offered.has(name));
  return {
    branches: branches.length === 0 ? null : branches,
    showRemoteBranches: selection.showRemoteBranches,
  };
}
