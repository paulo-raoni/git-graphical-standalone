# E01-M01-S05 · The graph table renderer

What a reader of the code needs to know about `src/ui/`: how a page becomes rows and lines, the recycling
scheme the whole slice rests on, the palette, every place the reference behaviour was silent and this lane
decided, and exactly what S06 has to connect.

## What exists now

The window still opens on `No repository is open.`, because nothing here reads a repository. Given a
`GraphPage` it draws the table the milestone is for: one row per commit, newest at the top, with the drawn
graph, the description and the reference labels in front of it, the date, the author and the abbreviated
object name; the uncommitted-changes row above every commit; and a **Load More Commits** control that emits
an intent and loads nothing.

It was run and looked at rather than inferred from green gates. What was on screen is in
`AUDIT-S05-graph-table-renderer.md`.

Seven modules, none of which knows what a repository is:

| module | what it is |
| --- | --- |
| `renderer.ts` | the entry point: assert the bridge, mount, publish the view on one namespaced global |
| `graph-table.ts` | the view — the elements, the pool, the scroll and resize handling, the frame |
| `row-element.ts` | one pool element: built once, rewritten in place |
| `row-model.ts` | a pure function of a page and a row index to what that row shows |
| `graph-canvas.ts` | the painter: one canvas the size of the viewport |
| `geometry.ts` | every number the view is made of, as arithmetic over one scroll offset |
| `palette.ts` | the one place a `colourIndex` becomes a colour |

`geometry.ts`, `row-model.ts` and `palette.ts` hold **no DOM reference at all**. That is deliberate and
load-bearing twice: it is what makes the recycling arithmetic testable without a window, and it is what lets
`test/e2e/` import them into plain Node tests — which it has to, for the reason under *What this lane could
not do*.

## The drawing model

The table is a **grid per row**, five columns wide, and the graph column of every row is an **empty cell**.
Nothing is drawn into it. One canvas, positioned over the scrolling area and the width of that column,
carries the whole graph.

```
.graph                position: relative, fills the window below nothing
  .graph__scroll      absolutely positioned over it, the only thing that scrolls
    .graph__head      sticky at its top, sharing the rows' grid
    .graph__spacer    height = rowCount × 24px, so the scrollbar is right
      .row × pool     absolutely positioned, moved by transform
    .graph__more      in flow below the spacer
  .graph__canvas      absolutely positioned, NOT inside the scroller
```

**The head is inside the scroller, stuck to its top.** Outside it, it would span the scrollbar as well and
every column would be a scrollbar's width out of true. Inside, it also sits in the flow above the spacer, so
a row's offset inside the spacer and its offset on the canvas differ by the head's height at every scroll
position — and that cancels exactly, because the canvas starts below the head too. The arithmetic in
`geometry.ts` is therefore `row × ROW_HEIGHT − scrollTop` with no correction term anywhere.

**The canvas is the size of the viewport, never of the content.** A canvas as tall as two hundred thousand
rows is a texture no machine allocates, so the canvas does not scroll: it is repainted from the layout
buffers with the scroll offset subtracted. Its backing store is `devicePixelRatio` times its box, re-read on
every paint rather than watched, because a window dragged to a second display, an operating-system scaling
change and a browser zoom all arrive there and not all three fire a resize of the element. A media query on
`(resolution: <r>dppx)`, re-armed once per distinct ratio, asks for a repaint when the ratio moves; it is a
query and not a timer, so it wakes nothing in between.

**The stylesheet must give the canvas an explicit height, and a comment in `graph-canvas.ts` says why.** A
canvas is a replaced element: with `height: auto` it takes its intrinsic size and `bottom` is ignored.
Measured in this lane, a canvas stretched between `top: 24px` and `bottom: 0` inside a 681-pixel box came
out **100 by 50**, its default 2:1 ratio against the width it had been given. Everything downstream kept
working and was simply wrong — ten pool elements instead of thirty-nine, because the arithmetic believed the
viewport was one row tall. That is why the end-to-end gate computes its bound from the measured height
rather than from a number written into the test.

### One segment, and the four lines it can be

`LayoutRows` models a segment as one line crossing one row's band, and the painter's whole job is the four
cases in `segmentLines`. `V` is the row's vertex lane, from `laneIndex`.

| segment | drawn as |
| --- | --- |
| `(L, L)`, `L ≠ V` | the whole band, top edge to bottom edge, **whatever the clip bits say** |
| `(V, V)` | two halves: the upper only when `ClipAboveVertex` is clear, the lower only when `ClipBelowVertex` is clear |
| `(L, V)`, `L ≠ V` | a line arriving: from the top edge in lane `L` down to the **vertex**, and no further |
| `(V, R)`, `R ≠ V` | a line born here: from the vertex out to lane `R` at the bottom edge |

The first row is the one a painter gets wrong. `src/contracts/layout.ts` is explicit that the clip bits are
about the vertex's lane only, and that a painter clipping on the segments instead leaves a gap at the foot
of every page. The second is what tells a branch tip from a line continuing off the page: both are spelled
`(V, V)`, and only the bits differ. A segment leaning between two lanes that are **both** not the vertex's
is drawn corner to corner; `src/core/layout/` emits no such segment today, and the case exists so that a
later layout cannot make this function silently paint nothing.

Lines are painted per segment in the segment's own colour, with round caps at 1.6 pixels. The vertex is a
filled dot of the row's colour, 3.5 pixels, or an outline on the uncommitted row.

## The recycling scheme, and its invariants

A fixed pool of row elements over a spacer. The three invariants:

1. **Live elements are a function of the viewport and of nothing else.**
   `rowPoolSize(height) = ceil(height / 24) + 1 + 2 × 4`. The row count is deliberately not a parameter of
   that function, so the guarantee is a property of its signature rather than of its body. The pool is
   rebuilt only when that number changes, which is a resize; nothing in `paint` creates or destroys an
   element.
2. **One redraw per animation frame at most, and none when nothing happens.**
   Every trigger calls `schedule`, which is `state.frame ??= requestAnimationFrame(…)`. There is no
   interval, no polling and no animation loop anywhere in `src/ui/`, so an idle window does no work at all.
3. **Read, then write.** `paint` takes `scrollTop`, the canvas box and the pixel ratio from the DOM before
   it writes anything, and writes nothing it then reads back.

**A row keeps its slot under a modulo**: slot `row mod poolSize`. The slot a row lands in does not depend on
the scroll offset, so scrolling by *k* rows rewrites *k* elements and leaves the rest untouched, whatever
*k* is and however many commits are loaded. `firstDrawnRow` clamps the drawn window to the pool's length at
both ends, which is what keeps that mapping a bijection — and, at the foot of a long page, what keeps every
element in use instead of leaving a band of hidden ones there.

**`forgetRows` hides as well as forgetting, and that is not tidiness.** `writeRows` leaves a slot alone when
the row it should hold is the row it already holds, so recording "no row" without hiding the element leaves
it on screen, unwritten, for as long as it stays outside the drawn window. This lane shipped that bug and
found it **by looking at the window**: a twenty-row page drawn after a ninety-six-row one showed rows 20 to
37 of the page before it, with their text, under a graph that had correctly stopped at row 19. Every
assertion passed, because each was about a row that was supposed to be there. `graph-table.spec.ts` now
counts the visible rows of a complete page.

## The row model

`rowViewAt(page, row)` is a pure function of a page and one row index, called for the rows a pool element is
about to hold and dropped. **Nothing is per loaded row**: no array of row views, no map keyed by hash, no
cache. A page of two hundred thousand commits and a page of twenty cost it the same. Materialising a row
object per loaded commit is exactly the shape `docs/ADR-0002-architecture-and-performance.md` decision 3
built the columnar store to avoid, and rebuilding it in the renderer would hand the whole of it back.

Which commit a layout row is about comes from `workingTree.hasChanges`, not from `RowFlag.Uncommitted`:
`hasChanges` is what `src/contracts/graph-page.ts` makes the two row counts differ by, while the flag
belongs to the caller that prepends the row. The painter reads the same source for the same reason — read
differently, the dot and the description end up disagreeing about the same row.

Labels walk the whole reference block **once per labelled kind** — three times — for each row that is about
to be written, which is what puts them in kind order without a sort. That is three times the repository's
reference count and never anything to do with its commit count, so a scroll of one row costs three walks
however many commits are loaded. An index over the block, built once per page, would make it a lookup and
would be the obvious next step if a repository with thousands of tags ever measured badly; it is not built
now, because the measurement that would justify it does not exist yet, and the constant is not what would
decide it — three walks and one walk are both linear in the reference count.

## The palette, and what happens past its end

`palette.ts` is the one place in the project that turns a `colourIndex` into a colour, for the canvas and
for the reference labels alike, so the two cannot disagree about what lane three looks like. It is in the
renderer because the index is an index and `src/core/` must not know a colour.

**Eight colours, taken modulo.** A lane index past the end repeats: lane 8 is lane 0's colour, and a graph
of any width is drawable. Eight is against a measurement rather than a feeling — S04 measured its braided
history **seven lanes wide at ten thousand, forty thousand and one hundred and sixty thousand commits
alike** — so the repeat is reached only by a graph wider than the widest shape anybody here has measured,
and it matters less than it looks: S04 fixes a line's colour to the lane it was born in, so two lines
sharing a colour are eight lanes apart on screen.

**One palette, not one per theme.** Every colour is a mid-tone chosen to read on both backgrounds
`renderer.css` defines, so nothing painted on the canvas depends on the light or dark preference and the
view installs no listener for one. `docs/ADR-0002-architecture-and-performance.md` decision 5 lists a theme
change among the things that may cause a repaint; it permits those triggers rather than requiring them, and
a listener that repaints identical pixels is a wakeup that buys nothing. Configurable colours are E01-M02,
which is the milestone where a theme-dependent palette would arrive with something to repaint.

The colours are stored as **one concatenated string** and sliced. `noUncheckedIndexedAccess` types every
indexed read as possibly absent, so an array of colours forces either a non-null assertion — which silences
the check without performing it — or an unreachable branch nothing can test. `String.prototype.slice` is
total, so `laneColour` has one path and no case a reader has to talk themselves out of.

## What the reference behaviour left open, and what this lane decided

The reference behaviour describes what a reader sees and stops. These it does not decide. Each is cheap to
change and none is a contract.

1. **A row is 24 pixels and the overscan is 4 rows.** The overscan buys a row entering the view being
   already written, and a scroll of up to four rows in one frame revealing nothing blank. Raising it raises
   the live-element budget of ADR-0002 decision 6 and is a commit that says why.
2. **The graph column is as wide as its page needs**, `2 × 12 + maxLane × 14`, clamped to 64…320 pixels, and
   settled once per page rather than per frame — columns have fixed widths in this slice. The floor is not
   about the graph, which needs 38 pixels for a one-lane page: at 48 the heading read `Gra…` in the window
   this lane looked at, so the floor is what lets `Graph` fit. Past the ceiling, about twenty lanes, the
   right-hand lanes are clipped by the canvas rather than squeezing every text column off the window; column
   resizing is E01-M02.
3. **The uncommitted row's vertex is hollow**, and its description is `Uncommitted changes (n)` where *n* is
   the changed files plus the untracked ones. An outline reads as a place where a commit is not yet. The
   wording is this lane's: the behaviour given to it says only that the row sits above every commit.
4. **The date is the author's date, in the author's own recorded offset from UTC**, spelled
   `YYYY-MM-DD HH:mm`. The author's offset rather than the machine's because it is the one the page carries,
   so the column is identical on every machine that opens the repository, which makes it reproducible in a
   test and in a screenshot. The format is fixed and locale-free rather than an `Intl` call, because E01-M02
   owns date formats and the way to hand it that decision is to leave exactly one spelling to change.
5. **The object name is abbreviated to 8 characters.**
6. **Only local branches, remote branches and tags get a label**, in that order, each in its row's lane
   colour: a solid box, a dashed box and a rounded one. A remote's symbolic `HEAD` and the stash's own
   reference point at commits too, and showing them would put `origin/HEAD` beside `origin/main` on one row
   and a `stash` label on an ordinary commit.
7. **`RefFlag.CheckedOut` is not drawn.** Distinguishing the checked-out branch is real, and the reference
   behaviour given to this lane does not ask for it; the HEAD tooltip is E01-M02, which is where it belongs
   with the rest of that question.
8. **The text columns are fixed at 132, 148 and 84 pixels** with the description taking the rest. Resizing,
   hiding and the header context menu are E01-M02.
9. **Rows carry no separator, stripe or hover state.** Nothing in the behaviour asks for one, and each is a
   decision about density that E01-M02's options are the place for.
10. **A redraw happens on a scroll, a resize, a new page and a pixel-ratio change, and on nothing else.**
11. **`vertexRowAt` exists and nothing calls it.** It is the arithmetic ADR-0002 decision 5 asks for —
    row from `y`, lane from the layout, one comparison — and the task names it as arithmetic to unit-test.
    Selection is E03 and tooltips are E01-M02, so it has no caller here; esbuild shakes it out of the
    production bundle, so it costs the size budget nothing. It is here because it is the recycling
    arithmetic read from the other direction: a vertex is drawn where it says it is, or one of the two is
    wrong.

## What S06 must connect

Three things, and their exact shapes.

```ts
// src/ui/graph-table
export function mountGraphTable(root: HTMLElement): GraphTableView;

export interface GraphTableView {
  readonly showPage: (page: GraphPage) => void;
  readonly onLoadMore: (listener: () => void) => void;
}
```

`renderer.ts` already calls `mountGraphTable(document.getElementById('app'))` at module scope and publishes
the result on **one namespaced global**, `window.gitGraphicalView`, as
`{ mount, showPage, onLoadMore }`. That global exists for the end-to-end driver, which has no other seam
into a bundle that runs at module scope; S06 composes in-process and should import `mountGraphTable`
directly rather than reach for it.

What S06 owns, and this slice does not:

- **Everything that loads.** `onLoadMore` fires when the control is clicked and that is the whole of it: the
  view holds no bridge, no channel and no loader. S06 registers a listener that calls
  `loadMoreCommits({ count })` over the preload bridge and hands the reply — which is the **whole page
  again**, grown, not a delta (`src/contracts/graph-page.ts`) — back to `showPage`.
- **The control's own state while a load is in flight.** The view neither disables the button nor shows
  progress; `hasMore` is the only thing that hides it.
- **The scroll position across a load.** Nothing needs doing: the spacer only grows, so the browser keeps
  the offset and the rows under the cursor do not move. `showPage` does not touch `scrollTop`.
- **The three flags `src/core/layout/` does not set** — `RowFlag.Head`, `RowFlag.Stash` and
  `RowFlag.Uncommitted` — and **prepending the uncommitted row itself**, which is not a commit and which the
  layout pass never sees. `test/e2e/graph-table.spec.ts` does that prepend in `withUncommittedRow`, and what
  it does there is what S06 has to do for real: shift every per-row column by one, give row 0 lane 0 with
  one `(0, 0)` segment, and set `Uncommitted | ClipAboveVertex` on it.
- **Holding one `LayoutState` for the life of the view** and passing it back on every page, which is S04's
  interface and not this one's.

## What it costs

| thing | cost | how it was measured |
| --- | --- | --- |
| live row elements | **39**, at 1 000 rows and at 10 000 alike, against a bound of 39 | `graph-table.spec.ts` counts `.row` elements in the built application at both page sizes, after scrolling through the larger one; the bound is `visibleRowCount(measured canvas height) + 2 × overscan` |
| redraws | **1 redraw in 1 frame** for a burst of 25 scroll events dispatched in one task | `clearRect` and `requestAnimationFrame` counted in the page, installed before `renderer.js` runs |
| an idle window | **no frame, no redraw and no timer registration** over two seconds | the same counters, read twice |
| drawing | **200 stroke calls** for the first page of a 96-row fixture | the same counters |
| `renderer.js` | see the audit for the current figure, against a budget of 12 288 | `npm run gates:size`, which weighs the production build |

The numbers in that table are a measurement with a date and a method, not a threshold. **S07 owns
`perf/baselines.json`**; this lane recommends the live-element count and the redraws-per-frame ratio as the
two counters to put in the gate, and did not add them.

## What this lane could not do

**The unit tests for `src/ui/` are not colocated with it, and cannot be.** `ui-only-contracts` in
`.dependency-cruiser.cjs` lets `src/ui/` name `src/contracts/` and `src/ui/` and nothing else, with **no
carve-out for a colocated test** of the kind `core/` and `contracts/` each acquired when they needed one. A
`src/ui/geometry.test.ts` that imports `vitest` therefore fails `gates:boundaries` — measured in this lane,
one error, planted and watched red and green — and that rule's file was outside this task's boundary.

So the pure tests live in `test/e2e/graph-geometry.spec.ts` and `test/e2e/graph-table.spec.ts`, on
Playwright's runner, against the same modules and with no browser anywhere near them. That works because
those modules hold no DOM reference, and it costs two things worth naming: they are outside `gates:unit`'s
coverage report, and they run in the slowest gate rather than the fastest. The repair is the same pair of
rules S08 needed for `contracts/` — a `pathNot: TEST_FILES` on `ui-only-contracts` and a
`ui-tests-only-the-runner` beside it — and it is raised in `AUDIT-S05-graph-table-renderer.md` rather than
made here.
