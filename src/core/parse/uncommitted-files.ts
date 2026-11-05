import { isObjectName } from '../../contracts/commit-details';
import type { ChangedFile, UncommittedDetails } from '../../contracts/index';

import { decodeUtf8 } from './bytes';
import { createNulRecordReader, finishNulRecords, pushNulRecords } from './nul-records';
import type { NulRecordReader } from './nul-records';

/**
 * The uncommitted changes' details, from two readings of git: `git status
 * --porcelain=v2 --branch --untracked-files=all -z`, which says which commit
 * `HEAD` is and which files git does not track, and then a `--raw --numstat -z`
 * diff of that commit against the working tree, which says what changed in every
 * tracked path, staged or not (`./changed-files.ts`).
 *
 * The diff is taken against **the commit the status named** rather than against
 * `HEAD` read a second time, so a commit made between the two readings cannot
 * set one of them against another `HEAD`. With no commit yet the status says
 * `(initial)`, and the diff is taken against the empty tree, which lists every
 * path git tracks as added.
 *
 * Of the status this reads two things and no more. A status record of a rename
 * (`2`) is followed by a record holding the path it came from, which is read
 * past rather than taken for a record of its own: the old path of a rename can
 * itself begin with `? `.
 */

/**
 * The empty tree's object name under SHA-1, which git knows in every repository
 * whether or not the repository holds it. SHA-1 alone, because the page reads
 * twenty-byte object names alone (`HASH_BYTE_LENGTH`), so a SHA-256 repository
 * never opens.
 */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** The header that names `HEAD`'s commit. */
const HEAD_COMMIT = '# branch.oid ';

/** What that header says when `HEAD` has no commit yet. */
const UNBORN = '(initial)';

/** What starts an untracked file's record. */
const UNTRACKED = '? ';

/** What starts a rename's or a copy's record, whose old path is the next record. */
const RENAMED = '2 ';

/** The status parser's whole state. */
export interface UncommittedStatusParser {
  readonly records: NulRecordReader;
  /** What the diff is taken against: `HEAD`'s commit, or the empty tree. */
  base: string;
  /** Every untracked file, in git's order. */
  readonly untracked: string[];
  /** Whether the next record is a rename's old path, to be read past. */
  skipNext: boolean;
}

export function createUncommittedStatusParser(): UncommittedStatusParser {
  return { records: createNulRecordReader(), base: EMPTY_TREE, untracked: [], skipNext: false };
}

/**
 * Read `HEAD`'s commit from its header.
 *
 * @throws SyntaxError when it is neither an object name nor the unborn marker
 */
function readHead(parser: UncommittedStatusParser, value: string): void {
  if (value === UNBORN) {
    return;
  }
  if (!isObjectName(value)) {
    throw new SyntaxError(`git named HEAD's commit "${value}"`);
  }
  parser.base = value;
}

function readRecord(parser: UncommittedStatusParser, record: Uint8Array): void {
  const text = decodeUtf8(record, 0, record.length);
  if (parser.skipNext) {
    parser.skipNext = false;
  } else if (text.startsWith(HEAD_COMMIT)) {
    readHead(parser, text.slice(HEAD_COMMIT.length));
  } else if (text.startsWith(UNTRACKED)) {
    parser.untracked.push(text.slice(UNTRACKED.length));
  } else {
    parser.skipNext = text.startsWith(RENAMED);
  }
}

/** Feed one chunk of the status. */
export function pushUncommittedStatus(parser: UncommittedStatusParser, chunk: Uint8Array): void {
  pushNulRecords(parser.records, chunk, (record) => {
    readRecord(parser, record);
  });
}

/** Read what is left of the status. */
export function finishUncommittedStatus(parser: UncommittedStatusParser): void {
  finishNulRecords(parser.records, (record) => {
    readRecord(parser, record);
  });
}

/** The details: the diff's changed files in git's order, then every untracked file. */
export function uncommittedDetailsOf(
  parser: UncommittedStatusParser,
  changed: readonly ChangedFile[],
): UncommittedDetails {
  const untracked = parser.untracked.map((path): ChangedFile => ({
    path,
    oldPath: null,
    status: 'untracked',
    additions: null,
    deletions: null,
  }));
  return { files: [...changed, ...untracked] };
}
