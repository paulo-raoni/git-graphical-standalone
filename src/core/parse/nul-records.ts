/**
 * Cutting `-z` output into its NUL-terminated records, byte for byte, across
 * chunk boundaries.
 *
 * `./records.ts` does the same for the page's formats and drops a carriage return
 * that ends a record, which is right for its line-terminated format and harmless
 * for a page's fields. It is wrong for a path: a file name may end in a carriage
 * return on a file system that allows one, and git writes it, under `-z`,
 * exactly as it is. So the details of a commit are cut here instead, where a
 * record is every byte between two NULs and nothing else, and NUL is the one byte
 * no path and no commit message can hold.
 *
 * Every record is handed over as a copy of its own, whole: the details of one
 * commit are a handful of records, and a single way through the code is a code
 * whose every line a test can tell apart. Only the record in progress is kept
 * between chunks (`docs/ADR-0002-architecture-and-performance.md` decision 4).
 */

/** The byte `-z` ends every record with. */
const NUL = 0x00;

/** What a completed record is handed to. */
export type NulRecordSink = (record: Uint8Array) => void;

/** The splitter's whole state: the pieces of the record in progress, in order. */
export interface NulRecordReader {
  pieces: Uint8Array[];
}

export function createNulRecordReader(): NulRecordReader {
  return { pieces: [] };
}

/** The pieces kept so far, as one record, and the reader emptied. */
function takeRecord(reader: NulRecordReader): Uint8Array {
  let length = 0;
  for (const piece of reader.pieces) {
    length += piece.length;
  }
  const record = new Uint8Array(length);
  let at = 0;
  for (const piece of reader.pieces) {
    record.set(piece, at);
    at += piece.length;
  }
  reader.pieces = [];
  return record;
}

/** Feed one chunk, handing every record it completes to `onRecord`. */
export function pushNulRecords(
  reader: NulRecordReader,
  chunk: Uint8Array,
  onRecord: NulRecordSink,
): void {
  let start = 0;
  for (let end = chunk.indexOf(NUL); end !== -1; end = chunk.indexOf(NUL, start)) {
    reader.pieces.push(chunk.slice(start, end));
    onRecord(takeRecord(reader));
    start = end + 1;
  }
  reader.pieces.push(chunk.slice(start));
}

/**
 * Hand over a last record that arrived without its NUL.
 *
 * Every output read here ends its last record with one, so this is the
 * truncation path, and it reports what was read rather than dropping it.
 */
export function finishNulRecords(reader: NulRecordReader, onRecord: NulRecordSink): void {
  const rest = takeRecord(reader);
  if (rest.length > 0) {
    onRecord(rest);
  }
}
