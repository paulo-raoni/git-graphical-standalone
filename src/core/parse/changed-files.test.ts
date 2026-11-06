import { describe, expect, it } from 'vitest';

import type { ChangedFile } from '../../contracts/index';

import {
  changedFilesOf,
  createChangedFilesParser,
  createChangedFilesReader,
  finishChangedFiles,
  pushChangedFiles,
  readChangedFile,
} from './changed-files';

/**
 * The records are written as git writes them under `--raw --numstat -z`
 * (measured with git 2.51.0: every raw entry first, then every line count, each
 * path a record of its own, a rename's two paths old first). Every path a test
 * here reads holds a byte the reader must not cut or drop.
 */

const NUL = '\u0000';

/** The UTF-8 bytes of `text`. */
function utf8Of(text: string): number[] {
  const bytes: number[] = [];
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}

/** Records, each ended by a NUL, as one stream. */
const streamOf = (records: readonly string[]): string =>
  records.map((record) => `${record}${NUL}`).join('');

/** Read a whole stream, cut into chunks of `size` bytes. */
function filesOf(stream: readonly number[] | string, size = 4096): ChangedFile[] {
  const bytes = typeof stream === 'string' ? utf8Of(stream) : stream;
  const parser = createChangedFilesParser();
  for (let at = 0; at < bytes.length; at += size) {
    pushChangedFiles(parser, Uint8Array.from(bytes.slice(at, at + size)));
  }
  return finishChangedFiles(parser);
}

const raw = (status: string): string => `:100644 100644 1234567 89abcde ${status}`;

const file = (
  path: string,
  status: ChangedFile['status'],
  additions: number | null,
  deletions: number | null,
  oldPath: string | null = null,
): ChangedFile => ({ path, oldPath, status, additions, deletions });

describe('the changed files of a diff', () => {
  it('reads every status git writes, with the counts of each path', () => {
    const stream = streamOf([
      raw('A'),
      'added.txt',
      raw('M'),
      'modified.txt',
      raw('D'),
      'deleted.txt',
      raw('T'),
      'typed',
      '3\t0\tadded.txt',
      '12\t7\tmodified.txt',
      '0\t40\tdeleted.txt',
      '1\t1\ttyped',
    ]);
    expect(filesOf(stream)).toEqual([
      file('added.txt', 'added', 3, 0),
      file('modified.txt', 'modified', 12, 7),
      file('deleted.txt', 'deleted', 0, 40),
      file('typed', 'type-changed', 1, 1),
    ]);
  });

  it('reads a rename and a copy under their new paths, the old one kept, counted by the new one', () => {
    const stream = streamOf([
      raw('R086'),
      'old name.txt',
      'new name.txt',
      raw('C075'),
      'source.txt',
      'copy.txt',
      '1\t2\t',
      'old name.txt',
      'new name.txt',
      '5\t0\t',
      'source.txt',
      'copy.txt',
    ]);
    expect(filesOf(stream)).toEqual([
      file('new name.txt', 'renamed', 1, 2, 'old name.txt'),
      file('copy.txt', 'copied', 5, 0, 'source.txt'),
    ]);
  });
});

describe('the changed files of a diff, binary, uncounted and after a line feed', () => {
  it('reads a binary file as having no counts', () => {
    expect(filesOf(streamOf([raw('M'), 'image.png', '-\t-\timage.png']))).toEqual([
      file('image.png', 'modified', null, null),
    ]);
  });

  it('gives a path git wrote no count for no counts', () => {
    expect(filesOf(streamOf([raw('A'), 'one', raw('D'), 'two', '4\t0\tone']))).toEqual([
      file('one', 'added', 4, 0),
      file('two', 'deleted', null, null),
    ]);
  });

  it('drops the line feed git writes before a commit’s first entry, and from no path', () => {
    const stream = streamOf([`\n${raw('A')}`, '\nnew', '\n2\t0\t\nnew']);
    expect(filesOf(stream)).toEqual([file('\nnew', 'added', 2, 0)]);
    expect(filesOf(streamOf(['\n1\t0\tx', raw('M'), 'x']))).toEqual([file('x', 'modified', 1, 0)]);
  });
});

describe('the changed files of a diff, by every name a path can have', () => {
  it('keeps every byte of a path that is not a NUL, as a path git writes under -z', () => {
    const names = [
      'tab\there.txt',
      'quote"mark.txt',
      'line\nfeed.txt',
      'ends with return\r',
      'bell\u0007.txt',
      ':colon first',
      '? question first',
      '1\t2\tlooks counted',
      'hash#percent%question?.txt',
      'naïve café 日本 😀.txt',
      'deep/er/still/leaf.txt',
      ' leading and trailing ',
    ];
    const stream = streamOf([
      ...names.flatMap((name) => [raw('M'), name]),
      ...names.map((name) => `1\t2\t${name}`),
    ]);
    const expected = names.map((name) => file(name, 'modified', 1, 2));
    expect(filesOf(stream)).toEqual(expected);
    for (const size of [1, 2, 3, 7]) {
      expect(filesOf(stream, size), String(size)).toEqual(expected);
    }
  });

  it('carries a path that is not UTF-8 with each ill-formed sequence replaced', () => {
    const bytes = [
      ...utf8Of(`${raw('A')}${NUL}bad`),
      0xff,
      0xc3,
      ...utf8Of(`.txt${NUL}1\t0\tbad`),
      0xff,
      0xc3,
      ...utf8Of(`.txt${NUL}`),
    ];
    expect(filesOf(bytes)).toEqual([file('bad��.txt', 'added', 1, 0)]);
  });
});

describe('the changed files of a diff, its counts and its last record', () => {
  it('reads a count of many digits as the number it spells', () => {
    expect(filesOf(streamOf([raw('M'), 'big', '1234567\t890\tbig']))).toEqual([
      file('big', 'modified', 1234567, 890),
    ]);
  });

  it('reads a last record that came without its NUL', () => {
    const stream = streamOf([raw('M'), 'f']) + '9\t8\tf';
    expect(filesOf(stream)).toEqual([file('f', 'modified', 9, 8)]);
  });

  it('reads nothing as no changed file', () => {
    expect(filesOf('')).toEqual([]);
  });
});

describe('the changed files of a diff, against output it cannot read', () => {
  it('refuses a status it has no name for', () => {
    for (const status of ['U', 'X', 'B', 'a', '']) {
      expect(() => filesOf(streamOf([raw(status), 'f'])), status).toThrow(
        `git wrote a changed file whose status is "${status.charAt(0)}"`,
      );
    }
  });

  it('refuses a count that is not a number of lines', () => {
    for (const count of ['x4', '4x', '', ' 4', '4.5', '+4', '--']) {
      expect(() => filesOf(streamOf([`${count}\t0\tf`])), count).toThrow(
        `git wrote "${count}" where a count of lines belongs`,
      );
      expect(() => filesOf(streamOf([`0\t${count}\tf`])), count).toThrow(
        `git wrote "${count}" where a count of lines belongs`,
      );
    }
  });

  it('refuses a count without its two tabs, and an empty record where an entry belongs', () => {
    expect(() => filesOf(streamOf(['4']))).toThrow('where a count of lines belongs');
    expect(() => filesOf(streamOf(['4\t0']))).toThrow(
      'git wrote "" where a count of lines belongs',
    );
    expect(() => filesOf(streamOf(['']))).toThrow('git wrote "" where a count of lines belongs');
  });

  it('refuses output that ends before the paths an entry is owed', () => {
    const ended = 'git output ended before the paths of a changed file';
    expect(() => filesOf(streamOf([raw('M')]))).toThrow(ended);
    expect(() => filesOf(streamOf([raw('R100'), 'old']))).toThrow(ended);
    expect(() => filesOf(streamOf(['1\t1\t', 'old']))).toThrow(ended);
  });
});

describe('readChangedFile and changedFilesOf, one decoded record at a time', () => {
  it('owes nothing between entries, and two paths, old first, to a rename', () => {
    const reader = createChangedFilesReader();
    expect(changedFilesOf(reader)).toEqual([]);
    readChangedFile(reader, raw('R100'));
    readChangedFile(reader, 'a');
    expect(reader.pending?.oldPath).toBe('a');
    readChangedFile(reader, 'b');
    expect(reader.pending).toBeNull();
    readChangedFile(reader, raw('M'));
    readChangedFile(reader, 'c');
    expect(changedFilesOf(reader)).toEqual([
      file('b', 'renamed', null, null, 'a'),
      file('c', 'modified', null, null),
    ]);
  });
});
