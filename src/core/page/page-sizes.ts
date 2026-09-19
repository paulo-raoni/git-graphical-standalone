/**
 * How many commits a page holds, and how many one press of Load More adds.
 *
 * They are constants of this slice and they live here, in one place, because
 * they are a decision and not a number the view or the shell is entitled to
 * invent. Making them settings is E02-M03, and the way to hand that milestone
 * the decision is to leave exactly one spelling of each to change.
 *
 * **Both are 300, and the two halves of that are measured rather than felt.**
 *
 * The first page is sized against the window. The initial frame is 1280 × 800
 * (`src/app/window.ts`) and a row is 24 pixels (`src/ui/geometry.ts`), so the
 * table shows about 31 rows at a time; 300 is nearly ten of those, which is what
 * makes the first screen full with somewhere to scroll rather than an immediate
 * request for more.
 *
 * The further page is sized against what a press costs. Every page is read by
 * asking the adapter for the whole of it again
 * (`docs/plan/E01-commit-graph/M01-first-graph/S06-open-a-repository.md`), so a
 * press costs one walk of everything loaded so far plus the new commits; the
 * measurements in that document are what these numbers were chosen against.
 * Making the further page smaller than the first would spend that walk on fewer
 * new rows each time, and making it larger would lengthen the press a user is
 * waiting through. Equal is the size at which the *n*th press reads *n + 1*
 * pages, which is the arithmetic the measurement in that document reports.
 */

/** Commits the first page of a repository holds. */
export const FIRST_PAGE_COMMITS = 300;

/** Commits one press of Load More Commits adds. */
export const FURTHER_PAGE_COMMITS = 300;
