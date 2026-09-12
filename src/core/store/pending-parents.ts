import { HASH_BYTE_LENGTH } from '../../contracts/index';

import { entryAt } from './column-read';
import { copiedUint32, copiedUint8 } from './growth';
import { bucketOfHash, hashesMatch } from './hash-index';

/**
 * Parents named before their commit arrived.
 *
 * Git emits children before parents, so when a commit is appended its parents
 * are, almost always, not in the store yet. Resolution therefore cannot be a
 * single lookup: the store has to remember "row *n*'s second parent is waiting
 * for this object name" and patch that slot when the name turns up.
 *
 * The naive place to keep that is a list scanned on every append, which is
 * linear in the number of waiting parents and so quadratic over a page in the
 * one case that matters — a repository whose parents arrive far from their
 * children. This is a hash table instead: buckets over the waiting object names,
 * chained through `next`, so an append pays one bucket and the length of one
 * chain.
 *
 * Entries are **freed when they resolve** and reused through a free list
 * threaded down the same `next` column. That is what keeps this structure
 * proportional to the number of parents waiting at once — the width of the
 * branch frontier, tens of entries — rather than to the number of commits
 * loaded, which would otherwise put twenty-four bytes per commit against a
 * ninety-six byte budget.
 */
export interface PendingParents {
  /** Waiting object names, `HASH_BYTE_LENGTH` bytes per entry. */
  hashes: Uint8Array;
  /** The `parentIndices` slot each entry patches once its commit arrives. */
  targets: Uint32Array;
  /** Next entry of the same bucket, or of the free list. `END_OF_CHAIN` ends both. */
  next: Uint32Array;
  /** `entry + 1` per bucket, or `0` for an empty bucket. A power of two long. */
  buckets: Uint32Array;
  /** `buckets.length - 1`. */
  mask: number;
  /** Entries the three entry columns have room for. */
  capacity: number;
  /** Entries ever handed out, which is the high-water mark of waiting parents. */
  used: number;
  /** Head of the free list, or `END_OF_CHAIN` when nothing is free. */
  free: number;
  /** Entries currently waiting for their commit. */
  live: number;
}

/** Terminates a bucket chain and the free list alike. */
const END_OF_CHAIN = 0xffffffff;

/** Waiting parents a fresh structure has room for. */
const INITIAL_ENTRIES = 16;

/** An empty structure. */
export function createPendingParents(): PendingParents {
  return {
    hashes: new Uint8Array(INITIAL_ENTRIES * HASH_BYTE_LENGTH),
    targets: new Uint32Array(INITIAL_ENTRIES),
    next: new Uint32Array(INITIAL_ENTRIES),
    buckets: new Uint32Array(INITIAL_ENTRIES * 2),
    mask: INITIAL_ENTRIES * 2 - 1,
    capacity: INITIAL_ENTRIES,
    used: 0,
    free: END_OF_CHAIN,
    live: 0,
  };
}

/** The first entry of `bucket`'s chain, or `END_OF_CHAIN`. */
function headOf(pending: PendingParents, bucket: number): number {
  const head = entryAt(pending.buckets, bucket);
  return head === 0 ? END_OF_CHAIN : head - 1;
}

/** Put every used entry back into a freshly sized bucket table. */
function rebuildBuckets(pending: PendingParents): void {
  pending.buckets = new Uint32Array(pending.capacity * 2);
  pending.mask = pending.buckets.length - 1;
  for (let entry = 0; entry < pending.used; entry += 1) {
    const bucket = bucketOfHash(pending.hashes, entry * HASH_BYTE_LENGTH, pending.mask);
    pending.next[entry] = headOf(pending, bucket);
    pending.buckets[bucket] = entry + 1;
  }
}

/**
 * Double the entry columns.
 *
 * Only ever reached with an empty free list, so every entry below `used` is
 * live and the rebuilt chains below lose nothing.
 */
function growPending(pending: PendingParents): void {
  const capacity = pending.capacity * 2;
  pending.hashes = copiedUint8(
    pending.hashes,
    pending.used * HASH_BYTE_LENGTH,
    capacity * HASH_BYTE_LENGTH,
  );
  pending.targets = copiedUint32(pending.targets, pending.used, capacity);
  pending.next = copiedUint32(pending.next, pending.used, capacity);
  pending.capacity = capacity;
  rebuildBuckets(pending);
}

/** An entry index to write into, from the free list or from fresh capacity. */
function allocate(pending: PendingParents): number {
  if (pending.free !== END_OF_CHAIN) {
    const entry = pending.free;
    pending.free = entryAt(pending.next, entry);
    return entry;
  }
  if (pending.used === pending.capacity) {
    growPending(pending);
  }
  const entry = pending.used;
  pending.used += 1;
  return entry;
}

/**
 * Remember that `parentIndices[targetSlot]` belongs to the object name at
 * `hashOffset` of `parentHashes`, which no row holds yet.
 */
export function rememberParent(
  pending: PendingParents,
  parentHashes: Uint8Array,
  hashOffset: number,
  targetSlot: number,
): void {
  const entry = allocate(pending);
  const at = entry * HASH_BYTE_LENGTH;
  pending.hashes.set(parentHashes.subarray(hashOffset, hashOffset + HASH_BYTE_LENGTH), at);
  pending.targets[entry] = targetSlot;
  const bucket = bucketOfHash(pending.hashes, at, pending.mask);
  pending.next[entry] = headOf(pending, bucket);
  pending.buckets[bucket] = entry + 1;
  pending.live += 1;
}

/** Take `entry` out of `bucket`'s chain and put it on the free list. */
function release(
  pending: PendingParents,
  bucket: number,
  previous: number,
  entry: number,
  following: number,
): void {
  if (previous === END_OF_CHAIN) {
    // A bucket holds `entry + 1`, so an empty bucket is 0. When the chain ends
    // here, `following` is `END_OF_CHAIN`, and `END_OF_CHAIN + 1` is two to the
    // thirty-second, which a `Uint32Array` stores as exactly that 0. The
    // arithmetic is the same statement as the special case, with one branch
    // fewer to get wrong.
    pending.buckets[bucket] = following + 1;
  } else {
    pending.next[previous] = following;
  }
  pending.next[entry] = pending.free;
  pending.free = entry;
  pending.live -= 1;
}

/**
 * Patch every waiting parent that was in fact row `rowIndex`, and report how
 * many were patched.
 */
export function resolveParents(
  pending: PendingParents,
  hashes: Uint8Array,
  rowIndex: number,
  parentIndices: Uint32Array,
): number {
  const offset = rowIndex * HASH_BYTE_LENGTH;
  const bucket = bucketOfHash(hashes, offset, pending.mask);
  let entry = headOf(pending, bucket);
  let previous = END_OF_CHAIN;
  let resolved = 0;
  while (entry !== END_OF_CHAIN) {
    const following = entryAt(pending.next, entry);
    if (hashesMatch(pending.hashes, entry * HASH_BYTE_LENGTH, hashes, offset)) {
      parentIndices[entryAt(pending.targets, entry)] = rowIndex;
      release(pending, bucket, previous, entry, following);
      resolved += 1;
    } else {
      previous = entry;
    }
    entry = following;
  }
  return resolved;
}

/** Bytes this structure retains, which the performance gate counts. */
export function pendingByteLength(pending: PendingParents): number {
  return (
    pending.hashes.byteLength +
    pending.targets.byteLength +
    pending.next.byteLength +
    pending.buckets.byteLength
  );
}
