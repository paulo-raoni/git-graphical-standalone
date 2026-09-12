/**
 * The growing store for one page's segments.
 *
 * A row's segment count is not known before the row is laid out, and the page's
 * total is not known before the page is, so the three segment columns of
 * `LayoutRows` cannot be allocated exactly up front. They are grown here
 * geometrically and copied out exactly once, at the end of the page.
 *
 * Three parallel typed arrays rather than an array of `{from, to, colour}`
 * objects, for the reason `docs/ADR-0002-architecture-and-performance.md`
 * decision 3 gives for the commit store: a page of forty thousand rows holds
 * some hundreds of thousands of segments, and an object each would be tens of
 * megabytes the garbage collector traces on every major collection, against
 * five bytes each here.
 */

/** The growth factor, as an exact ratio so that no float rounding enters it. */
const GROWTH_NUMERATOR = 5;
const GROWTH_DENOMINATOR = 4;

/**
 * The smallest buffer worth allocating, for a page of no or very few rows.
 */
export const MINIMUM_SEGMENT_CAPACITY = 16;

export interface SegmentBuffer {
  /** Lane each segment's line enters at the top edge of its row. */
  from: Uint16Array;
  /** Lane each segment's line leaves at the bottom edge of its row. */
  to: Uint16Array;
  /** Palette index of each segment. Not a colour. */
  colour: Uint8Array;
  /** Segments written so far. */
  count: number;
  /** The widest lane any segment has touched, for `LayoutRows.maxLane`. */
  maxLane: number;
}

/**
 * The capacity to grow to so that `required` segments fit.
 *
 * Five quarters, as everywhere else in this project
 * (`docs/plan/E01-commit-graph/M01-first-graph/S02-gates-and-store.md`): still
 * geometric, so appending a segment stays amortised constant, and the unused
 * part of a buffer is capped at a quarter rather than at a whole.
 */
export function nextSegmentCapacity(current: number, required: number): number {
  let capacity = Math.max(1, current);
  while (capacity < required) {
    capacity = Math.ceil((capacity * GROWTH_NUMERATOR) / GROWTH_DENOMINATOR);
  }
  return capacity;
}

/**
 * A buffer for a page of `rowCount` rows.
 *
 * One segment per row is the floor for a page drawn as a single straight chain,
 * and it is the commonest shape by a long way, so a page starts with room for
 * exactly that and grows from there. Starting smaller would reallocate on every
 * page; starting at a multiple of the row count would hold a page's worth of
 * slack for the narrow graphs that are the normal case.
 */
export function createSegmentBuffer(rowCount: number): SegmentBuffer {
  const capacity = Math.max(MINIMUM_SEGMENT_CAPACITY, rowCount);
  return {
    from: new Uint16Array(capacity),
    to: new Uint16Array(capacity),
    colour: new Uint8Array(capacity),
    count: 0,
    maxLane: 0,
  };
}

function grow(buffer: SegmentBuffer): void {
  const capacity = nextSegmentCapacity(buffer.from.length, buffer.count + 1);
  const from = new Uint16Array(capacity);
  from.set(buffer.from);
  const to = new Uint16Array(capacity);
  to.set(buffer.to);
  const colour = new Uint8Array(capacity);
  colour.set(buffer.colour);
  buffer.from = from;
  buffer.to = to;
  buffer.colour = colour;
}

/**
 * Record one line's crossing of one row's band.
 *
 * `from` is the lane it enters at the top edge, `to` the lane it leaves at the
 * bottom edge, and `colour` the palette index of the line itself — which is
 * neither of the two whenever the line moves across, so the third column is not
 * derivable from the first two.
 */
export function pushSegment(buffer: SegmentBuffer, from: number, to: number, colour: number): void {
  if (buffer.count === buffer.from.length) {
    grow(buffer);
  }
  buffer.from[buffer.count] = from;
  buffer.to[buffer.count] = to;
  buffer.colour[buffer.count] = colour;
  buffer.count += 1;
  buffer.maxLane = Math.max(buffer.maxLane, from, to);
}
