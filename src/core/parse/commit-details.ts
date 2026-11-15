import { FailureKind } from '../../contracts/index';
import type { CommitDetails, DetailsPerson, Result } from '../../contracts/index';

import { decodeUtf8 } from './bytes';
import { changedFilesOf, createChangedFilesReader, readChangedFile } from './changed-files';
import type { ChangedFilesReader } from './changed-files';
import { createNulRecordReader, finishNulRecords, pushNulRecords } from './nul-records';
import type { NulRecordReader } from './nul-records';
import { rawDateOffsetMinutes, rawDateSeconds } from './raw-date';
import { afterMark, fieldFrom, fieldTo, splitFields, UNIT_MARK } from './records';

/**
 * One commit's details, from a single `git log -1 -z` asked for this header and
 * for the commit's changed files in `--raw --numstat` form.
 *
 * The output is one header record, ended by the NUL `-z` puts after a commit's
 * formatted text, then the changed files (`./changed-files.ts`), every record
 * of which is ended by a NUL too. The header's fields are cut by the unit
 * separator, and **the message is last**, read with `%B`, which is the raw
 * message, subject and body, exactly as the commit object holds it: a line
 * indented by spaces or a tab and a blank line inside the body arrive as they
 * were written, and a message holding the unit separator absorbs it, because
 * the cut stops at the last field (`splitFields` of `./records.ts`). Only a NUL
 * could end the message early, and a commit message cannot hold one.
 */
export const COMMIT_DETAILS_FORMAT = '%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%cn%x1f%ce%x1f%cd%x1f%B';

/** Fields {@link COMMIT_DETAILS_FORMAT} asks for. */
const FIELD_COUNT = 9;

const HASH = 0;
const PARENTS = 1;
const AUTHOR_NAME = 2;
const AUTHOR_EMAIL = 3;
const AUTHOR_DATE = 4;
const COMMITTER_NAME = 5;
const COMMITTER_EMAIL = 6;
const COMMITTER_DATE = 7;
const MESSAGE = 8;

/** Everything of the details but the files, read from the header record. */
interface CommitHeader {
  readonly hash: string;
  readonly parents: readonly string[];
  readonly author: DetailsPerson;
  readonly committer: DetailsPerson;
  readonly message: string;
}

/** The parser's whole state. */
export interface CommitDetailsParser {
  readonly records: NulRecordReader;
  /** Field bounds of the header record. */
  readonly bounds: Uint32Array;
  /** The header, once its record has been read. */
  header: CommitHeader | null;
  readonly files: ChangedFilesReader;
}

export function createCommitDetailsParser(): CommitDetailsParser {
  return {
    records: createNulRecordReader(),
    bounds: new Uint32Array(FIELD_COUNT * 2),
    header: null,
    files: createChangedFilesReader(),
  };
}

/** The text of field `index` of the header. */
function text(parser: CommitDetailsParser, record: Uint8Array, index: number): string {
  return decodeUtf8(record, fieldFrom(parser.bounds, index), fieldTo(parser.bounds, index));
}

/** A person of the header: a name field, the e-mail field after it, and a raw date field. */
function person(
  parser: CommitDetailsParser,
  record: Uint8Array,
  name: number,
  email: number,
  date: number,
): DetailsPerson {
  const from = fieldFrom(parser.bounds, date);
  const to = fieldTo(parser.bounds, date);
  return {
    name: text(parser, record, name),
    email: text(parser, record, email),
    time: rawDateSeconds(record, from, to),
    offsetMinutes: rawDateOffsetMinutes(record, from, to),
  };
}

/**
 * The header record, read.
 *
 * @throws SyntaxError when it does not start with the record separator or does
 *   not hold every field asked for
 */
function headerOf(parser: CommitDetailsParser, record: Uint8Array): CommitHeader {
  const end = record.length;
  const found = splitFields(record, afterMark(record, 0, end), end, UNIT_MARK, parser.bounds);
  if (found !== FIELD_COUNT) {
    throw new SyntaxError(
      `a commit's details have ${String(FIELD_COUNT)} fields, not ${String(found)}`,
    );
  }
  const parents = text(parser, record, PARENTS);
  return {
    hash: text(parser, record, HASH),
    parents: parents === '' ? [] : parents.split(' '),
    author: person(parser, record, AUTHOR_NAME, AUTHOR_EMAIL, AUTHOR_DATE),
    committer: person(parser, record, COMMITTER_NAME, COMMITTER_EMAIL, COMMITTER_DATE),
    message: text(parser, record, MESSAGE),
  };
}

/** The header if it is still to come, else one record of the changed files. */
function readRecord(parser: CommitDetailsParser, record: Uint8Array): void {
  if (parser.header === null) {
    parser.header = headerOf(parser, record);
    return;
  }
  readChangedFile(parser.files, decodeUtf8(record, 0, record.length));
}

/** Feed one chunk of the details' output. */
export function pushCommitDetails(parser: CommitDetailsParser, chunk: Uint8Array): void {
  pushNulRecords(parser.records, chunk, (record) => {
    readRecord(parser, record);
  });
}

/**
 * The details read, once the output has ended: the details of `asked`, or a
 * failure when the output held no commit or a commit by another name.
 *
 * Git answers a tree's or a blob's object name with no output and a success, and
 * a tag's with the commit it points at, so neither its exit status nor its output
 * alone says whether `asked` is a commit; the header's own object name equal to
 * `asked` does.
 *
 * @throws SyntaxError when the output ended inside a changed file's entry
 */
export function finishCommitDetails(
  parser: CommitDetailsParser,
  asked: string,
): Result<CommitDetails> {
  finishNulRecords(parser.records, (record) => {
    readRecord(parser, record);
  });
  const header = parser.header;
  if (header?.hash !== asked) {
    return {
      ok: false,
      kind: FailureKind.GitFailed,
      message: `${asked} is not a commit of this repository.`,
    };
  }
  return { ok: true, value: { ...header, files: changedFilesOf(parser.files) } };
}
