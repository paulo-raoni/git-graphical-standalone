import { entryAt } from './bytes';

/**
 * `--date=raw`: the seconds git recorded, and the offset the person was at.
 *
 * Git writes this as `1700000000 +0530`, which is exactly the two numbers
 * `CommitColumns` keeps — epoch seconds in UTC, and the offset in minutes, kept
 * apart so that no `Date` object is ever retained
 * (`docs/ADR-0002-architecture-and-performance.md` decision 3). Every other date
 * format git offers would have to be turned back into these two, and one of them
 * (`%ai`) loses the distinction between an offset of `-0000` and `+0000`.
 *
 * The two numbers are read from the record's own bytes rather than from a string
 * cut out of it, so a page of commits allocates nothing for its timestamps.
 */

/** `-`, which is the only thing that makes either number negative. */
const MINUS = 0x2d;

/** `+`, the other sign an offset from UTC may carry. */
const PLUS = 0x2b;

/** The space between the seconds and the offset. */
const SPACE = 0x20;

/** Digits in an offset from UTC, after its sign: two of hours, two of minutes. */
const OFFSET_DIGITS = 4;

/** Where the space is, which is where the seconds end and the offset begins. */
function spaceIn(bytes: Uint8Array, from: number, to: number): number {
  for (let at = from; at < to; at += 1) {
    if (entryAt(bytes, at) === SPACE) {
      return at;
    }
  }
  throw new SyntaxError('a raw date is seconds, a space, and an offset from UTC');
}

/** The decimal number spelled in `bytes[from, to)`. */
function digits(bytes: Uint8Array, from: number, to: number): number {
  if (to <= from) {
    throw new SyntaxError('a raw date has a number where git wrote nothing');
  }
  let value = 0;
  for (let at = from; at < to; at += 1) {
    const digit = entryAt(bytes, at) - 0x30;
    if (digit < 0 || digit > 9) {
      throw new SyntaxError('a raw date has a digit that is not a digit');
    }
    value = value * 10 + digit;
  }
  return value;
}

/**
 * The epoch seconds of the raw date in `bytes[from, to)`.
 *
 * Negative seconds are a commit dated before 1970, which git records and shows
 * without complaint, so this reads them rather than refusing them.
 */
export function rawDateSeconds(bytes: Uint8Array, from: number, to: number): number {
  const space = spaceIn(bytes, from, to);
  if (entryAt(bytes, from) === MINUS) {
    return -digits(bytes, from + 1, space);
  }
  return digits(bytes, from, space);
}

/** The offset from UTC of the raw date in `bytes[from, to)`, in minutes. */
export function rawDateOffsetMinutes(bytes: Uint8Array, from: number, to: number): number {
  const at = spaceIn(bytes, from, to) + 1;
  if (to - at !== OFFSET_DIGITS + 1) {
    throw new SyntaxError('an offset from UTC is a sign and four digits');
  }
  const sign = entryAt(bytes, at);
  if (sign !== PLUS && sign !== MINUS) {
    throw new SyntaxError('an offset from UTC starts with a sign');
  }
  const total = digits(bytes, at + 1, at + 3) * 60 + digits(bytes, at + 3, to);
  return sign === MINUS ? -total : total;
}
