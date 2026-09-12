import { describe, expect, it } from 'vitest';

import { HASH_BYTE_LENGTH, RowFlag, UNKNOWN_INDEX } from '../../contracts/index';
import type { CommitColumns, LayoutRows, PersonTable } from '../../contracts/index';

import { entryAt } from './column-entry';
import { createLayoutState, layoutPage } from './lane-layout';

/**
 * Every shape below is a `CommitColumns` built here, from its parent lists
 * alone, rather than read out of a repository: the layout pass reads `count`,
 * `parentOffsets` and `parentIndices` and nothing else, so a fixture that
 * spawned git would be testing the parser instead.
 *
 * A parent index at or past `count` is a parent that has not been loaded, which
 * is exactly how the store spells it, so `pageTo` doubles as the first page of a
 * history that continues below.
 */
const NOBODY: PersonTable = { names: [], emails: [] };

function pageTo(parents: readonly (readonly number[])[], count: number): CommitColumns {
  const parentOffsets = new Uint32Array(count + 1);
  const flat: number[] = [];
  for (const [row, list] of parents.slice(0, count).entries()) {
    flat.push(...list.map((parent) => (parent >= count ? UNKNOWN_INDEX : parent)));
    parentOffsets[row + 1] = flat.length;
  }
  return {
    count,
    hashes: new Uint8Array(count * HASH_BYTE_LENGTH),
    parentOffsets,
    parentIndices: Uint32Array.from(flat),
    authorId: new Uint32Array(count),
    committerId: new Uint32Array(count),
    authorTime: new Float64Array(count),
    commitTime: new Float64Array(count),
    authorTzMinutes: new Int16Array(count),
    commitTzMinutes: new Int16Array(count),
    subjectOffsets: new Uint32Array(count + 1),
    subjects: '',
    people: NOBODY,
  };
}

function page(parents: readonly (readonly number[])[]): CommitColumns {
  return pageTo(parents, parents.length);
}

function laidOut(parents: readonly (readonly number[])[]): LayoutRows {
  return layoutPage(createLayoutState(), page(parents), 0);
}

/** One row's segments as `[from, to, colour]`, in the order they were emitted. */
function segmentsOf(rows: LayoutRows, row: number): number[][] {
  const segments: number[][] = [];
  const end = entryAt(rows.segmentOffsets, row + 1);
  for (let at = entryAt(rows.segmentOffsets, row); at < end; at += 1) {
    segments.push([
      entryAt(rows.segmentFromLane, at),
      entryAt(rows.segmentToLane, at),
      entryAt(rows.segmentColour, at),
    ]);
  }
  return segments;
}

describe('a page with nothing in it', () => {
  it('is no rows, no segments and one lane of width', () => {
    const rows = laidOut([]);
    expect(rows.rowCount).toBe(0);
    expect([...rows.segmentOffsets]).toEqual([0]);
    expect(rows.segmentFromLane.length).toBe(0);
    expect(rows.segmentToLane.length).toBe(0);
    expect(rows.segmentColour.length).toBe(0);
    expect(rows.maxLane).toBe(0);
  });
});

describe('a single root commit', () => {
  it('sits in lane zero with no line at all', () => {
    const rows = laidOut([[]]);
    expect([...rows.laneIndex]).toEqual([0]);
    expect([...rows.colourIndex]).toEqual([0]);
    expect([...rows.flags]).toEqual([RowFlag.ClipAboveVertex | RowFlag.ClipBelowVertex]);
    expect([...rows.segmentOffsets]).toEqual([0, 0]);
    expect(rows.maxLane).toBe(0);
  });
});

describe('a straight line of commits', () => {
  const rows = laidOut([[1], [2], []]);

  it('keeps every commit in lane zero', () => {
    expect([...rows.laneIndex]).toEqual([0, 0, 0]);
    expect([...rows.colourIndex]).toEqual([0, 0, 0]);
    expect(rows.maxLane).toBe(0);
  });

  it('draws exactly one segment a row, and never two for one line', () => {
    expect([...rows.segmentOffsets]).toEqual([0, 1, 2, 3]);
    expect(segmentsOf(rows, 0)).toEqual([[0, 0, 0]]);
    expect(segmentsOf(rows, 1)).toEqual([[0, 0, 0]]);
    expect(segmentsOf(rows, 2)).toEqual([[0, 0, 0]]);
  });

  it('flags no merge, and clips only the tip above and the root below', () => {
    expect([...rows.flags]).toEqual([RowFlag.ClipAboveVertex, 0, RowFlag.ClipBelowVertex]);
  });
});

describe('a branch, where two commits share a parent', () => {
  const rows = laidOut([[2], [2], []]);

  it('puts the second child in the next lane and the parent back in the first', () => {
    expect([...rows.laneIndex]).toEqual([0, 1, 0]);
    expect([...rows.colourIndex]).toEqual([0, 1, 0]);
    expect(rows.maxLane).toBe(1);
  });

  it('leans the second lane into the parent, keeping its own colour', () => {
    expect(segmentsOf(rows, 1)).toEqual([
      [0, 0, 0],
      [1, 1, 1],
    ]);
    expect(segmentsOf(rows, 2)).toEqual([
      [0, 0, 0],
      [1, 0, 1],
    ]);
  });
});

describe('a merge', () => {
  const rows = laidOut([[1, 2], [3], [3], []]);

  it('flags the row and opens a lane for the second parent', () => {
    expect([...rows.flags]).toEqual([
      RowFlag.Merge | RowFlag.ClipAboveVertex,
      0,
      0,
      RowFlag.ClipBelowVertex,
    ]);
    expect([...rows.laneIndex]).toEqual([0, 0, 1, 0]);
    expect(rows.maxLane).toBe(1);
  });

  it('leans the second parent out of the merge, in its own new colour', () => {
    expect(segmentsOf(rows, 0)).toEqual([
      [0, 0, 0],
      [0, 1, 1],
    ]);
  });

  it('brings both lines back together at the commit they share', () => {
    expect(segmentsOf(rows, 3)).toEqual([
      [0, 0, 0],
      [1, 0, 1],
    ]);
  });
});

describe('a merge of more than two parents', () => {
  const rows = laidOut([[1, 2, 3], [4], [4], [4], []]);

  it('opens one lane a parent, all leaning out of the one vertex', () => {
    expect([...rows.flags]).toEqual([
      RowFlag.Merge | RowFlag.ClipAboveVertex,
      0,
      0,
      0,
      RowFlag.ClipBelowVertex,
    ]);
    expect([...rows.laneIndex]).toEqual([0, 0, 1, 2, 0]);
    expect(rows.maxLane).toBe(2);
    expect(segmentsOf(rows, 0)).toEqual([
      [0, 0, 0],
      [0, 1, 1],
      [0, 2, 2],
    ]);
  });

  it('brings every one of them back into the shared parent', () => {
    expect(segmentsOf(rows, 4)).toEqual([
      [0, 0, 0],
      [1, 0, 1],
      [2, 0, 2],
    ]);
  });
});

describe('two independent roots', () => {
  const rows = laidOut([[1], [], [3], []]);

  it('gives the second root the lane the first one freed', () => {
    expect([...rows.laneIndex]).toEqual([0, 0, 0, 0]);
    expect(rows.maxLane).toBe(0);
  });

  it('draws nothing across the row below a root with no children', () => {
    expect([...rows.segmentOffsets]).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('a lane freed and reused', () => {
  // Lane zero runs the whole page. Row 1 is a tip, so it opens lane one; row 2
  // is a root, so that line ends and lane one is free again; row 3 is another
  // tip, and takes lane one back rather than widening the graph to a third.
  const rows = laidOut([[4], [2], [], [4], []]);

  it('takes the freed lane back instead of widening the graph', () => {
    expect([...rows.laneIndex]).toEqual([0, 1, 1, 1, 0]);
    expect(rows.maxLane).toBe(1);
  });

  it('gives the line that reuses a lane that lane, and so that colour', () => {
    expect([...rows.colourIndex]).toEqual([0, 1, 1, 1, 0]);
    expect(segmentsOf(rows, 3)).toEqual([
      [0, 0, 0],
      [1, 1, 1],
    ]);
  });
});

describe('a lane freed in the middle of the graph', () => {
  // Three tips open lanes zero, one and two; the line in lane one ends at row 4
  // while lane two is still running, so the graph carries a hole for two rows.
  const rows = laidOut([[3], [4], [5], [6], [], [6], []]);

  it('leaves the lanes on either side of the hole where they were', () => {
    expect([...rows.laneIndex]).toEqual([0, 1, 2, 0, 1, 2, 0]);
    expect(rows.maxLane).toBe(2);
  });

  it('draws nothing in the empty lane rather than a line through it', () => {
    expect(segmentsOf(rows, 5)).toEqual([
      [0, 0, 0],
      [2, 2, 2],
    ]);
    expect(segmentsOf(rows, 6)).toEqual([
      [0, 0, 0],
      [2, 0, 2],
    ]);
  });
});

describe('a parent that has not been loaded', () => {
  // Both commits name a parent past the end of the page, so both lines are
  // still descending when the page runs out. The second row's own line is the
  // segment in lane one: a cropped graph would not have it.
  const rows = layoutPage(createLayoutState(), pageTo([[9], [9]], 2), 0);

  it('leaves the line at the bottom of the last row rather than cropping it', () => {
    expect(rows.rowCount).toBe(2);
    expect([...rows.laneIndex]).toEqual([0, 1]);
    expect(segmentsOf(rows, 1)).toEqual([
      [0, 0, 0],
      [1, 1, 1],
    ]);
    expect(rows.maxLane).toBe(1);
  });

  it('opens a lane a piece for two unloaded parents of one commit', () => {
    const merge = layoutPage(createLayoutState(), pageTo([[1, 2]], 1), 0);
    expect([...merge.flags]).toEqual([RowFlag.Merge | RowFlag.ClipAboveVertex]);
    expect(segmentsOf(merge, 0)).toEqual([
      [0, 0, 0],
      [0, 1, 1],
    ]);
    expect(merge.maxLane).toBe(1);
  });
});

describe('a parent above the commit that names it', () => {
  // Git emits children before parents, so a parent index below its child's is
  // the unusual case; the vocabulary has no segment that goes up a row, so the
  // line is not drawn. It is still a parent, so the merge flag still counts it.
  const rows = laidOut([[], [0, 2], []]);

  it('counts it for the flag and draws nothing for it', () => {
    // Row 0 is named as a parent by row 1, which is *below* it, so nothing
    // above it points at it and it is still clipped on both halves of its band.
    expect([...rows.flags]).toEqual([
      RowFlag.ClipAboveVertex | RowFlag.ClipBelowVertex,
      RowFlag.Merge | RowFlag.ClipAboveVertex,
      RowFlag.ClipBelowVertex,
    ]);
    expect([...rows.laneIndex]).toEqual([0, 0, 0]);
    expect(segmentsOf(rows, 1)).toEqual([[0, 0, 0]]);
    expect(rows.maxLane).toBe(0);
  });

  it('draws nothing for a commit that names itself either', () => {
    const own = laidOut([[0], []]);
    expect([...own.segmentOffsets]).toEqual([0, 0, 0]);
    expect([...own.laneIndex]).toEqual([0, 0]);
  });
});

/** The two clip bits of one row, so a row's other flags cannot mask a defect. */
function clipOf(rows: LayoutRows, row: number): number {
  return entryAt(rows.flags, row) & (RowFlag.ClipAboveVertex | RowFlag.ClipBelowVertex);
}

describe('the half of a band a painter must clip', () => {
  // The page of the task's first drawing: a mainline tip in lane zero, a branch
  // tip in lane one, the commit both share, and the root they run down to.
  const rows = laidOut([[2], [2], [3], []]);

  it('clips above a branch tip, which nothing above the page points at', () => {
    expect([...rows.laneIndex]).toEqual([0, 1, 0, 0]);
    expect(clipOf(rows, 1)).toBe(RowFlag.ClipAboveVertex);
  });

  it('clips below a root, whose line ends at the dot', () => {
    expect(clipOf(rows, 3)).toBe(RowFlag.ClipBelowVertex);
  });

  it('clips neither half of a row a line crosses whole', () => {
    expect(clipOf(rows, 2)).toBe(0);
  });

  it('clips both halves of a lone dot, with neither child nor parent', () => {
    // Rows 2 and 3 are lone dots in lane two; the page's own single commit is
    // one as well, with no other lane to cross it.
    const both = RowFlag.ClipAboveVertex | RowFlag.ClipBelowVertex;
    const lone = laidOut([[4], [4], [], [], []]);
    expect([...lone.laneIndex]).toEqual([0, 1, 2, 2, 0]);
    expect(clipOf(lone, 2)).toBe(both);
    expect(clipOf(lone, 3)).toBe(both);
    expect(clipOf(laidOut([[]]), 0)).toBe(both);
  });
});

describe('a page boundary, which is not a root', () => {
  // This is the case the two bits exist for. A page that ends in a commit with
  // no parents and a page that ends in a commit whose parent is not loaded
  // produce byte-identical rows, lanes, segments and colours; only
  // `RowFlag.ClipBelowVertex` tells them apart, and a painter that clips both
  // puts a gap at the foot of every page of every repository larger than one.
  const trueRoot = laidOut([[1], []]);
  const unloadedParent = layoutPage(createLayoutState(), pageTo([[1], [2]], 2), 0);

  it('is identical to a true root in every column but the flags', () => {
    expect(unloadedParent.rowCount).toBe(trueRoot.rowCount);
    expect([...unloadedParent.laneIndex]).toEqual([...trueRoot.laneIndex]);
    expect([...unloadedParent.colourIndex]).toEqual([...trueRoot.colourIndex]);
    expect([...unloadedParent.segmentOffsets]).toEqual([...trueRoot.segmentOffsets]);
    expect(segmentsOf(unloadedParent, 1)).toEqual(segmentsOf(trueRoot, 1));
  });

  it('clips below the true root and not below the unloaded parent', () => {
    expect(clipOf(trueRoot, 1)).toBe(RowFlag.ClipBelowVertex);
    expect(clipOf(unloadedParent, 1)).toBe(0);
  });

  it('still does not clip below it once that parent arrives in the page below', () => {
    const state = createLayoutState();
    const first = layoutPage(state, pageTo([[1], [2], []], 2), 0);
    expect(clipOf(first, 1)).toBe(0);
    const second = layoutPage(state, page([[1], [2], []]), 2);
    expect(clipOf(second, 0)).toBe(RowFlag.ClipBelowVertex);
    // The row the first page emitted is never rewritten, so the bit it carried
    // has to have been right when it was written and not merely right later.
    expect(clipOf(first, 1)).toBe(0);
  });

  it('clips above a first row nothing points at, and not one a page above does', () => {
    const orphan = createLayoutState();
    layoutPage(orphan, page([[]]), 0);
    expect(clipOf(layoutPage(orphan, page([[], [2], []]), 1), 0)).toBe(RowFlag.ClipAboveVertex);
    const continued = createLayoutState();
    layoutPage(continued, pageTo([[1], []], 1), 0);
    expect(clipOf(layoutPage(continued, page([[1], []]), 1), 0)).toBe(RowFlag.ClipBelowVertex);
  });
});

describe('a commit with no child above it and no parent below it', () => {
  // Rows 2 and 3 are lone dots: nothing arrives at them and they have no parent,
  // so they carry no segment at all. Row 2 is still in lane two, which is wider
  // than any lane a segment of this page reaches, so the column is three wide.
  const rows = laidOut([[4], [4], [], [], []]);

  it('is a dot with no line, and still decides the width of the column', () => {
    expect([...rows.laneIndex]).toEqual([0, 1, 2, 2, 0]);
    expect(segmentsOf(rows, 2)).toEqual([
      [0, 0, 0],
      [1, 1, 1],
    ]);
    expect(rows.maxLane).toBe(2);
  });
});
