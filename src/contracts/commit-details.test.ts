import { describe, expect, it } from 'vitest';

import { detailsTargetOf, isObjectName } from './commit-details';

/** Every hexadecimal digit, both ends of each range among them, `length` long. */
const hexOf = (length: number): string => '0123456789abcdef'.repeat(8).slice(0, length);

const SHA1 = hexOf(40);
const SHA256 = hexOf(64);

describe('isObjectName', () => {
  it('is a full SHA-1 or SHA-256 object name in lower-case hexadecimal', () => {
    expect(isObjectName(SHA1)).toBe(true);
    expect(isObjectName(SHA256)).toBe(true);
    expect(isObjectName('f'.repeat(40))).toBe(true);
    expect(isObjectName('9'.repeat(64))).toBe(true);
  });

  it('is no other length', () => {
    for (const length of [0, 1, 39, 41, 50, 63, 65, 80]) {
      expect(isObjectName(hexOf(length)), String(length)).toBe(false);
    }
  });

  it('is nothing but hexadecimal digits, from the first character to the last', () => {
    expect(isObjectName(`g${SHA1.slice(1)}`)).toBe(false);
    expect(isObjectName(`${SHA1.slice(1)}g`)).toBe(false);
    expect(isObjectName(SHA1.toUpperCase())).toBe(false);
    expect(isObjectName(`-${SHA1}`)).toBe(false);
    expect(isObjectName(`${SHA1}\n`)).toBe(false);
    expect(isObjectName(`x${SHA256}`)).toBe(false);
    expect(isObjectName(`${SHA256}x`)).toBe(false);
    expect(isObjectName(`${'/'.repeat(20)}${':'.repeat(20)}`)).toBe(false);
    expect(isObjectName(`${'`'.repeat(20)}${'g'.repeat(20)}`)).toBe(false);
  });

  it('is a string, not something that turns into one', () => {
    expect(isObjectName([SHA1])).toBe(false);
    expect(isObjectName({ toString: () => SHA1 })).toBe(false);
    expect(isObjectName(undefined)).toBe(false);
  });
});

describe('detailsTargetOf', () => {
  it('names the uncommitted changes, as a new object holding the kind alone', () => {
    const asked = { kind: 'uncommitted', hash: SHA1, extra: 1 };
    const target = detailsTargetOf(asked);
    expect(target).toStrictEqual({ kind: 'uncommitted' });
    expect(target).not.toBe(asked);
  });

  it('names a commit by its full object name, as a new object holding the two fields alone', () => {
    const asked = { kind: 'commit', hash: SHA256, extra: 1 };
    const target = detailsTargetOf(asked);
    expect(target).toStrictEqual({ kind: 'commit', hash: SHA256 });
    expect(target).not.toBe(asked);
  });

  it('names nothing for a commit without a full object name', () => {
    for (const hash of [
      undefined,
      'HEAD',
      'HEAD~1',
      '--output=x',
      SHA1.slice(1),
      SHA1.toUpperCase(),
    ]) {
      expect(detailsTargetOf({ kind: 'commit', hash }), String(hash)).toBeNull();
    }
  });

  it('names nothing for any other kind, or for a value that is not an object', () => {
    expect(detailsTargetOf({ kind: 'stash', hash: SHA1 })).toBeNull();
    expect(detailsTargetOf({ hash: SHA1 })).toBeNull();
    expect(detailsTargetOf(null)).toBeNull();
    expect(detailsTargetOf(undefined)).toBeNull();
    expect(detailsTargetOf('uncommitted')).toBeNull();
    expect(detailsTargetOf(SHA1)).toBeNull();
  });
});
