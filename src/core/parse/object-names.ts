import { entryAt } from '../../contracts/column-read';
import { HASH_BYTE_LENGTH } from '../../contracts/index';

/**
 * Object names, from the hex git prints to the binary bytes the store keeps.
 *
 * `docs/ADR-0002-architecture-and-performance.md` decision 3 keeps hashes as
 * twenty bytes and produces hex only for the rows on screen, so the forty
 * characters git writes are turned into bytes here, on the way in, and the
 * string they arrived in is never built at all: the digits are read straight out
 * of the record's own bytes.
 */

/** Hex digits git writes for one object name. */
export const HEX_NAME_LENGTH = HASH_BYTE_LENGTH * 2;

/** One name, a space, the next: what `%P` puts between parent object names. */
const SEPARATED_NAME_LENGTH = HEX_NAME_LENGTH + 1;

/** The value of one hex digit. */
function nibble(code: number): number {
  if (code >= 0x30 && code <= 0x39) {
    return code - 0x30;
  }
  if (code >= 0x61 && code <= 0x66) {
    return code - 0x57;
  }
  if (code >= 0x41 && code <= 0x46) {
    return code - 0x37;
  }
  throw new SyntaxError(
    `git wrote "${String.fromCharCode(code)}" where an object name's hex digit belongs`,
  );
}

/**
 * Write the object name spelled in `bytes[from, to)` into `target` at `offset`.
 *
 * @throws SyntaxError when the span is not exactly one object name in hex
 */
export function writeObjectName(
  bytes: Uint8Array,
  from: number,
  to: number,
  target: Uint8Array,
  offset: number,
): void {
  if (to - from !== HEX_NAME_LENGTH) {
    throw new SyntaxError(
      `an object name is ${String(HEX_NAME_LENGTH)} hex digits, not ${String(to - from)}`,
    );
  }
  for (let byte = 0; byte < HASH_BYTE_LENGTH; byte += 1) {
    const at = from + byte * 2;
    target[offset + byte] = (nibble(entryAt(bytes, at)) << 4) | nibble(entryAt(bytes, at + 1));
  }
}

/**
 * How many object names `bytes[from, to)` holds, separated by single spaces.
 *
 * @throws SyntaxError when the span is not a whole number of separated names
 */
export function objectNameCount(from: number, to: number): number {
  const span = to - from;
  if (span === 0) {
    return 0;
  }
  if ((span + 1) % SEPARATED_NAME_LENGTH !== 0) {
    throw new SyntaxError(`"${String(span)} bytes" is not a list of object names`);
  }
  return (span + 1) / SEPARATED_NAME_LENGTH;
}

/** Write every object name of `bytes[from, to)` into `target` at `offset`. */
export function writeObjectNames(
  bytes: Uint8Array,
  from: number,
  to: number,
  target: Uint8Array,
  offset: number,
): number {
  const count = objectNameCount(from, to);
  for (let name = 0; name < count; name += 1) {
    const at = from + name * SEPARATED_NAME_LENGTH;
    writeObjectName(bytes, at, at + HEX_NAME_LENGTH, target, offset + name * HASH_BYTE_LENGTH);
  }
  return count;
}
