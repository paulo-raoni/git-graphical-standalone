/**
 * The lane layout engine: the single import surface later rings use.
 *
 * The composition root holds one {@link LayoutState} per view, calls
 * {@link layoutPage} once per page of commits, and ships the `LayoutRows` it
 * gets to the renderer, which draws them and decides nothing. The lane table,
 * the segment buffer and the bounded column read are this folder's own business
 * and are not re-exported.
 */
export {
  colourOfLane,
  createLayoutState,
  layoutPage,
  layoutStateByteLength,
  layoutWork,
} from './lane-layout';
export type { LayoutCounters, LayoutState } from './lane-layout';
