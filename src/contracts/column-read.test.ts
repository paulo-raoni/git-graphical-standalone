import { describe, expect, it } from 'vitest';

import { entryAt } from './column-read';

/**
 * This is the whole of the coverage of the bounded read, for every ring.
 *
 * `src/core/layout/column-entry.ts` and the local `entryAt` of
 * `src/core/parse/bytes.ts` were the same twelve lines with a different message,
 * and each had a colocated test of its own; E01-M01-FIX-09 deleted both modules,
 * so what those two tests asserted has to be asserted from here. Everything they
 * carried beyond the cases below was the same case in different words — an
 * out-of-range read matched by a regular expression over the two numbers rather
 * than by the message, which the exact match here already subsumes. The one
 * thing that was not is the `Uint16Array`, which is the lane column and is the
 * only element type no case here reached.
 */
describe('entryAt', () => {
  it('reads the entry that is there', () => {
    expect(entryAt(Uint32Array.of(7, 8, 9), 1)).toBe(8);
  });

  it('reads entry zero', () => {
    expect(entryAt(Uint8Array.of(3), 0)).toBe(3);
  });

  it('reads an entry of a lane column, which is sixteen bits wide', () => {
    expect(entryAt(Uint16Array.of(7, 8, 9), 1)).toBe(8);
  });

  it('refuses an index past the end, naming the index and the length it had', () => {
    expect(() => entryAt(Uint8Array.of(3), 1)).toThrow(
      new RangeError('column entry 1 is outside a column of 1'),
    );
  });

  it('refuses a negative index', () => {
    expect(() => entryAt(Uint8Array.of(3), -1)).toThrow(RangeError);
  });

  it('reads a zero entry rather than treating it as absent', () => {
    expect(entryAt(Float64Array.of(0), 0)).toBe(0);
  });
});
