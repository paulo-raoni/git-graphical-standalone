import { describe, expect, it } from 'vitest';

import { HASH_BYTE_LENGTH } from '../../contracts/index';
import type { CommitColumns } from '../../contracts/index';

import { continuesBlock } from './continues-block';
import { createRowBlock } from './row-block';
import type { RowBlock } from './row-block';

/**
 * Whether a reading continues the block, over object names built by hand.
 *
 * Each commit's name is twenty bytes of one value, so a case can say "commit
 * 7" and a reader can see which commit it means. The cases that differ from the
 * block by one byte put that byte at each end of the prefix, because a
 * comparison that stops a byte short, or starts a byte late, still agrees
 * everywhere else.
 */

/** Object names for `commits`, twenty bytes of the commit's own value each. */
function namesOf(commits: readonly number[]): Uint8Array {
  const names = new Uint8Array(commits.length * HASH_BYTE_LENGTH);
  commits.forEach((commit, at) => {
    names.fill(commit, at * HASH_BYTE_LENGTH, (at + 1) * HASH_BYTE_LENGTH);
  });
  return names;
}

/** A reading whose only column this function reads is its object names. */
function readingOf(hashes: Uint8Array): CommitColumns {
  const count = hashes.length / HASH_BYTE_LENGTH;
  return {
    count,
    hashes,
    parentOffsets: new Uint32Array(count + 1),
    parentIndices: new Uint32Array(0),
    authorId: new Uint32Array(count),
    committerId: new Uint32Array(count),
    authorTime: new Float64Array(count),
    commitTime: new Float64Array(count),
    authorTzMinutes: new Int16Array(count),
    commitTzMinutes: new Int16Array(count),
    subjectOffsets: new Uint32Array(count + 1),
    subjects: '',
    people: { names: [], emails: [] },
  };
}

/** A block of `rowCount` rows; this function reads nothing of it but the count. */
function blockOf(rowCount: number): RowBlock {
  return { ...createRowBlock(), rowCount };
}

/** The block of three rows every case below starts from, and what it was laid out from. */
const LAID_OUT = [3, 2, 1];

describe('continuesBlock', () => {
  it('is continued by a larger reading of the same history', () => {
    const reading = readingOf(namesOf([3, 2, 1, 9, 8]));
    expect(continuesBlock(blockOf(3), namesOf(LAID_OUT), reading)).toBe(true);
  });

  it('is continued by a reading exactly as long as the block', () => {
    expect(continuesBlock(blockOf(3), namesOf(LAID_OUT), readingOf(namesOf(LAID_OUT)))).toBe(true);
  });

  it('is not continued once a commit has gone on the front of the log', () => {
    const reading = readingOf(namesOf([4, 3, 2, 1, 9]));
    expect(continuesBlock(blockOf(3), namesOf(LAID_OUT), reading)).toBe(false);
  });

  it('is not continued when the commits are the same ones in another order', () => {
    const reading = readingOf(namesOf([3, 1, 2, 9]));
    expect(continuesBlock(blockOf(3), namesOf(LAID_OUT), reading)).toBe(false);
  });

  it('is not continued when only the first byte of the prefix differs', () => {
    const names = namesOf([3, 2, 1, 9]);
    names[0] = 0xff;
    expect(continuesBlock(blockOf(3), namesOf(LAID_OUT), readingOf(names))).toBe(false);
  });

  it('is not continued when only the last byte of the prefix differs', () => {
    const names = namesOf([3, 2, 1, 9]);
    names[3 * HASH_BYTE_LENGTH - 1] = 0xff;
    expect(continuesBlock(blockOf(3), namesOf(LAID_OUT), readingOf(names))).toBe(false);
  });

  it('reads nothing past the block, in the reading or in what it was laid out from', () => {
    const laidOutFrom = namesOf([3, 2, 1, 7, 7]);
    const reading = readingOf(namesOf([3, 2, 1, 9]));
    expect(continuesBlock(blockOf(3), laidOutFrom, reading)).toBe(true);
    expect(continuesBlock(blockOf(3), namesOf(LAID_OUT), reading)).toBe(true);
  });

  it('is not continued by a reading shorter than the block, even one it begins', () => {
    const reading = readingOf(namesOf([3, 2]));
    expect(continuesBlock(blockOf(3), namesOf(LAID_OUT), reading)).toBe(false);
  });

  it('is not continued when what it was laid out from does not cover the block', () => {
    const reading = readingOf(namesOf([3, 2, 1, 9]));
    expect(continuesBlock(blockOf(3), namesOf([3, 2]), reading)).toBe(false);
  });

  it('is continued by every reading while it holds no row', () => {
    const empty = new Uint8Array(0);
    expect(continuesBlock(blockOf(0), empty, readingOf(namesOf([5, 4])))).toBe(true);
    expect(continuesBlock(blockOf(0), empty, readingOf(empty))).toBe(true);
  });
});
