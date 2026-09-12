import { describe, expect, it } from 'vitest';

import { HASH_BYTE_LENGTH } from '../../contracts/index';

import {
  createPendingParents,
  pendingByteLength,
  rememberParent,
  resolveParents,
} from './pending-parents';

/** A column of `count` distinct object names, spread over all twenty bytes. */
function namesFor(count: number): Uint8Array {
  const hashes = new Uint8Array(count * HASH_BYTE_LENGTH);
  for (let row = 0; row < count; row += 1) {
    let state = row + 1;
    for (let byte = 0; byte < HASH_BYTE_LENGTH; byte += 1) {
      state = (state * 1103515245 + 12345) >>> 0;
      hashes[row * HASH_BYTE_LENGTH + byte] = (state >>> 16) & 0xff;
    }
  }
  return hashes;
}

/** `count` names that all fall in the same bucket, differing only at the end. */
function collidingNamesFor(count: number): Uint8Array {
  const hashes = new Uint8Array(count * HASH_BYTE_LENGTH);
  for (let row = 0; row < count; row += 1) {
    hashes.set(Uint8Array.of(7, 7, 7, 7), row * HASH_BYTE_LENGTH);
    hashes[row * HASH_BYTE_LENGTH + HASH_BYTE_LENGTH - 1] = row + 1;
  }
  return hashes;
}

describe('pending parents', () => {
  it('starts empty, with twice as many buckets as entries', () => {
    const pending = createPendingParents();
    expect(pending.live).toBe(0);
    expect(pending.used).toBe(0);
    expect(pending.buckets.length).toBe(pending.capacity * 2);
    expect(pending.mask).toBe(pending.buckets.length - 1);
  });

  it('patches the slot that was waiting, and frees the entry', () => {
    const hashes = namesFor(3);
    const parentIndices = new Uint32Array(4);
    const pending = createPendingParents();
    rememberParent(pending, hashes, 2 * HASH_BYTE_LENGTH, 1);
    expect(pending.live).toBe(1);
    expect(resolveParents(pending, hashes, 2, parentIndices)).toBe(1);
    expect(parentIndices[1]).toBe(2);
    expect(pending.live).toBe(0);
  });

  it('patches every slot waiting for the same name', () => {
    const hashes = namesFor(2);
    const parentIndices = new Uint32Array(4);
    const pending = createPendingParents();
    rememberParent(pending, hashes, HASH_BYTE_LENGTH, 0);
    rememberParent(pending, hashes, HASH_BYTE_LENGTH, 3);
    expect(resolveParents(pending, hashes, 1, parentIndices)).toBe(2);
    expect(parentIndices[0]).toBe(1);
    expect(parentIndices[3]).toBe(1);
    expect(pending.live).toBe(0);
  });
});

describe('pending parents, on a name nobody waits for', () => {
  it('leaves an empty bucket alone', () => {
    const hashes = namesFor(2);
    const parentIndices = new Uint32Array(2);
    const pending = createPendingParents();
    rememberParent(pending, hashes, 0, 1);
    expect(resolveParents(pending, hashes, 1, parentIndices)).toBe(0);
    expect(pending.live).toBe(1);
    expect(parentIndices[1]).toBe(0);
  });

  it('leaves an entry of a bucket it shares alone', () => {
    const hashes = collidingNamesFor(2);
    const parentIndices = new Uint32Array(2);
    const pending = createPendingParents();
    rememberParent(pending, hashes, 0, 1);
    expect(resolveParents(pending, hashes, 1, parentIndices)).toBe(0);
    expect(pending.live).toBe(1);
    expect(parentIndices[1]).toBe(0);
  });
});

describe('pending parents, unlinking', () => {
  it('unlinks an entry from the middle of a bucket, not only from its head', () => {
    const hashes = collidingNamesFor(3);
    const parentIndices = new Uint32Array(3);
    const pending = createPendingParents();
    rememberParent(pending, hashes, 0, 0);
    rememberParent(pending, hashes, HASH_BYTE_LENGTH, 1);
    rememberParent(pending, hashes, 2 * HASH_BYTE_LENGTH, 2);
    expect(resolveParents(pending, hashes, 1, parentIndices)).toBe(1);
    expect(pending.live).toBe(2);
    expect(resolveParents(pending, hashes, 0, parentIndices)).toBe(1);
    expect(resolveParents(pending, hashes, 2, parentIndices)).toBe(1);
    expect([...parentIndices]).toEqual([0, 1, 2]);
    expect(pending.live).toBe(0);
  });

  it('reuses a freed entry rather than growing', () => {
    const hashes = namesFor(2);
    const parentIndices = new Uint32Array(2);
    const pending = createPendingParents();
    rememberParent(pending, hashes, 0, 0);
    resolveParents(pending, hashes, 0, parentIndices);
    rememberParent(pending, hashes, HASH_BYTE_LENGTH, 1);
    expect(pending.used).toBe(1);
    expect(resolveParents(pending, hashes, 1, parentIndices)).toBe(1);
    expect(parentIndices[1]).toBe(1);
  });
});

describe('pending parents, as they grow', () => {
  const waiting = 40;

  it('grows when more parents wait at once than it started with, and loses none', () => {
    const hashes = namesFor(waiting);
    const parentIndices = new Uint32Array(waiting);
    const pending = createPendingParents();
    const startingCapacity = pending.capacity;
    for (let row = 0; row < waiting; row += 1) {
      rememberParent(pending, hashes, row * HASH_BYTE_LENGTH, row);
    }
    expect(pending.capacity).toBeGreaterThan(startingCapacity);
    expect(pending.live).toBe(waiting);
    for (let row = 0; row < waiting; row += 1) {
      expect(resolveParents(pending, hashes, row, parentIndices)).toBe(1);
    }
    expect([...parentIndices]).toEqual([...Array(waiting).keys()]);
  });

  it('rebuilds chains that still collide, and loses none', () => {
    const hashes = collidingNamesFor(waiting);
    const parentIndices = new Uint32Array(waiting);
    const pending = createPendingParents();
    for (let row = 0; row < waiting; row += 1) {
      rememberParent(pending, hashes, row * HASH_BYTE_LENGTH, row);
    }
    for (let row = waiting - 1; row >= 0; row -= 1) {
      expect(resolveParents(pending, hashes, row, parentIndices)).toBe(1);
    }
    expect([...parentIndices]).toEqual([...Array(waiting).keys()]);
  });

  it('reports the bytes it retains, and grows them with its capacity', () => {
    const pending = createPendingParents();
    const empty = pendingByteLength(pending);
    const hashes = namesFor(waiting);
    for (let row = 0; row < waiting; row += 1) {
      rememberParent(pending, hashes, row * HASH_BYTE_LENGTH, row);
    }
    expect(empty).toBeGreaterThan(0);
    expect(pendingByteLength(pending)).toBeGreaterThan(empty);
    expect(pendingByteLength(pending)).toBe(
      pending.hashes.byteLength +
        pending.targets.byteLength +
        pending.next.byteLength +
        pending.buckets.byteLength,
    );
  });
});

describe('pending parents, rebuilding their chains', () => {
  it('doubles its entries and its buckets together', () => {
    const pending = createPendingParents();
    const startingCapacity = pending.capacity;
    const hashes = namesFor(startingCapacity + 1);
    for (let row = 0; row <= startingCapacity; row += 1) {
      rememberParent(pending, hashes, row * HASH_BYTE_LENGTH, row);
    }
    expect(pending.capacity).toBe(startingCapacity * 2);
    expect(pending.buckets.length).toBe(pending.capacity * 2);
    expect(pending.mask).toBe(pending.buckets.length - 1);
  });

  /**
   * The rebuilt chains must hold the entries that are in use and no others.
   *
   * An off-by-one that also relinks the first unused entry is invisible while
   * that entry's twenty bytes are still the zeroes a fresh buffer came with —
   * unless the parent that caused the growth is itself named by twenty zeroes.
   * Then the stale link and the real link are in the same bucket and point at
   * the same entry, which resolves twice.
   */
  it('rebuilds chains over the entries in use, and no others', () => {
    const pending = createPendingParents();
    const overflow = pending.capacity;
    const hashes = namesFor(overflow + 1);
    hashes.fill(0, overflow * HASH_BYTE_LENGTH);
    const parentIndices = new Uint32Array(overflow + 1);
    for (let row = 0; row <= overflow; row += 1) {
      rememberParent(pending, hashes, row * HASH_BYTE_LENGTH, row);
    }
    expect(resolveParents(pending, hashes, overflow, parentIndices)).toBe(1);
    expect(pending.live).toBe(overflow);
  });
});
