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
 * The fields of one commit as `git log` and `git stash list` are asked for
 * them, every field separated by the ASCII unit separator.
 *
 * The order is not arbitrary. **The subject is last**, so that the one field a
 * user writes freely cannot move any other field even if it contains a separator
 * of its own: a subject holding the unit separator absorbs the rest of its own
 * record, and every field before it is already read. The record terminator is
 * the NUL of `-z`, which a git object's message cannot contain at all.
 *
 * `./stash-list.ts` asks `git stash list` for the same fields after the stash's
 * own name, so that a stash is read into the same commit a log record is.
 */
export const COMMIT_FIELDS = '%H%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%cn%x1f%ce%x1f%cd%x1f%s';

/**
 * The format asked of `git log`: {@link COMMIT_FIELDS}, every record introduced
 * by the record separator.
 */
export const COMMIT_LOG_FORMAT = `%x1e${COMMIT_FIELDS}`;

/** Fields {@link COMMIT_FIELDS} asks for. */
export const COMMIT_FIELD_COUNT = 9;

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
 * The buffers a record's commit fields are read with: the field bounds of the
 * record, and the object names, **reused for every commit**.
 *
 * Reusing them is safe for exactly the reason `AppendedCommit` exists: the store
 * copies each field into a column and lets the object die in the nursery. A sink
 * that retains an `AppendedCommit` past its own return retains a buffer that the
 * next commit overwrites, so a sink that wants to keep one copies it.
 */
export interface CommitFieldBuffers {
  /** Field bounds of the record being read, reused so a record allocates none. */
  readonly bounds: Uint32Array;
  /** The object name of the commit being read. */
  readonly hash: Uint8Array;
  /** Its parents' object names, grown when a merge needs more room than this. */
  parents: Uint8Array;
}

/** The parser's whole state. */
export interface CommitLogParser extends CommitFieldBuffers {
  readonly reader: RecordReader;
  readonly onCommit: CommitSink;
}

/** Buffers for a record of `fields` fields. */
export function createCommitFieldBuffers(fields: number): CommitFieldBuffers {
  return {
    bounds: new Uint32Array(fields * 2),
    hash: new Uint8Array(HASH_BYTE_LENGTH),
    parents: new Uint8Array(INITIAL_PARENTS * HASH_BYTE_LENGTH),
  };
}

export function createCommitLogParser(onCommit: CommitSink): CommitLogParser {
  return {
    reader: createRecordReader(NUL_TERMINATOR),
    ...createCommitFieldBuffers(COMMIT_FIELD_COUNT),
    onCommit,
  };
}

/** The text of field `index` of the record in `bytes`. */
function text(buffers: CommitFieldBuffers, bytes: Uint8Array, index: number): string {
  return decodeUtf8(bytes, fieldFrom(buffers.bounds, index), fieldTo(buffers.bounds, index));
}

/** The seconds and the offset of the raw date in field `index`. */
function seconds(buffers: CommitFieldBuffers, bytes: Uint8Array, index: number): number {
  return rawDateSeconds(bytes, fieldFrom(buffers.bounds, index), fieldTo(buffers.bounds, index));
}

function offset(buffers: CommitFieldBuffers, bytes: Uint8Array, index: number): number {
  return rawDateOffsetMinutes(
    bytes,
    fieldFrom(buffers.bounds, index),
    fieldTo(buffers.bounds, index),
  );
}

/** Read the parents in field `index` into the reused buffer, and report how many. */
function readParents(buffers: CommitFieldBuffers, bytes: Uint8Array, index: number): number {
  const from = fieldFrom(buffers.bounds, index);
  const to = fieldTo(buffers.bounds, index);
  const required = objectNameCount(from, to) * HASH_BYTE_LENGTH;
  if (required > buffers.parents.length) {
    buffers.parents = new Uint8Array(required);
  }
  return writeObjectNames(bytes, from, to, buffers.parents, 0);
}

/**
 * The commit whose {@link COMMIT_FIELDS} start at field `first` of a record
 * whose bounds `buffers` already holds. Its object name is that first field.
 */
export function commitOfFields(
  buffers: CommitFieldBuffers,
  bytes: Uint8Array,
  first: number,
): AppendedCommit {
  writeObjectName(
    bytes,
    fieldFrom(buffers.bounds, first),
    fieldTo(buffers.bounds, first),
    buffers.hash,
    0,
  );
  const parents = readParents(buffers, bytes, first + PARENTS);
  return {
    hash: buffers.hash,
    parentHashes: buffers.parents.subarray(0, parents * HASH_BYTE_LENGTH),
    authorName: text(buffers, bytes, first + AUTHOR_NAME),
    authorEmail: text(buffers, bytes, first + AUTHOR_EMAIL),
    authorTime: seconds(buffers, bytes, first + AUTHOR_DATE),
    authorTzMinutes: offset(buffers, bytes, first + AUTHOR_DATE),
    committerName: text(buffers, bytes, first + COMMITTER_NAME),
    committerEmail: text(buffers, bytes, first + COMMITTER_EMAIL),
    commitTime: seconds(buffers, bytes, first + COMMITTER_DATE),
    commitTzMinutes: offset(buffers, bytes, first + COMMITTER_DATE),
    subject: text(buffers, bytes, first + SUBJECT),
  };
}

/** Turn one complete record into a commit and hand it to the sink. */
function emitCommit(parser: CommitLogParser, bytes: Uint8Array, from: number, to: number): void {
  const found = splitFields(bytes, afterMark(bytes, from, to), to, UNIT_MARK, parser.bounds);
  if (found !== COMMIT_FIELD_COUNT) {
    throw new SyntaxError(
      `a commit record has ${String(COMMIT_FIELD_COUNT)} fields, not ${String(found)}`,
    );
  }
  parser.onCommit(commitOfFields(parser, bytes, 0));
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
