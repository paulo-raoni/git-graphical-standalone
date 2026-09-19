/**
 * The lane palette.
 *
 * It lives in the renderer because `LayoutRows.colourIndex` is an **index** and
 * `src/core/` must not know a colour (`src/contracts/layout.ts`: "Colours are
 * palette indices, never colour values, so that a theme change repaints without
 * recomputing the layout"). This module is the one place in the project that
 * turns one into the other, for the canvas and for the reference labels alike,
 * so the two can never disagree about what lane three looks like.
 *
 * **Eight colours, and what happens past the end.** The index is taken modulo
 * the palette, so lane 8 repeats lane 0's colour and a graph of any width is
 * drawable. Eight is chosen against a measurement rather than a feeling: S04
 * measured its braided history — a branch every ninth commit, merges resolving
 * within forty rows — at **seven lanes wide at ten thousand, forty thousand and
 * one hundred and sixty thousand commits alike**
 * (`docs/plan/E01-commit-graph/M01-first-graph/S04-lane-layout.md`), so eight is
 * one more than the widest shape anybody here has measured and the repeat is
 * reached only by a graph wider than that. It matters less than it looks: S04
 * also fixes a line's colour to the lane it was born in, so two lines that
 * repeat a colour are eight lanes apart on screen.
 *
 * **One palette, not one per theme.** Every colour below is a mid-tone chosen to
 * read on both of the two backgrounds `renderer.css` defines, so nothing painted
 * on the canvas depends on the light or dark preference and the view installs no
 * listener for it. That is why a theme change is absent from the redraw triggers
 * in this slice, where `docs/ADR-0002-architecture-and-performance.md`
 * decision 5 lists it: the decision permits those triggers rather than requiring
 * them, and a listener that repaints identical pixels is a wakeup that buys
 * nothing. Configurable colours are E01-M02, and that is the milestone where a
 * theme-dependent palette would arrive with something to repaint.
 *
 * **Why one string and not an array.** `noUncheckedIndexedAccess` types every
 * indexed read as possibly absent, so an array of colours forces either a
 * non-null assertion — which silences the check without performing it — or an
 * unreachable branch nothing can test. `String.prototype.slice` is total: it
 * returns a string for every input, so `laneColour` has one path and no case a
 * reader has to talk themselves out of.
 */

/** Seven characters per colour, concatenated. */
const LANE_COLOURS = '#3d7fd6#d9534f#3fa34d#a86fd0#e08b2f#2aa9a0#c2569a#8a8f3a';

/** Characters one `#rrggbb` occupies. */
const COLOUR_LENGTH = 7;

/** How many distinct lane colours there are. */
export const LANE_COLOUR_COUNT = LANE_COLOURS.length / COLOUR_LENGTH;

/**
 * The colour of a lane, for any palette index the contract can hold.
 *
 * `colourIndex` is a `Uint8Array` entry, so it is a whole number from 0 to 255
 * and the modulo below is total over its whole range.
 */
export function laneColour(colourIndex: number): string {
  const at = (colourIndex % LANE_COLOUR_COUNT) * COLOUR_LENGTH;
  return LANE_COLOURS.slice(at, at + COLOUR_LENGTH);
}
