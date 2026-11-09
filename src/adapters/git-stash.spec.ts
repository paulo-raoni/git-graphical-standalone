import { beforeAll, describe, expect, it } from 'vitest';

import { entryAt } from '../contracts/column-read';
import {
  HASH_BYTE_LENGTH,
  RefKind,
  RowFlag,
  UNCOMMITTED_COLOUR,
  UNKNOWN_INDEX,
} from '../contracts/index';
import type { BranchSelection, GraphPage, LayoutRows } from '../contracts/index';
import { createLayoutState } from '../core/layout/index';
import { addPage, continuesReading, createRowBlock, layoutReading } from '../core/page/index';
import type { RepositoryPage } from '../ports/index';

import { fixtureAt, gitLines, hexAt, refNameAt } from './fixtures.spec-support';
import { createGitRepositoryReader } from './git-repository-reader';

/**
 * The stash rows of a page (E04-M01-S14), read from a real repository and laid
 * out as the utility process lays out a page: the reader's reading, then
 * `layoutReading` and `addPage` of `src/core/page/`.
 *
 * The `stashes` fixture (`test/fixtures/generate.ts`) is the shape the reference
 * extension was observed with: `stash@{0}` made on `main`'s tip, *move main on*,
 * with an untracked file; `stash@{1}` made on *on gone*, a commit of a branch
 * deleted since, so no branch reaches it; and an uncommitted change. Each case
 * asserts flags, lanes and the ends of lines, not pixels, against the reference
 * behaviour's items, which the slice document carries.
 */

const reader = createGitRepositoryReader();

let where = '';

/** The fixture's commits by what they are, as git names them. */
const named = new Map<string, string>();

beforeAll(() => {
  where = fixtureAt('stashes');
  const revisions = ['stash@{0}', 'stash@{0}^2', 'stash@{0}^3', 'main', 'main~1'];
  const more = ['stash@{1}', 'stash@{1}^1', 'stash@{1}^2'];
  const hashes = gitLines(where, ['rev-parse', ...revisions, ...more]);
  const names = ['stash0', 'index0', 'untracked0', 'main', 'first', 'stash1', 'gone', 'index1'];
  names.forEach((name, at) => named.set(name, hashes[at] ?? ''));
});

const hashOf = (name: string): string => named.get(name) ?? '';

/** One page of the fixture read through the reader, or a thrown failure. */
async function readingOf(pageSize = 100, selection?: BranchSelection): Promise<RepositoryPage> {
  const request = {
    repositoryPath: where,
    pageSize,
    ...(selection === undefined ? {} : { selection }),
  };
  const outcome = await reader.readPage(request);
  if (!outcome.ok) {
    throw new Error(`${outcome.kind}: ${outcome.message}`);
  }
  return outcome.value;
}

/** A reading laid out from nothing, as an open lays out its first page. */
function laidOut(read: RepositoryPage): GraphPage {
  const block = createRowBlock();
  return addPage(block, layoutReading(createLayoutState(), block, read), read);
}

/** The object name of every commit of a reading, in its order. */
function hashesOf(read: RepositoryPage): string[] {
  return Array.from({ length: read.commits.count }, (_unused, row) =>
    hexAt(read.commits.hashes, row, HASH_BYTE_LENGTH),
  );
}

/** One row's segments as `[from, to, colour]`. */
function segmentsOf(rows: LayoutRows, row: number): number[][] {
  const found: number[][] = [];
  for (
    let segment = entryAt(rows.segmentOffsets, row);
    segment < entryAt(rows.segmentOffsets, row + 1);
    segment += 1
  ) {
    found.push([
      entryAt(rows.segmentFromLane, segment),
      entryAt(rows.segmentToLane, segment),
      entryAt(rows.segmentColour, segment),
    ]);
  }
  return found;
}

/** The row of a page whose commit is `hash`, counting the uncommitted row. */
function rowOf(page: GraphPage, hash: string): number {
  return hashesOf(page).indexOf(hash) + (page.workingTree.hasChanges ? 1 : 0);
}

/** The commit rows a stash reference names, by name. */
function stashRows(read: RepositoryPage): Map<string, number> {
  const found = new Map<string, number>();
  for (let ref = 0; ref < read.refs.count; ref += 1) {
    if (read.refs.kind[ref] === RefKind.Stash) {
      found.set(
        refNameAt(read.refs.names, read.refs.nameOffsets, ref),
        read.refs.commitIndex[ref] ?? -1,
      );
    }
  }
  return found;
}

describe('every stash is a row of its own (item 1)', () => {
  it('puts each stash among the commits where its date puts it, and nothing git made for it', async () => {
    const read = await readingOf();
    expect(hashesOf(read)).toEqual([
      hashOf('stash0'),
      hashOf('main'),
      hashOf('stash1'),
      hashOf('gone'),
      hashOf('first'),
    ]);
    for (const helper of ['index0', 'untracked0', 'index1']) {
      expect(hashesOf(read)).not.toContain(hashOf(helper));
    }
    expect(stashRows(read)).toEqual(
      new Map([
        ['stash@{0}', 0],
        ['stash@{1}', 2],
      ]),
    );
  });

  it('flags the stash rows, and no other row, as stashes', async () => {
    const page = laidOut(await readingOf());
    const stashes = [...page.layout.flags].map((flags) => flags & RowFlag.Stash);
    expect(stashes).toEqual([0, RowFlag.Stash, 0, RowFlag.Stash, 0, 0]);
  });

  it('gives each stash one parent, the commit it was made on, and draws no line to the others', async () => {
    const read = await readingOf();
    const parentsOf = (row: number): number[] =>
      Array.from(
        read.commits.parentIndices.subarray(
          entryAt(read.commits.parentOffsets, row),
          entryAt(read.commits.parentOffsets, row + 1),
        ),
      );
    expect(parentsOf(0)).toEqual([1]);
    expect(parentsOf(2)).toEqual([3]);
    const page = laidOut(read);
    for (let row = 0; row < page.layout.rowCount; row += 1) {
      for (const [from, to] of segmentsOf(page.layout, row)) {
        expect(Math.max(from ?? 0, to ?? 0)).toBeLessThanOrEqual(1);
      }
    }
    expect(page.layout.maxLane).toBe(1);
  });
});

describe('a stash row is drawn as the reference draws one (items 2 and 3)', () => {
  it('sits in lane one beside the uncommitted line and curves into the tip it was made on', async () => {
    const page = laidOut(await readingOf());
    const rows = page.layout;
    expect([...rows.laneIndex]).toEqual([0, 1, 0, 1, 1, 0]);
    // Row 1, stash@{0}: nothing above its ring, its line leaving it down lane 1.
    expect(entryAt(rows.flags, 1) & RowFlag.ClipAboveVertex).toBe(RowFlag.ClipAboveVertex);
    expect(segmentsOf(rows, 1)).toEqual([
      [0, 0, UNCOMMITTED_COLOUR],
      [1, 1, 1],
    ]);
    // Row 2, main's tip: the stash's line arrives from lane 1 into its dot in lane 0.
    expect(segmentsOf(rows, 2)).toEqual([
      [1, 0, 1],
      [0, 0, 0],
    ]);
  });
});

describe('a stash whose branch was deleted keeps the commit it was made on (item 4)', () => {
  it('shows that commit once, joined to the stash above and to its own parent below', async () => {
    const page = laidOut(await readingOf());
    const gone = rowOf(page, hashOf('gone'));
    expect(hashesOf(page).filter((hash) => hash === hashOf('gone'))).toHaveLength(1);
    expect(gone).toBe(4);
    // stash@{1} straight down lane 1 into it, and it on into its parent's dot in lane 0.
    expect(entryAt(page.layout.laneIndex, 3)).toBe(1);
    expect(segmentsOf(page.layout, 3)).toEqual([
      [0, 0, 0],
      [1, 1, 1],
    ]);
    expect(entryAt(page.layout.laneIndex, gone)).toBe(1);
    expect(entryAt(page.layout.flags, gone) & RowFlag.ClipAboveVertex).toBe(0);
    expect(segmentsOf(page.layout, 5)).toEqual([
      [0, 0, 0],
      [1, 0, 1],
    ]);
    expect(gitLines(where, ['branch', '--list', 'gone'])).toEqual([]);
  });
});

describe("the uncommitted row's line reaches HEAD's dot (item 6)", () => {
  it("runs from the ring down lane 0, grey, past the stash, and ends at HEAD's dot", async () => {
    const page = laidOut(await readingOf());
    const rows = page.layout;
    const head = rowOf(page, hashOf('main'));
    expect(head).toBe(2);
    expect(entryAt(rows.flags, 0)).toBe(RowFlag.Uncommitted | RowFlag.ClipAboveVertex);
    expect(entryAt(rows.colourIndex, 0)).toBe(UNCOMMITTED_COLOUR);
    expect(segmentsOf(rows, 0)).toEqual([[0, 0, UNCOMMITTED_COLOUR]]);
    expect(segmentsOf(rows, 1)[0]).toEqual([0, 0, UNCOMMITTED_COLOUR]);
    expect(entryAt(rows.laneIndex, head)).toBe(0);
    expect(entryAt(rows.flags, head)).toBe(
      RowFlag.Head | RowFlag.ClipAboveVertex | RowFlag.UncommittedAbove,
    );
    const marked = [...rows.flags].flatMap((flags, row) =>
      (flags & RowFlag.UncommittedAbove) === 0 ? [] : [row],
    );
    expect(marked).toEqual([head]);
  });

  it('draws no line above a branch tip or a stash ring of a dirty repository with many tips', async () => {
    const remotes = fixtureAt('remotes');
    const outcome = await reader.readPage({ repositoryPath: remotes, pageSize: 300 });
    if (!outcome.ok) {
      throw new Error(outcome.message);
    }
    for (const page of [laidOut(outcome.value), laidOut(await readingOf())]) {
      const commits = page.commits;
      const parents = new Set<number>(
        Array.from(commits.parentIndices).filter((parent) => parent !== UNKNOWN_INDEX),
      );
      const shift = page.workingTree.hasChanges ? 1 : 0;
      for (let commit = 0; commit < commits.count; commit += 1) {
        const flags = entryAt(page.layout.flags, commit + shift);
        if (!parents.has(commit)) {
          expect(flags & RowFlag.ClipAboveVertex, `row ${String(commit + shift)}`).toBe(
            RowFlag.ClipAboveVertex,
          );
        }
      }
    }
  });
});

describe('the stash rows under a branch selection and over pages', () => {
  it('shows a stash on a selected branch above the commit it was made on, and no other', async () => {
    const read = await readingOf(100, { branches: ['refs/heads/main'], showRemoteBranches: true });
    expect(hashesOf(read)).toEqual([hashOf('stash0'), hashOf('main'), hashOf('first')]);
    expect(stashRows(read)).toEqual(
      new Map([
        ['stash@{0}', 0],
        ['stash@{1}', UNKNOWN_INDEX],
      ]),
    );
    const flags = [...laidOut(read).layout.flags].map((bits) => bits & RowFlag.Stash);
    expect(flags).toEqual([0, RowFlag.Stash, 0, 0]);
  });

  it('reads a larger page as the smaller one continued, the stash rows counted as rows', async () => {
    const first = await readingOf(2);
    expect(hashesOf(first)).toEqual([hashOf('stash0'), hashOf('main')]);
    expect(first.hasMore).toBe(true);
    const block = createRowBlock();
    const state = createLayoutState();
    addPage(block, layoutReading(state, block, first), first);
    const second = await readingOf(4);
    expect(hashesOf(second).slice(0, 2)).toEqual(hashesOf(first));
    expect(continuesReading(block, first.commits.hashes, second)).toBe(true);
    const page = addPage(block, layoutReading(state, block, second), second);
    expect([...page.layout.laneIndex]).toEqual([0, 1, 0, 1, 1]);
    expect([...page.layout.flags].map((bits) => bits & RowFlag.Stash)).toEqual([
      0,
      RowFlag.Stash,
      0,
      RowFlag.Stash,
      0,
    ]);
  });
});
