# E01-M01-S04 · The lane layout engine

What a reader of the code needs to know about `src/core/layout/`: the single forward pass that turns a page of
commits into the drawing instruction set for the graph column, the invariants it keeps, and every place where
the reference behaviour was silent and this lane decided.

## What exists now

Nothing a user sees has changed: the application still opens one window and says `No repository is open.`
Under `src/core/layout/` there is now the pass that answers "which lane is this commit in", which
`docs/ADR-0002-architecture-and-performance.md` decision 1 says is never answered in the renderer. It reads a
`CommitColumns` and produces a `LayoutRows`, both frozen in `src/contracts/`, and it reads nothing else: not a
repository, not a decoder, not a hash.

## The vocabulary

- A **lane** is a column of the graph, numbered from zero at the left.
- A **line** is the edge between a commit and one of its parents. It is born in the row of the child, runs down
  one lane, and ends in the row of the parent.
- A **segment** is one line's crossing of one row's band, as `segmentFromLane` (the lane it enters at the top
  edge), `segmentToLane` (the lane it leaves at the bottom edge) and `segmentColour`. A line that does not move
  across has equal from and to.
- A **vertex** is the commit's own dot, in the lane `laneIndex` names.
- A lane is **open** while a line is descending in it, and **free** otherwise.

## What later lanes call

| function | what it does |
| --- | --- |
| `createLayoutState()` | a state with no lane open, which is what a first page starts from |
| `layoutPage(state, columns, rowsAlreadyLaidOut)` | lays out `columns` from `rowsAlreadyLaidOut` to its end, advances `state` in place, and returns the new rows as `LayoutRows` |
| `layoutWork(state)` | the deterministic work counter, for a performance gate |
| `layoutStateByteLength(state)` | the bytes the state carries between pages |
| `colourOfLane(lane)` | the palette index a line born in `lane` carries |

`LayoutState` is the type S06 holds for the life of a view and passes back on every page. It is advanced in
place, the way the commit store's builder is, rather than returned as a new object, so that a page costs no
allocation for the state itself.

`rowsAlreadyLaidOut` is passed **as well as** being held in the state, and the two are checked against each
other. The way this interface is misused is by laying the same page out twice or by skipping one, and both of
those produce a graph that is quietly wrong rather than one that fails; the check turns them into a
`RangeError` at the call.

## The algorithm

One forward pass over the rows in the order they arrive. Per row, in this order:

1. **Cross.** Walk the open lanes, left to right. A lane whose line is not ending at this commit emits a
   straight segment. A lane whose line ends here emits a segment leaning into the vertex. The **leftmost** lane
   ending here is the vertex's lane.
2. **Place.** When no line ends here — a branch tip, or the first commit of a page — the vertex takes the
   **leftmost free lane** instead.
3. **Depart.** Walk the commit's parents. The **first drawable parent continues in the vertex's own lane**;
   every further one starts a line in the leftmost free lane, leaning out of the vertex. A parent is drawable
   when it is `UNKNOWN_INDEX`, or when its index is greater than the commit's own.
4. **Close.** Free every lane whose line ended at this commit. A lane taken by a departing line in step 3 no
   longer points at this row, so the same test leaves it alone and no list of arrivals is carried between the
   steps.

Steps 3 and 4 are in that order on purpose: a line born at this row never takes a lane a line died in at this
row, because the two would be drawn crossing inside one row's band, which reads as neither.

The row's `flags` are written from what steps 1 to 3 already looked at, not from a pass of their own: see
*Where a row's line begins and ends* below.

### Appending a page

The state is the open lanes and nothing else. A line whose parent was not loaded keeps its lane open and
remembers **which entry of `parentIndices`** named that parent. The store resolves that entry in place when the
commit finally arrives, and the parent columns are appended to and never rewritten, so the entry is still the
right one a page later. At the start of every call each waiting lane re-reads its entry; a lane that now has a
row closes at that row, and a lane that still does not keeps waiting.

That is the whole of what makes the pass incremental. **No row already emitted is read, recomputed or
rewritten**, and the cost of continuing is one walk of the open lanes per page, not per row.

### Invariants

- `laneIndex`, `colourIndex` and `flags` have `rowCount` entries; `segmentOffsets` has `rowCount + 1`, starts
  at 0 and is non-decreasing; the three segment columns have `segmentOffsets[rowCount]` entries. Verified by
  the contract's own shape and by the tests in this folder.
- A row's segments are, in order, the lines that already existed in lane order, then the lines born at this row
  in parent order. So a row can be drawn knowing only its own slice of the arrays.
- At most one segment per lane per row: a line arriving at the vertex and a line leaving it in the same lane
  are one segment, not two.
- Every lane a segment names is either the row's vertex lane or a lane open across that row, so `maxLane` is
  the width of the column.
- A row carries exactly one vertex, so `RowFlag.ClipAboveVertex` and `RowFlag.ClipBelowVertex` are properties
  of the row and need no lane of their own. They are about the vertex's lane only; a line crossing the row in
  another lane spans the whole band whatever they say.
- After any page, every lane still open holds a target the page did not reach, so it keeps descending and is
  closed by whichever later page contains that commit. The store's ordering makes that target `UNKNOWN_INDEX`
  in practice; a target naming a row already gone past behaves the same way, and the lane descends for the rest
  of the view.

## The decisions this lane made

The reference behaviour describes what a reader sees and stops there. These five it does not decide.

### 1 · A new line takes the leftmost free lane

**Alternative rejected:** the next lane to the right of everything in use, never reusing.

Reuse is the whole reason a graph stays narrow; without it the column grows by one for every branch ever
created in the loaded history. Measured on this lane's own synthetic braided history — a mainline with a branch
every ninth commit and merges resolving within forty rows — the graph is **seven lanes wide at ten thousand,
forty thousand and one hundred and sixty thousand commits alike** (`maxLane` 6, measured by running the pass
over shapes built by the generator described under *What was measured* below). Without reuse the same shape
would open one lane per branch, which is one every ninth row.

**Cost to change:** one line of `firstFreeLane`. Nothing else depends on which lane is chosen.

### 2 · A merge's further parents take the leftmost free lane too, and only lanes free before the row

**Alternative rejected:** allowing a lane freed earlier in the same row to be taken.

Allowing it draws a dying line and a newborn line crossing inside one row's band, in the same lane, which
reads as neither of them. Deferring the reuse by one row costs at most one extra lane of width for one row.

A consequence worth naming: when a hole exists to the **left** of a merge's vertex, the second parent's line is
drawn leaning left across the lanes between. The alternative — taking the nearest free lane to the right — keeps
that diagonal short but never fills holes on the left, so the graph accumulates them and grows wider. Narrowness
was judged the property a reader needs more. **Cost to change:** the same one line as decision 1.

### 3 · The vertex sits in the leftmost lane that ends at it

**Alternative rejected:** the lane of the first child to have been laid out.

The two differ only when a commit has several children. Leftmost keeps the mainline — which, being the first
line opened, is the leftmost — running straight down the view, and makes the other children's lines converge
into it, which is what the reference behaviour calls a branch. **Cost to change:** one comparison in
`crossOpenLanes`; the segments would still be emitted in lane order.

### 4 · A line's colour is the lane it was born in

**Alternative rejected:** a counter that hands out a fresh colour to every line.

`colourIndex` is an index into a palette this ring does not define and must not define, so the only question is
what the index is a function of. Making it the lane guarantees that two lines running side by side never share
an index, which is the property a reader actually needs; a counter can hand adjacent lanes two indices that the
renderer's modulo maps to the same colour. The consequence is that a lane reused later carries the same index
as the line before it, separated vertically by the row where the first one ended.

The index is the lane's low eight bits, because `LayoutRows.colourIndex` is a `Uint8Array`. That is the
contract's range, not a palette size: a graph wider than 256 lanes cycles, and the renderer takes this index
modulo however many colours it has.

Note that the colour is **not** derivable from the two lane columns: a line born at a merge moves from the
vertex lane to its own, and carries its own lane's colour, which is the `to` end; a line dying at a vertex
carries the `from` end. The third column earns its place.

**Cost to change:** `colourOfLane` is one function and one call site per segment. A per-line colour would add
one `Uint8Array` to the state, one byte per open lane.

### 5 · A parent whose index is not greater than its child's is not drawn

Git emits children before parents, so a parent index below its child's is the unusual case; the segment
vocabulary has no line that goes **up** a row, so such a line cannot be drawn at all. It is still a parent, so
it is still counted for the merge flag. This is the one place where the pass drops information rather than
drawing it, and it is recorded here because it is invisible from the output.

**Cost to change:** it cannot be changed inside this contract. Drawing an upward line needs a segment
vocabulary that has one.

## Where a row's line begins and ends

`LayoutRows` models a segment as spanning a whole row band, from the top edge to the bottom edge. A commit that
is the **start of its line** — a branch tip, with no child among the loaded rows — and a commit that is the
**end of it** — a root, with no parent — each occupy only half of their band, and the segment cannot say which
half: a tip's departure and a root's arrival are both spelled `(V, V)` in the vertex's own lane.

So the row says it instead, in two bits of `LayoutRows.flags` this pass sets:

| bit | set when | what the painter does |
| --- | --- | --- |
| `RowFlag.ClipAboveVertex` | the vertex took a **free** lane, so no loaded row above names this commit as a parent | paints nothing in the upper half of the band, in the vertex's lane only |
| `RowFlag.ClipBelowVertex` | the commit has **no parent entry at all**, `parentOffsets[row + 1] === parentOffsets[row]` | paints nothing in the lower half of the same lane |

Neither costs a second pass over the rows, which
`docs/ADR-0002-architecture-and-performance.md` decision 4 does not allow. The upper bit falls out of the walk
of the lane table the crossing already does — a vertex placed in a free lane is a vertex nothing was descending
towards — and the lower one out of the parent offsets the departures already read. It is also **final on any
page**: git emits children before parents, so a commit whose children are all absent from the rows loaded so
far cannot acquire one from a page that arrives later, and a row's flags are never rewritten once emitted.

**The lower bit reads the parent count and never a parent value, and that is the guarantee.** A commit with a
parent still spelled `UNKNOWN_INDEX` has a parent that exists and is not loaded, so its line leaves the bottom
of the page and continues into the page below: it must **not** be clipped. Reading "no *loaded* parent" instead
is one comparison away, is invisible on any single page, and is wrong on every page but the last — it would clip
the foot of every page of every repository with more commits than a page. `lane-layout.test.ts` asserts the pair
under *a page boundary, which is not a root*: the two pages are identical in `rowCount`, `laneIndex`,
`colourIndex`, `segmentOffsets` and every segment column, and differ in `flags` alone.

### The gap this replaced, and what it cost

The vocabulary did not always have these two bits, and while it did not, every `flags` entry of a tip-and-root
page was `0`. **This lane found that** by rendering the layout to text and reading it, not by a test: it
reported rows 3 and 20 of its braided sample showing the stub above a tip, and the root of the seven-row
fixture in `lane-layout-pages.test.ts` showing the one below a root. Emitting nothing instead of the stub
replaces it with a half-row **gap** between the dot and the line, which is worse, and emitting the arrival and
the departure as two segments does not help, because both are spelled `(V, V)`.

It raised the gap in `AUDIT-S04-lane-layout.md` and emitted the stub rather than inventing a channel for it,
because `src/contracts/` was outside its boundary and was being edited by another lane of the same wave. The
gap then cost a review finding and a repair lane before the renderer could be specified at all, and that
review added the half of it this note had missed: that a true root and a page whose last commit has an
unloaded parent are **byte-identical** in the output. The lesson for the next person choosing a vocabulary is
that *"a segment spans a band"* was one case short of complete, and that the missing case was invisible from
any single page of output — which is why a renderer would have been written against it before anyone noticed.

## What this lane does not set

`RowFlag.Merge` is set here, from the parent count, and so are `RowFlag.ClipAboveVertex` and
`RowFlag.ClipBelowVertex`. `RowFlag.Stash`, `RowFlag.Head` and `RowFlag.Uncommitted`
are not, because this ring is not told which commit `HEAD` resolves to, which rows are stash entries, or
whether the working tree is dirty. They belong to the caller that reads `Refs` and `WorkingTree` — S06 — which
sets `Head` on the row whose hash matches, `Stash` on the rows it appended from the stash list, and
`Uncommitted` on the row it prepends when the tree is dirty. Prepending that row is also the caller's: it is
not a commit, this pass never sees it, and `LayoutRows` puts it at row 0 by the contract's own invariant.

## What it costs

| thing | cost | how it was measured |
| --- | --- | --- |
| the state carried between pages | **8 bytes per lane** the graph has ever been wide, two `Uint32Array` columns, plus at most a quarter of slack | read off the two column lengths by `layoutStateByteLength`, asserted in `lane-layout-pages.test.ts` |
| a row | one walk of the open lanes for the crossing, one for the closing, one lane search per line born, and one segment per occupied lane | counted by the `laneVisits` and `segments` counters |
| continuing a page | one walk of the open lanes | counted by the same counter |

Nothing is proportional to the number of rows already loaded. The state of a 160 000-commit braided history was
**64 bytes** — the initial eight lanes, never grown — and the same 64 bytes after 10 000 commits.

### What was measured

A deterministic generator built each shape: for row *i*, a first parent at *i + 1 + r* for *r* in 0…2, and for
every ninth row a second parent at *i + 1 + r* for *r* in 0…39, from a fixed linear congruential sequence, with
parents past the end of the page left as `UNKNOWN_INDEX`. Measured on the development machine with Node 24.18.0,
by running the bundled module outside the test harness, after one warm-up pass, four times:

| shape | rows | work per row | segments per row | widest lane | commits per second |
| --- | --- | --- | --- | --- | --- |
| straight chain | 10 000 | 4.9999 | 1.0000 | 0 | 18 556 318 |
| straight chain | 40 000 | 5.0000 | 1.0000 | 0 | 11 806 375 |
| braided | 10 000 | 17.0621 | 4.2400 | 6 | 4 735 970 |
| braided | 40 000 | 17.1784 | 4.2759 | 6 | 3 107 086 to 3 714 986 |
| braided | 160 000 | 17.1958 | 4.2818 | 6 | 4 394 276 to 5 088 524 |

Four times the rows cost **4.0001** times the work on the chain and **4.0273** times on the braided shape. The
counters are identical on every run, which is why they are the claim; the wall clock for the same 40 000 rows
moved by 20 per cent across the four runs, and by a factor of two against a run taken earlier in the session,
so the ranges above are what it honestly carries. The budget of
`docs/ADR-0002-architecture-and-performance.md` decision 6 is 200 000 commits per second, and the slowest
figure measured for the braided shape is fifteen times that.

The counter is `layoutWork`, the sum of rows, parent entries read, lane slots inspected and segments emitted:
it is the right one because every one of those is a thing the pass does per unit of input, it is identical on
every machine, and a pass that had become quadratic in the rows would show it as a ratio far from four however
fast the machine was that day. **S07 owns `perf/baselines.json`**; this lane recommends `workPerRow` on a
braided shape as the counter to put in the gate, and did not add it.

Laying the braided 40 000 out in eight pages instead of one produced **every one of the seven arrays identical,
entry by entry**, and the same `maxLane`; the only difference was 31 more lane visits, which is the
seven extra per-page walks of the open lanes.

## Reading one

The seven-row fixture in `lane-layout-pages.test.ts` asserts the layout drawn as text, three lines to a row, so
that the shape is in the diff a reviewer reads rather than only in a number. It draws one branch leaving a merge
at row 0, running in lane one for three rows, and rejoining at the commit both sides share in row 5. The forty
rows of the braided sample were drawn and read the same way; they show a mainline in lane zero, branches opening
and closing in lanes one to six, merges marked, and lanes being reused after the line in them ends.
