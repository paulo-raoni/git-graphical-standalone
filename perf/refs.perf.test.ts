import { describe, expect, it } from 'vitest';

import { HASH_BYTE_LENGTH, RefKind } from '../src/contracts/index';
import {
  buildRefs,
  createReferenceList,
  createReferenceParser,
  finishReferences,
  pushReferences,
  resolveCommitRows,
} from '../src/core/parse/index';
import type { ReferenceList } from '../src/core/parse/index';

import { held } from './workloads';

/**
 * The reader over very many references, counted.
 *
 * A page joins its references to its commits in `resolveCommitRows` of
 * `src/core/parse/commit-lookup.ts`, and that is the one step of reading a page
 * whose cost could be a product of the two: every other step reads each
 * reference once, in one pass over `git for-each-ref`'s output. So this counts
 * the full object-name comparisons it makes. Each reference whose commit is on
 * the page should cost one, and a reference that is not on it none, however many
 * references there are; a lookup that compared every reference with every row
 * would cost a page's worth each, ten thousand here.
 *
 * The workload is synthetic and the same on every run: a page of
 * {@link PAGE_COMMITS} commits with object names drawn from a fixed linear
 * congruential sequence, and references in the mix of the `many-refs` fixture
 * (`test/fixtures/generate.ts`) — local branches, one remote-tracking branch on
 * the same commit as each, and half as many tags as branches, every other one
 * annotated — spelled as `git for-each-ref` spells them in the reader's format
 * and read by the reader's own parser. Every reference stands on a commit of the
 * page, so that each one is looked up for real. It is read at the fixture's
 * size, {@link FIXTURE_BRANCHES} branches, and at four times it.
 */

/** Commits on the page every reference is looked up in. */
const PAGE_COMMITS = 10_000;

/** Local branches of the `many-refs` fixture; it also has `main`, which this adds. */
const FIXTURE_BRANCHES = 1000;

/** A distinct object name per row, from its own sequence. */
function nameAt(row: number): Uint8Array {
  const name = new Uint8Array(HASH_BYTE_LENGTH);
  let state = (row + 1) * 2654435761;
  for (let byte = 0; byte < HASH_BYTE_LENGTH; byte += 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    name[byte] = (state >>> 16) & 0xff;
  }
  return name;
}

function hexOf(name: Uint8Array): string {
  let text = '';
  for (const byte of name) {
    text += byte.toString(16).padStart(2, '0');
  }
  return text;
}

/** The object names of the page, concatenated, as `CommitColumns.hashes` holds them. */
function pageHashes(): Uint8Array {
  const hashes = new Uint8Array(PAGE_COMMITS * HASH_BYTE_LENGTH);
  for (let row = 0; row < PAGE_COMMITS; row += 1) {
    hashes.set(nameAt(row), row * HASH_BYTE_LENGTH);
  }
  return hashes;
}

/** One record of `git for-each-ref` in `REFERENCE_FORMAT`, for a reference on `row`. */
function record(refname: string, row: number, annotated: boolean, checkedOut: boolean): string {
  const commit = hexOf(nameAt(row));
  const object = annotated ? hexOf(nameAt(PAGE_COMMITS + row)) : commit;
  const fields = [
    refname,
    annotated ? 'tag' : 'commit',
    object,
    annotated ? commit : '',
    '',
    checkedOut ? '*' : ' ',
  ];
  return `\u001e${fields.join('\u001f')}\n`;
}

/** What `git for-each-ref` would print for `branches` branches in the fixture's mix. */
function forEachRefOutput(branches: number): Uint8Array {
  const records: string[] = [record('refs/heads/main', 0, false, true)];
  for (let branch = 0; branch < branches; branch += 1) {
    records.push(
      record(`refs/heads/branch-${String(branch)}`, (7 * branch) % PAGE_COMMITS, false, false),
    );
  }
  for (let branch = 0; branch < branches; branch += 1) {
    const row = (7 * branch) % PAGE_COMMITS;
    records.push(record(`refs/remotes/origin/branch-${String(branch)}`, row, false, false));
  }
  for (let tag = 0; tag < branches / 2; tag += 1) {
    const row = (11 * tag) % PAGE_COMMITS;
    records.push(record(`refs/tags/tag-${String(tag)}`, row, tag % 2 === 0, false));
  }
  return new TextEncoder().encode(records.join(''));
}

/** A reading: the references parsed, how many of each kind, and the comparisons made. */
interface Reading {
  readonly references: number;
  readonly kinds: readonly number[];
  readonly onPage: number;
  readonly comparisons: number;
}

/** Parse the output in 64 KiB chunks, as a pipe delivers it, and look every reference up. */
function read(branches: number, hashes: Uint8Array): Reading {
  const output = forEachRefOutput(branches);
  const list: ReferenceList = createReferenceList();
  const parser = createReferenceParser(list);
  for (let from = 0; from < output.length; from += 65_536) {
    pushReferences(parser, output.subarray(from, from + 65_536));
  }
  finishReferences(parser);
  const lookup = resolveCommitRows(list.targets, list.count, hashes, PAGE_COMMITS);
  const refs = buildRefs(list, lookup.rows);
  const kinds = [RefKind.LocalHead, RefKind.RemoteBranch, RefKind.Tag].map(
    (kind) => refs.kind.filter((each) => each === kind).length,
  );
  const onPage = lookup.rows.filter((row) => row < PAGE_COMMITS).length;
  return { references: refs.count, kinds, onPage, comparisons: lookup.comparisons };
}

const hashes = pageHashes();
const fixture = read(FIXTURE_BRANCHES, hashes);
const quadrupled = read(FIXTURE_BRANCHES * 4, hashes);

describe('the references of a page, counted', () => {
  it('reads every reference of the workload, by kind, and finds each on the page', () => {
    expect(fixture.kinds).toEqual([FIXTURE_BRANCHES + 1, FIXTURE_BRANCHES, FIXTURE_BRANCHES / 2]);
    expect(fixture.onPage).toBe(fixture.references);
    expect(quadrupled.kinds).toEqual([
      FIXTURE_BRANCHES * 4 + 1,
      FIXTURE_BRANCHES * 4,
      FIXTURE_BRANCHES * 2,
    ]);
    expect(quadrupled.onPage).toBe(quadrupled.references);
  });

  it('makes about one full comparison per reference', () => {
    const comparison = held(
      'refLookupComparisonsPerRef',
      `full object-name comparisons per reference, ${String(fixture.references)} references`,
      fixture.comparisons / fixture.references,
    );
    expect(comparison.failed).toBe(false);
  });

  it('makes four times the comparisons for four times the references, not sixteen', () => {
    const comparison = held(
      'refLookupScalingRatio',
      `comparisons for ${String(quadrupled.references)} references over ${String(fixture.references)}`,
      quadrupled.comparisons / fixture.comparisons,
    );
    expect(comparison.failed).toBe(false);
  });
});
