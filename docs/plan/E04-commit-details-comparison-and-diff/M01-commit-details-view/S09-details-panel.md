# E04-M01-S09 · The details panel

**Parent:** E04 Commit details, comparison and diff > E04-M01 Commit Details View > E04-M01-S09 the details panel

A click on a commit row, a stash row or the Uncommitted Changes row opens an area directly under the row and asks
for its details over the bridge S06 landed. The area is 250 pixels tall, spans the table, holds the commit's
fields and message on the left, the changed files' paths in a pane beside them and a close control at the far
right. Every row after the open one moves down by the area's height, the graph's lines run on through the area,
and a change of lane next to it stays one row tall and fixed to one dot, as the reference was seen to draw it.

Each statement below is marked **measured** (a reading, with its method), **read from code** (a claim about
files as they stand, checkable by reading them) or **inferred** (a judgement no measurement made).

## What it is made of

| piece | where |
| --- | --- |
| the area: one element, built with the view, its left pane, files pane and close control | `src/ui/details-area.ts` |
| which row is open, opening, closing, centring, asking, the stale-reply guard | `src/ui/details-panel.ts` |
| a row's top with the area counted (`rowOffsetY`, `rowTopY`), the area's height (`DETAILS_HEIGHT`), the lines across it (`gapLines`, `gapSide`, the `side` argument of `segmentLines`) | `src/ui/geometry.ts` |
| the painter's gap pass | `src/ui/graph-canvas.ts` |
| the view, its listeners, the pool written with the open row | `src/ui/graph-table.ts` |
| the target of a row and the row of a target | `src/ui/row-model.ts` (`detailsTargetAt`, `rowOfTarget`) |
| the bridge call and the Refresh that asks again | `src/ui/renderer.ts` |
| the area's colours, in both themes | `src/ui/renderer.css` |

**What the renderer exposes** (for S11's keys and S12's place): `GraphTableView.toggleDetails(row)`,
`closeDetails()`, `onDetails(listener)` and `rereadUncommitted()`. `toggleDetails` is what a click and a
parent link call: it opens the row's details, or closes them when they are that row's already. The view holds no
bridge: `onDetails` is handed the target and a function to hand the reply to, and `renderer.ts` makes the call.

## Where the details open, and what moves

- **The area is one element** in the spacer, moved by `transform` as a row is, and hidden when closed. The pool
  holds the elements it held (read from code; a live-row count with an area open on a ten-thousand-row page is in
  *Costs*).
- **Height: 250 pixels, border included, for every row** (`DETAILS_HEIGHT`). It is the orchestrator's reading of
  the reference's 249 pixels against a 24-pixel row (task, item 2), and not measured by this lane. S12 makes it
  adjustable.
- **Every row after the open one is `DETAILS_HEIGHT` lower, the rows up to it stay.** The spacer and the scroll
  range grow by the same amount. **Measured** by `test/e2e/details-panel.spec.ts`, first case, on the `details`
  fixture: the area's box is 250 high at the clicked row's bottom edge, and every row shown is exactly where it was
  or exactly 250 lower, compared to the pixel.
- **The open row carries a lighter band** (`row--open`) while the area is open.
- **Centring.** On opening, the view sets `scrollTop` so that the row and its area, as one block, sit in the middle of
  the list below the sticky head, and a block taller than the list puts the row at the top. The browser clamps the
  offset at both ends of the scroll range, so near the end the view stops at its bottom. **Measured** by
  `details-lines.spec.ts`, on `large` grown to 10 000 commits: the block's centre is within one pixel of the list's
  at row 5 005, and the view is at its end after opening the third row from the last. Closing does not scroll back
  (the same case reads `scrollTop` before and after the close).

## The two places the guarantee hangs on

1. **A row's top, on the canvas and in the DOM.** `rowOffsetY(row, open)` is the one function: the DOM writes a row's
   `translateY` from it (`writeRows`), and the canvas takes `rowTopY(row, scrollTop, open)`, which is the same
   number less the scroll offset. `firstDrawnRow` and `vertexRowAt` place a content offset among the rows with the
   same area (`rowAtOffset`). **Probe, seen red then green:** `writeRows` given `row * ROW_HEIGHT` fails the first
   case of `details-panel.spec.ts`; `paintGraph` not given the open row fails the canvas case of
   `details-lines.spec.ts`.
2. **Which end of the gap a curve belongs to** (`segmentLines` for the half a row paints, `gapLines` for the part in
   the area, one rule for both). See the next section. **Probes, seen red then green:** the departing curve drawn
   at the lower row's end fails three of the four `details-lines.spec.ts` cases that read lines; the arriving
   curve drawn at the upper row's end fails two of them.

## The lines across the area

**Drawn.** The canvas is over the scrolling area already, so the lines are drawn over the area's background. With
the details of row `r` open, `paintGraph` draws `r`'s lines that cross its foot through the area (`gapLines`)
whenever any of the area is on screen, **whether or not `r` or the row after it is in the drawn window**. A paint
reads, besides the drawn rows and their two neighbours, the open row and the one after it, wherever they are.
That is two rows more, once, and does not grow with the page (read from code; the live-row bound and the redraw
counts with an area open are *Costs*).

**Closed drawing is unchanged** (the `side` argument defaults to none): `golden-graph.spec.ts` passes with its golden
file untouched, and so do every existing case of `graph-geometry.spec.ts` and `stash-rows.spec.ts` (**measured**,
the whole `application` project, 87 of 89 cases passing in the run of 2026-11-11 that included both new files'
first versions; the two that failed were corrected cases of the new files, see the audit).

**Which end a curve belongs to.** The task inferred that the layout's lane at the boundary (row `r`'s
`segmentToLane`, which is row `r + 1`'s `segmentFromLane`) is the lane at `r`'s centre when the line joins at
`r + 1`, and the lane at `r + 1`'s centre when it leaves at `r`. **Read from `src/core/layout/lane-layout.ts`**
(`crossOpenLanes`, `openDepartures`), and confirmed in the first half:

- a line passing a row emits `(L, L)`; a line ending at the vertex emits `(L, vertex)`, so the row above it holds
  `(L, L)` and the line is in `L` at its centre: the lane at the boundary is the lane at `r`'s centre. It **joins**
  `r + 1`'s dot. A commit's first-parent line is `(V, V)` and, when the parent's dot is in a lane further left, it
  too arrives as `(V, vertex)`, which is why a stash's line goes straight down its own lane and curves in above
  its base (the reading of item 5).
- a line born at the vertex towards a further parent is `(vertex, L)`, `L` the leftmost free lane. It **leaves**
  `r`'s dot, and the lane at the boundary is the lane the line has below, **when the parent's own row is in `L`**.

**The refutation of "when".** The second half does not always hold. **Measured** with the real layout pass on
`[[3], [2], [4, 3], [4], []]` (a commit in lane 1 whose further parent, row 3, is also the parent of row 0 in lane
0): row 2 emits `1>2`, and row 3 takes lane 0, as the leftmost lane a line arrives in, and emits `2>0`. So the lane at
the boundary (2) is neither the lane at `r`'s centre (1) nor at `r + 1`'s (0). **The decision, argued:** such a line
is born at `r`'s dot, so it **leaves**: the rule is *joins when the lane at the boundary is the lane at `r`'s
centre, and leaves in every other case*. The curve then stays one row below `r`'s dot, and the line runs down lane 0
to `r + 1`'s dot. The reference was not observed in this shape (inferred, a case of the same family as the merge it
was observed with). `details-lines.spec.ts`, third case, holds it.

**What each row paints beside an area.** The curve is one S-curve, vertical at both ends, cut at its middle. Beside
an area:

- *leaves `r`:* `r` paints the first half as it always did, `gapLines` paints the second half in the area's top
  half row and then straight down, and the row after the area paints its upper half straight;
- *joins `r + 1`:* `r` paints its lower half straight, `gapLines` paints straight down and then the first half of
  the curve over the area's last half row, and the row after the area paints the second half as it always did.

**Measured** by `details-lines.spec.ts`: the first three cases cut an S-curve by de Casteljau, independently of the
code under test, and compare every point of `gapLines`' and `segmentLines`' output on layouts made by the real
layout pass; the canvas case reads the built window's pixels (software rendering, `--disable-gpu`) at points
through an area opened under a merge, under a branch's tip and under the uncommitted ring, with the dot of the row
after the area where it moves to, and with the window made 200 pixels tall and scrolled into the area.

## What the left pane says

- **A commit and a stash:** `Commit:`, `Parents:`, `Author:`, then `Author Date:`, `Committer:`, `Committer Date:`
  when the two people are recorded at different moments, or `Committer:` and one `Date:` when they are at the same
  moment (the same time and the same offset). Labels are bold, each field on its own line. **The test for
  "different" is the orchestrator's choice** (task); the reference showed only the two extremes.
- **A date** reads `Tue Nov 14 2023 22:18:20 GMT+0000`, in the person's own recorded offset, without a zone name.
  **Measured:** the cases compare dates spelt by hand from the fixture's times, with `Date.toUTCString` agreeing
  with each on 2026-11-11, so nothing is compared with `dateText`.
- **The message** is the reply's, with every space, tab and blank line kept (`white-space: pre-wrap`), **less the one
  line feed that ends it**. **Decision:** git terminates the last line with it, so it begins no further line, and
  leaving it in would add a visible empty line only in some engines. **Measured:** `textContent` of the message is
  compared with the exact literal, including the four-space and tab-indented lines of the two-people commit.
- **Parents:** each full hash, comma-separated; a link where the commit is a row of the page, plain text otherwise
  (a stash's second and third parents, a parent past the loaded page, a parent outside a selection); `None` for a
  root. **Measured** on `stashes`: one link and two plain texts. A link calls `toggleDetails` for that row: the same as
  a click on it.
- **The uncommitted changes:** the one sentence.
- **While the reply is awaited** the area is open at its full height saying `Loading…`; **a failure** shows its
  message; **a `Cancelled` reply closes the area silently**. All three are the orchestrator's choices (task), held
  by `details-panel.spec.ts` on a second view that the case feeds replies by hand.
- **A stale reply is never drawn.** Every request carries a number; the area draws a reply only if it is the number the
  view last asked, and closing the area or opening another row moves it on. **Measured:** the first reply, answered
  after another row was opened, is not drawn; with the guard removed it is (probe, red then green).
- **The files pane** lists one line per file of the reply, its path, in the reply's order, as plain text, until
  S10 replaces it. **The cost of one element a file:** not measured on a commit of many files. The largest commit of
  any fixture this lane has is the two-people commit's nine files, and a measurement on it says nothing about a commit
  of thousands. What is known is read from code: the pane is rewritten once per reply, in one `replaceChildren`,
  never per frame, so a commit of many files costs one burst of element creation per open and nothing while it is
  open. Raised for S10, which owns this pane.

## When a page arrives under an open area

**Decisions (task, scope 7):** a page drawn from its first row (an Open, a new branch selection) closes the area;
a page drawn at the current offset (a Refresh, a Load More) keeps it when the new page still has its row, the same
full hash or the uncommitted row, and closes it otherwise. After a Refresh an uncommitted area asks again
(`rereadUncommitted`); a commit's does not, because a commit's details cannot change. Finding the row walks the
loaded commits once per page that arrives, comparing a first byte and spelling a name only for a match.
**Measured** by `details-panel.spec.ts`: a Load More with an area open keeps it on the same commit; a Refresh after a
file is written into the repository shows the file in an open uncommitted area; unchecking Show Remote Branches on
`remotes` closes it. Each has a probe (red then green).

## Costs

- **Live row elements with an area open, on a page of 10 000 commits:** 37, 37, 37, 37 at four scroll offsets, bound 37
  (the bound is the table's own, `visibleRowCount + 2 * OVERSCAN_ROWS`, computed from the measured viewport).
  **Measured** by `details-lines.spec.ts`, last case, 2026-11-11.
- **A burst of 25 announced scroll events:** 1 redraw. **An idle window with an area open:** the timers and frames the
  page had registered are the same two seconds later (the probes of `./support/budgets-page.ts`).
- **Where they are.** `graph-table.spec.ts` holds 290 of the 300 lines `eslint.config.js` allows a module and
  `graph-geometry.spec.ts` 294 (measured with `max-lines` set to 1), so the three cases and the geometry cases are
  in `details-lines.spec.ts`, which reads `loadMoreAndShow` and the probes of `support/budgets-page.ts` instead of the
  helpers local to `graph-table.spec.ts`.
- **How long a click takes** (click to the left pane holding the reply, five readings each, milliseconds, in the order
  taken; `details-panel.spec.ts`, last case, printed and not held). Five runs, each five readings, all with other
  projects running.

  | run (2026-11-11, load not sampled) | `details`, HEAD's commit | `details`, the uncommitted changes | `large`, HEAD's commit |
  | --- | --- | --- | --- |
  | 1 | 389, 360, 319, 386, 305 | 493, 627, 525, 489, 496 | 283, 233, 232, 223, 386 |
  | 2 | 250, 241, 243, 237, 280 | 476, 417, 461, 456, 433 | 278, 248, 272, 284, 440 |
  | 3 | 289, 227, 228, 222, 202 | 510, 598, 790, 549, 577 | 285, 232, 195, 243, 244 |
  | 4 (machine visibly busy) | 478, 559, 372, 466, 424 | 1104, 1156, 980, 972, 799 | 469, 371, 361, 407, 472 |
  | 5 (machine visibly busy) | 525, 328, 341, 352, 448 | 1112, 1014, 761, 921, 1041 | 1074, 1866, 898, 530, 415 |

  **What these are, and are not.** They are **measured** (the page's `performance.now()` from the click to the
  left pane holding the reply, `details-panel.spec.ts`, last case), and **not** readings under the free-machine rule
  of `AGENTS.md` §11: this lane did not sample the load during any of them. The machine was shared with other
  projects' runs throughout, which the spread between runs (a median from 232 to 1 074 ms for the same click) shows
  but does not measure. The reference of the task's scope 9 asks for the load beside each reading; **that is owed**
  (see the audit's *Status*). What the readings do say: the commit's details cost about a quarter to a half of a
  second here and the uncommitted changes' about twice that, as S06's request readings did, and the click adds no
  visible cost on top of the request (S06's readings of the bare request were 464 to 715 ms for HEAD's commit under
  load, which they exceed in no run above by more than the machine's own spread; an inference, not a series).

  Whether a budget should exist for it is a plan decision, not this lane's: `ADR-0002` decision 6 names none.
  Raised in the audit.

- **Bundle size.** renderer.js 26 543 bytes against 20 995 at the base, renderer.css 8 170 against 7 117. Both budgets
  were reset once by the margin rule (`comment-e04-m01-s09` in `scripts/gates/size-budget.json`, with the per-module
  figures and what was tried).

## Looking at it (task, scope 10)

**Measured, by eye, on 2026-11-11,** from screenshots of the built application at device ratio 1 (not zoomed), on `details`, `stashes` and `remotes`,
against the items of the reference:

- *1 and 3, where it opens and what moves:* under the clicked row, full width, the left pane starting at the
  Description column, the files pane beside it, the close control at the far right; the rows below moved down by the
  area, the rows above did not. The uncommitted row's area had its sentence and the three paths.
- *4, the lines across it:* with the merge open, lane 0 straight down through the area, lane 1 straight down from
  the curve that leaves under the merge's dot; with the branch tip open, lane 1 straight down and the curve into
  the parent's dot at the area's foot; with a stash open on `stashes`, the stash's line straight down lane 1 and
  curving into its base's dot at the foot, and the uncommitted row's grey line straight through lane 0; on `remotes`,
  three further lanes passing through the area. Dots, colours and widths looked as in the closed graph.
- *5, the curves:* none stretched; each stayed one row.
- *7, closing:* shown by the cases, not looked at again by eye.
- *2, the height:* 250 pixels against 24, ten and a bit rows, as the task chose.
- *6, the fields:* `Commit`, `Parents` (the first a link, the stash's others plain), `Author`, `Committer`, `Date`,
  the message. The two-people commit was not screenshotted; its four-line variant is held by a case.
- **Not looked at, and said so:** the dark theme (the shots are in the light theme), the layout at other window widths,
  and a zoomed view: the shots are at device ratio 1, so each item was read at that size.

## Not in this slice (as the task says)

The files as a tree or a list, status colours and counts (S10); every key (S11); the height dragged, the docked place,
Auto Center off, the options control (S12); the Code Review button (E04-M04); links inside a message, e-mail links
(E04-M05); a hover band.
