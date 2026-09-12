import { describe, expect, it } from 'vitest';

import { HASH_BYTE_LENGTH, UNKNOWN_INDEX } from '../../contracts/index';
import type { CommitColumns } from '../../contracts/index';

import { authorOf, commitCount, committerOf, hexHashOf, parentsOf, subjectOf } from './index';

const PEOPLE = {
  names: ['Ada', 'Grace'],
  emails: ['ada@example.invalid', 'grace@example.invalid'],
};

/**
 * A page of one commit, written by hand.
 *
 * By hand rather than through the builder, because several of the tests below
 * need a page whose people table disagrees with its columns, which the builder
 * cannot produce and which is exactly the disagreement the accessors refuse.
 */
function pageOf(): CommitColumns {
  const hashes = new Uint8Array(HASH_BYTE_LENGTH);
  hashes[0] = 0x0a;
  hashes[HASH_BYTE_LENGTH - 1] = 0xff;
  return {
    count: 1,
    hashes,
    parentOffsets: Uint32Array.of(0, 2),
    parentIndices: Uint32Array.of(4, UNKNOWN_INDEX),
    authorId: Uint32Array.of(0),
    committerId: Uint32Array.of(1),
    authorTime: Float64Array.of(1700000000),
    commitTime: Float64Array.of(1700000001),
    authorTzMinutes: Int16Array.of(60),
    commitTzMinutes: Int16Array.of(-300),
    subjectOffsets: Uint32Array.of(0, 5),
    subjects: 'first',
    people: PEOPLE,
  };
}

/**
 * A page of two commits.
 *
 * Every accessor addresses row *n* by arithmetic over an offset column, and
 * arithmetic that is wrong is still right at row zero. This page is what makes
 * row one say so.
 */
function pairPage(): CommitColumns {
  const hashes = new Uint8Array(2 * HASH_BYTE_LENGTH);
  hashes[0] = 0x0a;
  hashes[HASH_BYTE_LENGTH - 1] = 0xff;
  hashes[HASH_BYTE_LENGTH] = 0xbe;
  hashes[2 * HASH_BYTE_LENGTH - 1] = 0x01;
  return {
    count: 2,
    hashes,
    parentOffsets: Uint32Array.of(0, 1, 3),
    parentIndices: Uint32Array.of(1, UNKNOWN_INDEX, 0),
    authorId: Uint32Array.of(0, 1),
    committerId: Uint32Array.of(1, 0),
    authorTime: Float64Array.of(1700000000, 1700000060),
    commitTime: Float64Array.of(1700000001, 1700000061),
    authorTzMinutes: Int16Array.of(60, -60),
    commitTzMinutes: Int16Array.of(-300, 0),
    subjectOffsets: Uint32Array.of(0, 5, 11),
    subjects: 'firstsecond',
    people: PEOPLE,
  };
}

describe('reading a page', () => {
  it('reports how many commits it holds', () => {
    expect(commitCount(pageOf())).toBe(1);
    expect(commitCount({ ...pageOf(), count: 0 })).toBe(0);
  });

  it('renders the object name as hex, padding a byte below sixteen', () => {
    expect(hexHashOf(pageOf(), 0)).toBe(`0a${'00'.repeat(HASH_BYTE_LENGTH - 2)}ff`);
  });

  it('renders exactly two characters per byte', () => {
    expect(hexHashOf(pageOf(), 0)).toHaveLength(HASH_BYTE_LENGTH * 2);
  });

  it('slices the subject out of the blob', () => {
    expect(subjectOf(pageOf(), 0)).toBe('first');
  });

  it('gives the parents as a view of the flat column', () => {
    expect([...parentsOf(pageOf(), 0)]).toEqual([4, UNKNOWN_INDEX]);
  });

  it('gives the author and the committer their own entries', () => {
    expect(authorOf(pageOf(), 0)).toEqual({ name: 'Ada', email: 'ada@example.invalid' });
    expect(committerOf(pageOf(), 0)).toEqual({ name: 'Grace', email: 'grace@example.invalid' });
  });
});

describe('reading the second row of a page', () => {
  it('renders that row’s object name, not the first one’s', () => {
    expect(hexHashOf(pairPage(), 1)).toBe(`be${'00'.repeat(HASH_BYTE_LENGTH - 2)}01`);
  });

  it('slices that row’s subject, not the whole blob', () => {
    expect(subjectOf(pairPage(), 1)).toBe('second');
    expect(subjectOf(pairPage(), 0)).toBe('first');
  });

  it('gives that row’s parents, not the first row’s', () => {
    expect([...parentsOf(pairPage(), 0)]).toEqual([1]);
    expect([...parentsOf(pairPage(), 1)]).toEqual([UNKNOWN_INDEX, 0]);
  });

  it('gives that row’s people, not the first row’s', () => {
    expect(authorOf(pairPage(), 1).name).toBe('Grace');
    expect(committerOf(pairPage(), 1).name).toBe('Ada');
  });
});

describe('reading a row that is not in the page', () => {
  it('refuses the row one past the end, naming the page it looked in', () => {
    expect(() => hexHashOf(pageOf(), 1)).toThrow(
      new RangeError('row 1 is not a commit of a page of 1'),
    );
  });

  it('refuses a negative row before reading anything', () => {
    expect(() => subjectOf(pageOf(), -1)).toThrow(
      new RangeError('row -1 is not a commit of a page of 1'),
    );
  });

  it('refuses a row that is not a whole number', () => {
    expect(() => parentsOf(pageOf(), 0.5)).toThrow(
      new RangeError('row 0.5 is not a commit of a page of 1'),
    );
  });

  it('refuses any row at all in an empty page', () => {
    expect(() => hexHashOf({ ...pageOf(), count: 0 }, 0)).toThrow(
      new RangeError('row 0 is not a commit of a page of 0'),
    );
  });

  it('refuses the row past the end from every accessor, by that accessor', () => {
    const past = new RangeError('row 1 is not a commit of a page of 1');
    expect(() => authorOf(pageOf(), 1)).toThrow(past);
    expect(() => committerOf(pageOf(), 1)).toThrow(past);
    expect(() => parentsOf(pageOf(), 1)).toThrow(past);
    expect(() => subjectOf(pageOf(), 1)).toThrow(past);
  });

  it('accepts row zero, which the checks above must not have excluded', () => {
    expect(() => hexHashOf(pageOf(), 0)).not.toThrow();
  });
});

describe('reading a page whose people table disagrees with its columns', () => {
  it('refuses an author identifier the table does not hold', () => {
    const page: CommitColumns = { ...pageOf(), authorId: Uint32Array.of(7) };
    expect(() => authorOf(page, 0)).toThrow(new RangeError('person 7 is not in a table of 2'));
  });

  it('refuses a committer identifier the table does not hold', () => {
    const page: CommitColumns = { ...pageOf(), committerId: Uint32Array.of(7) };
    expect(() => committerOf(page, 0)).toThrow(new RangeError('person 7 is not in a table of 2'));
  });

  it('refuses a table with a name but no address for that identifier', () => {
    const page: CommitColumns = { ...pageOf(), people: { names: ['Ada'], emails: [] } };
    expect(() => authorOf(page, 0)).toThrow(new RangeError('person 0 is not in a table of 1'));
  });

  it('refuses a table with an address but no name for that identifier', () => {
    const page: CommitColumns = {
      ...pageOf(),
      people: { names: [], emails: ['ada@example.invalid'] },
    };
    expect(() => authorOf(page, 0)).toThrow(new RangeError('person 0 is not in a table of 0'));
  });
});
