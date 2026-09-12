import { HASH_BYTE_LENGTH, UNKNOWN_INDEX } from '../../contracts/index';

import { entryAt } from './column-read';

/**
 * Binary object name to row index, without a string anywhere.
 *
 * The obvious mechanism is a `Map` keyed by the 40-character hex spelling of the
 * hash. That is exactly the allocation this store exists to avoid: one string
 * per commit, plus one per parent lookup, plus the map's own entry objects — for
 * fifty thousand commits, several megabytes of retained rope and hash-table
 * entries, to answer a question the binary bytes already answer.
 *
 * So this is open addressing with linear probing over a single `Uint32Array` of
 * slots. A slot holds `rowIndex + 1`, which leaves `0` free to mean "empty", and
 * the key itself is never copied: it is read back out of the store's own
 * `hashes` column at `rowIndex * HASH_BYTE_LENGTH`. The table therefore costs
 * four bytes per slot and nothing else, and at the three-quarter load factor
 * below that is between five and eleven bytes per commit.
 *
 * The bucket is the object name's **first four bytes**, used as they are. A git
 * object name is the output of a cryptographic hash, so its bytes are already
 * uniformly distributed; hashing it again would cost arithmetic per lookup to
 * buy a distribution it already has.
 */
export interface HashIndex {
  /** `rowIndex + 1` per slot, or `0` for an empty slot. Length is a power of two. */
  slots: Uint32Array;
  /** `slots.length - 1`, so a bucket wraps with a bitwise and rather than a modulo. */
  mask: number;
  /** Entries currently in the table, which drives when it is rehashed. */
  count: number;
  /**
   * Slots examined by a lookup since the table was created.
   *
   * This is the performance gate's counter for the parent-resolution half of an
   * append. It is deterministic — it depends on the object names and on nothing
   * about the machine — which is what lets the gate assert a scaling ratio
   * rather than a stopwatch reading.
   */
  probes: number;
}

/** Smallest table, so that a store of one commit does not allocate a page. */
const MIN_SLOTS = 16;

/** Maximum load factor, as an exact ratio: three quarters. */
const LOAD_NUMERATOR = 3;
const LOAD_DENOMINATOR = 4;

/** The smallest power of two that holds `entries` at the load factor above. */
function slotsFor(entries: number): number {
  let slots = MIN_SLOTS;
  while (slots * LOAD_NUMERATOR < entries * LOAD_DENOMINATOR) {
    slots *= 2;
  }
  return slots;
}

/** An empty table sized for `expectedEntries` without rehashing. */
export function createHashIndex(expectedEntries: number): HashIndex {
  const slots = slotsFor(expectedEntries);
  return { slots: new Uint32Array(slots), mask: slots - 1, count: 0, probes: 0 };
}

/**
 * The bucket an object name belongs in: its first four bytes, big-endian, masked
 * down to the table's size.
 */
export function bucketOfHash(bytes: Uint8Array, offset: number, mask: number): number {
  const first = entryAt(bytes, offset);
  const second = entryAt(bytes, offset + 1);
  const third = entryAt(bytes, offset + 2);
  const fourth = entryAt(bytes, offset + 3);
  return (((first << 24) | (second << 16) | (third << 8) | fourth) >>> 0) & mask;
}

/** Whether the two object names at those offsets are the same twenty bytes. */
export function hashesMatch(
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

/** Put `rowIndex` in the first empty slot from its bucket. */
function place(slots: Uint32Array, mask: number, hashes: Uint8Array, rowIndex: number): void {
  let bucket = bucketOfHash(hashes, rowIndex * HASH_BYTE_LENGTH, mask);
  while (entryAt(slots, bucket) !== 0) {
    bucket = (bucket + 1) & mask;
  }
  slots[bucket] = rowIndex + 1;
}

/** Double the table and put every entry back, reading the keys from `hashes`. */
function rehash(index: HashIndex, hashes: Uint8Array): void {
  const slots = new Uint32Array(index.slots.length * 2);
  const mask = slots.length - 1;
  for (let bucket = 0; bucket < index.slots.length; bucket += 1) {
    const slot = entryAt(index.slots, bucket);
    if (slot !== 0) {
      place(slots, mask, hashes, slot - 1);
    }
  }
  index.slots = slots;
  index.mask = mask;
}

/**
 * Record that the object name at `rowIndex * HASH_BYTE_LENGTH` of `hashes` is
 * that row's.
 */
export function insertCommitHash(index: HashIndex, hashes: Uint8Array, rowIndex: number): void {
  if ((index.count + 1) * LOAD_DENOMINATOR > index.slots.length * LOAD_NUMERATOR) {
    rehash(index, hashes);
  }
  place(index.slots, index.mask, hashes, rowIndex);
  index.count += 1;
}

/**
 * The row holding the object name at `probeOffset` of `probe`, or
 * `UNKNOWN_INDEX` when no row holds it.
 *
 * The loop terminates because the load factor keeps at least a quarter of the
 * slots empty, so a run of occupied slots is always followed by an empty one.
 */
export function findCommitByHash(
  index: HashIndex,
  hashes: Uint8Array,
  probe: Uint8Array,
  probeOffset: number,
): number {
  let bucket = bucketOfHash(probe, probeOffset, index.mask);
  for (;;) {
    index.probes += 1;
    const slot = entryAt(index.slots, bucket);
    if (slot === 0) {
      return UNKNOWN_INDEX;
    }
    const rowIndex = slot - 1;
    if (hashesMatch(hashes, rowIndex * HASH_BYTE_LENGTH, probe, probeOffset)) {
      return rowIndex;
    }
    bucket = (bucket + 1) & index.mask;
  }
}

/** Bytes this table retains, which the performance gate counts against the budget. */
export function hashIndexByteLength(index: HashIndex): number {
  return index.slots.byteLength;
}
