import type { ChangedFile, FileStatus } from '../../contracts/commit-details';

import { decodeUtf8 } from './bytes';
import { createNulRecordReader, finishNulRecords, pushNulRecords } from './nul-records';
import type { NulRecordReader } from './nul-records';

/**
 * The changed files of a diff, from git's `--raw --numstat -z` output: each with
 * its status, its old path when it was renamed or copied, and its line counts.
 *
 * Git writes the two formats one after the other, every file once in each, and
 * this reads both and joins them by the file's path. **Every path is a record of
 * its own**, because under `-z` git ends each path with a NUL and writes its
 * bytes as they are, unquoted: a tab, a quotation mark, a line feed or a byte
 * that is not UTF-8 is part of the path, and only a NUL ends one. So the
 * records come in three shapes, and which one a record is follows from the
 * record before it, never from what the record holds:
 *
 * - a raw entry, `:<mode> <mode> <object> <object> <status>`, then its path, or
 *   for a rename or a copy (`R` or `C`, followed by a score) the old path and
 *   the new one;
 * - a line count, `<added>\t<deleted>\t<path>`, or for a rename or a copy
 *   `<added>\t<deleted>\t` with nothing after it, then the old path and the new
 *   one; a binary file is counted `-` and `-`, which is read as no count;
 * - a path, owed to the entry before it.
 *
 * The first entry of a commit's diff follows the line feed git writes between a
 * commit's formatted header and its diff, so a single line feed at the head of
 * an entry is dropped. It is never dropped from a path.
 *
 * Paths are decoded as UTF-8: a path whose bytes are not valid UTF-8 is carried
 * with each ill-formed sequence replaced by U+FFFD, as `./bytes.ts` decodes it.
 */

/** Git's status letters, and what each is called here. */
const STATUSES = new Map<string, FileStatus>([
  ['A', 'added'],
  ['M', 'modified'],
  ['D', 'deleted'],
  ['R', 'renamed'],
  ['C', 'copied'],
  ['T', 'type-changed'],
]);

/** What a binary file is counted as, where a count of lines would be. */
const NO_COUNT = '-';

/** The counts of a file git gives no line counts for. */
const UNCOUNTED = { additions: null, deletions: null } as const;

/** The counts of one path. */
interface Counts {
  readonly additions: number | null;
  readonly deletions: number | null;
}

/** One entry whose paths are still being read. */
interface PendingEntry {
  /** The status of a raw entry, or `null` for a line count. */
  readonly status: FileStatus | null;
  /** The counts of a line count, and none for a raw entry. */
  readonly counts: Counts;
  /** Whether two paths are owed, the old one first: a rename or a copy. */
  readonly twoPaths: boolean;
  /** The old path, once read. */
  oldPath: string | null;
}

/** A raw entry, read whole. */
interface RawEntry {
  readonly path: string;
  readonly oldPath: string | null;
  readonly status: FileStatus;
}

/** The reader's whole state. */
export interface ChangedFilesReader {
  /** The entry whose paths are owed, or `null` when the next record starts an entry. */
  pending: PendingEntry | null;
  /** Every raw entry read, in git's order. */
  readonly entries: RawEntry[];
  /** Every line count read, by the path it counts: the new path of a rename. */
  readonly counts: Map<string, Counts>;
}

export function createChangedFilesReader(): ChangedFilesReader {
  return { pending: null, entries: [], counts: new Map() };
}

/**
 * One count of `--numstat`: a number of lines, or `null` for a binary file.
 *
 * @throws SyntaxError when it is neither
 */
function countOf(text: string): number | null {
  if (text === NO_COUNT) {
    return null;
  }
  if (!/^\d+$/.test(text)) {
    throw new SyntaxError(`git wrote "${text}" where a count of lines belongs`);
  }
  return Number(text);
}

/** Finish an entry with the path it was owed last. */
function settle(reader: ChangedFilesReader, pending: PendingEntry, path: string): void {
  reader.pending = null;
  if (pending.status === null) {
    reader.counts.set(path, pending.counts);
    return;
  }
  reader.entries.push({ path, oldPath: pending.oldPath, status: pending.status });
}

/**
 * Start a raw entry: the status is the first letter of the last field.
 *
 * @throws SyntaxError for a status this application has no name for
 */
function startRaw(reader: ChangedFilesReader, text: string): void {
  const letter = text.charAt(text.lastIndexOf(' ') + 1);
  const status = STATUSES.get(letter);
  if (status === undefined) {
    throw new SyntaxError(`git wrote a changed file whose status is "${letter}"`);
  }
  const twoPaths = status === 'renamed' || status === 'copied';
  reader.pending = { status, counts: UNCOUNTED, twoPaths, oldPath: null };
}

/**
 * Read a line count, which is whole here unless it counts a rename or a copy,
 * whose two paths are then owed.
 */
function startCount(reader: ChangedFilesReader, text: string): void {
  const first = text.indexOf('\t');
  const second = text.indexOf('\t', first + 1);
  const path = text.slice(second + 1);
  const counts: Counts = {
    additions: countOf(text.slice(0, first)),
    deletions: countOf(text.slice(first + 1, second)),
  };
  if (path === '') {
    reader.pending = { status: null, counts, twoPaths: true, oldPath: null };
    return;
  }
  reader.counts.set(path, counts);
}

/** Start the entry `record` opens, which is raw when it starts with a colon. */
function startEntry(reader: ChangedFilesReader, record: string): void {
  const text = record.startsWith('\n') ? record.slice(1) : record;
  if (text.startsWith(':')) {
    startRaw(reader, text);
    return;
  }
  startCount(reader, text);
}

/** Read one record of `--raw --numstat -z` output, decoded. */
export function readChangedFile(reader: ChangedFilesReader, record: string): void {
  const pending = reader.pending;
  if (pending === null) {
    startEntry(reader, record);
  } else if (pending.twoPaths && pending.oldPath === null) {
    pending.oldPath = record;
  } else {
    settle(reader, pending, record);
  }
}

/**
 * Every changed file read, in git's order, each with the counts git gave for its
 * path, or none.
 *
 * @throws SyntaxError when the output ended inside an entry
 */
export function changedFilesOf(reader: ChangedFilesReader): ChangedFile[] {
  if (reader.pending !== null) {
    throw new SyntaxError('git output ended before the paths of a changed file');
  }
  return reader.entries.map((entry) => ({
    ...entry,
    ...(reader.counts.get(entry.path) ?? UNCOUNTED),
  }));
}

/** A diff's changed files, read from a stream of `--raw --numstat -z` output. */
export interface ChangedFilesParser {
  readonly records: NulRecordReader;
  readonly reader: ChangedFilesReader;
}

export function createChangedFilesParser(): ChangedFilesParser {
  return { records: createNulRecordReader(), reader: createChangedFilesReader() };
}

function readRecord(parser: ChangedFilesParser, record: Uint8Array): void {
  readChangedFile(parser.reader, decodeUtf8(record, 0, record.length));
}

/** Feed one chunk of a diff's `--raw --numstat -z` output. */
export function pushChangedFiles(parser: ChangedFilesParser, chunk: Uint8Array): void {
  pushNulRecords(parser.records, chunk, (record) => {
    readRecord(parser, record);
  });
}

/** Read what is left of the stream, and every changed file it held. */
export function finishChangedFiles(parser: ChangedFilesParser): ChangedFile[] {
  finishNulRecords(parser.records, (record) => {
    readRecord(parser, record);
  });
  return changedFilesOf(parser.reader);
}
