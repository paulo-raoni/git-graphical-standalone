import { HASH_BYTE_LENGTH, UNKNOWN_INDEX } from '../../contracts/index';
import type { CommitColumns, PersonTable } from '../../contracts/index';

import {
  copiedFloat64,
  copiedInt16,
  copiedUint32,
  copiedUint8,
  INITIAL_COMMIT_CAPACITY,
  nextCapacity,
} from './growth';
import {
  createHashIndex,
  findCommitByHash,
  hashIndexByteLength,
  insertCommitHash,
} from './hash-index';
import type { HashIndex } from './hash-index';
import {
  createPendingParents,
  pendingByteLength,
  rememberParent,
  resolveParents,
} from './pending-parents';
import type { PendingParents } from './pending-parents';

/**
 * One commit as the parser hands it over.
 *
 * It is flat, and it is not retained: every field is copied into a column and
 * the object itself dies in the nursery. That is the whole difference between
 * this and the array-of-objects store `docs/ADR-0002-architecture-and-performance.md`
 * decision 3 rejects — the cost of an object per commit is the cost of *keeping*
 * one, not of seeing one go past.
 *
 * Parent object names arrive as one buffer of whole twenty-byte names rather
 * than as an array of arrays, so that a commit with two parents costs the parser
 * one slice and not three allocations.
 */
export interface AppendedCommit {
  /** This commit's object name, exactly `HASH_BYTE_LENGTH` bytes. */
  readonly hash: Uint8Array;
  /** Its parents' object names, concatenated. Empty for a root commit. */
  readonly parentHashes: Uint8Array;
  readonly authorName: string;
  readonly authorEmail: string;
  /** Author time, epoch seconds in UTC. */
  readonly authorTime: number;
  /** The author's own offset from UTC, in minutes. */
  readonly authorTzMinutes: number;
  readonly committerName: string;
  readonly committerEmail: string;
  /** Commit time, epoch seconds in UTC. */
  readonly commitTime: number;
  /** The committer's own offset from UTC, in minutes. */
  readonly commitTzMinutes: number;
  /** The first line of the message, without its newline. */
  readonly subject: string;
}

/**
 * Deterministic work counters, which is what the performance gate asserts on.
 *
 * A stopwatch on a shared machine measures the machine. These count the store's
 * own decisions, are identical on every machine, and make an accidentally
 * quadratic append visible as a ratio rather than as a slow afternoon
 * (`docs/ADR-0003-quality-gates-and-ci.md` decision 4).
 */
export interface StoreCounters {
  /** Commits appended. */
  appends: number;
  /** Parent object names looked up, which is one per parent of every commit. */
  parentLookups: number;
  /** Times a column was outgrown and replaced. */
  reallocations: number;
  /** Entries copied by those growths, summed. Linear growth keeps this linear. */
  movedEntries: number;
}

/**
 * The store as it is being filled.
 *
 * Every field is per-builder: there is no module-level mutable state and no
 * singleton anywhere in this ring
 * (`docs/ADR-0002-architecture-and-performance.md` decision 7), so two stores
 * built side by side cannot see each other.
 */
export interface CommitStoreBuilder {
  /** Commits appended so far. */
  count: number;
  /** Commits the per-commit columns have room for. */
  capacity: number;
  /** Parent entries written so far. */
  parentCount: number;
  /** Parent entries `parentIndices` has room for. */
  parentCapacity: number;
  hashes: Uint8Array;
  parentOffsets: Uint32Array;
  parentIndices: Uint32Array;
  authorId: Uint32Array;
  committerId: Uint32Array;
  authorTime: Float64Array;
  commitTime: Float64Array;
  authorTzMinutes: Int16Array;
  commitTzMinutes: Int16Array;
  subjectOffsets: Uint32Array;
  /** Every subject so far, concatenated. Grown by `+=`, which costs a rope node. */
  subjects: string;
  /** The interned people, in identifier order. */
  names: string[];
  emails: string[];
  /**
   * Name to address to identifier.
   *
   * Nested rather than keyed by a joined string so that interning a person costs
   * no allocation at all on the hot path. It is bounded by the number of
   * distinct people in the repository — tens, where the commits are tens of
   * thousands — which is the whole point of interning.
   */
  peopleByName: Map<string, Map<string, number>>;
  index: HashIndex;
  pending: PendingParents;
  counters: StoreCounters;
}

/** An empty store. `initialCapacity` is the commits it fits before growing. */
export function createCommitStoreBuilder(
  initialCapacity: number = INITIAL_COMMIT_CAPACITY,
): CommitStoreBuilder {
  const capacity = Math.max(1, initialCapacity);
  return {
    count: 0,
    capacity,
    parentCount: 0,
    parentCapacity: capacity,
    hashes: new Uint8Array(capacity * HASH_BYTE_LENGTH),
    parentOffsets: new Uint32Array(capacity + 1),
    parentIndices: new Uint32Array(capacity),
    authorId: new Uint32Array(capacity),
    committerId: new Uint32Array(capacity),
    authorTime: new Float64Array(capacity),
    commitTime: new Float64Array(capacity),
    authorTzMinutes: new Int16Array(capacity),
    commitTzMinutes: new Int16Array(capacity),
    subjectOffsets: new Uint32Array(capacity + 1),
    subjects: '',
    names: [],
    emails: [],
    peopleByName: new Map<string, Map<string, number>>(),
    index: createHashIndex(capacity),
    pending: createPendingParents(),
    counters: { appends: 0, parentLookups: 0, reallocations: 0, movedEntries: 0 },
  };
}

/** Make room for `required` commits, geometrically, copying only what is used. */
function ensureCommitCapacity(builder: CommitStoreBuilder, required: number): void {
  if (required <= builder.capacity) {
    return;
  }
  const capacity = nextCapacity(builder.capacity, required);
  const used = builder.count;
  builder.hashes = copiedUint8(
    builder.hashes,
    used * HASH_BYTE_LENGTH,
    capacity * HASH_BYTE_LENGTH,
  );
  builder.parentOffsets = copiedUint32(builder.parentOffsets, used + 1, capacity + 1);
  builder.authorId = copiedUint32(builder.authorId, used, capacity);
  builder.committerId = copiedUint32(builder.committerId, used, capacity);
  builder.authorTime = copiedFloat64(builder.authorTime, used, capacity);
  builder.commitTime = copiedFloat64(builder.commitTime, used, capacity);
  builder.authorTzMinutes = copiedInt16(builder.authorTzMinutes, used, capacity);
  builder.commitTzMinutes = copiedInt16(builder.commitTzMinutes, used, capacity);
  builder.subjectOffsets = copiedUint32(builder.subjectOffsets, used + 1, capacity + 1);
  builder.capacity = capacity;
  builder.counters.reallocations += 1;
  builder.counters.movedEntries += used;
}

/** Make room for `required` parent entries. */
function ensureParentCapacity(builder: CommitStoreBuilder, required: number): void {
  if (required <= builder.parentCapacity) {
    return;
  }
  const capacity = nextCapacity(builder.parentCapacity, required);
  builder.parentIndices = copiedUint32(builder.parentIndices, builder.parentCount, capacity);
  builder.parentCapacity = capacity;
  builder.counters.reallocations += 1;
  builder.counters.movedEntries += builder.parentCount;
}

/** The identifier of this name and address, assigning one the first time. */
function internPerson(builder: CommitStoreBuilder, name: string, email: string): number {
  let byEmail = builder.peopleByName.get(name);
  if (byEmail === undefined) {
    byEmail = new Map<string, number>();
    builder.peopleByName.set(name, byEmail);
  }
  const known = byEmail.get(email);
  if (known !== undefined) {
    return known;
  }
  const identifier = builder.names.length;
  builder.names.push(name);
  builder.emails.push(email);
  byEmail.set(email, identifier);
  return identifier;
}

function writeIdentity(builder: CommitStoreBuilder, row: number, commit: AppendedCommit): void {
  builder.authorId[row] = internPerson(builder, commit.authorName, commit.authorEmail);
  builder.committerId[row] = internPerson(builder, commit.committerName, commit.committerEmail);
  builder.authorTime[row] = commit.authorTime;
  builder.commitTime[row] = commit.commitTime;
  builder.authorTzMinutes[row] = commit.authorTzMinutes;
  builder.commitTzMinutes[row] = commit.commitTzMinutes;
}

/**
 * Resolve this commit's parents to rows, remembering the ones not loaded yet.
 *
 * Git emits children before parents, so most of these lookups miss on the way
 * past and are patched later by {@link resolveParents}. The index is consulted
 * first anyway, because a page appended after another one has its parents
 * already in the store.
 */
function appendParents(builder: CommitStoreBuilder, row: number, parentHashes: Uint8Array): void {
  const parents = parentHashes.length / HASH_BYTE_LENGTH;
  ensureParentCapacity(builder, builder.parentCount + parents);
  for (let parent = 0; parent < parents; parent += 1) {
    const offset = parent * HASH_BYTE_LENGTH;
    const slot = builder.parentCount + parent;
    const found = findCommitByHash(builder.index, builder.hashes, parentHashes, offset);
    builder.parentIndices[slot] = found;
    if (found === UNKNOWN_INDEX) {
      rememberParent(builder.pending, parentHashes, offset, slot);
    }
    builder.counters.parentLookups += 1;
  }
  builder.parentCount += parents;
  builder.parentOffsets[row + 1] = builder.parentCount;
}

/**
 * Append one commit and report the row it landed in.
 *
 * @throws RangeError when an object name is not a whole `HASH_BYTE_LENGTH` bytes
 */
export function appendCommit(builder: CommitStoreBuilder, commit: AppendedCommit): number {
  if (commit.hash.length !== HASH_BYTE_LENGTH) {
    throw new RangeError(
      `a commit object name is ${String(HASH_BYTE_LENGTH)} bytes, not ${String(commit.hash.length)}`,
    );
  }
  if (commit.parentHashes.length % HASH_BYTE_LENGTH !== 0) {
    throw new RangeError(
      `parent object names are whole ${String(HASH_BYTE_LENGTH)} byte names, not ` +
        `${String(commit.parentHashes.length)} bytes`,
    );
  }
  const row = builder.count;
  ensureCommitCapacity(builder, row + 1);
  builder.hashes.set(commit.hash, row * HASH_BYTE_LENGTH);
  writeIdentity(builder, row, commit);
  builder.subjects += commit.subject;
  builder.subjectOffsets[row + 1] = builder.subjects.length;
  appendParents(builder, row, commit.parentHashes);
  builder.count = row + 1;
  insertCommitHash(builder.index, builder.hashes, row);
  resolveParents(builder.pending, builder.hashes, row, builder.parentIndices);
  builder.counters.appends += 1;
  return row;
}

/**
 * The page, as the contract describes it.
 *
 * The arrays are views of exactly the length the contract requires, so no slack
 * is visible to a reader, and they are views rather than copies so that "Load
 * More" grows the same buffers instead of doubling them.
 */
export function buildCommitColumns(builder: CommitStoreBuilder): CommitColumns {
  const count = builder.count;
  const people: PersonTable = { names: builder.names.slice(), emails: builder.emails.slice() };
  return {
    count,
    hashes: builder.hashes.subarray(0, count * HASH_BYTE_LENGTH),
    parentOffsets: builder.parentOffsets.subarray(0, count + 1),
    parentIndices: builder.parentIndices.subarray(0, builder.parentCount),
    authorId: builder.authorId.subarray(0, count),
    committerId: builder.committerId.subarray(0, count),
    authorTime: builder.authorTime.subarray(0, count),
    commitTime: builder.commitTime.subarray(0, count),
    authorTzMinutes: builder.authorTzMinutes.subarray(0, count),
    commitTzMinutes: builder.commitTzMinutes.subarray(0, count),
    subjectOffsets: builder.subjectOffsets.subarray(0, count + 1),
    subjects: builder.subjects,
    people,
  };
}

/**
 * Every structural byte the store holds on to, message text excluded.
 *
 * The whole buffer is counted, not the used part of it, because the unused tail
 * of a geometrically grown column is memory this process is holding just the
 * same. The people table is excluded for the same reason the subjects are: it is
 * text, and it is bounded by the number of distinct people rather than by the
 * number of commits.
 */
export function retainedByteLength(builder: CommitStoreBuilder): number {
  return (
    builder.hashes.buffer.byteLength +
    builder.parentOffsets.buffer.byteLength +
    builder.parentIndices.buffer.byteLength +
    builder.authorId.buffer.byteLength +
    builder.committerId.buffer.byteLength +
    builder.authorTime.buffer.byteLength +
    builder.commitTime.buffer.byteLength +
    builder.authorTzMinutes.buffer.byteLength +
    builder.commitTzMinutes.buffer.byteLength +
    builder.subjectOffsets.buffer.byteLength +
    hashIndexByteLength(builder.index) +
    pendingByteLength(builder.pending)
  );
}

/**
 * Total deterministic work the store has done.
 *
 * Appends, parent lookups, slots probed while resolving them, and entries moved
 * by growth: every operation whose count would change if the append stopped
 * being constant-time. Linear behaviour makes this grow with the commit count,
 * so four times the commits is about four times this number and a quadratic
 * append would be sixteen.
 */
export function storeWork(builder: CommitStoreBuilder): number {
  return (
    builder.counters.appends +
    builder.counters.parentLookups +
    builder.counters.movedEntries +
    builder.index.probes
  );
}
