/**
 * The lane layout engine: the single import surface later rings use.
 *
 * The composition root holds one {@link LayoutState} per view, calls
 * {@link layoutPage} once per page of commits, and ships the `LayoutRows` it
 * gets to the renderer, which draws them and decides nothing. The lane table and
 * the segment buffer are this folder's own business and are not re-exported. The
 * bounded column read is not this folder's at all any more: it is
 * `src/contracts/column-read`, named by module path (E01-M01-FIX-09).
 */
export {
  colourOfLane,
  createLayoutState,
  layoutPage,
  layoutStateByteLength,
  layoutWork,
} from './lane-layout';
export type { LayoutCounters, LayoutState } from './lane-layout';
