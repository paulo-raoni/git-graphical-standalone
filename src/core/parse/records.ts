import { entryAt } from '../../contracts/column-read';

/**
 * Cutting git's output into records and fields, across chunk boundaries.
 *
 * `docs/ADR-0002-architecture-and-performance.md` decision 4: the page's text is
 * never one string, so the splitter sees the output a chunk at a time and keeps
 * only the bytes of the record it is in the middle of. That carry is the whole
 * of the state, and it is what makes a record split between two chunks parse
 * identically to the same record arriving whole.
 *
 * Both separators are chosen so that nothing a user can write reaches them. The
 * terminator is NUL wherever git offers `-z`, and NUL cannot occur inside a
 * multi-byte UTF-8 sequence or inside a git object's message, so a record
 * boundary is never a boundary this code invented. Where git offers no `-z` —
 * `for-each-ref` — the terminator is the line feed git writes, and every field
 * of that format is a reference name, an object name or a single marker
 * character, none of which may contain an ASCII control character at all
 * (`git check-ref-format`).
 */

/** Starts a record, so that a stream read out of step fails rather than drifts. */
export const RECORD_MARK = 0x1e;

/** Separates the fields inside one record. */
export const UNIT_MARK = 0x1f;

/** Ends a record wherever git was asked for `-z`. */
export const NUL_TERMINATOR = 0x00;

/** Ends a record of a format git writes one line at a time. */
export const LINE_TERMINATOR = 0x0a;

/** A carriage return, dropped from a line-terminated record. */
const CARRIAGE_RETURN = 0x0d;

/** Bytes the carry starts with, which is more than any record git writes here. */
const INITIAL_CARRY = 256;

/** What a completed record is handed to. The range is `[from, to)` of `bytes`. */
export type RecordSink = (bytes: Uint8Array, from: number, to: number) => void;

/**
 * The splitter's whole state: the bytes of the record in progress.
 *
 * There is no module-level mutable state here
 * (`docs/ADR-0002-architecture-and-performance.md` decision 7), so two streams
 * being read at once cannot see each other.
 */
export interface RecordReader {
  /** Bytes of the record in progress, waiting for the terminator that ends it. */
  carry: Uint8Array;
  /** How many entries of {@link RecordReader.carry} are in use. */
  carried: number;
  /** The byte that ends a record in this stream. */
  readonly terminator: number;
}

/** A reader for a stream whose records end with `terminator`. */
export function createRecordReader(terminator: number): RecordReader {
  return { carry: new Uint8Array(INITIAL_CARRY), carried: 0, terminator };
}

/** Append `chunk[from, to)` to the carry, growing it geometrically. */
function carryBytes(reader: RecordReader, chunk: Uint8Array, from: number, to: number): void {
  const required = reader.carried + (to - from);
  if (required > reader.carry.length) {
    let length = reader.carry.length;
    while (length < required) {
      length *= 2;
    }
    const grown = new Uint8Array(length);
    grown.set(reader.carry.subarray(0, reader.carried));
    reader.carry = grown;
  }
  reader.carry.set(chunk.subarray(from, to), reader.carried);
  reader.carried = required;
}

/**
 * The end of the record, with a carriage return dropped.
 *
 * Git writes a line feed to a pipe on every platform, but a repository read
 * through a tool that rewrites line endings would otherwise leave the return
 * inside the last field of the record. `docs/ADR-0001-stack.md` Axis 5 puts that
 * normalisation here, at the parser, rather than at each field.
 */
function withoutReturn(bytes: Uint8Array, from: number, to: number): number {
  if (to > from && entryAt(bytes, to - 1) === CARRIAGE_RETURN) {
    return to - 1;
  }
  return to;
}

/**
 * Feed one chunk, handing every record it completes to `onRecord`.
 *
 * A record wholly inside the chunk is handed over as a range of the chunk and is
 * never copied. Only a record that straddles the boundary is assembled in the
 * carry, so the copying is proportional to the number of chunk boundaries rather
 * than to the size of the output.
 */
export function pushRecords(reader: RecordReader, chunk: Uint8Array, onRecord: RecordSink): void {
  let start = 0;
  for (let at = 0; at < chunk.length; at += 1) {
    if (entryAt(chunk, at) !== reader.terminator) {
      continue;
    }
    if (reader.carried === 0) {
      onRecord(chunk, start, withoutReturn(chunk, start, at));
    } else {
      carryBytes(reader, chunk, start, at);
      onRecord(reader.carry, 0, withoutReturn(reader.carry, 0, reader.carried));
      reader.carried = 0;
    }
    start = at + 1;
  }
  carryBytes(reader, chunk, start, chunk.length);
}

/**
 * Hand over a last record that arrived without its terminator.
 *
 * Every format read here terminates its last record, so this is the truncation
 * path. It reports what was read rather than discarding it, because a silently
 * dropped record is the failure that looks like a smaller repository.
 */
export function finishRecords(reader: RecordReader, onRecord: RecordSink): void {
  if (reader.carried > 0) {
    onRecord(reader.carry, 0, withoutReturn(reader.carry, 0, reader.carried));
    reader.carried = 0;
  }
}

/**
 * Strip the mark git writes at the head of a record.
 *
 * @throws SyntaxError when the record does not start with one
 */
export function afterMark(bytes: Uint8Array, from: number, to: number): number {
  if (to <= from || entryAt(bytes, from) !== RECORD_MARK) {
    throw new SyntaxError('a record of git output did not start with the record separator');
  }
  return from + 1;
}

/**
 * Cut `bytes[from, to)` at every `separator`, and report the fields found.
 *
 * `bounds` is filled with a start and an end for each field, so field `index`
 * spans `[bounds[index * 2], bounds[index * 2 + 1])`. It belongs to the caller
 * and is reused for every record, which is why cutting a record allocates
 * nothing at all. Its length is also the **number of fields asked for**, and
 * that is the whole of the protection the last field gets:
 *
 * **once the last field is being filled, the separator stops separating.** A
 * commit subject is the one field a user writes freely, and a subject holding
 * the unit separator would otherwise cut a record into more fields than the
 * format has — which is not a subject that moves another field, it is a record
 * that no longer parses at all. With the cut stopped, the last field runs to the
 * end of its own record and every field before it is already read, which is why
 * `COMMIT_LOG_FORMAT` puts the subject last.
 *
 * A record with **fewer** fields than were asked for is still reported as fewer,
 * and every caller checks the count, so a format that changed under us fails
 * rather than being read into the wrong columns.
 */
export function splitFields(
  bytes: Uint8Array,
  from: number,
  to: number,
  separator: number,
  bounds: Uint32Array,
): number {
  const asked = bounds.length / 2;
  let count = 0;
  let start = from;
  for (let at = from; at <= to; at += 1) {
    if (at < to && (count + 1 === asked || entryAt(bytes, at) !== separator)) {
      continue;
    }
    bounds[count * 2] = start;
    bounds[count * 2 + 1] = at;
    count += 1;
    start = at + 1;
  }
  return count;
}

/** Where field `index` starts, from the bounds {@link splitFields} filled. */
export function fieldFrom(bounds: Uint32Array, index: number): number {
  return entryAt(bounds, index * 2);
}

/** Where field `index` ends, from the bounds {@link splitFields} filled. */
export function fieldTo(bounds: Uint32Array, index: number): number {
  return entryAt(bounds, index * 2 + 1);
}
