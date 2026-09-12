import { HASH_BYTE_LENGTH, UNKNOWN_INDEX } from '../../contracts/index';

import { entryAt } from './bytes';

/**
 * Which row of the page each reference points at.
 *
 * A reference arrives naming an object, and `Refs.commitIndex` wants a row. The
 * obvious mechanism is a `Map` keyed by the hex spelling of every commit's object
 * name, which is one string per **commit** — the allocation the columnar store
 * exists to avoid (`docs/ADR-0002-architecture-and-performance.md` decision 3).
 *
 * So the map is built the other way round, over the **targets**, which number in
 * the tens or the low thousands where the commits number in the tens of
 * thousands. Its key is the first four bytes of an object name read as one
 * integer: a git object name is already the output of a cryptographic hash, so
 * those four bytes are uniformly distributed and need no further hashing, and a
 * numeric key costs a lookup no allocation at all. Two targets can still share a
 * prefix, so each key holds the targets that chose it and the full twenty bytes
 * decide.
 *
 * One pass over the page then answers every reference at once, which is what
 * keeps opening a repository linear in the commits read rather than a product of
 * commits and references.
 */

/** The first four bytes of the object name at `offset`, as one integer. */
function prefixAt(bytes: Uint8Array, offset: number): number {
  return (
    ((entryAt(bytes, offset) << 24) |
      (entryAt(bytes, offset + 1) << 16) |
      (entryAt(bytes, offset + 2) << 8) |
      entryAt(bytes, offset + 3)) >>>
    0
  );
}

/** Whether the two object names at those offsets are the same twenty bytes. */
function sameObjectName(
  left: Uint8Array,
  leftOffset: number,
  right: Uint8Array,
  rightOffset: number,
): boolean {
  for (let byte = 0; byte < HASH_BYTE_LENGTH; byte += 1) {
    if (entryAt(left, leftOffset + byte) !== entryAt(right, rightOffset + byte)) {
      return false;
    }
  }
  return true;
}

/** The targets that share each four-byte prefix. */
function targetsByPrefix(targets: Uint8Array, count: number): Map<number, number[]> {
  const byPrefix = new Map<number, number[]>();
  for (let target = 0; target < count; target += 1) {
    const prefix = prefixAt(targets, target * HASH_BYTE_LENGTH);
    const sharing = byPrefix.get(prefix);
    if (sharing === undefined) {
      byPrefix.set(prefix, [target]);
    } else {
      sharing.push(target);
    }
  }
  return byPrefix;
}

/**
 * The row of each of `targetCount` object names in `targets`, or
 * `UNKNOWN_INDEX` for one whose commit is not on this page.
 */
export function resolveCommitRows(
  targets: Uint8Array,
  targetCount: number,
  hashes: Uint8Array,
  commitCount: number,
): Uint32Array {
  const rows = new Uint32Array(targetCount).fill(UNKNOWN_INDEX);
  const byPrefix = targetsByPrefix(targets, targetCount);
  for (let row = 0; row < commitCount; row += 1) {
    const offset = row * HASH_BYTE_LENGTH;
    const sharing = byPrefix.get(prefixAt(hashes, offset));
    if (sharing === undefined) {
      continue;
    }
    for (const target of sharing) {
      if (sameObjectName(targets, target * HASH_BYTE_LENGTH, hashes, offset)) {
        rows[target] = row;
      }
    }
  }
  return rows;
}
