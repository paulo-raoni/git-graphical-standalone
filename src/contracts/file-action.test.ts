import { describe, expect, it } from 'vitest';

import { absolutePathIn, fileActionRequestOf, isRelativeFilePath, liesInside } from './file-action';

const HASH = 'ab'.repeat(20);
const commit = { kind: 'commit', hash: HASH } as const;

describe('isRelativeFilePath', () => {
  it('accepts a /-separated relative path, of one segment or several', () => {
    for (const path of [
      'a',
      'a/b',
      'docs/café-ç.txt',
      '.hidden',
      'a/..b',
      'a/b.',
      'x/\uFFFD.txt',
    ]) {
      expect(isRelativeFilePath(path), path).toBe(true);
    }
  });

  it('refuses an empty path, a leading slash and an empty segment', () => {
    for (const path of ['', '/a', 'a//b', 'a/', '/']) {
      expect(isRelativeFilePath(path), path).toBe(false);
    }
  });

  it('refuses a . or .. segment wherever it stands', () => {
    for (const path of ['.', '..', './a', 'a/.', 'a/./b', '../a', 'a/..', 'a/../b', 'a/b/../..']) {
      expect(isRelativeFilePath(path), path).toBe(false);
    }
  });

  it('refuses a backslash and a NUL', () => {
    for (const path of ['a\\b', '\\a', 'a\0b', 'a/b\0', '..\\a']) {
      expect(isRelativeFilePath(path), JSON.stringify(path)).toBe(false);
    }
  });

  it('refuses what is not a string', () => {
    for (const path of [undefined, null, 1, {}, ['a']]) {
      expect(isRelativeFilePath(path)).toBe(false);
    }
  });
});

describe('fileActionRequestOf', () => {
  it('is each of the three actions on a commit and on the uncommitted changes', () => {
    for (const action of ['open-file', 'copy-absolute-path', 'copy-relative-path'] as const) {
      expect(fileActionRequestOf({ action, target: commit, path: 'a/b.txt' })).toEqual({
        action,
        target: commit,
        path: 'a/b.txt',
      });
      expect(fileActionRequestOf({ action, target: { kind: 'uncommitted' }, path: 'a' })).toEqual({
        action,
        target: { kind: 'uncommitted' },
        path: 'a',
      });
    }
  });

  it('holds the three fields alone', () => {
    const made = fileActionRequestOf({
      action: 'open-file',
      target: { ...commit, extra: 1 },
      path: 'a',
      more: 2,
    });
    expect(made).toEqual({ action: 'open-file', target: commit, path: 'a' });
    expect(Object.keys(made ?? {})).toEqual(['action', 'target', 'path']);
  });

  it('refuses an action that is none of the three', () => {
    for (const action of ['', 'open', 'delete', 'toString', '__proto__', 1, null, undefined]) {
      expect(fileActionRequestOf({ action, target: commit, path: 'a' }), String(action)).toBeNull();
    }
  });
});

describe('fileActionRequestOf, what it refuses', () => {
  it('refuses a target detailsTargetOf refuses', () => {
    const targets = [
      { kind: 'commit', hash: '--output=x' },
      { kind: 'x' },
      null,
      'HEAD',
      undefined,
    ];
    for (const target of targets) {
      expect(fileActionRequestOf({ action: 'open-file', target, path: 'a' })).toBeNull();
    }
  });

  it('refuses a path that is not a relative path', () => {
    for (const path of ['../x', 'a/../../x', '/etc/passwd', 'a\\..\\b', 'a\0', '', undefined]) {
      const request = { action: 'copy-absolute-path', target: commit, path };
      expect(fileActionRequestOf(request), JSON.stringify(path)).toBeNull();
    }
  });

  it('refuses what is not an object', () => {
    for (const value of [null, undefined, 'open-file', 3]) {
      expect(fileActionRequestOf(value)).toBeNull();
    }
  });
});

describe('liesInside', () => {
  it('holds a path below the top', () => {
    expect(liesInside('C:/repo', 'C:/repo/a')).toBe(true);
    expect(liesInside('/r', '/r/a/b')).toBe(true);
    expect(liesInside('', '/a')).toBe(true);
  });

  it('refuses the top itself and a sibling that shares its prefix', () => {
    expect(liesInside('/r', '/r')).toBe(false);
    expect(liesInside('/r', '/rx/a')).toBe(false);
  });

  it('refuses a path that leaves the top by .. and takes one that returns by ..', () => {
    expect(liesInside('/r', '/r/../x')).toBe(false);
    expect(liesInside('/r/s', '/r/s/../t')).toBe(false);
    expect(liesInside('/r', '/r/a/../b')).toBe(true);
    expect(liesInside('/r', '/r/./a')).toBe(true);
    expect(liesInside('/r', '/../a')).toBe(false);
    expect(liesInside('r', '../a')).toBe(false);
    expect(liesInside('/r/./s', '/r/s/a')).toBe(false);
  });

  it('refuses a top that cannot be resolved', () => {
    expect(liesInside('..', '../a')).toBe(false);
    expect(liesInside('/r/..', '/r/../a')).toBe(false);
  });
});

describe('absolutePathIn', () => {
  it('joins with the separator asked for', () => {
    expect(absolutePathIn('C:/repo', 'a/b.txt', '\\')).toBe('C:\\repo\\a\\b.txt');
    expect(absolutePathIn('/home/r', 'a/b.txt', '/')).toBe('/home/r/a/b.txt');
  });

  it('takes a top written with backslashes or a trailing separator', () => {
    expect(absolutePathIn('C:\\repo\\', 'a', '\\')).toBe('C:\\repo\\a');
    expect(absolutePathIn('/home/r/', 'a', '/')).toBe('/home/r/a');
    expect(absolutePathIn('/home/r//', 'a', '/')).toBe('/home/r/a');
  });

  it('joins at the root of a file system', () => {
    expect(absolutePathIn('/', 'a', '/')).toBe('/a');
  });

  it('is null for an empty top and for a path that is not a relative one', () => {
    expect(absolutePathIn('', 'a', '/')).toBeNull();
    expect(absolutePathIn('/r', '../a', '/')).toBeNull();
    expect(absolutePathIn('/r', '/a', '/')).toBeNull();
    expect(absolutePathIn('/r', 'a\\b', '/')).toBeNull();
  });

  it('is null when the joined path does not lie inside the top', () => {
    expect(absolutePathIn('/r/..', 'a', '/')).toBeNull();
    expect(absolutePathIn('/r/s/../..', 'a', '/')).toBeNull();
  });
});
