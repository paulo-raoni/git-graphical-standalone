import { HASH_BYTE_LENGTH, RefKind } from '../../contracts/index';
import type { ChangedFile, CommitDetails } from '../../contracts/index';
import type { AppendedCommit } from '../store/index';

import {
  COMMIT_FIELD_COUNT,
  COMMIT_FIELDS,
  commitOfFields,
  createCommitFieldBuffers,
} from './commit-log';
import type { CommitFieldBuffers, CommitSink } from './commit-log';
import { addReferenceTo } from './reference-list';
import type { ReferenceList } from './reference-list';
import {
  afterMark,
  createRecordReader,
  finishRecords,
  NUL_TERMINATOR,
  pushRecords,
  splitFields,
  UNIT_MARK,
} from './records';
import type { RecordReader } from './records';

/**
 * `git stash list`, read into the stash rows of a page (E04-M01-S14).
 *
 * **A stash is a row of its own, joined to the commit it was made on.** Git
 * records a stash as a commit whose first parent is the commit it was made on,
 * whose second is a commit of the index, and whose third, when the stash holds
 * untracked files, is a commit of those files with no parent. The reference
 * extension draws the first and neither of the others (the task's reference
 * behaviour, item 1). So each entry is read here into the commit a page row is
 * made of, with **its first parent as its only parent**, and nothing of the
 * other two reaches the page: the log is never given a stash, so they are never
 * walked, never a row and never a line.
 *
 * **Where the row goes.** On every branch the page's log is given each stash's
 * first parent as a further tip (`commitLogArgs` of
 * `src/adapters/git-commands.ts`), so a commit no branch reaches any more is
 * still read, and {@link interleaveStashes} puts each stash into the log's
 * stream where git's own walk would put it if it were given the stash itself:
 * before the first commit older than the stash by commit date, which is where
 * the log's `--date-order` puts a commit, after all its children. Under a branch
 * selection the first parent is not a tip, so whether it will be read is known
 * only when it arrives: there a stash goes directly above it, and a stash whose
 * first parent the selection does not read is not shown. The slice document
 * argues both.
 *
 * The entries are few — one per stash, never one per commit — so each is kept
 * as an `AppendedCommit` with buffers of its own, which the columnar store's
 * rule against an object per commit does not reach.
 */

/**
 * The format asked of `git stash list`: the fields a log record has
 * ({@link COMMIT_FIELDS}), each record introduced by the record separator and
 * ended by the NUL of `-z`.
 *
 * **The entry's name is not asked for.** It was, as `%gd`, until the stash list
 * had to be read with raw dates like the log, and with `--date=raw` git 2.51.0
 * printed `%gd` as `stash@{1700000240 +0000}` instead of `stash@{0}`: git
 * documents a reflog selector as following the date option it is given
 * (measured by E04-M01-S14 on the `stashes` fixture). The name is the entry's
 * place in the list instead, which is what the number in `stash@{n}` is: the
 * entry the list prints *n*th, counting from 0.
 */
export const STASH_FORMAT = `%x1e${COMMIT_FIELDS}`;

/** Where in the list the stash list's own entries are named from. */
const STASH_REFERENCE = 'stash';

/** One stash entry. */
export interface StashEntry {
  /** Its name, `stash@{n}`. */
  readonly name: string;
  /** Its commit, with buffers of its own, and its first parent as its only parent. */
  readonly commit: AppendedCommit;
}

/** Every stash entry, in the order `git stash list` gives them, newest first. */
export interface StashList {
  readonly entries: StashEntry[];
}

/**
 * The parser's whole state: the splitter, its field buffers, the list being
 * filled, and how many records it has read, which numbers the next entry.
 */
export interface StashListParser {
  readonly reader: RecordReader;
  readonly fields: CommitFieldBuffers;
  readonly list: StashList;
  records: number;
}

/** A list with no entry, which is what a page read without stashes carries. */
export function emptyStashList(): StashList {
  return { entries: [] };
}

/** A parser for `git stash list` output in {@link STASH_FORMAT}. */
export function createStashListParser(): StashListParser {
  return {
    reader: createRecordReader(NUL_TERMINATOR),
    fields: createCommitFieldBuffers(COMMIT_FIELD_COUNT),
    list: emptyStashList(),
    records: 0,
  };
}

/**
 * Read one record into the list, as the entry its place names, skipping an
 * entry with no parent to sit on, which `git stash` never writes and a
 * hand-made `refs/stash` could. A skipped entry keeps its number, so the next
 * is named as git names it.
 */
function readStash(parser: StashListParser, bytes: Uint8Array, from: number, to: number): void {
  const found = splitFields(bytes, afterMark(bytes, from, to), to, UNIT_MARK, parser.fields.bounds);
  if (found !== COMMIT_FIELD_COUNT) {
    throw new SyntaxError(
      `a stash record has ${String(COMMIT_FIELD_COUNT)} fields, not ${String(found)}`,
    );
  }
  const place = parser.records;
  parser.records += 1;
  const commit = commitOfFields(parser.fields, bytes, 0);
  if (commit.parentHashes.length === 0) {
    return;
  }
  parser.list.entries.push({
    name: `${STASH_REFERENCE}@{${String(place)}}`,
    commit: {
      ...commit,
      hash: commit.hash.slice(),
      parentHashes: commit.parentHashes.slice(0, HASH_BYTE_LENGTH),
    },
  });
}

/** Feed one chunk of `git stash list` output. */
export function pushStashList(parser: StashListParser, chunk: Uint8Array): void {
  pushRecords(parser.reader, chunk, (bytes, from, to) => {
    readStash(parser, bytes, from, to);
  });
}

/** Read a last record that arrived without its terminator, and answer the list. */
export function finishStashList(parser: StashListParser): StashList {
  finishRecords(parser.reader, (bytes, from, to) => {
    readStash(parser, bytes, from, to);
  });
  return parser.list;
}

/** `bytes` in lower-case hexadecimal, as git spells an object name. */
function hexOf(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) {
    text += byte.toString(16).padStart(2, '0');
  }
  return text;
}

/**
 * The object names of the commits the stashes were made on, each once, in the
 * order of the stashes: the tips a page's log is given beside the branches, so
 * that a commit only a stash reaches is read (the reference behaviour, item 4).
 */
export function stashBaseNames(list: StashList): string[] {
  return [...new Set(list.entries.map((entry) => hexOf(entry.commit.parentHashes)))];
}

/** Add one `RefKind.Stash` reference per entry, pointing at the stash's own commit. */
export function addStashReferences(references: ReferenceList, list: StashList): void {
  for (const entry of list.entries) {
    addReferenceTo(references, RefKind.Stash, entry.name, 0, entry.commit.hash);
  }
}

/** Whether `left` and `right` start with the same object name. */
function sameName(left: Uint8Array, right: Uint8Array): boolean {
  for (let at = 0; at < HASH_BYTE_LENGTH; at += 1) {
    if (left[at] !== right[at]) {
      return false;
    }
  }
  return true;
}

/**
 * A sink for the page's log that hands `onRow` every row of the page in order:
 * the log's commits, with each stash of `list` put in before the first commit
 * that is its place.
 *
 * A stash goes in before the commit it was made on, which keeps every stash
 * above its parent; and, when `byDate`, before the first commit whose commit
 * time is earlier than its own, which is where git's walk would take the stash
 * out of its queue had it been given it. Stashes that go in before the same
 * commit go in newest first, and in the list's order on a tie.
 *
 * A log commit that **is** a stash's own commit, because a branch was made on
 * the stash, is that stash's row: the stash goes in in its place if it has not
 * gone in already, and the log's copy is dropped either way, so no commit is a
 * row twice.
 *
 * A stash none of whose places the log reaches is never handed on. On every
 * branch that is a stash whose place is past the page; under a selection it is
 * also a stash made on a commit the selection does not read.
 *
 * With no stash this is `onRow` itself and does no work of its own, which is
 * the case of every repository the performance gates read.
 */
export function interleaveStashes(list: StashList, byDate: boolean, onRow: CommitSink): CommitSink {
  if (list.entries.length === 0) {
    return onRow;
  }
  // A stable sort, so entries of one commit time keep the list's order.
  const order = list.entries.toSorted(
    (left, right) => right.commit.commitTime - left.commit.commitTime,
  );
  const shown = new Set<StashEntry>();
  return (commit) => {
    let own = false;
    for (const entry of order) {
      const stash = entry.commit;
      const itself = sameName(stash.hash, commit.hash);
      own ||= itself;
      if (
        !shown.has(entry) &&
        (itself ||
          sameName(stash.parentHashes, commit.hash) ||
          (byDate && stash.commitTime > commit.commitTime))
      ) {
        shown.add(entry);
        onRow(stash);
      }
    }
    if (!own) {
      onRow(commit);
    }
  };
}

/**
 * The third parent of `details` when it has exactly three, which is where a
 * stash with untracked files keeps their commit, and `null` otherwise.
 *
 * A stash with untracked files is the only commit `git stash` writes with three
 * parents. A merge of three branches has three parents too, so the count says
 * only that the commit may be such a stash: {@link isStashCommit} says whether it
 * is. The count is asked first because it costs no git process, and an ordinary
 * commit's details then cost the one they always did.
 */
export function thirdParentOf(details: CommitDetails): string | null {
  const [, , third, ...more] = details.parents;
  return third === undefined || more.length > 0 ? null : third;
}

/** Whether the commit named `hash`, in hexadecimal, is one of `stashes`. */
export function isStashCommit(hash: string, stashes: StashList): boolean {
  return stashes.entries.some((entry) => hexOf(entry.commit.hash) === hash);
}

/**
 * A stash's details with its untracked files after its own changes: every file
 * of `untracked`, the details of its untracked files' commit, with the status
 * `untracked`. That commit has no parent, so git lists each of its files as
 * added against the empty tree, with the lines it holds.
 */
export function withUntrackedFiles(
  details: CommitDetails,
  untracked: CommitDetails,
): CommitDetails {
  const files = untracked.files.map((file): ChangedFile => ({ ...file, status: 'untracked' }));
  return { ...details, files: [...details.files, ...files] };
}
