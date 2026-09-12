import { describe, expect, it } from 'vitest';

import { HASH_BYTE_LENGTH } from '../../contracts/index';

import {
  HEX_NAME_LENGTH,
  objectNameCount,
  writeObjectName,
  writeObjectNames,
} from './object-names';

const bytesOf = (text: string): Uint8Array =>
  Uint8Array.from(text, (character) => character.charCodeAt(0));

/** Twenty bytes of `value`, spelled the way git spells an object name. */
const nameOf = (value: string): string => value.repeat(HEX_NAME_LENGTH / value.length);

describe('writeObjectName', () => {
  it('turns forty hex digits into twenty bytes', () => {
    const target = new Uint8Array(HASH_BYTE_LENGTH);
    const bytes = bytesOf(nameOf('0f'));
    writeObjectName(bytes, 0, bytes.length, target, 0);
    expect([...target]).toEqual(Array.from({ length: HASH_BYTE_LENGTH }, () => 0x0f));
  });

  it('reads upper case and lower case digits alike', () => {
    const lower = new Uint8Array(HASH_BYTE_LENGTH);
    const upper = new Uint8Array(HASH_BYTE_LENGTH);
    const low = bytesOf(nameOf('ab'));
    const high = bytesOf(nameOf('AB'));
    writeObjectName(low, 0, low.length, lower, 0);
    writeObjectName(high, 0, high.length, upper, 0);
    expect([...upper]).toEqual([...lower]);
  });

  it('writes at the offset it is given', () => {
    const target = new Uint8Array(HASH_BYTE_LENGTH * 2);
    const bytes = bytesOf(nameOf('ff'));
    writeObjectName(bytes, 0, bytes.length, target, HASH_BYTE_LENGTH);
    expect(target[0]).toBe(0);
    expect(target[HASH_BYTE_LENGTH]).toBe(0xff);
  });

  it('reads the last digit of each of the three ranges', () => {
    const target = new Uint8Array(HASH_BYTE_LENGTH);
    const bytes = bytesOf(nameOf('aF'));
    writeObjectName(bytes, 0, bytes.length, target, 0);
    expect(target[0]).toBe(0xaf);
    const nine = new Uint8Array(HASH_BYTE_LENGTH);
    const digits = bytesOf(nameOf('90'));
    writeObjectName(digits, 0, digits.length, nine, 0);
    expect(nine[0]).toBe(0x90);
  });

  it('refuses a name that is not forty digits, and says how many it wanted', () => {
    const bytes = bytesOf('abc');
    expect(() => {
      writeObjectName(bytes, 0, bytes.length, new Uint8Array(20), 0);
    }).toThrow(/40 hex digits, not 3/);
  });

  it('refuses a digit that is not hexadecimal, and says which', () => {
    const bytes = bytesOf(`${'0'.repeat(HEX_NAME_LENGTH - 1)}z`);
    expect(() => {
      writeObjectName(bytes, 0, bytes.length, new Uint8Array(20), 0);
    }).toThrow(/"z" where an object name's hex digit belongs/);
  });
});

describe('writeObjectName, on characters either side of the three ranges', () => {
  /** A name of forty digits whose last one is `character`. */
  const endingIn = (character: string): Uint8Array =>
    bytesOf(`${'0'.repeat(HEX_NAME_LENGTH - 1)}${character}`);

  const refuses = (character: string): void => {
    const bytes = endingIn(character);
    expect(() => {
      writeObjectName(bytes, 0, bytes.length, new Uint8Array(20), 0);
    }).toThrow(/hex digit belongs/);
  };

  it('refuses the character below the digits', () => {
    refuses('/');
  });

  it('refuses the characters between the digits and the upper case letters', () => {
    refuses(':');
    refuses('@');
  });

  it('refuses the characters between the upper and the lower case letters', () => {
    refuses('G');
    refuses('`');
  });

  it('refuses the character above the lower case letters', () => {
    refuses('g');
  });
});

describe('objectNameCount', () => {
  it('counts nothing in an empty span', () => {
    expect(objectNameCount(0, 0)).toBe(0);
  });

  it('counts one name', () => {
    expect(objectNameCount(0, HEX_NAME_LENGTH)).toBe(1);
  });

  it('counts names separated by single spaces', () => {
    expect(objectNameCount(0, HEX_NAME_LENGTH * 3 + 2)).toBe(3);
  });

  it('refuses a span that is not a whole number of separated names, and says its size', () => {
    expect(() => objectNameCount(0, HEX_NAME_LENGTH + 1)).toThrow(
      /"41 bytes" is not a list of object names/,
    );
  });
});

describe('writeObjectNames', () => {
  it('writes every name of a parent list', () => {
    const first = nameOf('11');
    const second = nameOf('22');
    const bytes = bytesOf(`${first} ${second}`);
    const target = new Uint8Array(HASH_BYTE_LENGTH * 2);
    expect(writeObjectNames(bytes, 0, bytes.length, target, 0)).toBe(2);
    expect(target[0]).toBe(0x11);
    expect(target[HASH_BYTE_LENGTH]).toBe(0x22);
  });

  it('writes nothing for a root commit', () => {
    expect(writeObjectNames(bytesOf(''), 0, 0, new Uint8Array(0), 0)).toBe(0);
  });
});
