# E01-M01-S06 · Opening a repository

What a reader of the code needs to know about the slice that joined the four pieces: which process holds
what, what crosses each boundary, how big a page is, how a further one is read and what it costs, and the
two places where this lane had to choose and could be wrong.

## What exists now

The window no longer says `No repository is open.` unless it has nothing to show. Started with a folder —
`npm start -- <path>`, or the path as the application's own argument — it opens that repository and draws
its commit graph: the first page of commits newest first, the reference labels, the uncommitted-changes row
when the working tree is dirty, and the commit at `HEAD` marked. **Load More Commits** appends the next
page. **Refresh** re-reads the repository. When git cannot be found, when the folder is not a repository or
when git fails, the window says which in plain words and shows git's own message underneath, and the Open
Repository control stays where it is so another folder can be chosen.

It was run against this repository and looked at, at 1280 × 800, on 2026-09-19, when this repository had
**112 commits** — a number that is wrong by the next merge and is written down because it is what the
readings below are of. The rows matched `git log --graph --branches --tags --remotes --date-order` line for
line over the whole of them:
the seven commits of this lane straight down lane 0, then the merge at `0ccbd45` opening a second line in
lane 1 that ran the seven commits of E01-M01-S05 and rejoined at `e7c5fce`, then the merge at `74cf434`
doing the same over three commits and rejoining at `eb21c9a`. The lane branch's label sat on the tip in a
solid box and `dev` on `ccdec244` seven rows down, which is where `git branch -v` puts them. The
abbreviated object names were the first eight hex digits of the ones `git log --format=%H` printed, in the
same order. With fewer commits than a page of 300 the Load More control was correctly hidden. A file written
into the working tree and a press of Refresh put `Uncommitted changes (1)` at the top with a hollow dot and
its line descending into the tip; deleting the file and pressing Refresh again took it away and put the tip
back on row 0. That is an observation on this machine at this size on 2026-09-19, not a frame-time
measurement; the budgets are S07's.

## The process model, and what crosses each boundary

`docs/ADR-0002-architecture-and-performance.md` decision 2, made real. Three processes and one more bundle
than before.

| process | bundle | owns |
| --- | --- | --- |
| **main** | `dist/main.cjs` | the window, the lifecycle, the folder dialog, the startup path, and the IPC handlers |
| **utility** | `dist/repository.cjs` | the `RepositoryReader`, the commit store, one `LayoutState`, and the page assembly |
| **renderer** | `dist/renderer.js` | the table, the graph canvas, the control bar and the failure view |

```
renderer  --preload bridge, allow-listed channels-->  main  --utilityProcess message port-->  utility
                                                                                                |
                                                                             git, five processes per page
```

- **The renderer never talks to the utility process** and does not know it exists. It calls one of six
  methods on the bridge, each of which is one channel of `src/contracts/ipc.ts`.
- **The main process forwards.** `src/app/handlers.ts` answers `startupRepository` from a string it read
  off the command line at startup, answers `chooseFolder` with a dialog only a process that owns a window
  can show, and hands the other four to the utility process. It starts no git process, parses nothing and
  lays out nothing.
- **The utility process is started on the first request and stopped with the last window.**
  `src/app/repository-client.ts` forks it lazily, correlates replies to requests by an integer, and fails
  every outstanding request when the process ends, so a control is never disabled for ever. **Every request
  settles**, and that is the property the client is written around rather than a hope: the death of the
  process is an answer like any other, the promise that waits for it to start is resolved by a spawn *or*
  an exit, and the next request after a death starts a new process — which is also what makes a crash
  recoverable without a restart. Driven with the bundle deliberately missing, the window showed the failure
  view in half a second and kept its Open Repository control. `src/app/main.ts` stops the process on
  `window-all-closed` and again on `before-quit` — two events, neither implying the other, and a utility
  process outliving its window is this slice's characteristic leak.

**What crosses, and in what form.** A `GraphPage` crosses twice, once by `MessagePort` from the utility
process to main and once by `ipcRenderer.invoke` from main to the renderer. Both are structured clones, and
what is cloned is the columnar blocks of `src/contracts/` — nine typed arrays of layout, six of commits,
three of references, two interned string arrays and two string blobs. **No array of objects crosses either
boundary**, which is what decision 2 asks for. The buffers are cloned rather than transferred: transferring
would detach them in the utility process, which is the process that has to keep them to append to.

## The page assembly, in `src/core/page/`

This is what later milestones extend when they add rows or flags, so its shape is written out here.

```ts
export interface RowBlock {
  rowCount: number;      // commit rows accumulated; the uncommitted row is not one
  segmentCount: number;  // which is segmentOffsets[rowCount]
  maxLane: number;
  headRow: number;       // the row carrying RowFlag.Head, or NO_HEAD_ROW
  laneIndex: Uint16Array;      colourIndex: Uint8Array;     flags: Uint8Array;
  segmentOffsets: Uint32Array;
  segmentFromLane: Uint16Array; segmentToLane: Uint16Array; segmentColour: Uint8Array;
}

export const NO_HEAD_ROW: -1;
export const FIRST_PAGE_COMMITS: 300;
export const FURTHER_PAGE_COMMITS: 300;

export function createRowBlock(): RowBlock;
export function appendRows(block: RowBlock, rows: LayoutRows): void;
export function markHeadRow(block: RowBlock, row: number): void;
export function layoutRowsOf(block: RowBlock, withUncommittedRow: boolean): LayoutRows;
export function graphPageOf(block: RowBlock, read: RepositoryPage): GraphPage;
export function addPage(block: RowBlock, rows: LayoutRows, read: RepositoryPage): GraphPage;
```

It is in `core/` and not in the wiring because it holds three decisions, each of which can be wrong.

**One growing block, appended and never recomputed.** `layoutPage` returns the rows of the new commits
only, so something has to hold the accumulation; this does, in nine columns that grow by five quarters —
the ratio `src/core/store/growth.ts` argues for, repeated here because the store's helpers are deliberately
not re-exported and `src/core/store/` was outside this lane's boundary. The only entry that is not a
straight copy is `segmentOffsets`, whose values are absolute over the block and so are written on with the
segments already held added to them. A block starts empty and the first append grows it to fit that append,
so a five-commit repository costs five rows rather than a page's worth.

**`RowFlag.Head` is written into the block, not onto the page.** The row HEAD names is almost always in the
prefix, and a page is produced from the block without touching the rows in it, so the bit has to go where
the rows live. `markHeadRow` clears the row it marked last and marks the new one, which costs two writes
however many rows are loaded, and an index outside the rows loaded — `UNKNOWN_INDEX`, or a HEAD below the
page — leaves the block with no head row at all.

**The uncommitted row is put on when the page is produced.** It is not a commit, `src/core/layout/` never
sees it, and `src/contracts/graph-page.ts` fixes it at row 0 — so holding it inside the block would make
every later page shift every row already laid out. `layoutRowsOf` builds the shifted copy instead: row 0
gets lane 0, colour 0, one `(0, 0)` segment and the flags `Uncommitted | ClipAboveVertex`, and every other
per-row and per-segment entry moves along by one. It is exactly what `test/e2e/graph-table.spec.ts` does by
hand in `withUncommittedRow`.

**What that shift costs, and why it is paid there.** It is one copy of the block's nine columns per load:
**eight bytes a row** — two for the lane, one for the colour, one for the flags and four for the row's
segment offset — and **five a segment**. The 10 000-commit fixture is a straight chain, so its layout emits
about one segment a row, and S04 measured 4.28 a row on its braided shape; a 10 000-commit page therefore
copies between 130 KB and 295 KB. The page is copied
twice more anyway by the two structured clones above, so this is one more copy of the same order on a path
that runs **once per load and never once per frame**. What it buys is that appending stays a pure append,
which is a cost per *new* row rather than per *loaded* row, and that is the one thing decision 4 does not
allow to slip. The copy is paid on a clean working tree too, because the block's columns are geometrically
grown and therefore longer than the rows in them, and shipping a quarter of slack across two process
boundaries would be the worse copy of the two.

## The page sizes

Both are 300, in `src/core/page/page-sizes.ts`, which is the only place either number is written on the
producing side.

- **The first page is sized against the window.** The frame opens at 1280 × 800 (`src/app/window.ts`) and a
  row is 24 pixels (`src/ui/geometry.ts`), so the table shows about 31 rows; 300 is nearly ten screenfuls,
  which is what makes the first screen full with somewhere to scroll rather than an immediate request for
  more. `page-sizes.test.ts` holds the constant above that bound rather than at 300, so the assertion
  survives the decision moving and fails if it is lost.
- **The further page is sized against what a press costs**, which is the next section. Equal to the first is
  the size at which the *n*th press reads *n + 1* pages.

Making them settings is E02-M03. The way to hand that milestone the decision was to leave exactly one
spelling of each to change, and there is one — with one exception, which is the next heading but one.

## How a further page is read, and what it costs

`RepositoryReader.readPage` takes a page size and no offset (`src/ports/repository-reader.ts`), so **Load
More asks for the whole page again, larger**: `pageSize` becomes the rows already laid out plus the count
asked for. The alternative is to teach `src/adapters/` to skip, which was outside this lane's boundary and
is reported in `AUDIT-S06-open-a-repository.md` rather than built.

**The layout stays incremental anyway, and that is the part worth understanding.** A re-read produces a
fresh `CommitColumns`, but its prefix is the same commits in the same order, with the parents that were
`UNKNOWN_INDEX` now resolved to the rows the larger page reached. That is exactly the shape `layoutPage`
expects of an appended page: a lane left open for an unloaded parent remembers *which entry of
`parentIndices`* it is waiting on and re-reads that entry at the start of the next call (S04's slice
document, *Appending a page*). So a press lays out only its new rows and `src/core/page/` appends only
those rows, however the commits arrived. `src/core/page/row-block.test.ts` states that as a property: the
same braided history laid out in one piece and in two halves produces a block whose seven columns are equal
entry for entry, and the first half's entries are the ones the whole page has in those positions.

**What it costs, measured.** `test/e2e/open-repository.spec.ts` presses Load More five times over the
bridge on the 10 000-commit fixture, 300 commits a press, timing each round trip with `performance.now()`
in the page and drawing each reply. Four runs on the development machine, 2026-09-19:

| press | commits read | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- | --- |
| 1st | 600 | 551 | 500 | 451 | 492 |
| 2nd | 900 | 439 | 489 | 422 | 583 |
| 3rd | 1 200 | 409 | 481 | 598 | 457 |
| 4th | 1 500 | 585 | 492 | 427 | 429 |
| 5th | 1 800 | 554 | 652 | 420 | 438 |

The fifth press reads three times as many commits as the first and did not cost measurably more on these
readings. The bound that explains it comes from the same suite: **9 700 commits read, parsed, stored, laid
out, appended and cloned across two process boundaries in 822, 834, 889 and 954 ms** over the same four
runs, so the commits themselves cost about a tenth of a millisecond each. The growth that predicts between
the first press and the fifth — about 110 ms — is inside the spread of these readings, which neither show it
nor exclude it. What is left is the part that does not scale with the page: five git processes per read
(`src/adapters/git-page.ts`), two structured clones, and the frame. **That is an inference from the two
measurements and not a third measurement.**

**Where it stops being acceptable is a fact about presses, not about commits.** The *n*th press reads
*n + 1* pages, so the total work over *n* presses is quadratic in *n* while each press stays linear in what
is loaded. At the sizes this milestone is about — tens of pages — the fixed cost dominates and the numbers
above are what a user meets. At a hundred presses it would not be, and the repair is an adapter that can
skip, which is the finding this lane raised rather than built.

## The one number that is written twice

`LoadMoreCommitsRequest.count` is a field of the request the **renderer** sends, and `ui-only-contracts` in
`.dependency-cruiser.cjs` lets `src/ui/` name `src/contracts/` and nothing else. So the renderer cannot
import `FURTHER_PAGE_COMMITS`, and weakening that rule would open `src/core/` to the renderer for the sake
of one integer. `src/ui/renderer.ts` therefore holds `LOAD_MORE_COMMITS`, and the comment at it says all of
this.

What keeps the two from drifting is a gate rather than that comment: `test/e2e/open-repository.spec.ts`
imports `FIRST_PAGE_COMMITS` and `FURTHER_PAGE_COMMITS` from `src/core/page/`, opens the 10 000-commit
fixture, presses Load More once and requires the page to have grown to exactly their sum. A renderer asking
for a different number fails that case with the two numbers in the message.

## The startup channel

The bridge had no way to say what the application was started with. One channel, and nothing else:

```ts
CHANNELS.startupRepository === 'repository:startup'

interface StartupRepository { readonly path: string | null }
type StartupRepositoryResponse = Result<StartupRepository>

bridge.startupRepository(): Promise<StartupRepositoryResponse>
```

It is a reply rather than a push because the renderer decides when it is ready to draw, and a message sent
before the document loads is a message nobody received. `path` is `null` when no folder was named, which is
the empty state and not a failure.

**Reading it off the command line is the part that is easy to get wrong.** An unpackaged run is
`electron <app> <arguments…>` and a packaged one is `<app> <arguments…>`, so the first argument of the
user's own is at index 2 in one case and index 1 in the other; anything beginning with `-` is a switch and
never a path. Getting it wrong is invisible in a packaged build and opens `.` as a repository in every
development run — which `test/e2e/window.spec.ts` catches without being edited, because it launches with
`['.']` and requires the empty state.

`npm start` swallowed the argument for a different reason: `run-s build start:electron` reads whatever npm
appends as another script name to run. It is now one command, so the path npm appends lands on `electron`.

## What the renderer holds, and what it still does not

A control bar with the repository's path, **Open Repository** and **Refresh**; a stage the table is mounted
into; and a failure view that shows `Failure.message` — git's own words — under a sentence chosen from
`Failure.kind`. `src/ui/status-text.ts` is that mapping and holds no DOM at all, which is what lets
`src/ui/status-text.test.ts` sit beside it.

**The renderer holds no rule.** It does not decide what a page is, which lane a commit is in or which row
HEAD is; it asks, and draws what it is given. The one thing it decides about `RowFlag.Head` is what the
mark *looks like*: `src/ui/graph-canvas.ts` draws a ring two pixels outside that row's dot, in the row's own
lane colour. The reference behaviour says the commit at `HEAD` is marked and says nothing about how; a ring
says *this one* without saying anything about what kind of commit it is, and it is inside half a lane's
width, so it can never reach a neighbouring line. While a request is in flight the control that started it is
disabled and says what it is doing — `Opening…`, `Refreshing…`, `Loading…` — and is restored in a `finally`,
so a failed request leaves a usable control rather than a dead one. Nothing polls and no timer is
registered: every request starts from the document loading, a click, or the view's Load More intent.

A dismissed folder chooser is `FailureKind.Cancelled` and shows nothing at all, because
`src/contracts/result.ts` calls dismissal an outcome rather than an error.

**A missing git is re-checked rather than remembered**, and that is the adapter's doing and not this lane's:
`createGitRepositoryReader` memoises discovery on success and clears it on failure, so a user who installs
git while the window is open gets a repository on the next attempt.

## The rule that let a renderer test come home

`ui-only-contracts` had no carve-out for a test file beside the renderer, which is why S05's pure tests live
in `test/e2e/` on Playwright's runner, outside the coverage report and inside the slowest gate. This lane
added the pair `src/contracts/` and `src/core/` each already had: `pathNot: TEST_FILES` on
`ui-only-contracts`, and `ui-tests-only-the-runner` beside it, so a renderer test may name the renderer, the
contract and `vitest` and nothing else. Both directions were probed and watched red and green; the audit
records all four steps. Moving S05's two suites is scheduled separately and is not this lane's.

## What S07 should measure

This lane measured what it needed to argue its own decisions and deliberately landed no baseline
(`perf/baselines.json` is S07's). What it leaves:

1. **Cold start to a painted window with a repository on the command line.** ADR-0002 decision 6 budgets
   1500 ms for an empty one; this is the path a user actually starts on and nothing has timed it.
2. **10 000 commits to rows painted**, against the 800 ms budget. The nearest reading this lane has is the
   bridge round trip for 9 700 commits — 822 to 954 ms over four runs — which does not include the paint and
   is already at the budget. Measure it as one page rather than as a load-more, by opening a repository with
   `FIRST_PAGE_COMMITS` set to 10 000.
3. **The per-press cost as a function of pages already loaded.** It is the one quantity this design makes
   grow, the table above is four runs at five presses, and a counter rather than a stopwatch would make it
   a ratio that a busy machine cannot move.
4. **Resident memory of all three processes at 50 000 commits, and after the window closes.** The claim that
   ending the utility process gives the memory back is the reason it exists and is untested here.
5. **Idle cost with a repository open.** There is no timer in `src/ui/` and none in `src/app/`, and nothing
   has watched a window that has drawn a page do nothing for five minutes.

**How to drive a load of a given size from a test.** The window publishes nothing that loads; the bridge
does. From the page, `window.gitGraphical.openRepository({ path })` returns the first page and
`window.gitGraphical.loadMoreCommits({ count })` returns the whole page again, grown — both as
`Result<GraphPage>`, both answered by the utility process. `window.gitGraphicalView.showPage(page)` draws
one without asking for it. `test/e2e/open-repository.spec.ts` does all three, and its `fixture()` builds a
repository of any shape the committed generator knows into a directory of its own.

## What is not here

- **Stash rows.** `RowFlag.Stash` is not set and no stash row is added; that is E01-M02.
- **Settings, recent repositories, the repository dropdown, auto-refresh, keyboard shortcuts.**
- **An adapter that can read a page at an offset**, which is what would make a press cost its own page
  rather than everything before it. Raised in the audit; `src/adapters/` was outside this boundary.
- **A check that the prefix a re-read returns is the prefix the block was built from.** A commit made
  between a press and the press before it moves the log, and the append would then be an append onto rows
  that have shifted. Refresh is the remedy and it is one click; the finding is in the audit with what it
  would cost to close.
- **`perf/baselines.json`.** Measured and reported above; S07 lands the baselines.
