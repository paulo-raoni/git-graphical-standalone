import { describe, expect, it } from 'vitest';

import { createNulRecordReader, finishNulRecords, pushNulRecords } from './nul-records';

/** The records `chunks` cut into, each as its list of byte values, finished or not. */
function recordsOf(chunks: readonly (readonly number[])[], finish = true): number[][] {
  const reader = createNulRecordReader();
  const records: number[][] = [];
  const keep = (record: Uint8Array): void => {
    records.push([...record]);
  };
  for (const chunk of chunks) {
    pushNulRecords(reader, Uint8Array.from(chunk), keep);
  }
  if (finish) {
    finishNulRecords(reader, keep);
  }
  return records;
}

const CR = 0x0d;
const LF = 0x0a;

describe('pushNulRecords', () => {
  it('cuts a chunk at every NUL, and an empty record between two NULs is a record', () => {
    expect(recordsOf([[1, 2, 0, 0, 3, 0]])).toEqual([[1, 2], [], [3]]);
  });

  it('keeps every byte of a record, a carriage return or a line feed at either end included', () => {
    expect(recordsOf([[CR, 1, CR, 0, LF, 2, LF, 0]])).toEqual([
      [CR, 1, CR],
      [LF, 2, LF],
    ]);
  });

  it('joins a record cut across chunks, in order, whatever the cuts', () => {
    const whole = [1, 2, 3, 0, 4, 5, 6, 7, 0, 8, 0];
    const expected = [[1, 2, 3], [4, 5, 6, 7], [8]];
    for (let cut = 0; cut <= whole.length; cut += 1) {
      for (let second = cut; second <= whole.length; second += 1) {
        const chunks = [whole.slice(0, cut), whole.slice(cut, second), whole.slice(second)];
        expect(recordsOf(chunks), `${String(cut)}, ${String(second)}`).toEqual(expected);
      }
    }
  });

  it('joins a record spread over many chunks, one byte each', () => {
    expect(recordsOf([[1], [2], [3], [4], [0], [5], [0]])).toEqual([[1, 2, 3, 4], [5]]);
  });

  it('hands a record over as soon as its NUL arrives, and not before', () => {
    const reader = createNulRecordReader();
    const records: number[][] = [];
    const keep = (record: Uint8Array): void => {
      records.push([...record]);
    };
    pushNulRecords(reader, Uint8Array.from([1, 2]), keep);
    expect(records).toEqual([]);
    pushNulRecords(reader, Uint8Array.from([3, 0, 4]), keep);
    expect(records).toEqual([[1, 2, 3]]);
  });

  it('hands over records that are copies, so a chunk reused afterwards changes none of them', () => {
    const reader = createNulRecordReader();
    const records: Uint8Array[] = [];
    const chunk = Uint8Array.from([1, 2, 0, 3]);
    pushNulRecords(reader, chunk, (record) => records.push(record));
    chunk.fill(9);
    pushNulRecords(reader, Uint8Array.from([0]), (record) => records.push(record));
    expect(records.map((record) => [...record])).toEqual([[1, 2], [3]]);
  });
});

describe('finishNulRecords', () => {
  it('hands over a last record that came without its NUL', () => {
    expect(recordsOf([[1, 0, 2, 3]])).toEqual([[1], [2, 3]]);
    expect(recordsOf([[1, 0, 2], [3]])).toEqual([[1], [2, 3]]);
  });

  it('hands over nothing when the last record was terminated', () => {
    expect(recordsOf([[1, 0]])).toEqual([[1]]);
    expect(recordsOf([])).toEqual([]);
  });

  it('empties the reader, so a second finish hands over nothing', () => {
    const reader = createNulRecordReader();
    const records: number[][] = [];
    const keep = (record: Uint8Array): void => {
      records.push([...record]);
    };
    pushNulRecords(reader, Uint8Array.from([7]), keep);
    finishNulRecords(reader, keep);
    finishNulRecords(reader, keep);
    expect(records).toEqual([[7]]);
  });

  it('hands over nothing unfinished when the stream is not finished', () => {
    expect(recordsOf([[1, 0, 2]], false)).toEqual([[1]]);
  });
});
