/**
 * One indexed read of a typed array, with the bound the type system insists on.
 *
 * `noUncheckedIndexedAccess` types every indexed read as possibly `undefined`,
 * which is the truth: an index past the end of a typed array reads nothing. The
 * layout pass has already bounded every index it forms — a row is below
 * `CommitColumns.count`, a lane is below the lane table's capacity — so
 * `undefined` here is a defect of this folder rather than a case a caller should
 * handle, and it fails loudly instead of propagating a `NaN` into lane
 * arithmetic that would then be wrong several rows later.
 *
 * It is one function rather than a non-null assertion at each call site because
 * an assertion silences the check without performing it, and because a single
 * function is one place to test.
 *
 * **Why this is not imported from the commit store, which has the same
 * function.** `src/core/store/column-read.ts` exists and is identical in intent.
 * It is not re-exported from that folder's index, so using it would mean
 * reaching into another lane's internals; and E01-M01-S08, running in this same
 * wave, is moving the `CommitColumns` decoders — which are its only callers —
 * into `src/contracts/`, so its path is expected to move. Copying twelve lines
 * is the cheaper of the two mistakes while the wave is in flight. Hoisting the
 * two into one home is a later slice's work, and costs one import line here.
 */

/**
 * The shape every typed array satisfies: numeric entries addressed by index.
 * Written structurally so the same function serves `Uint8Array`, `Uint16Array`
 * and `Uint32Array` without a generic parameter per column.
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
      `layout read entry ${String(index)} of a column of ${String(column.length)}`,
    );
  }
  return value;
}
