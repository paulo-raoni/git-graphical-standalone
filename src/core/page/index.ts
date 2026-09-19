/**
 * Assembling a `GraphPage`: the single import surface the composition root uses.
 *
 * `src/core/layout/` answers which lane a commit is in and `src/adapters/` reads
 * a repository; neither of them knows what a *page of the view* is. This folder
 * does, and it holds the three decisions that make one: how the rows of every
 * page loaded so far are accumulated, which row HEAD is, and where the
 * uncommitted-changes row goes. They are here and not in `src/app/` because each
 * of them can be wrong, and `src/app/` contains no logic beyond wiring
 * (`docs/ADR-0002-architecture-and-performance.md` decision 1).
 *
 * The growth helpers and the shift arithmetic are this folder's own business and
 * are not re-exported.
 */
export { addPage, graphPageOf, layoutRowsOf } from './graph-page';

export { FIRST_PAGE_COMMITS, FURTHER_PAGE_COMMITS } from './page-sizes';

export { appendRows, createRowBlock, markHeadRow, NO_HEAD_ROW } from './row-block';
export type { RowBlock } from './row-block';
