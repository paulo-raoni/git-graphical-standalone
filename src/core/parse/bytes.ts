/**
 * Reading git's bytes: one bounded entry, and UTF-8 as text.
 *
 * The decoder is written here rather than borrowed because `src/core/` may not
 * reach the platform (`docs/ADR-0002-architecture-and-performance.md`
 * decision 1, enforced by `gates:boundaries`), and the platform's own
 * `TextDecoder` is neither in `lib: ["ES2023"]` nor in a ring this one may
 * import. Fifty lines of arithmetic is the price of keeping the parser pure, and
 * it buys something back: the byte sequences that decide whether a commit
 * subject survives — a character outside the basic multilingual plane, a
 * truncated sequence, an overlong one — become inputs to a unit test rather than
 * behaviour of a builtin nobody here can mutate.
 *
 * It implements the WHATWG encoding standard's UTF-8 decoder, replacement
 * characters and all, so that a repository whose messages are not valid UTF-8
 * produces the same text the rest of the platform would produce for it rather
 * than a second opinion. `git-process.spec.ts` holds it to that claim by
 * decoding the same bytes both ways and comparing.
 */

/** What every ill-formed byte sequence becomes: U+FFFD REPLACEMENT CHARACTER. */
const REPLACEMENT = 0xfffd;

/**
 * Code units handed to `String.fromCharCode` at once.
 *
 * Spreading an unbounded array into a call is how a long field becomes a stack
 * overflow instead of a string. Fields are short — a subject, a name, an address
 * — so the batching loop is the rare path and the single call is the usual one.
 */
const BATCH = 4096;

/**
 * The shape every typed array satisfies: numeric entries addressed by index.
 *
 * Written structurally so that one bounded read serves `Uint8Array` chunks and
 * the `Uint32Array` of field offsets without a generic parameter for each.
 */
export interface NumericBuffer {
  readonly [index: number]: number | undefined;
  readonly length: number;
}

/**
 * Read entry `index` of `buffer`.
 *
 * `noUncheckedIndexedAccess` types every indexed read as possibly `undefined`,
 * which is the truth. Every caller in this ring has already bounded its index
 * against a record it just cut, so `undefined` here is a defect of this ring,
 * and it fails loudly rather than propagating a `NaN` into arithmetic that would
 * then be wrong somewhere else entirely. It is a function rather than a non-null
 * assertion at each call site because an assertion silences the check without
 * performing it.
 *
 * @throws RangeError when the entry does not exist
 */
export function entryAt(buffer: NumericBuffer, index: number): number {
  const value = buffer[index];
  if (value === undefined) {
    throw new RangeError(`entry ${String(index)} is outside a buffer of ${String(buffer.length)}`);
  }
  return value;
}

/** Bytes in the sequence this lead byte starts, or 0 when it starts none. */
function sequenceLength(lead: number): number {
  if (lead < 0x80) {
    return 1;
  }
  if (lead < 0xc2) {
    return 0;
  }
  if (lead < 0xe0) {
    return 2;
  }
  if (lead < 0xf0) {
    return 3;
  }
  if (lead < 0xf5) {
    return 4;
  }
  return 0;
}

/**
 * The range the byte after `lead` may take, packed as `(low << 8) | high`.
 *
 * The four exceptions are the whole of what keeps an overlong encoding, a
 * surrogate half and a code point past U+10FFFF out: each of them is a sequence
 * whose lead byte is legal and whose second byte is not.
 */
function secondByteBounds(lead: number): number {
  if (lead === 0xe0) {
    return 0xa0bf;
  }
  if (lead === 0xed) {
    return 0x809f;
  }
  if (lead === 0xf0) {
    return 0x90bf;
  }
  if (lead === 0xf4) {
    return 0x808f;
  }
  return 0x80bf;
}

/** Append `value` as UTF-16, which is a surrogate pair above the first plane. */
function pushCodePoint(units: number[], value: number): void {
  if (value < 0x10000) {
    units.push(value);
    return;
  }
  const rest = value - 0x10000;
  units.push(0xd800 + (rest >> 10), 0xdc00 + (rest & 0x3ff));
}

/**
 * Decode one sequence at `at` into `units`, and report the bytes it consumed.
 *
 * A sequence that is cut short consumes only the bytes that were actually part
 * of it, so the byte that ended it is decoded in its own right on the next turn
 * — the "maximal subpart" rule, which is what makes one ill-formed run produce
 * the same number of replacement characters here as it does anywhere else.
 */
function decodeSequence(bytes: Uint8Array, at: number, end: number, units: number[]): number {
  const lead = entryAt(bytes, at);
  const length = sequenceLength(lead);
  if (length === 1) {
    units.push(lead);
    return 1;
  }
  if (length === 0) {
    units.push(REPLACEMENT);
    return 1;
  }
  let value = lead & (0x7f >> length);
  let bounds = secondByteBounds(lead);
  for (let index = 1; index < length; index += 1) {
    if (at + index >= end) {
      units.push(REPLACEMENT);
      return index;
    }
    const next = entryAt(bytes, at + index);
    if (next < bounds >> 8 || next > (bounds & 0xff)) {
      units.push(REPLACEMENT);
      return index;
    }
    value = (value << 6) | (next & 0x3f);
    bounds = 0x80bf;
  }
  pushCodePoint(units, value);
  return length;
}

/**
 * The code units as one string, always in batches.
 *
 * There is no short cut for a field that fits in one batch, and the loop below is
 * the whole of it. A fast path here would be a branch whose two arms produce the
 * same string for every input any repository can produce, which is a branch no
 * test can tell apart and therefore a branch that is not worth having.
 */
function stringOf(units: number[]): string {
  let text = '';
  for (let at = 0; at < units.length; at += BATCH) {
    text += String.fromCharCode(...units.slice(at, at + BATCH));
  }
  return text;
}

/** The text of `bytes[from, to)`, read as UTF-8. */
export function decodeUtf8(bytes: Uint8Array, from: number, to: number): string {
  const units: number[] = [];
  let at = from;
  while (at < to) {
    at += decodeSequence(bytes, at, to, units);
  }
  return stringOf(units);
}
