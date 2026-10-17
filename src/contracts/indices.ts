/**
 * The sentinel that marks an index whose target has not been loaded yet.
 *
 * Every index field in this ring is a `Uint32Array` entry, so "absent" cannot be
 * `null` or `-1`: it has to be a value inside the type's range. `0xFFFFFFFF` is
 * the largest `Uint32` and is four billion rows beyond anything a repository can
 * reach, so no real index can collide with it.
 *
 * Invariant: wherever a field's documentation says "or `UNKNOWN_INDEX`", a
 * consumer must test for this value before using the entry as an index.
 */
export const UNKNOWN_INDEX = 0xffffffff;
