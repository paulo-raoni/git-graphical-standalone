/**
 * Cutting `-z` output into its NUL-terminated records, byte for byte, across
 * chunk boundaries.
 *
 * A record is every byte between two NULs and nothing else: a carriage return or
 * a line feed at either end is kept (`./nul-records.test.ts`).
 *
 * `./records.ts` cuts the page's formats. Since E04-M01-S16 it drops a carriage
 * return from a line-terminated record only, `for-each-ref`'s, and keeps every
 * byte of a NUL-terminated one (`withoutReturn` there, held by
 * `./records.test.ts`). Until then it dropped one from every record, and that was
 * not harmless: E04-M01-S16 measured git 2.51.0 ending `status --porcelain=v2 -z`'s
 * record of an index path `cr-name\r` with the return before the NUL, and that
 * reader reading the path as `cr-name`. `./working-tree-status.ts` cuts its
 * records with that reader. Its measurements are in its slice document,
 * `S16-details-read-on-git-2-25.md`.
 *
 * So the two readers now keep the same bytes of a NUL-terminated record. What
 * still sets this one apart is how a record is handed over: `./records.ts` hands
 * over a range of the chunk, or of a carry it reuses for the next record, and
 * this reader hands over every record whole, as a copy of its own
 * (`./nul-records.test.ts`), by a single path through the code with no short cut
 * for a record that lies inside one chunk. That is why the
 * details of a commit, written against it by E04-M01-S06, are still cut here.
 * That moving them to `./records.ts` would read the same records is an
 * inference from reading both files; no slice has tried it.
 *
 * NUL is the byte git ends a record with under `-z`, as E04-M01-S06 and S16
 * recorded the output they read. That no path holds one is an inference from
 * the file systems this runs on. That no commit message holds one
 * was measured by E04-M01-FIX-07 on git 2.51.0, whose `commit` and `commit-tree`
 * both refused a message with a NUL in it; a commit object written another way
 * was not tried.
 *
 * Only the record in progress is kept between chunks
 * (`docs/ADR-0002-architecture-and-performance.md` decision 4).
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
