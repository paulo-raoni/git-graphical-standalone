import { entryAt } from '../contracts/column-read';
import {
  authorOf,
  hexHashOf,
  refCommitOf,
  refCount,
  refKindOf,
  refNameOf,
  RefKind,
  subjectOf,
} from '../contracts/index';
import type { GraphPage } from '../contracts/index';

/**
 * What one row shows, computed for one row index on demand.
 *
 * **Nothing here is per loaded row.** There is no array of row views, no map
 * keyed by hash and no cache: `rowViewAt` is a pure function of the page and an
 * index, the view calls it for the forty-odd rows a pool element is about to
 * hold, and the result is written into that element and dropped. A page of two
 * hundred thousand commits and a page of twenty cost this module the same.
 *
 * That is not a micro-optimisation. Materialising a row object per loaded commit
 * is exactly the 300-to-500-byte-per-commit shape that
 * `docs/ADR-0002-architecture-and-performance.md` decision 3 built the columnar
 * store to avoid; rebuilding it in the renderer would hand the whole of it back.
 *
 * Like `./geometry` this module holds no DOM reference, so it can be read by a
 * plain Node test.
 */

/** Characters of the object name the commit column shows. */
const ABBREVIATED_HASH_LENGTH = 8;

/** Kinds that get a label, in the order the description column shows them. */
const LABELLED_KINDS: readonly RefKind[] = [RefKind.LocalHead, RefKind.RemoteBranch, RefKind.Tag];

/** One reference label sitting on a row. */
export interface RowLabel {
  /** What the reference is, which decides the label's shape. */
  readonly kind: RefKind;
  /** The short name git reported, which is what the label reads. */
  readonly name: string;
}

/** Everything the five columns of one row need. */
export interface RowView {
  /** Whether this is the uncommitted-changes row rather than a commit. */
  readonly isUncommitted: boolean;
  /** The commit's subject, or what the uncommitted row says instead. */
  readonly description: string;
  /** The author date, or the empty string on the uncommitted row. */
  readonly date: string;
  /** The author's name, or the empty string on the uncommitted row. */
  readonly author: string;
  /** The abbreviated object name, or the empty string on the uncommitted row. */
  readonly hash: string;
  /** The references sitting on this commit, in kind order. */
  readonly labels: readonly RowLabel[];
  /** The palette index this row's vertex carries, which its labels share. */
  readonly colourIndex: number;
}

/**
 * Which commit a layout row is about.
 *
 * `LayoutRows` row 0 is the uncommitted row when the working tree is dirty, and
 * every later row is one commit further into `CommitColumns` than its own index
 * (`src/contracts/graph-page.ts`). The offset is read from
 * `workingTree.hasChanges` rather than from `RowFlag.Uncommitted`, because
 * `hasChanges` is what the contract makes the two row counts differ by, while
 * the flag is set by the caller that prepends the row (S06, per
 * `docs/plan/E01-commit-graph/M01-first-graph/S04-lane-layout.md`) and a page
 * whose producer forgot it would otherwise be drawn one commit out of step.
 */
function commitRowOf(page: GraphPage, row: number): number {
  return page.workingTree.hasChanges ? row - 1 : row;
}

/**
 * The author date, in the author's own recorded offset from UTC.
 *
 * The author's offset rather than this machine's, because it is the one the page
 * carries: it is identical on every machine that opens the repository, which
 * makes the column reproducible in a test and in a screenshot. Formatting is
 * deliberately fixed and locale-free — E01-M02 owns date formats, and the way to
 * hand it that decision is to have exactly one spelling to change rather than an
 * `Intl` call whose output depends on where the window is.
 */
function dateOf(page: GraphPage, commitRow: number): string {
  const seconds = entryAt(page.commits.authorTime, commitRow);
  const offsetMinutes = entryAt(page.commits.authorTzMinutes, commitRow);
  const at = new Date((seconds + offsetMinutes * 60) * 1000);
  const day = `${String(at.getUTCFullYear())}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
  return `${day} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * The references sitting on `commitRow`, in the order the column shows them.
 *
 * It walks the whole block **once per labelled kind** — three times — for each
 * row that is about to be written, which is what puts the labels in kind order
 * without a sort. That is three times the repository's reference count and
 * nothing to do with its commit count, so a scroll of one row costs three walks
 * however many commits are loaded. An index over the block, built once per page,
 * would turn that into a lookup and would be the obvious next step if a
 * repository with thousands of tags ever measured badly; it is not built now
 * because the measurement that would justify it does not exist yet
 * (`AGENTS.md` §7), and the constant is not what would decide it — three walks
 * and one walk are both linear in the reference count.
 *
 * Only the three kinds the reference behaviour names are shown. A remote's
 * symbolic HEAD and the stash's own reference point at commits too, and showing
 * them would put `origin/HEAD` beside `origin/main` on the same row and a
 * `stash` label on an ordinary commit.
 */
function labelsOn(page: GraphPage, commitRow: number): readonly RowLabel[] {
  const found: RowLabel[] = [];
  for (const kind of LABELLED_KINDS) {
    for (let ref = 0; ref < refCount(page.refs); ref += 1) {
      if (refCommitOf(page.refs, ref) === commitRow && refKindOf(page.refs, ref) === kind) {
        found.push({ kind, name: refNameOf(page.refs, ref) });
      }
    }
  }
  return found;
}

/**
 * What row `row` of this page shows.
 *
 * @throws RangeError when `row` is not a row of the page's layout
 */
export function rowViewAt(page: GraphPage, row: number): RowView {
  const colourIndex = entryAt(page.layout.colourIndex, row);
  const commitRow = commitRowOf(page, row);
  if (commitRow < 0) {
    const { changedFileCount, untrackedFileCount } = page.workingTree;
    return {
      isUncommitted: true,
      description: `Uncommitted changes (${String(changedFileCount + untrackedFileCount)})`,
      date: '',
      author: '',
      hash: '',
      labels: [],
      colourIndex,
    };
  }
  return {
    isUncommitted: false,
    description: subjectOf(page.commits, commitRow),
    date: dateOf(page, commitRow),
    author: authorOf(page.commits, commitRow).name,
    hash: hexHashOf(page.commits, commitRow).slice(0, ABBREVIATED_HASH_LENGTH),
    labels: labelsOn(page, commitRow),
    colourIndex,
  };
}
