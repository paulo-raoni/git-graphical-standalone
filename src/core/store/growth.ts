/**
 * How the store's columns grow, and why by five quarters rather than by two.
 *
 * Doubling is the reflex, and it is the wrong reflex here. The budget of
 * `docs/ADR-0002-architecture-and-performance.md` decision 6 is 96 structural
 * bytes per loaded commit, and the exact columns of one commit already cost 60
 * of them. Doubling leaves up to 100 per cent of a column unused immediately
 * after a growth, which is 120 bytes per commit before the parent lookup table
 * has been counted at all: the budget would be broken by the allocator rather
 * than by the design.
 *
 * Five quarters caps the unused part at 25 per cent, which keeps the worst case
 * inside the budget with the lookup table included, and it is still geometric,
 * so appending stays amortised constant: each entry is copied on average
 * `1 / (5/4 - 1)`, that is four times, over the whole life of the store, and
 * never once per append.
 */

/**
 * Commits a fresh builder has room for before its first reallocation.
 *
 * Large enough that opening an ordinary repository — git's own first page is a
 * few hundred commits, and this application's is a few thousand — reallocates
 * nothing at all, and small enough that a store built for one commit, which is
 * what most of the tests do, costs a quarter of a megabyte rather than more.
 */
export const INITIAL_COMMIT_CAPACITY = 4096;

/** The growth factor, as an exact ratio so that no float rounding enters it. */
const GROWTH_NUMERATOR = 5;
const GROWTH_DENOMINATOR = 4;

/**
 * The capacity to grow to so that `required` entries fit.
 *
 * Applies the factor repeatedly rather than jumping straight to `required`, so
 * that a caller which asks for one more entry than fits still gets room for the
 * ones after it, and a caller which asks for a whole page at once still gets a
 * capacity that is geometric in the old one.
 */
export function nextCapacity(current: number, required: number): number {
  let capacity = Math.max(1, current);
  while (capacity < required) {
    capacity = Math.ceil((capacity * GROWTH_NUMERATOR) / GROWTH_DENOMINATOR);
  }
  return capacity;
}

/**
 * A new `Uint8Array` of `length` entries holding the first `used` of `source`.
 *
 * Only the used prefix is copied. Copying the whole of the old array would copy
 * its unused tail as well, which is work proportional to the slack rather than
 * to the data, and would make the copy counter the performance gate reads say
 * something other than what it claims to say.
 */
export function copiedUint8(source: Uint8Array, used: number, length: number): Uint8Array {
  const target = new Uint8Array(length);
  target.set(source.subarray(0, used));
  return target;
}

/** A new `Uint32Array` of `length` entries holding the first `used` of `source`. */
export function copiedUint32(source: Uint32Array, used: number, length: number): Uint32Array {
  const target = new Uint32Array(length);
  target.set(source.subarray(0, used));
  return target;
}

/** A new `Int16Array` of `length` entries holding the first `used` of `source`. */
export function copiedInt16(source: Int16Array, used: number, length: number): Int16Array {
  const target = new Int16Array(length);
  target.set(source.subarray(0, used));
  return target;
}

/** A new `Float64Array` of `length` entries holding the first `used` of `source`. */
export function copiedFloat64(source: Float64Array, used: number, length: number): Float64Array {
  const target = new Float64Array(length);
  target.set(source.subarray(0, used));
  return target;
}
