import { describe, expect, it } from 'vitest';

import { entryAt } from '../../contracts/column-read';

/**
 * `column-read.ts` moved to `src/contracts/` in S08 and this test did not follow
 * it, for the reason recorded at the top of `commit-columns.test.ts`: a test file
 * under `src/contracts/` names `vitest` and `contracts-depends-on-nothing` has no
 * carve-out for one.
 */

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
