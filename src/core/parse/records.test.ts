import { describe, expect, it } from 'vitest';

import { decodeUtf8 } from './bytes';
import {
  afterMark,
  createRecordReader,
  fieldFrom,
  fieldTo,
  finishRecords,
  LINE_TERMINATOR,
  NUL_TERMINATOR,
  pushRecords,
  splitFields,
  UNIT_MARK,
} from './records';

/**
 * The splitter is the one part of the parser that can be right on a whole input
 * and wrong on a divided one, so every test that matters here feeds the same
 * bytes at every chunk size there is, down to one byte at a time, and asserts
 * that the records are the same records.
 */

const bytesOf = (text: string): Uint8Array =>
  Uint8Array.from(text, (character) => character.charCodeAt(0));

const RECORD = String.fromCharCode(0x1e);
const UNIT = String.fromCharCode(0x1f);
const NUL = String.fromCharCode(0);

/** Read `text` in chunks of `size`, and report the records as strings. */
function readIn(text: string, size: number, terminator: number): string[] {
  const reader = createRecordReader(terminator);
  const bytes = bytesOf(text);
  const found: string[] = [];
  const take = (chunk: Uint8Array, from: number, to: number): void => {
    found.push(decodeUtf8(chunk, from, to));
  };
  for (let at = 0; at < bytes.length; at += size) {
    pushRecords(reader, bytes.subarray(at, Math.min(at + size, bytes.length)), take);
  }
  finishRecords(reader, take);
  return found;
}

/** Every chunk size from one byte up to more than the whole input. */
function everySize(text: string, terminator: number): string[][] {
  const sizes: string[][] = [];
  for (let size = 1; size <= text.length + 1; size += 1) {
    sizes.push(readIn(text, size, terminator));
  }
  return sizes;
}

describe('pushRecords', () => {
  it('reads records terminated by NUL', () => {
    expect(readIn(`one${NUL}two${NUL}`, 64, NUL_TERMINATOR)).toEqual(['one', 'two']);
  });

  it('reads the same records at every chunk size, down to one byte', () => {
    const text = `alpha${NUL}beta${NUL}gamma${NUL}`;
    for (const found of everySize(text, NUL_TERMINATOR)) {
      expect(found).toEqual(['alpha', 'beta', 'gamma']);
    }
  });

  it('reads a record longer than the carry it started with, at every chunk size', () => {
    const long = 'x'.repeat(700);
    const text = `${long}${NUL}${long}${NUL}`;
    expect(readIn(text, 1, NUL_TERMINATOR)).toEqual([long, long]);
    expect(readIn(text, 300, NUL_TERMINATOR)).toEqual([long, long]);
    expect(readIn(text, 4096, NUL_TERMINATOR)).toEqual([long, long]);
  });

  it('keeps an empty record, which a stream may legitimately carry', () => {
    expect(readIn(`${NUL}a${NUL}`, 64, NUL_TERMINATOR)).toEqual(['', 'a']);
  });

  it('reads nothing from nothing', () => {
    expect(readIn('', 64, NUL_TERMINATOR)).toEqual([]);
  });

  it('drops the carriage return a line-terminated stream may carry', () => {
    expect(readIn('one\r\ntwo\n', 64, LINE_TERMINATOR)).toEqual(['one', 'two']);
  });

  it('drops that carriage return at every chunk size as well', () => {
    for (const found of everySize('one\r\ntwo\r\n', LINE_TERMINATOR)) {
      expect(found).toEqual(['one', 'two']);
    }
  });
});

describe('finishRecords', () => {
  it('hands over a last record that arrived without its terminator', () => {
    expect(readIn(`one${NUL}two`, 64, NUL_TERMINATOR)).toEqual(['one', 'two']);
  });

  it('hands over nothing when the stream ended on a terminator', () => {
    const reader = createRecordReader(NUL_TERMINATOR);
    const found: string[] = [];
    pushRecords(reader, bytesOf(`one${NUL}`), (chunk, from, to) => {
      found.push(decodeUtf8(chunk, from, to));
    });
    finishRecords(reader, () => {
      found.push('and another');
    });
    expect(found).toEqual(['one']);
  });
});

describe('pushRecords, and what it does not copy', () => {
  it('hands over a record that fits in one chunk as a range of that chunk', () => {
    const reader = createRecordReader(NUL_TERMINATOR);
    const chunk = bytesOf(`one${NUL}`);
    const given: Uint8Array[] = [];
    pushRecords(reader, chunk, (bytes) => {
      given.push(bytes);
    });
    expect(given[0]).toBe(chunk);
  });

  it('keeps its carry buffer while the record in progress still fits in it', () => {
    const reader = createRecordReader(NUL_TERMINATOR);
    const before = reader.carry;
    expect(before.length).toBe(256);
    pushRecords(reader, bytesOf('x'.repeat(256)), () => undefined);
    expect(reader.carried).toBe(256);
    expect(reader.carry).toBe(before);
  });

  it('doubles that buffer exactly once for a record one step past it', () => {
    const reader = createRecordReader(NUL_TERMINATOR);
    pushRecords(reader, bytesOf('x'.repeat(512)), () => undefined);
    expect(reader.carry.length).toBe(512);
    expect(reader.carried).toBe(512);
  });

  it('keeps what it already carried when the buffer is replaced', () => {
    const reader = createRecordReader(NUL_TERMINATOR);
    const long = 'abc'.repeat(300);
    pushRecords(reader, bytesOf(long.slice(0, 100)), () => undefined);
    pushRecords(reader, bytesOf(`${long.slice(100)}${NUL}`), (bytes, from, to) => {
      expect(decodeUtf8(bytes, from, to)).toBe(long);
    });
  });
});

describe('afterMark', () => {
  it('steps over the record separator', () => {
    const bytes = bytesOf(`${RECORD}body`);
    expect(afterMark(bytes, 0, bytes.length)).toBe(1);
  });

  it('refuses a record that does not start with one, and says so', () => {
    const bytes = bytesOf('body');
    expect(() => afterMark(bytes, 0, bytes.length)).toThrow(
      /did not start with the record separator/,
    );
  });

  it('refuses an empty record, which carries no separator at all', () => {
    expect(() => afterMark(bytesOf(''), 0, 0)).toThrow(/record separator/);
  });
});

describe('splitFields', () => {
  const bounds = (): Uint32Array => new Uint32Array(8);

  it('cuts a record into its fields', () => {
    const bytes = bytesOf(`a${UNIT}bb${UNIT}ccc`);
    const room = bounds();
    expect(splitFields(bytes, 0, bytes.length, UNIT_MARK, room)).toBe(3);
    expect(decodeUtf8(bytes, fieldFrom(room, 0), fieldTo(room, 0))).toBe('a');
    expect(decodeUtf8(bytes, fieldFrom(room, 1), fieldTo(room, 1))).toBe('bb');
    expect(decodeUtf8(bytes, fieldFrom(room, 2), fieldTo(room, 2))).toBe('ccc');
  });

  it('counts an empty field between two separators', () => {
    const bytes = bytesOf(`a${UNIT}${UNIT}c`);
    const room = bounds();
    expect(splitFields(bytes, 0, bytes.length, UNIT_MARK, room)).toBe(3);
    expect(fieldFrom(room, 1)).toBe(fieldTo(room, 1));
  });

  it('reads an empty record as one empty field', () => {
    expect(splitFields(bytesOf(''), 0, 0, UNIT_MARK, bounds())).toBe(1);
  });

  it('lets the last field asked for absorb every separator it contains', () => {
    const bytes = bytesOf(`a${UNIT}b${UNIT}c${UNIT}d${UNIT}e`);
    const room = bounds();
    expect(splitFields(bytes, 0, bytes.length, UNIT_MARK, room)).toBe(4);
    expect(decodeUtf8(bytes, fieldFrom(room, 3), fieldTo(room, 3))).toBe(`d${UNIT}e`);
  });

  it('reads a record as one field when only one was asked for', () => {
    const bytes = bytesOf(`a${UNIT}b`);
    const room = new Uint32Array(2);
    expect(splitFields(bytes, 0, bytes.length, UNIT_MARK, room)).toBe(1);
    expect(decodeUtf8(bytes, fieldFrom(room, 0), fieldTo(room, 0))).toBe(`a${UNIT}b`);
  });

  it('reports fewer fields than were asked for, rather than inventing them', () => {
    const bytes = bytesOf(`a${UNIT}b`);
    expect(splitFields(bytes, 0, bytes.length, UNIT_MARK, bounds())).toBe(2);
  });
});
