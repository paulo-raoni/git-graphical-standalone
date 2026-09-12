import type { PersonTable } from './people';

/** Bytes in a binary object name. Git's SHA-1 object names are 20 bytes. */
export const HASH_BYTE_LENGTH = 20;

/**
 * One page of commits, stored as a struct of typed arrays rather than an array
 * of structs.
 *
 * A JavaScript object per commit costs roughly 300 to 500 bytes once the engine
 * has added its header, shape and pointers, and every one of them is traced on
 * each major garbage collection. The columnar form below costs tens of bytes per
 * commit, is traced as a handful of buffers, and crosses the process boundary as
 * transferable `ArrayBuffer`s instead of a structured clone of fifty thousand
 * objects.
 *
 * Nothing here is decoded eagerly. Hashes stay binary and are rendered as hex
 * only for the rows on screen; subjects live in one blob and are sliced on
 * demand.
 *
 * Commit bodies are deliberately absent: the first milestone shows subjects
 * only, and adding bodies is a visible change to this contract rather than a
 * quiet addition.
 *
 * Invariants:
 * - every `count`-length array has exactly `count` entries;
 * - `parentOffsets` and `subjectOffsets` are non-decreasing, start at 0 and have
 *   `count + 1` entries, so entry `i` spans `[offsets[i], offsets[i + 1])`;
 * - `parentIndices` has `parentOffsets[count]` entries;
 * - `subjects.length === subjectOffsets[count]`;
 * - `authorId` and `committerId` are valid indices into `people`;
 * - a parent index is either a valid index into this page or `UNKNOWN_INDEX`,
 *   which means the parent exists but has not been loaded yet.
 */
export interface CommitColumns {
  /** Number of commits in this page. Every per-commit array has this length. */
  readonly count: number;
  /**
   * Binary object names, `HASH_BYTE_LENGTH` bytes each, concatenated. Commit `i`
   * occupies `[i * HASH_BYTE_LENGTH, (i + 1) * HASH_BYTE_LENGTH)`. Not hex.
   */
  readonly hashes: Uint8Array;
  /**
   * Compressed sparse row offsets into {@link CommitColumns.parentIndices}.
   * Commit `i`'s parents are `parentIndices[parentOffsets[i]]` up to but not
   * including `parentIndices[parentOffsets[i + 1]]`.
   */
  readonly parentOffsets: Uint32Array;
  /**
   * Flattened parent lists: the index of the parent commit in this page, or
   * `UNKNOWN_INDEX` when the parent has not been loaded. Never a nested array.
   */
  readonly parentIndices: Uint32Array;
  /** Index into {@link CommitColumns.people} of each commit's author. */
  readonly authorId: Uint32Array;
  /** Index into {@link CommitColumns.people} of each commit's committer. */
  readonly committerId: Uint32Array;
  /** Author time, epoch seconds in UTC. No `Date` objects are retained. */
  readonly authorTime: Float64Array;
  /** Commit time, epoch seconds in UTC. No `Date` objects are retained. */
  readonly commitTime: Float64Array;
  /** The author's own offset from UTC, in minutes, as git recorded it. */
  readonly authorTzMinutes: Int16Array;
  /** The committer's own offset from UTC, in minutes, as git recorded it. */
  readonly commitTzMinutes: Int16Array;
  /**
   * Offsets into {@link CommitColumns.subjects}, counted in UTF-16 code units so
   * they can be handed straight to `String.prototype.slice`.
   */
  readonly subjectOffsets: Uint32Array;
  /** Every subject of the page concatenated into one string, no separators. */
  readonly subjects: string;
  /** The interned author and committer table this page's ids point into. */
  readonly people: PersonTable;
}
