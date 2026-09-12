import { RowFlag } from '../../contracts/index';
import type { CommitColumns, LayoutRows } from '../../contracts/index';

import { entryAt } from './column-entry';
import {
  createOpenLanes,
  firstFreeLane,
  FREE_LANE,
  laneAwaitsUnloaded,
  laneTableByteLength,
  occupyLane,
} from './open-lanes';
import type { OpenLanes } from './open-lanes';
import { createSegmentBuffer, pushSegment } from './segment-buffer';
import type { SegmentBuffer } from './segment-buffer';

/**
 * Lane assignment: one forward pass over a page of commits, producing the whole
 * drawing instruction set of the graph column.
 *
 * The pass holds one thing between rows — the set of open lanes — and reads each
 * commit once. A page appended later continues from that set, so the rows
 * already emitted are never read, recomputed or rewritten
 * (`docs/ADR-0002-architecture-and-performance.md` decision 4). Nothing here is
 * proportional to the number of rows *loaded*; a row costs the width of the
 * graph at that row, which is the number of lines crossing it.
 *
 * ### What a row does
 *
 * 1. **Cross.** Every open lane is walked once. A lane whose line is not ending
 *    at this commit emits a straight segment; a lane whose line ends here emits
 *    a segment leaning into the vertex.
 * 2. **Place the vertex.** It sits in the **leftmost lane whose line ends at
 *    this commit**, so the lines of the commit's children converge into it. When
 *    no line ends here — a branch tip, or the first commit of a page — the
 *    vertex takes the **leftmost free lane**.
 * 3. **Depart.** The commit's **first drawable parent continues in the vertex's
 *    own lane**, which is what keeps a first-parent chain straight down the
 *    view. Every further parent starts a line in the leftmost free lane, leaning
 *    out of the vertex, which is what a merge looks like read downward.
 * 4. **Close.** Lanes whose line ended here are freed, for a later line to
 *    reuse. They are freed *after* the departures, so a line born at this row
 *    never takes a lane a line died in at this row: that would draw the two
 *    crossing inside one row's band, which reads as neither.
 *
 * ### Where a row's line begins and ends
 *
 * A segment spans a whole row band, so a tip's departing line and a root's
 * arriving line are both spelled `(V, V)` in the vertex's lane and a painter
 * cannot tell which half of the band it is holding. Two bits of
 * `LayoutRows.flags` say it instead, and this pass is where both are decided:
 * `RowFlag.ClipAboveVertex` when the vertex took a **free** lane, which means no
 * loaded row above names this commit as a parent, and
 * `RowFlag.ClipBelowVertex` when the commit has **no parent entry at all**.
 * Neither costs a second pass: the first falls out of the lane table the
 * crossing walk already read, the second out of the parent offsets the
 * departures already read. That is why {@link layoutPage} does the crossing
 * itself and hands the answer down — the lane table has forgotten it by the time
 * the row is finished.
 *
 * A parent is **drawable** when it is `UNKNOWN_INDEX` — not loaded, so its line
 * leaves the bottom of the page and is resolved when the page below arrives — or
 * when its index is below this commit's, meaning further down the view. A parent
 * whose index is *above* the commit's own would be a line drawn upward, which
 * this vocabulary has no segment for; it is counted for the merge flag and not
 * drawn. See the slice document for the decision and its cost.
 */

/** The answer of a search for a lane that found none. */
const NO_LANE = -1;

/**
 * The low bits of a lane index that fit `LayoutRows.colourIndex`.
 *
 * The palette belongs to the renderer and is not named here: a colour value in
 * `core/` would be a rule leaking out of it. What this ring decides is only that
 * **a line's colour follows the lane it was born in**, which is what makes two
 * lines running side by side always differ, and the contract's `Uint8Array`
 * decides how many indices there can be. The renderer takes this index modulo
 * however many colours it has.
 */
const COLOUR_INDEX_MASK = 0xff;

/** The palette index of every line born in `lane`, and of every vertex in it. */
export function colourOfLane(lane: number): number {
  return lane & COLOUR_INDEX_MASK;
}

/**
 * Deterministic work counters, which is what a performance gate can assert on.
 *
 * A stopwatch on a shared machine measures the machine. These count the pass's
 * own decisions, are identical on every machine, and make an accidentally
 * quadratic pass visible as a ratio rather than as a slow afternoon
 * (`docs/ADR-0003-quality-gates-and-ci.md` decision 4).
 */
export interface LayoutCounters {
  /** Rows laid out. */
  rows: number;
  /** Parent entries read, drawn or not. */
  parentEdges: number;
  /**
   * Lane slots inspected. A lane claimed counts the lanes up to and including
   * the one claimed, which is what the search looked at before deciding.
   */
  laneVisits: number;
  /** Segments emitted. */
  segments: number;
}

/**
 * Everything a following page needs, and nothing else.
 *
 * It is passed to {@link layoutPage} and advanced in place, the way the commit
 * store's builder is: the caller holds one of these for the life of a view and
 * hands it back for each page. Its whole size is the lane table's, eight bytes
 * per lane the graph has been wide (see {@link layoutStateByteLength}), so it is
 * proportional to the width of the branch frontier and never to the number of
 * commits loaded.
 */
export interface LayoutState {
  lanes: OpenLanes;
  /** Commits of the page laid out so far, and the first row of the next call. */
  rowsLaidOut: number;
  counters: LayoutCounters;
}

/** A state with no lane open, which is what a first page starts from. */
export function createLayoutState(): LayoutState {
  return {
    lanes: createOpenLanes(),
    rowsLaidOut: 0,
    counters: { rows: 0, parentEdges: 0, laneVisits: 0, segments: 0 },
  };
}

/** The counters summed: one number for a gate to hold against a row count. */
export function layoutWork(state: LayoutState): number {
  const counters = state.counters;
  return counters.rows + counters.parentEdges + counters.laneVisits + counters.segments;
}

/** Bytes the state retains between pages. */
export function layoutStateByteLength(state: LayoutState): number {
  return laneTableByteLength(state.lanes);
}

/**
 * Refuse a page that does not continue this state.
 *
 * The row count is passed in as well as held in the state so that the two can
 * disagree, because the way this is misused is by laying out the same page
 * twice, or by skipping one — and both produce a graph that is wrong rather than
 * one that fails.
 */
function checkPageContinues(
  state: LayoutState,
  columns: CommitColumns,
  rowsAlreadyLaidOut: number,
): void {
  if (rowsAlreadyLaidOut !== state.rowsLaidOut) {
    throw new RangeError(
      `layout was told ${String(rowsAlreadyLaidOut)} rows were laid out, having laid out ${String(state.rowsLaidOut)}`,
    );
  }
  if (columns.count < rowsAlreadyLaidOut) {
    throw new RangeError(
      `layout was given ${String(columns.count)} commits, fewer than the ${String(rowsAlreadyLaidOut)} already laid out`,
    );
  }
}

/**
 * Give every lane waiting for an unloaded commit the row it turned out to be.
 *
 * A line whose parent was not loaded left the bottom of the previous page, and
 * its lane has stayed open ever since. The store resolves that parent in place
 * when the commit arrives, so the lane only has to remember **which entry of
 * `parentIndices`** named it: the entry is stable, because the parent columns
 * are appended to and never rewritten.
 *
 * This is what makes the pass incremental without rewriting a prefix. It costs
 * one pass over the open lanes per page, not per row.
 *
 * The entry is written back without a test on what it says, because neither of
 * the two values that are not a row below this page changes anything. An entry
 * still reading `UNKNOWN_INDEX` writes back the value the lane already held. An
 * entry naming a row this page has gone past — which the store's ordering makes
 * unusual, and which no segment could reach anyway — leaves the lane descending
 * for the rest of the view, exactly as it would have if it had stayed unknown,
 * because every row from here on is below it. What the test does have to
 * exclude is a lane holding **no** line, whose remembered entry belongs to the
 * line before it.
 */
function resolveLanesAwaitingUnloaded(state: LayoutState, columns: CommitColumns): void {
  const lanes = state.lanes;
  for (let lane = 0; lane < lanes.limit; lane += 1) {
    state.counters.laneVisits += 1;
    if (laneAwaitsUnloaded(lanes, lane)) {
      lanes.target[lane] = entryAt(columns.parentIndices, entryAt(lanes.slot, lane));
    }
  }
}

/**
 * Walk every open lane, emitting its segment, and return the vertex's lane.
 *
 * The vertex sits in the leftmost lane ending at this commit, so the leftmost
 * such lane is found and used in the same walk: every lane to its left that ends
 * here cannot exist, and every lane to its right that ends here leans into it.
 * Returns {@link NO_LANE} when no line ends at this commit at all.
 */
function crossOpenLanes(state: LayoutState, row: number, segments: SegmentBuffer): number {
  const lanes = state.lanes;
  let vertex = NO_LANE;
  for (let lane = 0; lane < lanes.limit; lane += 1) {
    state.counters.laneVisits += 1;
    const target = entryAt(lanes.target, lane);
    if (target === FREE_LANE) {
      continue;
    }
    if (target !== row) {
      pushSegment(segments, lane, lane, colourOfLane(lane));
      continue;
    }
    if (vertex === NO_LANE) {
      vertex = lane;
    }
    pushSegment(segments, lane, vertex, colourOfLane(lane));
  }
  return vertex;
}

/** The leftmost free lane, counting the lanes the search looked at. */
function claimLane(state: LayoutState): number {
  const lane = firstFreeLane(state.lanes);
  state.counters.laneVisits += lane + 1;
  return lane;
}

/**
 * Start a line for each of the commit's drawable parents.
 *
 * The first continues in the vertex's own lane. When the vertex lane was not
 * already occupied by an arriving line, that continuation is the only thing in
 * the lane over this row's band, so it emits the band's one straight segment;
 * when it was, {@link crossOpenLanes} has already emitted it and a second would
 * draw the same line twice.
 */
function openDepartures(
  state: LayoutState,
  columns: CommitColumns,
  row: number,
  vertex: number,
  arrived: boolean,
  segments: SegmentBuffer,
): void {
  const end = entryAt(columns.parentOffsets, row + 1);
  let vertexTaken = false;
  for (let slot = entryAt(columns.parentOffsets, row); slot < end; slot += 1) {
    state.counters.parentEdges += 1;
    const parent = entryAt(columns.parentIndices, slot);
    // One test covers both kinds of parent this ring will not draw. A parent at
    // or above its own child would be a line going up a row, and the segment
    // vocabulary has none. `UNKNOWN_INDEX` needs no test of its own: it is the
    // largest `Uint32` by construction, four billion rows past anything a
    // repository can reach, so it is never at or above a row.
    if (parent <= row) {
      continue;
    }
    if (vertexTaken) {
      const lane = claimLane(state);
      pushSegment(segments, vertex, lane, colourOfLane(lane));
      occupyLane(state.lanes, lane, parent, slot);
      continue;
    }
    if (!arrived) {
      pushSegment(segments, vertex, vertex, colourOfLane(vertex));
    }
    occupyLane(state.lanes, vertex, parent, slot);
    vertexTaken = true;
  }
}

/**
 * Free every lane whose line ended at this commit, and narrow the table.
 *
 * A lane that ended here and was then taken by a departing line no longer points
 * at this row, so it is left alone by the same test that frees the others — no
 * list of arrivals has to be carried between the two steps.
 */
function closeArrivedLanes(state: LayoutState, row: number): void {
  const lanes = state.lanes;
  let limit = 0;
  for (let lane = 0; lane < lanes.limit; lane += 1) {
    state.counters.laneVisits += 1;
    const target = entryAt(lanes.target, lane);
    if (target === row) {
      lanes.target[lane] = FREE_LANE;
      continue;
    }
    if (target !== FREE_LANE) {
      limit = lane + 1;
    }
  }
  lanes.limit = limit;
}

/**
 * Place one commit's vertex and open its departures, and answer its lane.
 *
 * `arrival` is what {@link crossOpenLanes} answered for this row. The caller
 * walks the lanes and passes it in, rather than this function doing both, for
 * one reason: the arrival decides a **flag** as well as the lane, and once the
 * departures and the closing have run, the lane table no longer holds it. The
 * only other way to recover it is a second pass over the rows, which
 * `docs/ADR-0002-architecture-and-performance.md` decision 4 does not allow.
 */
function layoutRow(
  state: LayoutState,
  columns: CommitColumns,
  row: number,
  arrival: number,
  segments: SegmentBuffer,
): number {
  const vertex = arrival === NO_LANE ? claimLane(state) : arrival;
  openDepartures(state, columns, row, vertex, arrival !== NO_LANE, segments);
  closeArrivedLanes(state, row);
  return vertex;
}

/**
 * `RowFlag.ClipAboveVertex`, from what arrived at the row.
 *
 * No line was descending towards this commit, so nothing above it — on this page
 * or on any page laid out before it — names it as a parent: every drawable
 * parent occupies a lane, a lane is only ever claimed while free, and a lane
 * aimed at a row is freed only once that row is reached, so an arrival exists
 * exactly when some earlier row named this one.
 *
 * The bit is **final** rather than provisional. Git emits children before
 * parents, so a commit whose children are all absent from the rows loaded so far
 * cannot acquire one from a page that arrives later, and no row's flags are ever
 * rewritten.
 */
function clipAboveFlag(arrival: number): number {
  return arrival === NO_LANE ? RowFlag.ClipAboveVertex : 0;
}

/**
 * The bits the parent columns decide: `RowFlag.Merge` and
 * `RowFlag.ClipBelowVertex`.
 *
 * Both read the parent **count** and neither reads a parent value. For the merge
 * flag that is deliberate, so a parent this vocabulary cannot draw is still
 * counted. For `ClipBelowVertex` **it is the guarantee**: a commit with no
 * parent entry is a root and its line ends at the dot, while a commit whose
 * parent entry is `UNKNOWN_INDEX` has a parent that exists and is not loaded, so
 * its line leaves the bottom of the page and continues into the page below.
 * Reading "no *loaded* parent" instead would clip the last row of every page of
 * every repository too large to fit in one, which is invisible on a single page
 * and wrong on every page but the last.
 */
function rowFlags(columns: CommitColumns, row: number): number {
  const parents = entryAt(columns.parentOffsets, row + 1) - entryAt(columns.parentOffsets, row);
  const merge = parents > 1 ? RowFlag.Merge : 0;
  const clipBelow = parents === 0 ? RowFlag.ClipBelowVertex : 0;
  return merge | clipBelow;
}

/**
 * Lay out the commits of `columns` from `rowsAlreadyLaidOut` to its end.
 *
 * `state` is advanced in place and is what the next call continues from. The
 * returned rows cover the new commits only, so a page is a pure append to
 * whatever was drawn before — which is the property the incremental test holds
 * this module to, array by array.
 *
 * Stash, head and uncommitted flags are not set here: this ring is not told
 * which commit `HEAD` resolves to, which rows are stash entries, or whether the
 * working tree is dirty. The caller that knows those sets them on the rows it
 * gets, and prepends the uncommitted row itself.
 *
 * @throws RangeError when the page does not continue the state
 */
export function layoutPage(
  state: LayoutState,
  columns: CommitColumns,
  rowsAlreadyLaidOut: number,
): LayoutRows {
  checkPageContinues(state, columns, rowsAlreadyLaidOut);
  resolveLanesAwaitingUnloaded(state, columns);
  const rowCount = columns.count - rowsAlreadyLaidOut;
  const laneIndex = new Uint16Array(rowCount);
  const colourIndex = new Uint8Array(rowCount);
  const flags = new Uint8Array(rowCount);
  const segmentOffsets = new Uint32Array(rowCount + 1);
  const segments = createSegmentBuffer(rowCount);
  let maxLane = 0;
  for (let row = rowsAlreadyLaidOut; row < columns.count; row += 1) {
    const at = row - rowsAlreadyLaidOut;
    const arrival = crossOpenLanes(state, row, segments);
    const lane = layoutRow(state, columns, row, arrival, segments);
    laneIndex[at] = lane;
    colourIndex[at] = colourOfLane(lane);
    flags[at] = rowFlags(columns, row) | clipAboveFlag(arrival);
    segmentOffsets[at + 1] = segments.count;
    // A vertex is not always on a segment: a commit with no child above it and
    // no parent below it is a lone dot, and it can still be the widest lane the
    // page reached.
    maxLane = Math.max(maxLane, lane);
  }
  state.rowsLaidOut = columns.count;
  state.counters.rows += rowCount;
  state.counters.segments += segments.count;
  return {
    rowCount,
    laneIndex,
    colourIndex,
    flags,
    maxLane: Math.max(maxLane, segments.maxLane),
    segmentOffsets,
    segmentFromLane: segments.from.slice(0, segments.count),
    segmentToLane: segments.to.slice(0, segments.count),
    segmentColour: segments.colour.slice(0, segments.count),
  };
}
