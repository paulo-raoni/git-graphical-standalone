import { describe, expect, it } from 'vitest';

import {
  copiedFloat64,
  copiedInt16,
  copiedUint32,
  copiedUint8,
  INITIAL_COMMIT_CAPACITY,
  nextCapacity,
} from './growth';

describe('nextCapacity', () => {
  it('leaves a capacity that already fits alone', () => {
    expect(nextCapacity(100, 100)).toBe(100);
    expect(nextCapacity(100, 1)).toBe(100);
  });

  it('grows by five quarters, rounded up', () => {
    expect(nextCapacity(100, 101)).toBe(125);
    expect(nextCapacity(4, 5)).toBe(5);
  });

  it('applies the factor repeatedly until the requirement fits', () => {
    expect(nextCapacity(100, 200)).toBe(247);
  });

  it('caps the unused part at a quarter, which is what the byte budget needs', () => {
    for (let current = 1; current < 5000; current = Math.ceil(current * 1.7)) {
      const capacity = nextCapacity(current, current + 1);
      expect(capacity).toBeGreaterThan(current);
      expect(capacity).toBeLessThanOrEqual(Math.ceil((current + 1) * 1.25));
    }
  });

  it('starts from one when there is no capacity at all', () => {
    expect(nextCapacity(0, 1)).toBe(1);
    expect(nextCapacity(0, 3)).toBe(3);
  });

  it('offers a first capacity large enough that an ordinary page never grows', () => {
    expect(INITIAL_COMMIT_CAPACITY).toBeGreaterThanOrEqual(1000);
  });
});

describe('the copying growers', () => {
  it('keeps the used prefix and zeroes the rest', () => {
    expect([...copiedUint8(Uint8Array.of(1, 2, 3, 4), 2, 6)]).toEqual([1, 2, 0, 0, 0, 0]);
  });

  it('does not copy the unused tail of the old column', () => {
    expect([...copiedUint32(Uint32Array.of(9, 9, 9), 1, 3)]).toEqual([9, 0, 0]);
  });

  it('keeps signed values signed', () => {
    expect([...copiedInt16(Int16Array.of(-600, 330), 2, 3)]).toEqual([-600, 330, 0]);
  });

  it('keeps fractional values exact', () => {
    expect([...copiedFloat64(Float64Array.of(1.5, 2.25), 2, 3)]).toEqual([1.5, 2.25, 0]);
  });

  it('returns a column of exactly the requested length', () => {
    expect(copiedUint8(new Uint8Array(2), 0, 7)).toHaveLength(7);
    expect(copiedUint32(new Uint32Array(2), 0, 7)).toHaveLength(7);
    expect(copiedInt16(new Int16Array(2), 0, 7)).toHaveLength(7);
    expect(copiedFloat64(new Float64Array(2), 0, 7)).toHaveLength(7);
  });

  it('returns a different column, so the old one can be released', () => {
    const source = Uint8Array.of(1, 2);
    expect(copiedUint8(source, 2, 4)).not.toBe(source);
  });
});
