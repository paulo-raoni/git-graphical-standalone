import { describe, expect, it } from 'vitest';

import { HASH_BYTE_LENGTH, UNKNOWN_INDEX } from '../../contracts/index';

import {
  bucketOfHash,
  createHashIndex,
  findCommitByHash,
  hashesMatch,
  hashIndexByteLength,
  insertCommitHash,
} from './hash-index';
import type { HashIndex } from './hash-index';

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

/** Fill a table with the first `count` names and hand both back. */
function filled(count: number, expectedEntries: number): [HashIndex, Uint8Array] {
  const hashes = namesFor(count);
  const index = createHashIndex(expectedEntries);
  for (let row = 0; row < count; row += 1) {
    insertCommitHash(index, hashes, row);
  }
  return [index, hashes];
}

describe('bucketOfHash', () => {
  it('is the first four bytes, big-endian, masked', () => {
    const bytes = Uint8Array.of(0x12, 0x34, 0x56, 0x78, 0xff);
    expect(bucketOfHash(bytes, 0, 0xffff)).toBe(0x5678);
    expect(bucketOfHash(bytes, 0, 0xff)).toBe(0x78);
  });

  it('reads from the offset it is given, not from the start', () => {
    const bytes = Uint8Array.of(0, 0, 0, 0, 0x01, 0x02, 0x03, 0x04);
    expect(bucketOfHash(bytes, 4, 0xffff)).toBe(0x0304);
  });

  it('stays a bucket of the table when the name has its top bit set', () => {
    expect(bucketOfHash(Uint8Array.of(0xff, 0xff, 0xff, 0xf3), 0, 0xff)).toBe(0xf3);
  });
});

describe('hashesMatch', () => {
  it('matches a name against itself', () => {
    const left = namesFor(2);
    expect(hashesMatch(left, 0, left, 0)).toBe(true);
  });

  it('rejects two different names', () => {
    const left = namesFor(2);
    expect(hashesMatch(left, 0, left, HASH_BYTE_LENGTH)).toBe(false);
  });

  it('compares the last byte as well as the first', () => {
    const right = new Uint8Array(HASH_BYTE_LENGTH);
    right[HASH_BYTE_LENGTH - 1] = 1;
    expect(hashesMatch(new Uint8Array(HASH_BYTE_LENGTH), 0, right, 0)).toBe(false);
  });

  it('compares the first byte as well as the last', () => {
    const right = new Uint8Array(HASH_BYTE_LENGTH);
    right[0] = 1;
    expect(hashesMatch(new Uint8Array(HASH_BYTE_LENGTH), 0, right, 0)).toBe(false);
  });

  it('matches two names that are the same all the way along', () => {
    const left = new Uint8Array(HASH_BYTE_LENGTH).fill(3);
    expect(hashesMatch(left, 0, left.slice(), 0)).toBe(true);
  });
});

describe('the hash index', () => {
  it('finds nothing in an empty table', () => {
    const hashes = namesFor(1);
    const index = createHashIndex(4);
    expect(findCommitByHash(index, hashes, hashes, 0)).toBe(UNKNOWN_INDEX);
  });

  it('finds every name it was given', () => {
    const [index, hashes] = filled(200, 4);
    for (let row = 0; row < 200; row += 1) {
      expect(findCommitByHash(index, hashes, hashes, row * HASH_BYTE_LENGTH)).toBe(row);
    }
    expect(index.count).toBe(200);
  });

  it('counts every slot it looked at, so the gate has a deterministic counter', () => {
    const [index, hashes] = filled(1, 8);
    expect(index.probes).toBe(0);
    findCommitByHash(index, hashes, hashes, 0);
    expect(index.probes).toBeGreaterThan(0);
  });

  it('reports the bytes it retains, and nothing else', () => {
    const index = createHashIndex(1);
    expect(hashIndexByteLength(index)).toBe(index.slots.length * 4);
  });
});

describe('the hash index, as it fills up', () => {
  it('rehashes rather than filling up, and keeps every entry', () => {
    const initialSlots = createHashIndex(1).slots.length;
    const [index, hashes] = filled(64, 1);
    expect(index.slots.length).toBeGreaterThan(initialSlots);
    expect(index.mask).toBe(index.slots.length - 1);
    expect(findCommitByHash(index, hashes, hashes, 0)).toBe(0);
    expect(findCommitByHash(index, hashes, hashes, 63 * HASH_BYTE_LENGTH)).toBe(63);
  });

  it('keeps at least a quarter of the table empty, so a lookup terminates', () => {
    const [index] = filled(100, 1);
    expect(index.slots.length * 3).toBeGreaterThanOrEqual(index.count * 4);
  });

  it('is sized up front to the smallest power of two that holds what it expects', () => {
    expect(createHashIndex(1).slots.length).toBe(16);
    expect(createHashIndex(4).slots.length).toBe(16);
    expect(createHashIndex(12).slots.length).toBe(16);
    expect(createHashIndex(13).slots.length).toBe(32);
    expect(createHashIndex(4096).slots.length).toBe(8192);
  });

  it('rehashes when the next entry would pass three quarters, and not before', () => {
    expect(filled(12, 1)[0].slots.length).toBe(16);
    const [index, hashes] = filled(13, 1);
    expect(index.slots.length).toBe(32);
    expect(findCommitByHash(index, hashes, hashes, 12 * HASH_BYTE_LENGTH)).toBe(12);
  });
});

describe('the hash index, on a collision', () => {
  it('tells two names in the same bucket apart', () => {
    const hashes = new Uint8Array(2 * HASH_BYTE_LENGTH);
    hashes.set(Uint8Array.of(1, 2, 3, 4), 0);
    hashes.set(Uint8Array.of(1, 2, 3, 4), HASH_BYTE_LENGTH);
    hashes[HASH_BYTE_LENGTH + 19] = 9;
    const index = createHashIndex(8);
    insertCommitHash(index, hashes, 0);
    insertCommitHash(index, hashes, 1);
    expect(findCommitByHash(index, hashes, hashes, 0)).toBe(0);
    expect(findCommitByHash(index, hashes, hashes, HASH_BYTE_LENGTH)).toBe(1);
  });

  it('reports a name nobody inserted as unknown even when its bucket is taken', () => {
    const hashes = namesFor(2);
    const index = createHashIndex(8);
    insertCommitHash(index, hashes, 0);
    expect(findCommitByHash(index, hashes, hashes, HASH_BYTE_LENGTH)).toBe(UNKNOWN_INDEX);
  });
});
