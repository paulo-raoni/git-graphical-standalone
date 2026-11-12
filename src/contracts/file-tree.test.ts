import { describe, expect, it } from 'vitest';

import type { ChangedFile, FileStatus } from './commit-details';
import { fileRowsOf } from './file-tree';
import type { FileTreeRow, FileViewOptions } from './file-tree';

const file = (
  path: string,
  status: FileStatus = 'modified',
  counts: [number | null, number | null] = [1, 0],
  oldPath: string | null = null,
): ChangedFile => ({ path, oldPath, status, additions: counts[0], deletions: counts[1] });

const TREE: FileViewOptions = {
  view: 'tree',
  compact: true,
  letters: false,
  collapsed: new Set(),
};
const LIST: FileViewOptions = { ...TREE, view: 'list' };

/** A row as one comparable string: the shape is what these cases hold, the detail is below. */
const shape = (rows: readonly FileTreeRow[]): string[] =>
  rows.map(
    (row) => `${'  '.repeat(row.depth)}${row.kind === 'folder' ? `[${row.label}]` : row.label}`,
  );

/** The commit of the 2026-10-25 observation, in the order git lists it. */
const OBSERVED = [
  file('docs/new-name.md', 'renamed', [0, 0], 'docs/old-name.md'),
  file('docs/to-delete.md', 'deleted', [null, null]),
  file('docs/café-ç.txt', 'added', [null, null]),
  file("docs/it's.txt", 'added', [null, null]),
  file('src/deep/only/child/leaf.txt', 'modified', [1, 0]),
];

const rowOf = (changed: ChangedFile, options: FileViewOptions = TREE): FileTreeRow => {
  const row = fileRowsOf([changed], options).find((one) => one.kind === 'file');
  if (row === undefined) {
    throw new Error('no file row');
  }
  return row;
};

describe('the tree', () => {
  it('lists folders before files, each by name, with a chain of single folders as one row', () => {
    expect(shape(fileRowsOf(OBSERVED, TREE))).toEqual([
      '[docs]',
      '  café-ç.txt',
      "  it's.txt",
      '  new-name.md',
      '  to-delete.md',
      '[src / deep / only / child]',
      '  leaf.txt',
    ]);
  });

  it('puts the files of the root after its folders', () => {
    const rows = fileRowsOf([file('README.md'), file('docs/a.md'), file('b/c.md')], TREE);
    expect(shape(rows)).toEqual(['[b]', '  c.md', '[docs]', '  a.md', 'README.md']);
  });

  it('does not compact a folder holding a folder and a file', () => {
    const rows = fileRowsOf([file('a/b/c.txt'), file('a/d.txt')], TREE);
    expect(shape(rows)).toEqual(['[a]', '  [b]', '    c.txt', '  d.txt']);
  });

  it('compacts the chain below a folder that is not compacted', () => {
    const rows = fileRowsOf([file('a/b/c/d.txt'), file('a/e.txt')], TREE);
    expect(shape(rows)).toEqual(['[a]', '  [b / c]', '    d.txt', '  e.txt']);
  });

  it('keeps every folder its own row when compaction is off', () => {
    const rows = fileRowsOf(OBSERVED.slice(4), { ...TREE, compact: false });
    expect(shape(rows)).toEqual([
      '[src]',
      '  [deep]',
      '    [only]',
      '      [child]',
      '        leaf.txt',
    ]);
  });
});

describe('collapsing a folder', () => {
  it('hides the descendants of a collapsed folder', () => {
    const rows = fileRowsOf(OBSERVED, { ...TREE, collapsed: new Set(['docs']) });
    expect(shape(rows)).toEqual(['[docs]', '[src / deep / only / child]', '  leaf.txt']);
    expect(rows[0]).toMatchObject({ kind: 'folder', key: 'docs', collapsed: true });
    expect(rows[1]).toMatchObject({ kind: 'folder', collapsed: false });
  });

  it('collapses a compacted row as one, by the path of its deepest folder', () => {
    const rows = fileRowsOf(OBSERVED, { ...TREE, collapsed: new Set(['src/deep/only/child']) });
    expect(rows.at(-1)).toEqual({
      kind: 'folder',
      key: 'src/deep/only/child',
      label: 'src / deep / only / child',
      depth: 0,
      collapsed: true,
    });
    expect(rows).toHaveLength(6);
  });

  it('does not collapse a compacted row by the name of a folder inside its chain', () => {
    const rows = fileRowsOf(OBSERVED, { ...TREE, collapsed: new Set(['src']) });
    expect(rows).toHaveLength(7);
  });

  it('shows neither a folder inside a collapsed one nor its files', () => {
    const files = [file('a/b/c.txt'), file('a/d.txt')];
    const rows = fileRowsOf(files, { ...TREE, collapsed: new Set(['a']) });
    expect(shape(rows)).toEqual(['[a]']);
  });
});

describe('the order of names', () => {
  it('orders names by their lower-case form and then as they are, in UTF-16 code units', () => {
    const names = ['b', 'B', 'a', 'A', '_', 'é', 'z', 'Z'];
    const rows = fileRowsOf(
      names.map((name) => file(name)),
      TREE,
    );
    expect(shape(rows)).toEqual(['_', 'A', 'a', 'B', 'b', 'Z', 'z', 'é']);
  });

  it('orders folders the same way and keeps names that differ only in case apart', () => {
    const rows = fileRowsOf([file('b/x'), file('B/y'), file('a/z')], TREE);
    expect(shape(rows)).toEqual(['[a]', '  z', '[B]', '  y', '[b]', '  x']);
  });

  it('keeps a file and a folder of the same name apart', () => {
    const rows = fileRowsOf(
      [file('a', 'deleted', [null, null]), file('a/b', 'added', [null, null])],
      TREE,
    );
    expect(shape(rows)).toEqual(['[a]', '  b', 'a']);
  });

  it('keeps the file index of the reply on every file row', () => {
    const rows = fileRowsOf(OBSERVED, TREE);
    const indexes = rows.flatMap((row) => (row.kind === 'file' ? [[row.label, row.index]] : []));
    expect(indexes).toEqual([
      ['café-ç.txt', 2],
      ["it's.txt", 3],
      ['new-name.md', 0],
      ['to-delete.md', 1],
      ['leaf.txt', 4],
    ]);
  });

  it('is empty for no files', () => {
    expect(fileRowsOf([], TREE)).toEqual([]);
    expect(fileRowsOf([], LIST)).toEqual([]);
  });

  it('puts two files of one path in the reply order', () => {
    const rows = fileRowsOf([file('a', 'deleted'), file('a', 'added')], TREE);
    expect(rows.map((row) => (row.kind === 'file' ? row.status : ''))).toEqual([
      'deleted',
      'added',
    ]);
  });
});

describe('the list', () => {
  it('is the tree flattened, every folder expanded, each row its full path', () => {
    expect(shape(fileRowsOf(OBSERVED, LIST))).toEqual([
      'docs/café-ç.txt',
      "docs/it's.txt",
      'docs/new-name.md',
      'docs/to-delete.md',
      'src/deep/only/child/leaf.txt',
    ]);
  });

  it('reads the root commit as folders first and the root file last', () => {
    const root = [
      file('README.md', 'added', [null, null]),
      file('docs/old-name.md', 'added', [null, null]),
      file('docs/to-delete.md', 'added', [null, null]),
      file('src/deep/only/child/leaf.txt', 'added', [null, null]),
    ];
    expect(shape(fileRowsOf(root, LIST))).toEqual([
      'docs/old-name.md',
      'docs/to-delete.md',
      'src/deep/only/child/leaf.txt',
      'README.md',
    ]);
  });

  it('ignores collapse and compaction', () => {
    const rows = fileRowsOf(OBSERVED, { ...LIST, compact: false, collapsed: new Set(['docs']) });
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.kind === 'file' && row.depth === 0)).toBe(true);
  });

  it('puts a deeper folder before a file of its parent, as the tree does', () => {
    const rows = fileRowsOf([file('a/z.txt'), file('a/b/y.txt'), file('c.txt')], LIST);
    expect(shape(rows)).toEqual(['a/b/y.txt', 'a/z.txt', 'c.txt']);
  });
});

describe('a file row', () => {
  it('carries one literal per status: tone, counts, letter and tooltip', () => {
    const on = { ...TREE, letters: true };
    const plus = (a: string, b: string): object => ({ plus: a, minus: b });
    const cases: [ChangedFile, string, object | null, string, string][] = [
      [file('f.txt', 'added', [3, 0]), 'added', null, 'A', 'f.txt\nAdded'],
      [file('f.txt', 'modified', [3, 1]), 'plain', plus('+3', '-1'), 'M', 'f.txt\nModified'],
      [file('f.txt', 'deleted', [0, 4]), 'deleted', null, 'D', 'f.txt\nDeleted'],
      [
        file('n/f.txt', 'renamed', [0, 0], 'o/f.txt'),
        'plain',
        plus('+0', '-0'),
        'R',
        'n/f.txt\nRenamed (o/f.txt → n/f.txt)',
      ],
      [
        file('n.txt', 'copied', [2, 0], 'o.txt'),
        'added',
        plus('+2', '-0'),
        'A',
        'n.txt\nCopied (o.txt → n.txt)',
      ],
      [
        file('f.txt', 'type-changed', [1, 1]),
        'plain',
        plus('+1', '-1'),
        'M',
        'f.txt\nType Changed',
      ],
      [file('f.txt', 'untracked', [5, 0]), 'added', null, 'U', 'f.txt\nUntracked'],
    ];
    for (const [changed, tone, counts, letter, tooltip] of cases) {
      const expected = { tone, counts, letter, tooltip };
      expect(rowOf(changed, on), changed.status).toMatchObject(expected);
    }
  });
});

describe('the letter, counts and actions of a file row', () => {
  it('shows a letter only when the letters are on', () => {
    expect(rowOf(file('f.txt'), TREE)).toMatchObject({ letter: null });
    expect(rowOf(file('f.txt'), { ...TREE, letters: true })).toMatchObject({ letter: 'M' });
    expect(rowOf(file('f.txt'), { ...LIST, letters: true })).toMatchObject({ letter: 'M' });
  });

  it('shows no counts for a binary file, whose counts are null', () => {
    expect(rowOf(file('b.bin', 'modified', [null, null]))).toMatchObject({ counts: null });
    expect(rowOf(file('b.bin', 'modified', [1, null]))).toMatchObject({ counts: null });
    expect(rowOf(file('b.bin', 'modified', [null, 1]))).toMatchObject({ counts: null });
  });

  it('keeps a path holding U+FFFD as it arrived, in the label and the tooltip', () => {
    expect(rowOf(file('d/�.txt', 'added', [null, null]))).toMatchObject({
      label: '�.txt',
      path: 'd/�.txt',
      tooltip: 'd/�.txt\nAdded',
    });
  });

  it('carries the path a renamed file came from, and the path in a list row', () => {
    expect(rowOf(file('n/f.txt', 'renamed', [0, 0], 'o/f.txt'), LIST)).toMatchObject({
      label: 'n/f.txt',
      path: 'n/f.txt',
      oldPath: 'o/f.txt',
      depth: 0,
    });
  });

  it('offers copying to every file and opening to every file but a deleted one', () => {
    expect(rowOf(file('f.txt', 'deleted'))).toMatchObject({
      actions: ['copy-absolute-path', 'copy-relative-path'],
    });
    const others = ['added', 'modified', 'renamed', 'copied', 'type-changed', 'untracked'] as const;
    for (const status of others) {
      expect(rowOf(file('f.txt', status)), status).toMatchObject({
        actions: ['open-file', 'copy-absolute-path', 'copy-relative-path'],
      });
    }
  });
});
