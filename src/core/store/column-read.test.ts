import { describe, expect, it } from 'vitest';

import { entryAt } from './column-read';

describe('entryAt', () => {
  it('reads the entry that is there', () => {
    expect(entryAt(Uint32Array.of(7, 8, 9), 1)).toBe(8);
  });

  it('reads entry zero', () => {
    expect(entryAt(Uint8Array.of(3), 0)).toBe(3);
  });

  it('refuses an index past the end, naming the length it had', () => {
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
