/**
 * One indexed read of a typed-array column, with the bound the type system
 * insists on.
 *
 * `noUncheckedIndexedAccess` types every indexed read as possibly `undefined`,
 * which is the truth: an index past the end of a typed array reads nothing. Its
 * callers have already bounded their index, so `undefined` here is a defect in
 * the caller rather than a case it should handle, and it fails loudly instead of
 * propagating a `NaN` through arithmetic that would then be wrong somewhere else
 * entirely.
 *
 * It is one function rather than a non-null assertion at each call site because
 * an assertion silences the check without performing it, and because a single
 * function is one place to test.
 *
 * It lives in `src/contracts/` because `./commit-columns` needs it and this ring
 * may import nothing outside itself. It is deliberately **not** re-exported from
 * `./index`: it is a helper the decoders and the store's own tables share, not a
 * term of the contract, and the ring's exported surface is snapshotted by
 * `gates:contract`. `src/core/store/` names it by module path, which
 * `core-only-inward` allows.
 */

/**
 * The shape every typed array satisfies: numeric entries addressed by index.
 * Written structurally so the same function serves `Uint8Array`, `Uint32Array`,
 * `Int16Array` and `Float64Array` without a generic parameter per column.
 */
export interface NumericColumn {
  readonly [index: number]: number | undefined;
  readonly length: number;
}

/**
 * Read entry `index` of `column`.
 *
 * @throws RangeError when the entry does not exist
 */
export function entryAt(column: NumericColumn, index: number): number {
  const value = column[index];
  if (value === undefined) {
    throw new RangeError(
      `column entry ${String(index)} is outside a column of ${String(column.length)}`,
    );
  }
  return value;
}
