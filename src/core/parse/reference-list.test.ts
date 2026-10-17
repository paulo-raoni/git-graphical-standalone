import { describe, expect, it } from 'vitest';

import { HASH_BYTE_LENGTH, RefFlag, RefKind, UNKNOWN_INDEX } from '../../contracts/index';

import { addReference, buildRefs, createReferenceList, markDetachedFrom } from './reference-list';
import type { ReferenceList } from './reference-list';

const bytesOf = (text: string): Uint8Array =>
  Uint8Array.from(text, (character) => character.charCodeAt(0));

const HEX_LENGTH = HASH_BYTE_LENGTH * 2;

/** An object name whose every byte is `value`. */
const nameOf = (value: number): Uint8Array =>
  bytesOf(value.toString(16).padStart(2, '0').repeat(HASH_BYTE_LENGTH));

function put(list: ReferenceList, name: string, value: number, flags = 0): void {
  addReference(list, RefKind.LocalHead, name, flags, nameOf(value), 0, HEX_LENGTH);
}

describe('addReference', () => {
  /**
   * First in this file on purpose. A growth condition that is wrong in the
   * direction of growing doubles this column on every reference, and the two
   * tests below that add sixty-four and sixty-five references then ask for more
   * memory than the machine has before anything is asserted. One reference is
   * enough to see it, at the cost of one doubling, so the mutation gate's run
   * stops here, at its first failure.
   */
  it('keeps the target column it started with for its first reference', () => {
    const list = createReferenceList();
    const before = list.targets;
    put(list, 'main', 0x11);
    expect(list.targets).toBe(before);
    expect(list.targets.length).toBe(64 * HASH_BYTE_LENGTH);
  });

  it('keeps what it was given, in order', () => {
    const list = createReferenceList();
    put(list, 'main', 0x11);
    put(list, 'dev', 0x22, RefFlag.CheckedOut);
    expect(list.count).toBe(2);
    expect(list.names).toEqual(['main', 'dev']);
    expect(list.flags).toEqual([0, RefFlag.CheckedOut]);
    expect(list.targets[0]).toBe(0x11);
    expect(list.targets[HASH_BYTE_LENGTH]).toBe(0x22);
  });

  it('keeps its target column while the references it started with still fit', () => {
    const list = createReferenceList();
    const before = list.targets;
    expect(before.length).toBe(64 * HASH_BYTE_LENGTH);
    for (let at = 0; at < 64; at += 1) {
      put(list, `branch-${String(at)}`, at + 1);
    }
    expect(list.targets).toBe(before);
    expect(list.targets.length).toBe(64 * HASH_BYTE_LENGTH);
  });

  it('doubles that column exactly once when one more arrives, keeping what it held', () => {
    const list = createReferenceList();
    for (let at = 0; at < 65; at += 1) {
      put(list, `branch-${String(at)}`, at + 1);
    }
    expect(list.count).toBe(65);
    expect(list.targets.length).toBe(128 * HASH_BYTE_LENGTH);
    expect(list.targets[0]).toBe(1);
    expect(list.targets[63 * HASH_BYTE_LENGTH]).toBe(64);
    expect(list.targets[64 * HASH_BYTE_LENGTH]).toBe(65);
  });
});

describe('buildRefs', () => {
  it('concatenates the names and records where each one starts', () => {
    const list = createReferenceList();
    put(list, 'main', 0x11);
    put(list, 'feature', 0x22);
    const refs = buildRefs(list, Uint32Array.from([0, UNKNOWN_INDEX]));
    expect(refs.count).toBe(2);
    expect(refs.names).toBe('mainfeature');
    expect([...refs.nameOffsets]).toEqual([0, 4, 11]);
    expect([...refs.commitIndex]).toEqual([0, UNKNOWN_INDEX]);
    expect([...refs.kind]).toEqual([RefKind.LocalHead, RefKind.LocalHead]);
  });

  it('takes only as many rows as there are references', () => {
    const list = createReferenceList();
    put(list, 'main', 0x11);
    const refs = buildRefs(list, Uint32Array.from([3, 9]));
    expect([...refs.commitIndex]).toEqual([3]);
  });

  it('builds an empty block for a repository with no references', () => {
    const refs = buildRefs(createReferenceList(), new Uint32Array(0));
    expect(refs.count).toBe(0);
    expect(refs.names).toBe('');
    expect([...refs.nameOffsets]).toEqual([0]);
  });
});

describe('markDetachedFrom', () => {
  it('marks every reference standing at the commit HEAD is detached at', () => {
    const list = createReferenceList();
    put(list, 'main', 0x11);
    put(list, 'other', 0x22);
    put(list, 'also-here', 0x33);
    markDetachedFrom(list, Uint32Array.from([2, 0, 2]), 2);
    expect(list.flags).toEqual([RefFlag.DetachedHead, 0, RefFlag.DetachedHead]);
  });

  it('keeps the flags a reference already carries', () => {
    const list = createReferenceList();
    put(list, 'v1', 0x11, RefFlag.AnnotatedTag);
    markDetachedFrom(list, Uint32Array.from([5]), 5);
    expect(list.flags).toEqual([RefFlag.AnnotatedTag | RefFlag.DetachedHead]);
  });

  it('marks nothing when HEAD is not on the page', () => {
    const list = createReferenceList();
    put(list, 'main', 0x11);
    markDetachedFrom(list, Uint32Array.from([UNKNOWN_INDEX]), UNKNOWN_INDEX);
    expect(list.flags).toEqual([0]);
  });
});
