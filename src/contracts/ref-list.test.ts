import { describe, expect, it } from 'vitest';

import {
  refCommitOf,
  refCount,
  RefFlag,
  refFlagsOf,
  RefKind,
  refKindOf,
  refNameOf,
  UNKNOWN_INDEX,
} from './index';
import type { Refs } from './index';

/**
 * A block of two references, written by hand.
 *
 * Two rather than one, because every accessor addresses reference *n* by
 * arithmetic over a column or an offset table, and arithmetic that is wrong is
 * still right at entry zero. The names are deliberately different lengths, so a
 * slice that reads the wrong offset produces the wrong string rather than a
 * string of the right length from the wrong place.
 */
function pairBlock(): Refs {
  return {
    count: 2,
    kind: Uint8Array.of(RefKind.LocalHead, RefKind.Tag),
    commitIndex: Uint32Array.of(0, UNKNOWN_INDEX),
    nameOffsets: Uint32Array.of(0, 4, 13),
    names: 'mainv1.2.3-rc',
    flags: Uint8Array.of(RefFlag.CheckedOut, RefFlag.AnnotatedTag),
  };
}

/** A block holding one reference of every kind this contract defines. */
function everyKindBlock(): Refs {
  return {
    count: 5,
    kind: Uint8Array.of(
      RefKind.LocalHead,
      RefKind.RemoteBranch,
      RefKind.Tag,
      RefKind.RemoteSymbolicHead,
      RefKind.Stash,
    ),
    commitIndex: Uint32Array.of(0, 1, 2, 3, 4),
    nameOffsets: Uint32Array.of(0, 1, 2, 3, 4, 5),
    names: 'abcde',
    flags: Uint8Array.of(0, 0, 0, 0, 0),
  };
}

describe('reading a block of references', () => {
  it('reports how many it holds', () => {
    expect(refCount(pairBlock())).toBe(2);
    expect(refCount({ ...pairBlock(), count: 0 })).toBe(0);
  });

  it('slices each name out of the blob', () => {
    expect(refNameOf(pairBlock(), 0)).toBe('main');
    expect(refNameOf(pairBlock(), 1)).toBe('v1.2.3-rc');
  });

  it('gives each reference its own kind', () => {
    expect(refKindOf(pairBlock(), 0)).toBe(RefKind.LocalHead);
    expect(refKindOf(pairBlock(), 1)).toBe(RefKind.Tag);
  });

  it('gives each reference its own commit, sentinel included', () => {
    expect(refCommitOf(pairBlock(), 0)).toBe(0);
    expect(refCommitOf(pairBlock(), 1)).toBe(UNKNOWN_INDEX);
  });

  it('gives each reference its own flags, as the stored bits', () => {
    expect(refFlagsOf(pairBlock(), 0)).toBe(RefFlag.CheckedOut);
    expect(refFlagsOf(pairBlock(), 1)).toBe(RefFlag.AnnotatedTag);
  });

  it('reads a flags entry that carries more than one bit', () => {
    const block: Refs = {
      ...pairBlock(),
      flags: Uint8Array.of(RefFlag.CheckedOut | RefFlag.DetachedHead, 0),
    };
    expect(refFlagsOf(block, 0)).toBe(RefFlag.CheckedOut | RefFlag.DetachedHead);
  });
});

describe('reading every kind this contract defines', () => {
  it('returns each of the five, and never the one before or after it', () => {
    const block = everyKindBlock();
    expect(refKindOf(block, 0)).toBe(RefKind.LocalHead);
    expect(refKindOf(block, 1)).toBe(RefKind.RemoteBranch);
    expect(refKindOf(block, 2)).toBe(RefKind.Tag);
    expect(refKindOf(block, 3)).toBe(RefKind.RemoteSymbolicHead);
    expect(refKindOf(block, 4)).toBe(RefKind.Stash);
  });

  it('refuses a kind byte this contract does not define, naming the byte', () => {
    const block: Refs = { ...pairBlock(), kind: Uint8Array.of(9, RefKind.Tag) };
    expect(() => refKindOf(block, 0)).toThrow(
      new RangeError('reference kind 9 is not one this contract defines'),
    );
  });

  it('refuses the byte one past the last kind, which is the off-by-one', () => {
    const block: Refs = { ...pairBlock(), kind: Uint8Array.of(RefKind.Stash + 1, RefKind.Tag) };
    expect(() => refKindOf(block, 0)).toThrow(
      new RangeError('reference kind 5 is not one this contract defines'),
    );
  });
});

describe('reading a reference that is not in the block', () => {
  it('refuses the one past the end, naming the block it looked in', () => {
    expect(() => refNameOf(pairBlock(), 2)).toThrow(
      new RangeError('reference 2 is not one of a block of 2'),
    );
  });

  it('refuses a negative reference before reading anything', () => {
    expect(() => refNameOf(pairBlock(), -1)).toThrow(
      new RangeError('reference -1 is not one of a block of 2'),
    );
  });

  it('refuses a reference that is not a whole number', () => {
    expect(() => refNameOf(pairBlock(), 0.5)).toThrow(
      new RangeError('reference 0.5 is not one of a block of 2'),
    );
  });

  it('refuses any reference at all in an empty block', () => {
    expect(() => refNameOf({ ...pairBlock(), count: 0 }, 0)).toThrow(
      new RangeError('reference 0 is not one of a block of 0'),
    );
  });

  it('refuses the one past the end from every accessor, by that accessor', () => {
    const past = new RangeError('reference 2 is not one of a block of 2');
    expect(() => refNameOf(pairBlock(), 2)).toThrow(past);
    expect(() => refKindOf(pairBlock(), 2)).toThrow(past);
    expect(() => refCommitOf(pairBlock(), 2)).toThrow(past);
    expect(() => refFlagsOf(pairBlock(), 2)).toThrow(past);
  });

  it('accepts reference zero, which the checks above must not have excluded', () => {
    expect(() => refNameOf(pairBlock(), 0)).not.toThrow();
    expect(() => refKindOf(pairBlock(), 0)).not.toThrow();
    expect(() => refCommitOf(pairBlock(), 0)).not.toThrow();
    expect(() => refFlagsOf(pairBlock(), 0)).not.toThrow();
  });
});
