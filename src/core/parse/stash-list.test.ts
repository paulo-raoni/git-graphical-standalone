import { describe, expect, it } from 'vitest';

import { HASH_BYTE_LENGTH, RefKind } from '../../contracts/index';
import type { ChangedFile, CommitDetails } from '../../contracts/index';
import type { AppendedCommit } from '../store/index';

import { createReferenceList } from './reference-list';
import {
  addStashReferences,
  createStashListParser,
  emptyStashList,
  finishStashList,
  interleaveStashes,
  pushStashList,
  STASH_FORMAT,
  stashBaseNames,
  isStashCommit,
  thirdParentOf,
  withUntrackedFiles,
} from './stash-list';
import type { StashList } from './stash-list';

const bytesOf = (text: string): Uint8Array =>
  Uint8Array.from(text, (character) => character.charCodeAt(0));

const RECORD = String.fromCharCode(0x1e);
const UNIT = String.fromCharCode(0x1f);
const NUL = String.fromCharCode(0);

const hexName = (byte: number): string =>
  byte.toString(16).padStart(2, '0').repeat(HASH_BYTE_LENGTH);

const STASH = hexName(0x51);
const BASE = hexName(0x11);
const INDEX = hexName(0x12);
const UNTRACKED = hexName(0x13);

/** One `stash list` record, in the order `STASH_FORMAT` asks for. */
function stashRecord(own: string, parents: string, subject = 'On main: kept'): string {
  const fields = [
    own,
    parents,
    'Stasher',
    'stasher@example.invalid',
    '1700000100 +0100',
    'Committer',
    'committer@example.invalid',
    '1700000200 -0030',
    subject,
  ];
  return `${RECORD}${fields.join(UNIT)}${NUL}`;
}

function readStashes(text: string, chunkSize = 4096): StashList {
  const parser = createStashListParser();
  const bytes = bytesOf(text);
  for (let at = 0; at < bytes.length; at += chunkSize) {
    pushStashList(parser, bytes.subarray(at, Math.min(at + chunkSize, bytes.length)));
  }
  return finishStashList(parser);
}

/** The binary object name whose every byte is `byte`. */
function name(byte: number): Uint8Array {
  return new Uint8Array(HASH_BYTE_LENGTH).fill(byte);
}

/** A commit named by `byte`, committed at `time`, with parents named by `parents`. */
function commit(byte: number, time: number, parents: readonly number[] = []): AppendedCommit {
  const parentHashes = new Uint8Array(parents.length * HASH_BYTE_LENGTH);
  parents.forEach((parent, at) => parentHashes.fill(parent, at * HASH_BYTE_LENGTH));
  return {
    hash: name(byte),
    parentHashes,
    authorName: '',
    authorEmail: '',
    authorTime: time,
    authorTzMinutes: 0,
    committerName: '',
    committerEmail: '',
    commitTime: time,
    commitTzMinutes: 0,
    subject: `commit ${String(byte)}`,
  };
}

/** A list of stashes, each named by its own byte, made on the commit named by `base`. */
function stashes(...entries: readonly (readonly [number, number, number])[]): StashList {
  return {
    entries: entries.map(([own, time, base], at) => ({
      name: `stash@{${String(at)}}`,
      commit: commit(own, time, [base]),
    })),
  };
}

/** The rows `log` becomes with `list` put in, as the first byte of each row's name. */
function rowsOf(list: StashList, byDate: boolean, log: readonly AppendedCommit[]): number[] {
  const rows: number[] = [];
  const sink = interleaveStashes(list, byDate, (row) => rows.push(row.hash[0] ?? -1));
  for (const one of log) {
    sink(one);
  }
  return rows;
}

/** A log of three commits, 0x03 newest, each the parent of the one above it. */
const LOG = [commit(0x03, 30, [0x02]), commit(0x02, 20, [0x01]), commit(0x01, 10)];

describe('the format asked of git stash list', () => {
  it('asks for every field a log record has, in that order, and not for the name', () => {
    expect(STASH_FORMAT.split('%x1f')).toEqual([
      '%x1e%H',
      '%P',
      '%an',
      '%ae',
      '%ad',
      '%cn',
      '%ce',
      '%cd',
      '%s',
    ]);
  });
});

describe('pushStashList', () => {
  it('reads an entry into its name and a commit whose only parent is its first', () => {
    const list = readStashes(stashRecord(STASH, `${BASE} ${INDEX} ${UNTRACKED}`));
    expect(list.entries.map((entry) => entry.name)).toEqual(['stash@{0}']);
    const [entry] = list.entries;
    expect(entry?.commit.hash).toEqual(name(0x51));
    expect(entry?.commit.parentHashes).toEqual(name(0x11));
    expect(entry?.commit).toMatchObject({
      authorName: 'Stasher',
      authorEmail: 'stasher@example.invalid',
      authorTime: 1700000100,
      authorTzMinutes: 60,
      committerName: 'Committer',
      committerEmail: 'committer@example.invalid',
      commitTime: 1700000200,
      commitTzMinutes: -30,
      subject: 'On main: kept',
    });
  });

  it('keeps each entry in buffers of its own, which the next record does not touch', () => {
    const list = readStashes(
      stashRecord(STASH, `${BASE} ${INDEX}`) +
        stashRecord(hexName(0x52), `${hexName(0x21)} ${INDEX}`),
    );
    expect(list.entries.map((entry) => entry.commit.hash[0])).toEqual([0x51, 0x52]);
    expect(list.entries.map((entry) => entry.commit.parentHashes[0])).toEqual([0x11, 0x21]);
  });

  it('skips an entry with no parent to sit on, and names the next by its own place', () => {
    expect(readStashes(stashRecord(STASH, '')).entries).toEqual([]);
    const after = readStashes(stashRecord(STASH, '') + stashRecord(hexName(0x52), BASE));
    expect(after.entries.map((entry) => entry.name)).toEqual(['stash@{1}']);
  });

  it('reads the same stashes at every chunk size, down to one byte', () => {
    const text = stashRecord(STASH, BASE) + stashRecord(hexName(0x52), BASE);
    for (let size = 1; size <= text.length + 1; size += 1) {
      expect(readStashes(text, size).entries.map((entry) => entry.name)).toEqual([
        'stash@{0}',
        'stash@{1}',
      ]);
    }
  });

  it('refuses a record with the wrong number of fields, and says how many it wanted', () => {
    expect(() => readStashes(`${RECORD}${STASH}${UNIT}${BASE}${NUL}`)).toThrow(
      new SyntaxError('a stash record has 9 fields, not 2'),
    );
  });
});

describe('finishStashList', () => {
  it('reads a last record that arrived without its terminator', () => {
    const text = stashRecord(STASH, BASE).slice(0, -1);
    expect(readStashes(text).entries.map((entry) => entry.name)).toEqual(['stash@{0}']);
  });

  it('answers an empty list for no output', () => {
    expect(readStashes('')).toEqual(emptyStashList());
  });
});

describe('stashBaseNames', () => {
  it('names each commit a stash was made on once, in hex, in the order of the stashes', () => {
    expect(stashBaseNames(stashes([0x51, 5, 0x02], [0x52, 4, 0x01], [0x53, 3, 0x02]))).toEqual([
      hexName(0x02),
      hexName(0x01),
    ]);
    expect(stashBaseNames(emptyStashList())).toEqual([]);
  });
});

describe('addStashReferences', () => {
  it('adds one stash reference per entry, pointing at the stash itself', () => {
    const references = createReferenceList();
    addStashReferences(references, stashes([0x51, 5, 0x02], [0x52, 4, 0x01]));
    expect(references.count).toBe(2);
    expect(references.names).toEqual(['stash@{0}', 'stash@{1}']);
    expect(references.kinds).toEqual([RefKind.Stash, RefKind.Stash]);
    expect(references.flags).toEqual([0, 0]);
    expect(references.targets.subarray(0, 2 * HASH_BYTE_LENGTH)).toEqual(
      Uint8Array.of(...name(0x51), ...name(0x52)),
    );
  });
});

describe('interleaveStashes, on every branch', () => {
  it('is the sink itself when there is no stash', () => {
    const sink = (): void => undefined;
    expect(interleaveStashes(emptyStashList(), true, sink)).toBe(sink);
  });

  it('puts a stash before the first commit older than it', () => {
    expect(rowsOf(stashes([0x51, 25, 0x01]), true, LOG)).toEqual([0x03, 0x51, 0x02, 0x01]);
  });

  it('puts a stash older than its own base directly above that base', () => {
    expect(rowsOf(stashes([0x51, 5, 0x02]), true, LOG)).toEqual([0x03, 0x51, 0x02, 0x01]);
  });

  it('puts a stash of the same time as a commit after that commit', () => {
    expect(rowsOf(stashes([0x51, 20, 0x01]), true, LOG)).toEqual([0x03, 0x02, 0x51, 0x01]);
  });

  it('puts stashes of one place newest first, and in the list order on a tie', () => {
    const list = stashes([0x51, 22, 0x01], [0x52, 25, 0x01], [0x53, 22, 0x01]);
    expect(rowsOf(list, true, LOG)).toEqual([0x03, 0x52, 0x51, 0x53, 0x02, 0x01]);
  });

  it('hands on each stash once, with its first parent as its only parent', () => {
    const handed: AppendedCommit[] = [];
    const sink = interleaveStashes(stashes([0x51, 25, 0x02]), true, (row) => handed.push(row));
    for (const one of LOG) {
      sink(one);
    }
    const stash = handed.filter((row) => row.hash[0] === 0x51);
    expect(stash).toHaveLength(1);
    expect(stash[0]?.parentHashes).toEqual(name(0x02));
  });

  it('tells two object names apart by their last byte alone', () => {
    const near = commit(0x01, 10);
    near.hash[HASH_BYTE_LENGTH - 1] = 0x09;
    const log = [LOG[0], LOG[1], near].filter((one) => one !== undefined);
    expect(rowsOf(stashes([0x51, 5, 0x01]), false, log)).toEqual([0x03, 0x02, 0x01]);
  });

  it('hands on no stash whose place the log never reaches', () => {
    expect(rowsOf(stashes([0x51, 5, 0x09]), true, LOG)).toEqual([0x03, 0x02, 0x01]);
  });

  it("drops the log's copy of a stash's own commit and keeps the stash in its place", () => {
    const own = commit(0x51, 25, [0x01, 0x12]);
    const log = [LOG[0], own, LOG[1], LOG[2]].filter((one) => one !== undefined);
    expect(rowsOf(stashes([0x51, 25, 0x01]), true, log)).toEqual([0x03, 0x51, 0x02, 0x01]);
    const late = [LOG[0], LOG[1], own, LOG[2]].filter((one) => one !== undefined);
    expect(rowsOf(stashes([0x51, 25, 0x01]), true, late)).toEqual([0x03, 0x51, 0x02, 0x01]);
  });
});

describe('interleaveStashes, under a selection', () => {
  it('puts a stash directly above the commit it was made on, whatever its time', () => {
    expect(rowsOf(stashes([0x51, 25, 0x01]), false, LOG)).toEqual([0x03, 0x02, 0x51, 0x01]);
  });

  it('shows no stash made on a commit the selection does not read', () => {
    expect(rowsOf(stashes([0x51, 25, 0x09]), false, LOG)).toEqual([0x03, 0x02, 0x01]);
  });

  it("still puts a stash in its own commit's place when a selected branch reaches it", () => {
    const own = commit(0x51, 25, [0x02, 0x12]);
    const log = [LOG[0], own, LOG[1], LOG[2]].filter((one) => one !== undefined);
    expect(rowsOf(stashes([0x51, 25, 0x02]), false, log)).toEqual([0x03, 0x51, 0x02, 0x01]);
  });
});

/** The details of a commit named by `hash`, with `parents` and `files`. */
function details(
  hash: string,
  parents: readonly string[],
  files: readonly ChangedFile[] = [],
): CommitDetails {
  const person = { name: '', email: '', time: 0, offsetMinutes: 0 };
  return { hash, parents, author: person, committer: person, message: '', files };
}

describe('thirdParentOf', () => {
  it("names the third parent of a commit with three, where a stash keeps its untracked files' commit", () => {
    expect(thirdParentOf(details(STASH, [BASE, INDEX, UNTRACKED]))).toBe(UNTRACKED);
  });

  it('names nothing for a commit with fewer parents or more', () => {
    expect(thirdParentOf(details(STASH, [BASE, INDEX]))).toBeNull();
    expect(thirdParentOf(details(STASH, []))).toBeNull();
    expect(thirdParentOf(details(STASH, [BASE, INDEX, UNTRACKED, BASE]))).toBeNull();
  });
});

describe('isStashCommit', () => {
  it('knows a stash by its own object name, and nothing else as one', () => {
    const list = stashes([0x51, 5, 0x11], [0x52, 4, 0x11]);
    expect(isStashCommit(STASH, list)).toBe(true);
    expect(isStashCommit(hexName(0x52), list)).toBe(true);
    expect(isStashCommit(BASE, list)).toBe(false);
    expect(isStashCommit(STASH, emptyStashList())).toBe(false);
  });
});

describe('withUntrackedFiles', () => {
  it("puts the untracked files' commit's files after the stash's own, as untracked", () => {
    const own: ChangedFile = {
      path: 'file.txt',
      oldPath: null,
      status: 'modified',
      additions: 1,
      deletions: 1,
    };
    const added: ChangedFile = {
      path: 'new.txt',
      oldPath: null,
      status: 'added',
      additions: 2,
      deletions: 0,
    };
    const stash = details(STASH, [BASE, INDEX, UNTRACKED], [own]);
    const merged = withUntrackedFiles(stash, details(UNTRACKED, [], [added]));
    expect(merged).toEqual({ ...stash, files: [own, { ...added, status: 'untracked' }] });
  });
});
