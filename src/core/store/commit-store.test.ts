import { describe, expect, it } from 'vitest';

import { HASH_BYTE_LENGTH, UNKNOWN_INDEX } from '../../contracts/index';
import type { CommitColumns } from '../../contracts/index';

import {
  appendCommit,
  buildCommitColumns,
  createCommitStoreBuilder,
  retainedByteLength,
  storeWork,
} from './commit-store';
import type { AppendedCommit } from './commit-store';

/** A distinct object name per seed, spread over all twenty bytes. */
function nameOf(seed: number): Uint8Array {
  const hash = new Uint8Array(HASH_BYTE_LENGTH);
  let state = seed + 1;
  for (let byte = 0; byte < HASH_BYTE_LENGTH; byte += 1) {
    state = (state * 1103515245 + 12345) >>> 0;
    hash[byte] = (state >>> 16) & 0xff;
  }
  return hash;
}

/** Those names concatenated, which is how the builder takes parents. */
function namesOf(seeds: readonly number[]): Uint8Array {
  const names = new Uint8Array(seeds.length * HASH_BYTE_LENGTH);
  seeds.forEach((seed, at) => {
    names.set(nameOf(seed), at * HASH_BYTE_LENGTH);
  });
  return names;
}

function commitOf(
  seed: number,
  parents: readonly number[],
  subject = `subject ${String(seed)}`,
  person = 'Ada Lovelace',
): AppendedCommit {
  return {
    hash: nameOf(seed),
    parentHashes: namesOf(parents),
    authorName: person,
    authorEmail: `${person}@example.invalid`,
    authorTime: 1700000000 + seed,
    authorTzMinutes: 60,
    committerName: person,
    committerEmail: `${person}@example.invalid`,
    commitTime: 1700000500 + seed,
    commitTzMinutes: -300,
    subject,
  };
}

/** Every column of a page as plain values, so two pages can be compared. */
function snapshotOf(columns: CommitColumns): Record<string, unknown> {
  return {
    count: columns.count,
    hashes: [...columns.hashes],
    parentOffsets: [...columns.parentOffsets],
    parentIndices: [...columns.parentIndices],
    authorId: [...columns.authorId],
    committerId: [...columns.committerId],
    authorTime: [...columns.authorTime],
    commitTime: [...columns.commitTime],
    authorTzMinutes: [...columns.authorTzMinutes],
    commitTzMinutes: [...columns.commitTzMinutes],
    subjectOffsets: [...columns.subjectOffsets],
    subjects: columns.subjects,
    names: [...columns.people.names],
    emails: [...columns.people.emails],
  };
}

describe('an empty store', () => {
  it('builds a page of no commits', () => {
    const columns = buildCommitColumns(createCommitStoreBuilder());
    expect(columns.count).toBe(0);
    expect(columns.hashes).toHaveLength(0);
    expect(columns.parentIndices).toHaveLength(0);
    expect(columns.subjects).toBe('');
    expect(columns.people.names).toHaveLength(0);
  });

  it('still carries the sentinel offset every page has', () => {
    const columns = buildCommitColumns(createCommitStoreBuilder());
    expect([...columns.parentOffsets]).toEqual([0]);
    expect([...columns.subjectOffsets]).toEqual([0]);
  });

  it('has done no work and retains only what it was sized for', () => {
    const builder = createCommitStoreBuilder(16);
    expect(storeWork(builder)).toBe(0);
    expect(retainedByteLength(builder)).toBeGreaterThan(0);
  });

  it('still takes a commit when it was asked for no capacity at all', () => {
    const builder = createCommitStoreBuilder(0);
    appendCommit(builder, commitOf(1, []));
    expect(buildCommitColumns(builder).count).toBe(1);
  });
});

describe('a page that has already been built', () => {
  it('does not change when the store is appended to again', () => {
    const builder = createCommitStoreBuilder(8);
    appendCommit(builder, commitOf(1, [], 'one', 'Ada Lovelace'));
    const first = buildCommitColumns(builder);
    expect(first.people.names).toEqual(['Ada Lovelace']);
    appendCommit(builder, commitOf(2, [], 'two', 'Grace Hopper'));
    expect(first.people.names).toEqual(['Ada Lovelace']);
    expect(first.people.emails).toHaveLength(1);
    expect(buildCommitColumns(builder).people.names).toHaveLength(2);
    expect(buildCommitColumns(builder).people.emails).toHaveLength(2);
  });
});

describe('a store of one commit', () => {
  it('keeps the object name, the times and the offsets as they were given', () => {
    const builder = createCommitStoreBuilder();
    expect(appendCommit(builder, commitOf(1, []))).toBe(0);
    const columns = buildCommitColumns(builder);
    expect(columns.count).toBe(1);
    expect([...columns.hashes]).toEqual([...nameOf(1)]);
    expect(columns.authorTime[0]).toBe(1700000001);
    expect(columns.commitTime[0]).toBe(1700000501);
    expect(columns.authorTzMinutes[0]).toBe(60);
    expect(columns.commitTzMinutes[0]).toBe(-300);
  });

  it('gives a root commit no parents at all', () => {
    const builder = createCommitStoreBuilder();
    appendCommit(builder, commitOf(1, []));
    const columns = buildCommitColumns(builder);
    expect([...columns.parentOffsets]).toEqual([0, 0]);
    expect(columns.parentIndices).toHaveLength(0);
  });

  it('counts the append as one unit of work', () => {
    const builder = createCommitStoreBuilder();
    appendCommit(builder, commitOf(1, []));
    expect(builder.counters.appends).toBe(1);
    expect(builder.counters.parentLookups).toBe(0);
    expect(storeWork(builder)).toBe(1);
  });
});

describe('a store given an object name of the wrong size', () => {
  it('refuses a commit name that is not twenty bytes', () => {
    const builder = createCommitStoreBuilder();
    const wrong: AppendedCommit = { ...commitOf(1, []), hash: new Uint8Array(19) };
    expect(() => appendCommit(builder, wrong)).toThrow(
      new RangeError('a commit object name is 20 bytes, not 19'),
    );
  });

  it('refuses parent names that are not whole names', () => {
    const builder = createCommitStoreBuilder();
    const wrong: AppendedCommit = { ...commitOf(1, []), parentHashes: new Uint8Array(30) };
    expect(() => appendCommit(builder, wrong)).toThrow(
      new RangeError('parent object names are whole 20 byte names, not 30 bytes'),
    );
  });
});

describe('resolving parents', () => {
  it('gives a merge both its parents, in the order it was given them', () => {
    const builder = createCommitStoreBuilder();
    appendCommit(builder, commitOf(1, [2, 3]));
    appendCommit(builder, commitOf(2, []));
    appendCommit(builder, commitOf(3, []));
    const columns = buildCommitColumns(builder);
    expect([...columns.parentOffsets]).toEqual([0, 2, 2, 2]);
    expect([...columns.parentIndices]).toEqual([1, 2]);
  });

  it('resolves a parent appended after its child, which is git’s own order', () => {
    const builder = createCommitStoreBuilder();
    appendCommit(builder, commitOf(1, [2]));
    expect(buildCommitColumns(builder).parentIndices[0]).toBe(UNKNOWN_INDEX);
    appendCommit(builder, commitOf(2, []));
    expect(buildCommitColumns(builder).parentIndices[0]).toBe(1);
  });

  it('leaves a parent that was never appended unknown', () => {
    const builder = createCommitStoreBuilder();
    appendCommit(builder, commitOf(1, [99]));
    appendCommit(builder, commitOf(2, []));
    expect(buildCommitColumns(builder).parentIndices[0]).toBe(UNKNOWN_INDEX);
  });

  it('resolves a parent already in the store without waiting', () => {
    const builder = createCommitStoreBuilder();
    appendCommit(builder, commitOf(2, []));
    appendCommit(builder, commitOf(1, [2]));
    expect(buildCommitColumns(builder).parentIndices[0]).toBe(0);
    expect(builder.pending.live).toBe(0);
  });
});

describe('interning people', () => {
  it('gives the same person seen twice one entry', () => {
    const builder = createCommitStoreBuilder();
    appendCommit(builder, commitOf(1, []));
    appendCommit(builder, commitOf(2, []));
    const columns = buildCommitColumns(builder);
    expect(columns.people.names).toEqual(['Ada Lovelace']);
    expect([...columns.authorId]).toEqual([0, 0]);
    expect([...columns.committerId]).toEqual([0, 0]);
  });

  it('gives two different people two entries', () => {
    const builder = createCommitStoreBuilder();
    appendCommit(builder, commitOf(1, [], 'one', 'Ada Lovelace'));
    appendCommit(builder, commitOf(2, [], 'two', 'Grace Hopper'));
    const columns = buildCommitColumns(builder);
    expect(columns.people.names).toEqual(['Ada Lovelace', 'Grace Hopper']);
    expect([...columns.authorId]).toEqual([0, 1]);
  });

  it('tells one name with two addresses apart', () => {
    const builder = createCommitStoreBuilder();
    const first = commitOf(1, []);
    appendCommit(builder, first);
    appendCommit(builder, { ...first, hash: nameOf(2), authorEmail: 'other@example.invalid' });
    const columns = buildCommitColumns(builder);
    expect(columns.people.emails).toHaveLength(2);
    expect([...columns.authorId]).toEqual([0, 1]);
    expect([...columns.committerId]).toEqual([0, 0]);
  });
});

describe('subjects', () => {
  it('keeps a character outside the basic multilingual plane whole', () => {
    const astral = 'fix the \u{1F680} launcher';
    const builder = createCommitStoreBuilder();
    appendCommit(builder, commitOf(1, [], astral));
    appendCommit(builder, commitOf(2, [], 'plain'));
    const columns = buildCommitColumns(builder);
    expect(columns.subjects.slice(0, columns.subjectOffsets[1])).toBe(astral);
    expect(columns.subjectOffsets[1]).toBe(astral.length);
  });

  it('counts offsets in code units, so the blob slices without decoding', () => {
    const builder = createCommitStoreBuilder();
    appendCommit(builder, commitOf(1, [], '\u{1F680}'));
    const columns = buildCommitColumns(builder);
    expect([...columns.subjectOffsets]).toEqual([0, 2]);
  });
});

describe('a store that outgrows its columns', () => {
  it('reallocates geometrically and keeps every commit', () => {
    const builder = createCommitStoreBuilder(2);
    for (let seed = 0; seed < 20; seed += 1) {
      appendCommit(builder, commitOf(seed, seed === 0 ? [] : [seed - 1]));
    }
    expect(builder.counters.reallocations).toBeGreaterThanOrEqual(3);
    const columns = buildCommitColumns(builder);
    expect(columns.count).toBe(20);
    expect([...columns.hashes.subarray(0, HASH_BYTE_LENGTH)]).toEqual([...nameOf(0)]);
    expect([...columns.hashes.subarray(19 * HASH_BYTE_LENGTH)]).toEqual([...nameOf(19)]);
  });

  it('keeps every parent pointing where it did before the columns moved', () => {
    const builder = createCommitStoreBuilder(2);
    for (let seed = 0; seed < 20; seed += 1) {
      appendCommit(builder, commitOf(seed, seed === 19 ? [] : [seed + 1]));
    }
    const columns = buildCommitColumns(builder);
    expect([...columns.parentIndices]).toEqual([...Array(19).keys()].map((row) => row + 1));
    expect(columns.parentOffsets[20]).toBe(19);
  });

  it('never copies more than it has to, so the work counter stays linear', () => {
    const builder = createCommitStoreBuilder(2);
    for (let seed = 0; seed < 200; seed += 1) {
      appendCommit(builder, commitOf(seed, []));
    }
    expect(builder.counters.movedEntries).toBeLessThan(200 * 5);
  });
});

describe('the offset columns of a store that outgrew itself', () => {
  function grown(): CommitColumns {
    const builder = createCommitStoreBuilder(2);
    for (let seed = 0; seed < 20; seed += 1) {
      appendCommit(builder, commitOf(seed, seed === 19 ? [] : [seed + 1], 'ab'));
    }
    return buildCommitColumns(builder);
  }

  it('carry every parent offset the moves passed over, not only the last', () => {
    expect([...grown().parentOffsets]).toEqual([...[...Array(20).keys()], 19]);
  });

  it('carry every subject offset the moves passed over, not only the last', () => {
    expect([...grown().subjectOffsets]).toEqual([...Array(21).keys()].map((row) => row * 2));
  });
});

describe('two stores built from the same commits', () => {
  function built(): CommitColumns {
    const builder = createCommitStoreBuilder(4);
    appendCommit(builder, commitOf(1, [2, 3]));
    appendCommit(builder, commitOf(2, [4]));
    appendCommit(builder, commitOf(3, [99]));
    appendCommit(builder, commitOf(4, [], 'root', 'Grace Hopper'));
    return buildCommitColumns(builder);
  }

  it('produce the same page, column for column', () => {
    expect(snapshotOf(built())).toEqual(snapshotOf(built()));
  });

  it('produce a page whose columns are exactly as long as the contract says', () => {
    const columns = built();
    expect(columns.hashes).toHaveLength(columns.count * HASH_BYTE_LENGTH);
    expect(columns.parentOffsets).toHaveLength(columns.count + 1);
    expect(columns.subjectOffsets).toHaveLength(columns.count + 1);
    expect(columns.authorId).toHaveLength(columns.count);
    expect(columns.parentIndices).toHaveLength(columns.parentOffsets[columns.count] ?? -1);
    expect(columns.subjects).toHaveLength(columns.subjectOffsets[columns.count] ?? -1);
  });
});
