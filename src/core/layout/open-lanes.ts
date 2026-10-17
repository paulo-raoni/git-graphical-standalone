import { entryAt } from '../../contracts/column-read';
import { UNKNOWN_INDEX } from '../../contracts/index';

/**
 * The set of open lanes: the whole of what the layout pass carries from one page
 * to the next.
 *
 * A **lane** is a column of the graph. A lane is *open* while a line is
 * descending in it towards the commit it ends at, and free otherwise. This table
 * is therefore proportional to the **width of the branch frontier** — the number
 * of lines crossing one row, which is tens at most in a real repository — and
 * never to the number of commits loaded. That is the property that lets
 * `docs/ADR-0002-architecture-and-performance.md` decision 4 call the pass
 * incremental: appending a page continues from this table, and the rows already
 * emitted are never read again.
 *
 * Two `Uint32Array` columns, so one open lane costs **eight bytes** plus the
 * table's slack, and the table is traced by the garbage collector as two buffers
 * rather than as one object per lane.
 */

/**
 * A lane holding no line.
 *
 * It has to be a value inside `Uint32Array`'s range, as `UNKNOWN_INDEX` does and
 * for the same reason, and it has to differ from `UNKNOWN_INDEX`, which this
 * table uses for a lane whose target commit is not loaded yet. `0xFFFFFFFE` is
 * the largest `Uint32` but one, four billion rows past anything a repository can
 * reach, so no real commit index collides with it.
 */
export const FREE_LANE = 0xfffffffe;

/**
 * Lanes a fresh table has room for before its first reallocation.
 *
 * A repository's graph is a handful of lanes wide almost everywhere, so eight
 * costs 64 bytes and reallocates nothing for the ordinary case, while a table
 * sized for the rare wide graph would be slack in every other one.
 */
export const INITIAL_LANE_CAPACITY = 8;

/** The growth factor, as an exact ratio so that no float rounding enters it. */
const GROWTH_NUMERATOR = 5;
const GROWTH_DENOMINATOR = 4;

export interface OpenLanes {
  /**
   * What each lane's line is descending to: a commit index, `UNKNOWN_INDEX` when
   * that commit is not loaded yet, or {@link FREE_LANE} when no line is here.
   */
  target: Uint32Array;
  /**
   * For a lane whose target is `UNKNOWN_INDEX`, the entry of
   * `CommitColumns.parentIndices` that will name the commit once it loads.
   * Meaningless for any other lane.
   */
  slot: Uint32Array;
  /**
   * One past the highest lane currently holding a line, so that a row walks the
   * graph's present width rather than the widest it has ever been.
   */
  limit: number;
}

/**
 * The capacity to grow to so that `required` lanes fit.
 *
 * Five quarters, for the reason
 * `docs/plan/E01-commit-graph/M01-first-graph/S02-gates-and-store.md` gives for
 * the store's columns: it is geometric, so growth stays amortised constant, and
 * it caps the unused part of a table at a quarter rather than at a whole.
 */
export function nextLaneCapacity(current: number, required: number): number {
  let capacity = Math.max(1, current);
  while (capacity < required) {
    capacity = Math.ceil((capacity * GROWTH_NUMERATOR) / GROWTH_DENOMINATOR);
  }
  return capacity;
}

function grownTo(source: Uint32Array, capacity: number): Uint32Array {
  const grown = new Uint32Array(capacity);
  grown.set(source);
  return grown;
}

/** A table with no lane open, which is what a first page starts from. */
export function createOpenLanes(): OpenLanes {
  const table: OpenLanes = {
    target: new Uint32Array(INITIAL_LANE_CAPACITY),
    slot: new Uint32Array(INITIAL_LANE_CAPACITY),
    limit: 0,
  };
  table.target.fill(FREE_LANE);
  return table;
}

/**
 * Make room for `lane`, leaving every lane it adds free.
 *
 * Internal: the only way a lane is written is {@link occupyLane}, which makes
 * room for what it is about to write, so nothing outside this module has to
 * remember to.
 */
function ensureLaneCapacity(lanes: OpenLanes, lane: number): void {
  const current = lanes.target.length;
  if (lane < current) {
    return;
  }
  const capacity = nextLaneCapacity(current, lane + 1);
  lanes.target = grownTo(lanes.target, capacity);
  lanes.target.fill(FREE_LANE, current);
  lanes.slot = grownTo(lanes.slot, capacity);
}

/**
 * The leftmost lane holding no line, which is where every new line starts.
 *
 * Leftmost rather than next-unused is what makes a lane freed by a line ending
 * available to a later line, and so what keeps the graph as narrow as the
 * repository allows instead of growing a column for every branch ever created.
 *
 * The search stops at {@link OpenLanes.limit} because every lane at or above it
 * is free by definition, so this costs the graph's present width and not its
 * historical one.
 */
export function firstFreeLane(lanes: OpenLanes): number {
  for (let lane = 0; lane < lanes.limit; lane += 1) {
    if (entryAt(lanes.target, lane) === FREE_LANE) {
      return lane;
    }
  }
  return lanes.limit;
}

/** Put a line in `lane`, descending towards `target`. */
export function occupyLane(lanes: OpenLanes, lane: number, target: number, slot: number): void {
  ensureLaneCapacity(lanes, lane);
  lanes.target[lane] = target;
  lanes.slot[lane] = slot;
  if (lane >= lanes.limit) {
    lanes.limit = lane + 1;
  }
}

/** Whether `lane` is waiting for a commit that has not been loaded yet. */
export function laneAwaitsUnloaded(lanes: OpenLanes, lane: number): boolean {
  return entryAt(lanes.target, lane) === UNKNOWN_INDEX;
}

/** Bytes the table retains, which is what it costs to carry between pages. */
export function laneTableByteLength(lanes: OpenLanes): number {
  return lanes.target.byteLength + lanes.slot.byteLength;
}
