import { entryAt } from '../../contracts/column-read';
import { HASH_BYTE_LENGTH } from '../../contracts/index';
import type { WorkingTree } from '../../contracts/index';

import { decodeUtf8 } from './bytes';
import { writeObjectName } from './object-names';
import { createRecordReader, finishRecords, NUL_TERMINATOR, pushRecords } from './records';
import type { RecordReader } from './records';

/**
 * `git status --porcelain=v2 --branch -z`, read into the working tree scalars.
 *
 * Version 2 of the porcelain format is the one with a documented grammar and a
 * branch header, and `-z` is what makes a path with a newline, a quotation mark
 * or a tab in it an ordinary path rather than an escape sequence to undo: with
 * `-z` git writes paths literally and terminates each record with a NUL, which a
 * path cannot contain on any platform this runs on.
 *
 * Only one record shape spends two records: a rename or a copy writes the new
 * path, a NUL, then the path it came from. That second record is consumed
 * without being classified, which is why this parser has one bit of state beyond
 * the counts.
 */

/** `#`, which starts a header record. */
const HEADER = 0x23;

/** `1`, an ordinary changed entry. */
const CHANGED = 0x31;

/** `2`, a rename or a copy, whose original path follows in its own record. */
const RENAMED = 0x32;

/** `u`, an unmerged entry. */
const UNMERGED = 0x75;

/** `?`, an untracked file. */
const UNTRACKED = 0x3f;

const OID_HEADER = '# branch.oid ';
const NAME_HEADER = '# branch.head ';

/** What `# branch.oid` says when the branch has no commit yet. */
const UNBORN = '(initial)';

/** What `# branch.head` says when HEAD points straight at a commit. */
const DETACHED = '(detached)';

/** What one reading of the working tree found. */
export interface StatusFacts {
  /** Tracked files with staged or unstaged modifications. */
  changedFileCount: number;
  /** Files git does not track and does not ignore. */
  untrackedFileCount: number;
  /** HEAD's object name, meaningful only while {@link StatusFacts.hasHead}. */
  readonly headHash: Uint8Array;
  /** Whether HEAD names a commit: false on a branch with no commit yet. */
  hasHead: boolean;
  /** The checked-out branch's short name, or `null` when HEAD is detached. */
  headRefName: string | null;
  /** Whether HEAD points straight at a commit rather than at a branch. */
  isDetached: boolean;
}

/** The parser's whole state: the splitter, the facts, and one bit of grammar. */
export interface StatusParser {
  readonly reader: RecordReader;
  readonly facts: StatusFacts;
  /** Whether the next record is a rename's original path, to be consumed. */
  pendingOriginalPath: boolean;
}

/**
 * A parser over an unread repository.
 *
 * It starts detached with no name rather than named and attached, so that the
 * pair `headRefName === null` and `isDetached` the contract insists on holds
 * even for a status that never produced a branch header.
 */
export function createStatusParser(): StatusParser {
  return {
    reader: createRecordReader(NUL_TERMINATOR),
    facts: {
      changedFileCount: 0,
      untrackedFileCount: 0,
      headHash: new Uint8Array(HASH_BYTE_LENGTH),
      hasHead: false,
      headRefName: null,
      isDetached: true,
    },
    pendingOriginalPath: false,
  };
}

/** Read `# branch.oid`, which is an object name or the unborn marker. */
function readHeadCommit(
  parser: StatusParser,
  bytes: Uint8Array,
  from: number,
  to: number,
  value: string,
): void {
  if (value === UNBORN) {
    return;
  }
  writeObjectName(bytes, from, to, parser.facts.headHash, 0);
  parser.facts.hasHead = true;
}

/** Read one header record. Both prefixes are ASCII, so the offsets line up. */
function readHeader(parser: StatusParser, bytes: Uint8Array, from: number, to: number): void {
  const line = decodeUtf8(bytes, from, to);
  if (line.startsWith(OID_HEADER)) {
    readHeadCommit(parser, bytes, from + OID_HEADER.length, to, line.slice(OID_HEADER.length));
    return;
  }
  if (line.startsWith(NAME_HEADER)) {
    const name = line.slice(NAME_HEADER.length);
    parser.facts.isDetached = name === DETACHED;
    parser.facts.headRefName = parser.facts.isDetached ? null : name;
  }
}

/** Count one entry record by the character that classifies it. */
function readEntry(parser: StatusParser, first: number): void {
  if (first === RENAMED) {
    parser.facts.changedFileCount += 1;
    parser.pendingOriginalPath = true;
    return;
  }
  if (first === CHANGED || first === UNMERGED) {
    parser.facts.changedFileCount += 1;
    return;
  }
  if (first === UNTRACKED) {
    parser.facts.untrackedFileCount += 1;
  }
}

/** Classify one record, or consume the original path a rename left pending. */
function readRecord(parser: StatusParser, bytes: Uint8Array, from: number, to: number): void {
  if (to === from) {
    return;
  }
  if (parser.pendingOriginalPath) {
    parser.pendingOriginalPath = false;
    return;
  }
  const first = entryAt(bytes, from);
  if (first === HEADER) {
    readHeader(parser, bytes, from, to);
    return;
  }
  readEntry(parser, first);
}

/** Feed one chunk of `git status --porcelain=v2 -z` output. */
export function pushStatus(parser: StatusParser, chunk: Uint8Array): void {
  pushRecords(parser.reader, chunk, (bytes, from, to) => {
    readRecord(parser, bytes, from, to);
  });
}

/** Read a last record that arrived without its terminator. */
export function finishStatus(parser: StatusParser): void {
  finishRecords(parser.reader, (bytes, from, to) => {
    readRecord(parser, bytes, from, to);
  });
}

/**
 * The working tree as the contract holds it.
 *
 * `headRow` is where HEAD's commit landed in the page, which the caller resolved
 * with the same pass that resolved the references, or `UNKNOWN_INDEX` when it is
 * not on the page — including a repository whose branch has no commit yet.
 */
export function buildWorkingTree(facts: StatusFacts, headRow: number): WorkingTree {
  return {
    hasChanges: facts.changedFileCount + facts.untrackedFileCount > 0,
    changedFileCount: facts.changedFileCount,
    untrackedFileCount: facts.untrackedFileCount,
    headCommitIndex: headRow,
    headRefName: facts.headRefName,
    isDetached: facts.isDetached,
  };
}
