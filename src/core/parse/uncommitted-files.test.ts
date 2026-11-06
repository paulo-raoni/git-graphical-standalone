import { describe, expect, it } from 'vitest';

import type { ChangedFile } from '../../contracts/index';

import {
  createUncommittedStatusParser,
  EMPTY_TREE,
  finishUncommittedStatus,
  pushUncommittedStatus,
  uncommittedDetailsOf,
} from './uncommitted-files';
import type { UncommittedStatusParser } from './uncommitted-files';

/**
 * The status is written as `git status --porcelain=v2 --branch
 * --untracked-files=all -z` writes it (measured with git 2.51.0): headers, then
 * a record per changed path, a rename's old path in a record of its own after
 * it, and an untracked file's record starting `? `.
 */

const NUL = '\u0000';

const HEAD = '0123456789abcdef0123456789abcdef01234567';

/** The UTF-8 bytes of `text`. */
function utf8Of(text: string): number[] {
  const bytes: number[] = [];
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return bytes;
}

/** Read a status of `records`, each ended by a NUL unless `unterminated`, in chunks of `size`. */
function statusOf(
  records: readonly string[],
  size = 4096,
  unterminated = false,
): UncommittedStatusParser {
  const text = records.map((record) => `${record}${NUL}`).join('');
  const bytes = utf8Of(unterminated ? text.slice(0, -1) : text);
  const parser = createUncommittedStatusParser();
  for (let at = 0; at < bytes.length; at += size) {
    pushUncommittedStatus(parser, Uint8Array.from(bytes.slice(at, at + size)));
  }
  finishUncommittedStatus(parser);
  return parser;
}

const ORDINARY = '1 .M N... 100644 100644 100644 1111111 2222222 changed.txt';
const RENAMED = '2 R. N... 100644 100644 100644 1111111 2222222 R100 new.txt';
const UNMERGED = 'u UU N... 100644 100644 100644 100644 1111111 2222222 3333333 both.txt';

describe('the status the uncommitted changes are read from', () => {
  it('takes the diff against HEAD’s commit, and every untracked file in git’s order', () => {
    const parser = statusOf([
      `# branch.oid ${HEAD}`,
      '# branch.head main',
      ORDINARY,
      '? untracked #%.txt',
      UNMERGED,
      '? ünïcode/ 日本.txt',
    ]);
    expect(parser.base).toBe(HEAD);
    expect(parser.untracked).toEqual(['untracked #%.txt', 'ünïcode/ 日本.txt']);
  });

  it('takes the diff against the empty tree when HEAD has no commit yet', () => {
    const parser = statusOf(['# branch.oid (initial)', '# branch.head main', '? new.txt']);
    expect(parser.base).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904');
    expect(EMPTY_TREE).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904');
    expect(parser.untracked).toEqual(['new.txt']);
  });

  it('reads past a rename’s old path, whatever it holds', () => {
    const parser = statusOf([
      `# branch.oid ${HEAD}`,
      RENAMED,
      '? old name that looks untracked',
      '? really untracked',
      RENAMED,
      `# branch.oid ${'f'.repeat(40)}`,
    ]);
    expect(parser.untracked).toEqual(['really untracked']);
    expect(parser.base).toBe(HEAD);
  });

  it('reads past no record but a rename’s old path', () => {
    const parser = statusOf([ORDINARY, '? a', UNMERGED, '? b', '# branch.ab +1 -2', '? c']);
    expect(parser.untracked).toEqual(['a', 'b', 'c']);
    expect(parser.skipNext).toBe(false);
  });
});

describe('the status the uncommitted changes are read from, its paths and its chunks', () => {
  it('keeps every byte of an untracked file’s path, a tab and a carriage return included', () => {
    const names = ['tab\there', 'ends with return\r', 'quote"mark', ' spaced ', '? doubled'];
    expect(statusOf(names.map((name) => `? ${name}`)).untracked).toEqual(names);
  });

  it('reads the same whatever the chunks, and a last record that came without its NUL', () => {
    const records = [`# branch.oid ${HEAD}`, '? one', RENAMED, '? old', '? two'];
    for (const size of [1, 2, 3, 7]) {
      const parser = statusOf(records, size, true);
      expect(parser.untracked, String(size)).toEqual(['one', 'two']);
      expect(parser.base).toBe(HEAD);
    }
  });

  it('refuses a HEAD that is neither a commit’s object name nor unborn', () => {
    for (const value of ['', 'HEAD', '--output=x', HEAD.slice(1), `${HEAD} `]) {
      expect(() => statusOf([`# branch.oid ${value}`]), value).toThrow(
        `git named HEAD's commit "${value}"`,
      );
    }
  });
});

describe('uncommittedDetailsOf', () => {
  it('lists the diff’s changed files in git’s order, then every untracked file, uncounted', () => {
    const changed: ChangedFile[] = [
      { path: 'b.txt', oldPath: null, status: 'modified', additions: 1, deletions: 2 },
      { path: 'a.txt', oldPath: 'z.txt', status: 'renamed', additions: 0, deletions: 0 },
    ];
    const parser = statusOf(['? y', '? x']);
    expect(uncommittedDetailsOf(parser, changed)).toEqual({
      files: [
        ...changed,
        { path: 'y', oldPath: null, status: 'untracked', additions: null, deletions: null },
        { path: 'x', oldPath: null, status: 'untracked', additions: null, deletions: null },
      ],
    });
  });

  it('lists nothing when nothing changed', () => {
    expect(uncommittedDetailsOf(statusOf([`# branch.oid ${HEAD}`]), [])).toEqual({ files: [] });
  });
});
