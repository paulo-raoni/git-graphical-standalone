import { describe, expect, it } from 'vitest';

import type { ChangedFile, FileStatus } from '../../contracts/index';

import { currentPathOf } from './current-path';

const change = (status: FileStatus, path: string, oldPath: string | null = null): ChangedFile => ({
  path,
  oldPath,
  status,
  additions: 0,
  deletions: 0,
});

describe('currentPathOf', () => {
  it('follows a rename of the file to its new path', () => {
    const changes = [change('renamed', 'docs/new.md', 'docs/old.md')];
    expect(currentPathOf(changes, 'docs/old.md')).toBe('docs/new.md');
  });

  it('means a deleted file is gone', () => {
    expect(currentPathOf([change('deleted', 'a.txt')], 'a.txt')).toBeNull();
  });

  it('leaves a path no entry names as it is', () => {
    const changes = [
      change('modified', 'b.txt'),
      change('renamed', 'y', 'x'),
      change('deleted', 'z'),
    ];
    expect(currentPathOf(changes, 'a.txt')).toBe('a.txt');
    expect(currentPathOf([], 'a.txt')).toBe('a.txt');
  });

  it('leaves a modified, added or type-changed entry of the path alone', () => {
    for (const status of ['modified', 'added', 'type-changed', 'copied'] as const) {
      expect(currentPathOf([change(status, 'a.txt', 'a.txt')], 'a.txt'), status).toBe('a.txt');
    }
  });

  it('reads a renamed entry by its old path and not by its new one', () => {
    const changes = [change('renamed', 'b.txt', 'a.txt')];
    expect(currentPathOf(changes, 'b.txt')).toBe('b.txt');
  });

  it('reads a deleted entry by its path and a renamed entry by its old path only', () => {
    expect(currentPathOf([change('deleted', 'a.txt', 'a.txt')], 'a.txt')).toBeNull();
    expect(currentPathOf([change('renamed', 'c.txt', 'a.txt')], 'a.txt')).toBe('c.txt');
    expect(currentPathOf([change('deleted', 'c.txt')], 'a.txt')).toBe('a.txt');
  });

  it('takes the first entry that names the path', () => {
    const changes = [change('renamed', 'b.txt', 'a.txt'), change('deleted', 'a.txt')];
    expect(currentPathOf(changes, 'a.txt')).toBe('b.txt');
  });
});
