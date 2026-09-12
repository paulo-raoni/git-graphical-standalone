import { describe, expect, it } from 'vitest';

import { HASH_BYTE_LENGTH } from '../../contracts/index';

import {
  appendCommit,
  createCommitStoreBuilder,
  retainedByteLength,
  storeWork,
} from './commit-store';
import type { AppendedCommit, CommitStoreBuilder } from './commit-store';
import { INITIAL_COMMIT_CAPACITY } from './growth';

/**
 * The numbers the performance gate reads, tested as numbers.
 *
 * `perf/store.perf.test.ts` asserts these against committed baselines, and a
 * baseline is only worth something if the counter under it is right. A sum that
 * silently drops a column would make the store look cheaper than it is and the
 * gate would agree, so each one is checked here against a total this file works
 * out for itself.
 */

function nameOf(seed: number): Uint8Array {
  const hash = new Uint8Array(HASH_BYTE_LENGTH);
  let state = seed + 1;
  for (let byte = 0; byte < HASH_BYTE_LENGTH; byte += 1) {
    state = (state * 1103515245 + 12345) >>> 0;
    hash[byte] = (state >>> 16) & 0xff;
  }
  return hash;
}

function namesOf(seeds: readonly number[]): Uint8Array {
  const names = new Uint8Array(seeds.length * HASH_BYTE_LENGTH);
  seeds.forEach((seed, at) => {
    names.set(nameOf(seed), at * HASH_BYTE_LENGTH);
  });
  return names;
}

function commitOf(seed: number, parents: readonly number[], subject = 'subject'): AppendedCommit {
  return {
    hash: nameOf(seed),
    parentHashes: namesOf(parents),
    authorName: 'Ada Lovelace',
    authorEmail: 'ada@example.invalid',
    authorTime: 1700000000 + seed,
    authorTzMinutes: 0,
    committerName: 'Ada Lovelace',
    committerEmail: 'ada@example.invalid',
    commitTime: 1700000000 + seed,
    commitTzMinutes: 0,
    subject,
  };
}

/** Every buffer the store holds, added up here rather than by the store. */
function everyBufferOf(builder: CommitStoreBuilder): number {
  const columns = [
    builder.hashes,
    builder.parentOffsets,
    builder.parentIndices,
    builder.authorId,
    builder.committerId,
    builder.authorTime,
    builder.commitTime,
    builder.authorTzMinutes,
    builder.commitTzMinutes,
    builder.subjectOffsets,
  ];
  const pending = builder.pending;
  return (
    columns.reduce((total, column) => total + column.buffer.byteLength, 0) +
    builder.index.slots.byteLength +
    pending.hashes.byteLength +
    pending.targets.byteLength +
    pending.next.byteLength +
    pending.buckets.byteLength
  );
}

describe('the capacity a store starts with', () => {
  it('is the one it was asked for', () => {
    expect(createCommitStoreBuilder(16).capacity).toBe(16);
    expect(createCommitStoreBuilder(1024).capacity).toBe(1024);
  });

  it('is one when it was asked for none', () => {
    expect(createCommitStoreBuilder(0).capacity).toBe(1);
  });

  it('is the published default when it was not asked', () => {
    expect(createCommitStoreBuilder().capacity).toBe(INITIAL_COMMIT_CAPACITY);
  });
});

describe('the bytes a store retains', () => {
  it('are every buffer it holds, each counted once', () => {
    const builder = createCommitStoreBuilder(1);
    expect(retainedByteLength(builder)).toBe(everyBufferOf(builder));
  });

  it('are still every buffer once the store has grown', () => {
    const builder = createCommitStoreBuilder(2);
    for (let seed = 0; seed < 30; seed += 1) {
      appendCommit(builder, commitOf(seed, seed === 0 ? [] : [seed - 1]));
    }
    expect(retainedByteLength(builder)).toBe(everyBufferOf(builder));
    expect(retainedByteLength(builder)).toBeGreaterThan(
      retainedByteLength(createCommitStoreBuilder(2)),
    );
  });

  it('exclude the message text, which is not structure', () => {
    const plain = createCommitStoreBuilder(8);
    const wordy = createCommitStoreBuilder(8);
    appendCommit(plain, commitOf(1, [], 'x'));
    appendCommit(wordy, commitOf(1, [], 'x'.repeat(10000)));
    expect(retainedByteLength(wordy)).toBe(retainedByteLength(plain));
  });
});

describe('the work a store counts', () => {
  function worked(): CommitStoreBuilder {
    const builder = createCommitStoreBuilder(2);
    for (let seed = 0; seed < 12; seed += 1) {
      appendCommit(builder, commitOf(seed, seed === 11 ? [] : [seed + 1]));
    }
    return builder;
  }

  it('is the sum of its appends, its lookups, its moves and its probes', () => {
    const builder = worked();
    const counters = builder.counters;
    expect(counters.appends).toBeGreaterThan(0);
    expect(counters.parentLookups).toBeGreaterThan(0);
    expect(counters.movedEntries).toBeGreaterThan(0);
    expect(builder.index.probes).toBeGreaterThan(0);
    expect(storeWork(builder)).toBe(
      counters.appends + counters.parentLookups + counters.movedEntries + builder.index.probes,
    );
  });

  it('counts one lookup per parent, not one per commit', () => {
    const builder = createCommitStoreBuilder(8);
    appendCommit(builder, commitOf(1, [2, 3]));
    appendCommit(builder, commitOf(2, []));
    expect(builder.counters.parentLookups).toBe(2);
  });
});

describe('the entries a growth moves', () => {
  it('are the commits that were already there', () => {
    const builder = createCommitStoreBuilder(2);
    for (let seed = 0; seed < 3; seed += 1) {
      appendCommit(builder, commitOf(seed, []));
    }
    expect(builder.counters.reallocations).toBe(1);
    expect(builder.counters.movedEntries).toBe(2);
  });

  it('are the parent entries that were already there', () => {
    const builder = createCommitStoreBuilder(8);
    appendCommit(builder, commitOf(1, [10, 11, 12, 13, 14]));
    expect(builder.counters.reallocations).toBe(0);
    appendCommit(builder, commitOf(2, [15, 16, 17, 18, 19]));
    expect(builder.counters.reallocations).toBe(1);
    expect(builder.counters.movedEntries).toBe(5);
  });

  it('are none at all when a column is filled exactly to its capacity', () => {
    const builder = createCommitStoreBuilder(4);
    for (let seed = 0; seed < 4; seed += 1) {
      appendCommit(builder, commitOf(seed, [seed + 100]));
    }
    expect(builder.count).toBe(4);
    expect(builder.parentCount).toBe(4);
    expect(builder.counters.reallocations).toBe(0);
    expect(builder.counters.movedEntries).toBe(0);
  });
});
