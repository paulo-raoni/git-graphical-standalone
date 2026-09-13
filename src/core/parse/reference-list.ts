import { entryAt } from '../../contracts/column-read';
import { HASH_BYTE_LENGTH, RefFlag, UNKNOWN_INDEX } from '../../contracts/index';
import type { RefKind, Refs } from '../../contracts/index';

import { writeObjectName } from './object-names';

/**
 * References as they are collected, before they know which row they decorate.
 *
 * `Refs` is columnar for the same reason `CommitColumns` is
 * (`docs/ADR-0002-architecture-and-performance.md` decision 3): a repository can
 * carry thousands of tags. But a reference arrives naming an **object**, and the
 * row that object landed in is only known once the page has been read, so this
 * collects the object names and {@link buildRefs} turns them into indices
 * afterwards.
 *
 * The names and the two flag columns are ordinary arrays here rather than typed
 * ones. They are bounded by the number of references in the repository, not by
 * the number of commits loaded, which is the whole reason the store's own
 * columns had to be typed and these do not.
 */

/** References the target column has room for before it is replaced. */
const INITIAL_REFERENCES = 64;

export interface ReferenceList {
  /** References collected so far. */
  count: number;
  /** One {@link RefKind} per reference, in the order they were added. */
  readonly kinds: number[];
  /** One bitwise or of {@link RefFlag} values per reference. */
  readonly flags: number[];
  /** The short name of each reference, without the prefix its kind carries. */
  readonly names: string[];
  /** The object name each reference points at, concatenated, binary. */
  targets: Uint8Array;
}

/** An empty list. */
export function createReferenceList(): ReferenceList {
  return {
    count: 0,
    kinds: [],
    flags: [],
    names: [],
    targets: new Uint8Array(INITIAL_REFERENCES * HASH_BYTE_LENGTH),
  };
}

/** Make room for one more target object name. */
function ensureTargetRoom(list: ReferenceList): void {
  const required = (list.count + 1) * HASH_BYTE_LENGTH;
  if (required <= list.targets.length) {
    return;
  }
  const grown = new Uint8Array(list.targets.length * 2);
  grown.set(list.targets);
  list.targets = grown;
}

/**
 * Add one reference, whose target object name is spelled in `bytes[from, to)`.
 *
 * @throws SyntaxError when that span is not one object name in hex
 */
export function addReference(
  list: ReferenceList,
  kind: RefKind,
  name: string,
  flags: number,
  bytes: Uint8Array,
  from: number,
  to: number,
): void {
  ensureTargetRoom(list);
  writeObjectName(bytes, from, to, list.targets, list.count * HASH_BYTE_LENGTH);
  list.kinds.push(kind);
  list.flags.push(flags);
  list.names.push(name);
  list.count += 1;
}

/**
 * Mark every reference that points at the commit HEAD is detached at.
 *
 * `RefFlag.DetachedHead` documents itself as "the reference it was detached
 * from", and the only record of which reference that literally was is the
 * reflog, which this milestone does not read. What is available, and is what a
 * reader of the graph wants, is the reference standing at the same commit: check
 * out a tag and the tag carries the mark. When HEAD is detached at a commit no
 * reference names, no reference carries it, and `WorkingTree.isDetached` remains
 * the fact itself.
 */
export function markDetachedFrom(list: ReferenceList, rows: Uint32Array, headRow: number): void {
  if (headRow === UNKNOWN_INDEX) {
    return;
  }
  for (let index = 0; index < list.count; index += 1) {
    if (entryAt(rows, index) === headRow) {
      list.flags[index] = entryAt(list.flags, index) | RefFlag.DetachedHead;
    }
  }
}

/**
 * The references as the contract holds them, pointing at rows of the page.
 *
 * `rows` is what {@link resolveCommitRows} produced for this list's targets. It
 * may be longer than the list, because the same pass resolves HEAD's own commit,
 * so only the first `count` entries are taken.
 */
export function buildRefs(list: ReferenceList, rows: Uint32Array): Refs {
  const nameOffsets = new Uint32Array(list.count + 1);
  let names = '';
  let index = 0;
  for (const name of list.names) {
    names += name;
    index += 1;
    nameOffsets[index] = names.length;
  }
  return {
    count: list.count,
    kind: Uint8Array.from(list.kinds),
    commitIndex: rows.slice(0, list.count),
    nameOffsets,
    names,
    flags: Uint8Array.from(list.flags),
  };
}
