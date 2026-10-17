import { describe, expect, it } from 'vitest';

import { decodeUtf8 } from './bytes';

/**
 * The decoder is held to the WHATWG encoding standard's UTF-8 decoder, which is
 * what every other part of this machine implements. `git-process.spec.ts` checks
 * the two against each other over a corpus; the cases here are the individual
 * decisions, written as bytes so that each one names what it is.
 */

const bytesOf = (values: readonly number[]): Uint8Array => Uint8Array.from(values);

/** Decode the whole of a byte sequence. */
const textOf = (values: readonly number[]): string => {
  const bytes = bytesOf(values);
  return decodeUtf8(bytes, 0, bytes.length);
};

/**
 * One code point as text, for the boundaries whose character is a control code
 * or a non-character and would be an invisible or unreadable literal here.
 */
const charOf = (code: number): string => String.fromCodePoint(code);

const REPLACEMENT = '�';

/**
 * The bounded read this folder uses is `src/contracts/column-read`, and it is
 * asserted in `src/contracts/column-read.test.ts` — both the in-range and the
 * out-of-range path, and the message with the two numbers in it. The three cases
 * that stood here asserted the same two paths against a local copy of the same
 * twelve lines, which E01-M01-FIX-09 deleted.
 */

describe('decodeUtf8, on well-formed input', () => {
  it('decodes nothing as the empty string', () => {
    expect(textOf([])).toBe('');
  });

  it('decodes plain ASCII', () => {
    expect(textOf([0x67, 0x69, 0x74])).toBe('git');
  });

  it('decodes the last byte that stands for its own code point, which is 7F', () => {
    expect(textOf([0x7f])).toBe(charOf(0x7f));
  });

  it('decodes a two-byte sequence', () => {
    expect(textOf([0xc3, 0xa9])).toBe('é');
  });

  it('decodes the lowest two-byte sequence there is, whose lead is C2', () => {
    expect(textOf([0xc2, 0x80])).toBe(charOf(0x80));
    expect(textOf([0xc2, 0xa9])).toBe('©');
  });

  it('decodes the highest two-byte sequence there is, whose lead is DF', () => {
    expect(textOf([0xdf, 0xbf])).toBe(charOf(0x7ff));
  });

  it('decodes a three-byte sequence', () => {
    expect(textOf([0xe2, 0x82, 0xac])).toBe('€');
  });

  it('decodes the lowest three-byte sequence, whose lead is E0', () => {
    expect(textOf([0xe0, 0xa0, 0x80])).toBe('ࠀ');
  });

  it('decodes the code point just below the surrogates, whose lead is ED', () => {
    expect(textOf([0xed, 0x9f, 0xbf])).toBe('퟿');
  });

  it('decodes the code point just above the surrogates, whose lead is EE', () => {
    expect(textOf([0xee, 0x80, 0x80])).toBe(charOf(0xe000));
  });

  it('decodes the highest three-byte sequence there is, whose lead is EF', () => {
    expect(textOf([0xef, 0xbf, 0xbf])).toBe(charOf(0xffff));
  });

  it('decodes a character outside the basic multilingual plane as a pair', () => {
    expect(textOf([0xf0, 0x9f, 0x8e, 0x89])).toBe('🎉');
  });

  it('decodes the first supplementary code point, whose lead is F0', () => {
    expect(textOf([0xf0, 0x90, 0x80, 0x80])).toBe('𐀀');
  });

  it('decodes the last code point there is, whose lead is F4', () => {
    expect(textOf([0xf4, 0x8f, 0xbf, 0xbf])).toBe('􏿿');
  });
});

describe('decodeUtf8, on bytes that are not UTF-8', () => {
  it('replaces a continuation byte that starts nothing', () => {
    expect(textOf([0x80])).toBe(REPLACEMENT);
  });

  it('replaces the two lead bytes that could only be overlong', () => {
    expect(textOf([0xc0, 0xc1])).toBe(`${REPLACEMENT}${REPLACEMENT}`);
  });

  it('replaces a lead byte past the end of the encoding', () => {
    expect(textOf([0xf5, 0xff])).toBe(`${REPLACEMENT}${REPLACEMENT}`);
  });

  it('replaces a sequence cut short by the end of the input', () => {
    expect(textOf([0xe2, 0x82])).toBe(REPLACEMENT);
  });

  it('consumes only the bytes that were part of a sequence it refused', () => {
    expect(textOf([0xe2, 0x82, 0x67])).toBe(`${REPLACEMENT}g`);
  });

  it('refuses an overlong encoding of a character that has a shorter form', () => {
    expect(textOf([0xe0, 0x80, 0x80])).toBe(`${REPLACEMENT}${REPLACEMENT}${REPLACEMENT}`);
  });

  it('refuses a surrogate half, which UTF-8 may not carry', () => {
    expect(textOf([0xed, 0xa0, 0x80])).toBe(`${REPLACEMENT}${REPLACEMENT}${REPLACEMENT}`);
  });

  it('refuses the last surrogate as well as the first', () => {
    expect(textOf([0xed, 0xbf, 0xbf])).toBe(REPLACEMENT.repeat(3));
  });

  it('refuses a code point past the last one', () => {
    expect(textOf([0xf4, 0x90, 0x80, 0x80])).toBe(REPLACEMENT.repeat(4));
  });

  it('refuses a lead byte past the encoding even when three valid bytes follow', () => {
    expect(textOf([0xf5, 0x80, 0x80, 0x80])).toBe(REPLACEMENT.repeat(4));
    expect(textOf([0xff, 0x80, 0x80, 0x80])).toBe(REPLACEMENT.repeat(4));
  });

  it('refuses an overlong four-byte form, which is what the F0 bound is for', () => {
    expect(textOf([0xf0, 0x80, 0x80, 0x80])).toBe(REPLACEMENT.repeat(4));
    expect(textOf([0xf0, 0x8f, 0xbf, 0xbf])).toBe(REPLACEMENT.repeat(4));
  });

  it('refuses an overlong three-byte form just below the shortest one', () => {
    expect(textOf([0xe0, 0x9f, 0xbf])).toBe(REPLACEMENT.repeat(3));
  });

  it('refuses a sequence cut short by the end of the range it was given', () => {
    const bytes = bytesOf([0xe2, 0x82, 0xac]);
    expect(decodeUtf8(bytes, 0, 2)).toBe(REPLACEMENT);
    expect(decodeUtf8(bytes, 0, 1)).toBe(REPLACEMENT);
  });
});

describe('decodeUtf8, over a range', () => {
  it('decodes a field longer than one batch of code units', () => {
    const length = 10_000;
    const bytes = new Uint8Array(length).fill(0x61);
    expect(decodeUtf8(bytes, 0, length)).toBe('a'.repeat(length));
  });

  it('decodes only the range it is given', () => {
    const bytes = bytesOf([0x61, 0x62, 0x63]);
    expect(decodeUtf8(bytes, 1, 2)).toBe('b');
  });
});
