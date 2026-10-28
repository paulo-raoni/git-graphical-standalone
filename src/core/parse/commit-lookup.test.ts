import { describe, expect, it } from 'vitest';

import { HASH_BYTE_LENGTH, UNKNOWN_INDEX } from '../../contracts/index';

import { resolveCommitRows } from './commit-lookup';

/** An object name whose first four bytes are `prefix` and whose rest is `tail`. */
function nameOf(prefix: readonly number[], tail: number): Uint8Array {
  const name = new Uint8Array(HASH_BYTE_LENGTH).fill(tail);
  name.set(prefix, 0);
  return name;
}

function concatenated(names: readonly Uint8Array[]): Uint8Array {
  const all = new Uint8Array(names.length * HASH_BYTE_LENGTH);
  names.forEach((name, at) => {
    all.set(name, at * HASH_BYTE_LENGTH);
  });
  return all;
}

const SHARED = [0x01, 0x02, 0x03, 0x04];
const OTHER = [0x09, 0x08, 0x07, 0x06];

describe('resolveCommitRows', () => {
  it('answers nothing when nothing was asked', () => {
    const { rows } = resolveCommitRows(new Uint8Array(0), 0, new Uint8Array(0), 0);
    expect(rows.length).toBe(0);
  });

  it('finds the row each object name landed in', () => {
    const first = nameOf(SHARED, 0xaa);
    const second = nameOf(OTHER, 0xbb);
    const { rows } = resolveCommitRows(
      concatenated([second, first]),
      2,
      concatenated([first, second]),
      2,
    );
    expect([...rows]).toEqual([1, 0]);
  });

  it('reports a target whose commit is not on the page', () => {
    const wanted = nameOf(SHARED, 0xaa);
    const loaded = nameOf(OTHER, 0xbb);
    const { rows } = resolveCommitRows(concatenated([wanted]), 1, concatenated([loaded]), 1);
    expect([...rows]).toEqual([UNKNOWN_INDEX]);
  });
});

describe('resolveCommitRows, where targets meet', () => {
  it('separates two targets that share a four-byte prefix', () => {
    const wantedA = nameOf(SHARED, 0xaa);
    const wantedB = nameOf(SHARED, 0xbb);
    const decoy = nameOf(SHARED, 0xcc);
    const { rows } = resolveCommitRows(
      concatenated([wantedA, wantedB]),
      2,
      concatenated([decoy, wantedB]),
      2,
    );
    expect([...rows]).toEqual([UNKNOWN_INDEX, 1]);
  });

  it('answers two targets that name the same commit', () => {
    const shared = nameOf(SHARED, 0xaa);
    const { rows } = resolveCommitRows(
      concatenated([shared, shared]),
      2,
      concatenated([shared]),
      1,
    );
    expect([...rows]).toEqual([0, 0]);
  });

  it('answers nothing when the page holds no commits', () => {
    const { rows } = resolveCommitRows(
      concatenated([nameOf(SHARED, 0xaa)]),
      1,
      new Uint8Array(0),
      0,
    );
    expect([...rows]).toEqual([UNKNOWN_INDEX]);
  });
});

const THIRD = [0x05, 0x05, 0x05, 0x05];

describe('resolveCommitRows, against a page holding some of its targets', () => {
  it('answers every target, found or not', () => {
    const first = nameOf(SHARED, 0xaa);
    const second = nameOf(OTHER, 0xbb);
    const missing = nameOf(THIRD, 0xcc);
    const targets = concatenated([second, missing, first]);
    const page = concatenated([first, second]);
    const lookup = resolveCommitRows(targets, 3, page, 2);
    expect([...lookup.rows]).toEqual([1, UNKNOWN_INDEX, 0]);
    expect(lookup.comparisons).toBe(2);
  });

  it('compares each target only with the rows that share its first four bytes', () => {
    const first = nameOf(SHARED, 0xaa);
    const second = nameOf(OTHER, 0xbb);
    const elsewhere = nameOf(THIRD, 0xcc);
    const lookup = resolveCommitRows(
      concatenated([first, second]),
      2,
      concatenated([elsewhere, first, elsewhere, second, elsewhere]),
      5,
    );
    expect([...lookup.rows]).toEqual([1, 3]);
    expect(lookup.comparisons).toBe(2);
  });

  it('makes no comparison for a target that no row shares a prefix with', () => {
    const lookup = resolveCommitRows(
      concatenated([nameOf(THIRD, 0xcc)]),
      1,
      concatenated([nameOf(SHARED, 0xaa), nameOf(OTHER, 0xbb)]),
      2,
    );
    expect(lookup.comparisons).toBe(0);
  });
});

describe('resolveCommitRows, counting its comparisons', () => {
  it('counts a comparison for a row that only shares the prefix', () => {
    const wantedA = nameOf(SHARED, 0xaa);
    const wantedB = nameOf(SHARED, 0xbb);
    const decoy = nameOf(SHARED, 0xcc);
    const lookup = resolveCommitRows(
      concatenated([wantedA, wantedB]),
      2,
      concatenated([decoy, wantedB]),
      2,
    );
    expect([...lookup.rows]).toEqual([UNKNOWN_INDEX, 1]);
    expect(lookup.comparisons).toBe(4);
  });

  it('compares a thousand references on one commit once each, not once per row', () => {
    const crowded = nameOf(SHARED, 0xaa);
    const targets = concatenated(Array.from({ length: 1000 }, () => crowded));
    const page = concatenated([
      nameOf(OTHER, 0x01),
      crowded,
      ...Array.from({ length: 48 }, (_, at) => nameOf(THIRD, at)),
    ]);
    const lookup = resolveCommitRows(targets, 1000, page, 50);
    expect(lookup.rows.every((row) => row === 1)).toBe(true);
    expect(lookup.comparisons).toBe(1000);
  });
});
