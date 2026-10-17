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
 * **This module is the only home for it.** Every ring that needs a bounded read
 * of a typed array imports it from here **by module path**: `src/core/store/`,
 * `src/core/parse/` and `src/core/layout/` each name
 * `../../contracts/column-read`, and none of them keeps its own. It lives in
 * `src/contracts/` because `./commit-columns` needs it and this ring may import
 * nothing outside itself, so the one copy has to sit in the ring that imports
 * nothing and everything else has to reach inward for it, which
 * `core-only-inward` permits.
 *
 * Two further copies of these twelve lines grew in `src/core/` while wave 3 was
 * in flight, each for a reason its own doc comment recorded and each of which had
 * expired by the time the wave landed. E01-M01-FIX-09 deleted both; the record of
 * why they existed is kept in
 * `docs/plan/E01-commit-graph/M01-first-graph/S04-lane-layout.md`, because the
 * next person to meet the same situation should see how it was handled.
 *
 * It is deliberately **not** re-exported from `./index`: it is a helper the
 * decoders, the store's own tables, the parsers and the layout pass share, not a
 * term of the contract, and the ring's exported surface is snapshotted by
 * `gates:contract`. Naming it by module path is what keeps it out of that
 * snapshot.
 *
 * **The message it throws names the index and the length and nothing else.** The
 * two deleted copies each named the ring that was reading — `layout read entry …`
 * and `… is outside a buffer of …` — which a reader of the crash can see in the
 * stack trace above it and cannot act on, while the index and the length are the
 * two numbers that say what actually went wrong.
 */

/**
 * The shape every typed array satisfies: numeric entries addressed by index.
 *
 * Written structurally so that one function serves every column of every ring
 * without a generic parameter each: the `Uint8Array` of git's bytes, of a page's
 * object names and of a row's flags; the `Uint16Array` of lanes; and the
 * `Uint32Array` of every offset, index and slot table. It admits any typed
 * array, and `column-read.test.ts` reads four widths back through it.
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
