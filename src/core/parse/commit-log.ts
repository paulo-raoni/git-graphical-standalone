import { HASH_BYTE_LENGTH } from '../../contracts/index';
import type { AppendedCommit } from '../store/index';

import { decodeUtf8 } from './bytes';
import { objectNameCount, writeObjectName, writeObjectNames } from './object-names';
import { rawDateOffsetMinutes, rawDateSeconds } from './raw-date';
import {
  afterMark,
  createRecordReader,
  fieldFrom,
  fieldTo,
  finishRecords,
  NUL_TERMINATOR,
  pushRecords,
  splitFields,
  UNIT_MARK,
} from './records';
import type { RecordReader } from './records';

/**
 * `git log` output, one commit at a time, handed on as it completes.
 *
 * Nothing here accumulates. A commit is built when its record's terminator
 * arrives, handed to the sink, and forgotten: there is no array of commits and
 * no string holding the page
 * (`docs/ADR-0002-architecture-and-performance.md` decision 4). What the sink
 * does with it — `appendCommit`, in this application — is what decides how much
 * is kept.
 */

/**
 * The format asked of `git log`, with every field separated by the ASCII unit
 * separator and every record introduced by the record separator.
 *
 * The order is not arbitrary. **The subject is last**, so that the one field a
 * user writes freely cannot move any other field even if it contains a separator
 * of its own: a subject holding the unit separator absorbs the rest of its own
 * record, and every field before it is already read. The record terminator is
 * the NUL of `-z`, which a git object's message cannot contain at all.
 */
export const COMMIT_LOG_FORMAT = '%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%cn%x1f%ce%x1f%cd%x1f%s';

/** Fields {@link COMMIT_LOG_FORMAT} asks for. */
const FIELD_COUNT = 9;

const HASH = 0;
const PARENTS = 1;
const AUTHOR_NAME = 2;
const AUTHOR_EMAIL = 3;
const AUTHOR_DATE = 4;
const COMMITTER_NAME = 5;
const COMMITTER_EMAIL = 6;
const COMMITTER_DATE = 7;
const SUBJECT = 8;

/** Parents one commit has room for before the buffer is replaced. */
const INITIAL_PARENTS = 4;

/** What each completed commit is handed to. */
export type CommitSink = (commit: AppendedCommit) => void;

/**
 * The parser's whole state.
 *
 * The two buffers are **reused for every commit**, which is safe for exactly the
 * reason `AppendedCommit` exists: the store copies each field into a column and
 * lets the object die in the nursery. A sink that retains an `AppendedCommit`
 * past its own return retains a buffer that the next commit overwrites, so a
 * sink that wants to keep one copies it.
 */
export interface CommitLogParser {
  readonly reader: RecordReader;
  /** Field bounds of the record being read, reused so a record allocates none. */
  readonly bounds: Uint32Array;
  /** The object name of the commit being read. */
  readonly hash: Uint8Array;
  /** Its parents' object names, grown when a merge needs more room than this. */
  parents: Uint8Array;
  readonly onCommit: CommitSink;
}

export function createCommitLogParser(onCommit: CommitSink): CommitLogParser {
  return {
    reader: createRecordReader(NUL_TERMINATOR),
    bounds: new Uint32Array(FIELD_COUNT * 2),
    hash: new Uint8Array(HASH_BYTE_LENGTH),
    parents: new Uint8Array(INITIAL_PARENTS * HASH_BYTE_LENGTH),
    onCommit,
  };
}

/** The text of field `index` of the record in `bytes`. */
function text(parser: CommitLogParser, bytes: Uint8Array, index: number): string {
  return decodeUtf8(bytes, fieldFrom(parser.bounds, index), fieldTo(parser.bounds, index));
}

/** The seconds and the offset of the raw date in field `index`. */
function seconds(parser: CommitLogParser, bytes: Uint8Array, index: number): number {
  return rawDateSeconds(bytes, fieldFrom(parser.bounds, index), fieldTo(parser.bounds, index));
}

function offset(parser: CommitLogParser, bytes: Uint8Array, index: number): number {
  return rawDateOffsetMinutes(
    bytes,
    fieldFrom(parser.bounds, index),
    fieldTo(parser.bounds, index),
  );
}

/** Read the parents of this record into the reused buffer, and report how many. */
function readParents(parser: CommitLogParser, bytes: Uint8Array): number {
  const from = fieldFrom(parser.bounds, PARENTS);
  const to = fieldTo(parser.bounds, PARENTS);
  const required = objectNameCount(from, to) * HASH_BYTE_LENGTH;
  if (required > parser.parents.length) {
    parser.parents = new Uint8Array(required);
  }
  return writeObjectNames(bytes, from, to, parser.parents, 0);
}

/** Turn one complete record into a commit and hand it to the sink. */
function emitCommit(parser: CommitLogParser, bytes: Uint8Array, from: number, to: number): void {
  const found = splitFields(bytes, afterMark(bytes, from, to), to, UNIT_MARK, parser.bounds);
  if (found !== FIELD_COUNT) {
    throw new SyntaxError(
      `a commit record has ${String(FIELD_COUNT)} fields, not ${String(found)}`,
    );
  }
  writeObjectName(
    bytes,
    fieldFrom(parser.bounds, HASH),
    fieldTo(parser.bounds, HASH),
    parser.hash,
    0,
  );
  const parents = readParents(parser, bytes);
  parser.onCommit({
    hash: parser.hash,
    parentHashes: parser.parents.subarray(0, parents * HASH_BYTE_LENGTH),
    authorName: text(parser, bytes, AUTHOR_NAME),
    authorEmail: text(parser, bytes, AUTHOR_EMAIL),
    authorTime: seconds(parser, bytes, AUTHOR_DATE),
    authorTzMinutes: offset(parser, bytes, AUTHOR_DATE),
    committerName: text(parser, bytes, COMMITTER_NAME),
    committerEmail: text(parser, bytes, COMMITTER_EMAIL),
    commitTime: seconds(parser, bytes, COMMITTER_DATE),
    commitTzMinutes: offset(parser, bytes, COMMITTER_DATE),
    subject: text(parser, bytes, SUBJECT),
  });
}

/** Feed one chunk of `git log` output. */
export function pushCommitLog(parser: CommitLogParser, chunk: Uint8Array): void {
  pushRecords(parser.reader, chunk, (bytes, from, to) => {
    emitCommit(parser, bytes, from, to);
  });
}

/** Read the last record of a stream that ended without its terminator. */
export function finishCommitLog(parser: CommitLogParser): void {
  finishRecords(parser.reader, (bytes, from, to) => {
    emitCommit(parser, bytes, from, to);
  });
}
