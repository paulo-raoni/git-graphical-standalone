import { describe, expect, it } from 'vitest';

import {
  createSegmentBuffer,
  MINIMUM_SEGMENT_CAPACITY,
  nextSegmentCapacity,
  pushSegment,
} from './segment-buffer';

describe('nextSegmentCapacity', () => {
  it('leaves a capacity that already fits alone', () => {
    expect(nextSegmentCapacity(16, 16)).toBe(16);
    expect(nextSegmentCapacity(16, 1)).toBe(16);
  });

  it('grows by five quarters, rounded up', () => {
    expect(nextSegmentCapacity(16, 17)).toBe(20);
    expect(nextSegmentCapacity(4, 5)).toBe(5);
  });

  it('applies the factor repeatedly until the requirement fits', () => {
    expect(nextSegmentCapacity(16, 40)).toBe(40);
  });

  it('starts from one when there is no capacity at all', () => {
    expect(nextSegmentCapacity(0, 3)).toBe(3);
  });
});

describe('a segment buffer', () => {
  it('starts empty, with room for a straight chain of the page it was sized for', () => {
    const buffer = createSegmentBuffer(100);
    expect(buffer.count).toBe(0);
    expect(buffer.maxLane).toBe(0);
    expect(buffer.from.length).toBe(100);
    expect(buffer.to.length).toBe(100);
    expect(buffer.colour.length).toBe(100);
  });

  it('never allocates less than its floor, however small the page', () => {
    expect(createSegmentBuffer(0).from.length).toBe(MINIMUM_SEGMENT_CAPACITY);
  });

  it('keeps each segment in three parallel columns', () => {
    const buffer = createSegmentBuffer(4);
    pushSegment(buffer, 1, 2, 7);
    pushSegment(buffer, 3, 3, 3);
    expect(buffer.count).toBe(2);
    expect([...buffer.from.subarray(0, 2)]).toEqual([1, 3]);
    expect([...buffer.to.subarray(0, 2)]).toEqual([2, 3]);
    expect([...buffer.colour.subarray(0, 2)]).toEqual([7, 3]);
  });

  it('remembers the widest lane either end of a segment reached', () => {
    const buffer = createSegmentBuffer(4);
    pushSegment(buffer, 5, 1, 5);
    expect(buffer.maxLane).toBe(5);
    pushSegment(buffer, 1, 9, 1);
    expect(buffer.maxLane).toBe(9);
    pushSegment(buffer, 2, 2, 2);
    expect(buffer.maxLane).toBe(9);
  });

  // Every value written is non-zero and different in each of the three columns,
  // because a fresh typed array is already full of zeroes: a growth that dropped
  // a column's old contents would be invisible against zeroes.
  it('grows without losing a segment already written', () => {
    const buffer = createSegmentBuffer(1);
    const count = MINIMUM_SEGMENT_CAPACITY + 5;
    for (let index = 0; index < count; index += 1) {
      pushSegment(buffer, index + 1, index + 2, index + 3);
    }
    expect(buffer.count).toBe(count);
    expect(buffer.from.length).toBeGreaterThanOrEqual(count);
    expect([...buffer.from.subarray(0, 3)]).toEqual([1, 2, 3]);
    expect([...buffer.to.subarray(0, 3)]).toEqual([2, 3, 4]);
    expect([...buffer.colour.subarray(0, 3)]).toEqual([3, 4, 5]);
    expect(buffer.from[count - 1]).toBe(count);
  });
});

// The three columns are "grown geometrically and copied out exactly once", so a
// push that still has room must copy nothing. A buffer that reallocated on every
// push would keep every value, every length and every count identical —
// `nextSegmentCapacity` returns the capacity it was handed whenever the
// requirement already fits — so nothing this module answers would differ, and
// the only thing that can see the difference is the identity of the three
// arrays. It is asserted because the mutation gate found it: with the inner
// clock chosen (E01-M01-S09) the mutant that makes `pushSegment`'s test always
// true stopped being killed by a stopwatch and survived, and the copy of the
// whole buffer per segment that it buys is the cost this module exists to avoid.
describe('a segment buffer that still has room', () => {
  it('keeps the three columns it already has, and replaces them only when full', () => {
    const buffer = createSegmentBuffer(0);
    const { from, to, colour } = buffer;
    for (let index = 0; index < MINIMUM_SEGMENT_CAPACITY; index += 1) {
      pushSegment(buffer, index + 1, index + 2, index + 3);
      expect(buffer.from).toBe(from);
      expect(buffer.to).toBe(to);
      expect(buffer.colour).toBe(colour);
    }
    pushSegment(buffer, 1, 1, 1);
    expect(buffer.from).not.toBe(from);
    expect(buffer.to).not.toBe(to);
    expect(buffer.colour).not.toBe(colour);
    expect(buffer.from.length).toBe(20);
  });
});
