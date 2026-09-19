import { entryAt } from './column-read';
import { RefKind } from './refs';
import type { Refs } from './refs';

/**
 * Reading a {@link Refs} block.
 *
 * These are here for the same reason `./commit-columns` is, and by the same test
 * (`docs/plan/E01-commit-graph/M01-first-graph/S08-contract-decode-api.md`): ask
 * whether a reasonable person could implement the function another way and still
 * be right. None of these could. A reference's name **is** the slice of
 * {@link Refs.names} between its two offsets, and changing what `nameOf` returns
 * would be changing what {@link Refs} means rather than choosing a different
 * policy.
 *
 * The corollary is the useful half. {@link Refs} is a columnar block with a name
 * blob and an offset table, so **a consumer holding one cannot read a single
 * reference's name without these functions**, and `src/ui/` may import this ring
 * and nothing else (`ui-only-contracts`). Hand-rolling the blob slicing in the
 * renderer would put the only decode logic in the project outside the coverage
 * thresholds and outside the mutation scope, which is how it would rot unwatched.
 *
 * As in `./commit-columns`, every function takes the block as a parameter and
 * keeps nothing: no store object with methods, no module-level state
 * (`docs/ADR-0002-architecture-and-performance.md` decision 7), so the same
 * functions read a block built in this process and one that arrived over the IPC
 * boundary as transferred buffers.
 *
 * The sibling modules of this ring name each other directly rather than through
 * `./index`, because the index re-exports this module and a module that imported
 * its own index would be a cycle.
 */

/** References in this block. */
export function refCount(refs: Refs): number {
  return refs.count;
}

/**
 * Fail on a reference that is not in this block.
 *
 * The same guard `./commit-columns` puts in front of a row, for the same reason:
 * a typed array answers an out-of-range read with `undefined`, arithmetic on
 * `undefined` is `NaN`, and a `NaN` travels a long way before it becomes visible.
 *
 * @throws RangeError when `ref` is not a whole number inside the block
 */
function assertRef(refs: Refs, ref: number): void {
  if (!Number.isInteger(ref) || ref < 0 || ref >= refs.count) {
    throw new RangeError(`reference ${String(ref)} is not one of a block of ${String(refs.count)}`);
  }
}

/**
 * The short name of `ref`, sliced out of the block's one name blob.
 *
 * Names are stored as git reports them, without the `refs/heads/` style prefix
 * that {@link refKindOf} already carries, so this is what a label shows.
 */
export function refNameOf(refs: Refs, ref: number): string {
  assertRef(refs, ref);
  return refs.names.slice(entryAt(refs.nameOffsets, ref), entryAt(refs.nameOffsets, ref + 1));
}

/**
 * What kind of reference `ref` is.
 *
 * The entry is a `Uint8Array` byte and the return type is the union
 * {@link RefKind} declares, so the value is checked against that union rather
 * than asserted into it. A block whose `kind` column holds a byte this contract
 * does not define is a block that disagrees with its own invariant, and it is
 * refused here the way `./commit-columns` refuses a person identifier its table
 * does not hold — loudly, at the call that caused it, rather than as a label
 * that silently renders as nothing.
 *
 * @throws RangeError when the entry is not one of the {@link RefKind} values
 */
export function refKindOf(refs: Refs, ref: number): RefKind {
  assertRef(refs, ref);
  const kind = entryAt(refs.kind, ref);
  if (
    kind === RefKind.LocalHead ||
    kind === RefKind.RemoteBranch ||
    kind === RefKind.Tag ||
    kind === RefKind.RemoteSymbolicHead ||
    kind === RefKind.Stash
  ) {
    return kind;
  }
  throw new RangeError(`reference kind ${String(kind)} is not one this contract defines`);
}

/**
 * The row of the page that `ref` points at, or `UNKNOWN_INDEX` when the commit
 * it names has not been loaded.
 *
 * It is returned as it is stored. A caller that is about to use it as an index
 * tests it against `UNKNOWN_INDEX` first, which is the invariant
 * `src/contracts/indices.ts` states for every field of this kind; turning the
 * sentinel into `null` here would be this module inventing a second spelling for
 * something the contract already spells.
 */
export function refCommitOf(refs: Refs, ref: number): number {
  assertRef(refs, ref);
  return entryAt(refs.commitIndex, ref);
}

/**
 * The bitwise or of {@link RefFlag} values on `ref`.
 *
 * Returned as the stored byte rather than as a set of booleans, because the
 * contract's vocabulary for these is the bit: a caller writes
 * `(refFlagsOf(refs, i) & RefFlag.CheckedOut) !== 0`, which is the same sentence
 * the contract uses, and a flag added later costs no change here.
 */
export function refFlagsOf(refs: Refs, ref: number): number {
  assertRef(refs, ref);
  return entryAt(refs.flags, ref);
}
