import { describe, expect, it } from 'vitest';

import { rawDateOffsetMinutes, rawDateSeconds } from './raw-date';

const bytesOf = (text: string): Uint8Array =>
  Uint8Array.from(text, (character) => character.charCodeAt(0));

const secondsOf = (text: string): number => {
  const bytes = bytesOf(text);
  return rawDateSeconds(bytes, 0, bytes.length);
};

const offsetOf = (text: string): number => {
  const bytes = bytesOf(text);
  return rawDateOffsetMinutes(bytes, 0, bytes.length);
};

describe('rawDateSeconds', () => {
  it('reads the seconds git wrote', () => {
    expect(secondsOf('1700000000 +0000')).toBe(1_700_000_000);
  });

  it('reads a commit dated before the epoch', () => {
    expect(secondsOf('-86400 +0000')).toBe(-86_400);
  });

  it('reads a timestamp that uses every digit there is', () => {
    expect(secondsOf('1234567890 +0000')).toBe(1_234_567_890);
  });

  it('refuses a date with no space in it', () => {
    expect(() => secondsOf('1700000000')).toThrow(/seconds, a space, and an offset/);
  });

  it('refuses a date whose seconds hold a character above the digits', () => {
    expect(() => secondsOf('17000x0000 +0000')).toThrow(/digit that is not a digit/);
  });

  it('refuses a date whose seconds hold a character below the digits', () => {
    expect(() => secondsOf('17000/0000 +0000')).toThrow(/digit that is not a digit/);
  });

  it('refuses a date with no seconds at all', () => {
    expect(() => secondsOf(' +0000')).toThrow(/a number where git wrote nothing/);
  });
});

describe('rawDateOffsetMinutes', () => {
  it('reads an offset east of UTC', () => {
    expect(offsetOf('1700000000 +0530')).toBe(330);
  });

  it('reads an offset west of UTC', () => {
    expect(offsetOf('1789189447 -0300')).toBe(-180);
  });

  it('reads UTC itself as no offset', () => {
    expect(offsetOf('1700000000 +0000')).toBe(0);
  });

  it('reads an offset whose digits reach nine', () => {
    expect(offsetOf('1700000000 +0945')).toBe(585);
  });

  it('refuses an offset that is not a sign and four digits', () => {
    expect(() => offsetOf('1700000000 +530')).toThrow(/a sign and four digits/);
  });

  it('refuses an offset with no sign', () => {
    expect(() => offsetOf('1700000000 05300')).toThrow(/starts with a sign/);
  });
});
