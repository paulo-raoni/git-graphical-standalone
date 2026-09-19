import { describe, expect, it } from 'vitest';

import { FIRST_PAGE_COMMITS, FURTHER_PAGE_COMMITS } from './page-sizes';

/**
 * The two page sizes, held to the two properties their own doc comment argues
 * for. Neither assertion is about the number 300: both would still hold if the
 * decision moved, and both fail if the decision is lost.
 *
 * The first is that a page is worth drawing. The window opens at 800 pixels tall
 * and a row is 24 of them, so a first page shorter than 34 rows would open on a
 * view that is already asking for more. The number is written here rather than
 * imported, because `src/core/` may not name `src/ui/`; it is
 * `src/ui/geometry.ts`'s `ROW_HEIGHT` and `src/app/window.ts`'s `INITIAL_HEIGHT`
 * put together, and if either moves this bound is what says so.
 *
 * The second is that the two are equal, which is what makes the *n*th press of
 * Load More read *n + 1* pages under the re-read this slice chose.
 */

/** Rows the initial 800-pixel-tall window can show at 24 pixels each. */
const ROWS_THE_FIRST_WINDOW_SHOWS = Math.ceil(800 / 24);

describe('the page sizes', () => {
  it('are whole numbers of commits', () => {
    expect(Number.isSafeInteger(FIRST_PAGE_COMMITS)).toBe(true);
    expect(Number.isSafeInteger(FURTHER_PAGE_COMMITS)).toBe(true);
  });

  it('open on more than the first window can show', () => {
    expect(FIRST_PAGE_COMMITS).toBeGreaterThan(ROWS_THE_FIRST_WINDOW_SHOWS);
  });

  it('add as much as they opened with', () => {
    expect(FURTHER_PAGE_COMMITS).toBe(FIRST_PAGE_COMMITS);
  });
});
