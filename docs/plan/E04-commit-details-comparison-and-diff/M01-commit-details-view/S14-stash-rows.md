# E04-M01-S14 · Stash rows

**Parent:** E04 Commit details, comparison and diff > E04-M01 Commit Details View > E04-M01-S14 stash rows

Every entry of `git stash list` is now a row of the graph, placed by its date among the commits and joined by
one line to the commit it was made on, drawn as a ring with a small disc and labelled with a two-part chip. The
commit a stash was made on is a row even when no branch reaches it. The uncommitted row's line now runs grey
from its ring into HEAD's dot, past any row between them, which closes review round 06's C-25. A stash's details
list its untracked files after its own changes. And the page's log is read with `--date-order`, so no commit is
listed before any of its children (scope 10, added to the task while it ran).

## How the page learns of the stashes

**The stash list is read first, and the stashes are put in; they are never walked.** A page is still five git
processes: the probe, `git stash list`, `git log`, `git for-each-ref` and `git status`, in that order. Before
this slice the stash list was read last, after the references, and pointed each stash's reference at the commit
it was made on.

- **The log is given each stash's first parent as a further tip**, on every branch, after `HEAD`
  (`commitLogArgs` of `src/adapters/git-commands.ts`, from `stashBaseNames` of `src/core/parse/stash-list.ts`).
  So a commit only a stash reaches, such as *on gone* on the fixture, is read and joined to its own parents like
  any commit. The names are forty hexadecimal digits written from git's own output, so none can be read as an
  option. A commit that is in the graph anyway is not read twice, because git walks it once.
- **The stash itself is put into the log's stream**, by `interleaveStashes`. It is read from the stash list with
  the fields of a log record, with its first parent as its only parent, so the index commit and the
  untracked-files commit git makes for a stash are never read: they are never a row and never a line. A stash
  goes in before the first commit older than it by commit date, which is where the log's `--date-order` would
  take it had it been given the stash itself, and in any case before the commit it was made on.
- **Why not give the log the stashes themselves.** It would walk their index and untracked-files commits, and
  each would have to be recognised and dropped from the stream, with the page's count of commits then counting
  rows that are never shown. `--all` is the same with more: on the `stash` fixture it walks four commits where the
  page has three rows (`git-commands.ts`'s comment, now amended).
- **The stash's own reference** points at the stash row since this slice, so `RefKind.Stash`'s
  `commitIndex` is the stash row and the label sits on it. `RowFlag.Stash` is put on those rows by
  `markStashRows` of `src/core/page/row-block.ts`, when a page is added, as `RowFlag.Head` is.
- **The stash's name is its place.** `%gd`, which named it before, printed `stash@{1700000240 +0000}` instead of
  `stash@{0}` once the list was read with `--date=raw` (git 2.51.0, on the `stashes` fixture), because git prints
  a reflog selector in the date format it is given. The list has to be read with raw dates like the log, so the
  name is taken from the entry's place in the list, which is what the number in `stash@{n}` is; an entry skipped
  for having no parent keeps its number.

**Paging.** A page's size counts its rows, stashes among them, so a Load More reads the same prefix larger and
continues the block as before (`git-stash.spec.ts` reads a page of two rows and then of four, and the first is
the second's prefix). A stash pushed or dropped between two reads changes the prefix's object names, and the
reading is laid out whole.

**Under a branch selection** the stashes' first parents are not given to the log, because that would read the
history of a commit the selection did not choose. So whether a stash's commit will be read is known only when it
arrives in the log's stream. **A selection shows a stash exactly when it reads the commit the stash was made on,
and shows it directly above that commit; a stash whose base no selected branch reaches is not shown, and neither
is its base.** That is the rule `shownWorkingTree` already applies to the uncommitted row, shown under a
selection only when HEAD's commit is among the commits read. On every branch the same stash is placed by its date,
and the two places differ only where a selected branch has a commit dated between the stash and its base; placing
it by date under a selection would need the rows after its place held back until its base arrived or the page
ended, which the store's append-only columns do not allow. `git-stash.spec.ts` holds both halves on the fixture
under the selection `main`.

## One mechanism for a row the page adds

The task asked for one mechanism for the stash's line to its base and the uncommitted row's line to HEAD, where
they share the problem. The problem they share is that the layout must know of the join: a row it does not know
is joined from above is a tip, with `ClipAboveVertex`, and nothing above it keeps a lane for the line. Review
round 06's probe R2 showed that clearing the bit in the painter instead draws a line above every tip.

- **A stash** is a commit of the page whose one parent is its base, so the layout lays out its line as it lays
  out any commit's: its ring takes a free lane, its line arrives at the base's row, and the base's row is not a
  tip. Nothing in `src/core/layout/` knows what a stash is.
- **The uncommitted row** is not a commit, and its row is still put on when the page is produced
  (`layoutRowsOf`). Its line is opened in the layout before the first commit, by `openUncommittedLine` of
  `src/core/layout/lane-layout.ts`: a line in lane 0 aimed at HEAD's row, so every row between keeps out of
  lane 0 and HEAD's vertex is in it. Each row it crosses carries a straight segment in lane 0 coloured
  `UNCOMMITTED_COLOUR`. At HEAD's row it emits no arriving segment; HEAD's row carries the new
  `RowFlag.UncommittedAbove`, and the painter paints the half band above HEAD's dot grey from that bit
  (`uncommittedArrival` of `src/ui/geometry.ts`). HEAD's row keeps `ClipAboveVertex`, because HEAD's own line,
  in its lane's colour, starts at its dot, as the reference was seen to draw it.
- **Who opens the line.** `layoutReading` of `src/core/page/graph-page.ts` opens it when the block is empty and
  the reading shows the uncommitted row with HEAD's commit loaded, and records the row in
  `RowBlock.uncommittedHead`. `continuesReading` appends a further reading only when it would draw the same line:
  a tree made clean or dirty, a HEAD moved, or HEAD's commit reached for the first time lays the reading out whole.
  `src/app/repository-host.ts` calls the two instead of `layoutPage` and `continuesBlock`; that file's boundary is
  "only where scope 1 needs it", and scope 1 needs it because the stash's lane is item 3's: `stash@{0}` sat in
  lane 1 beside the uncommitted line, which only a layout told of that line can place.
- **A HEAD whose commit is not loaded gets no line.** `WorkingTree.headCommitIndex` is `UNKNOWN_INDEX` for a HEAD
  past the page and for an unborn branch alike, and a line laid out towards the first would run down every page of
  the second. So the ring is drawn alone, with `ClipBelowVertex`, until a Load More reaches HEAD's commit, and that
  reading is laid out again. That is this lane's choice; the reference was not observed with HEAD past a page.
- **What it changed for ordinary commits**, which the task allows where a new row forces it. With a dirty working
  tree, lane 0 is held from the top down to HEAD's row, so a commit above HEAD that sat in lane 0 now sits in
  another lane, and HEAD's vertex is always in lane 0. With a clean tree nothing changed: the perf gate's layout
  readings, under *Gates*, are on clean histories. `ClipAboveVertex`'s definition moved from "no loaded row above
  names this commit" to "no line from a commit above arrives in the vertex's own lane"; the two differ on HEAD's
  row only, when a child above HEAD arrives in another lane beside the uncommitted line (`src/contracts/layout.ts`
  says so).
- **A colour index of its own.** `UNCOMMITTED_COLOUR` is 255, and `colourOfLane` now takes a lane's low seven
  bits rather than its low eight, so no lane shares it. The two differ for a lane of 128 or more only, and the
  320-pixel column draws no lane above 21 (12 + 21 × 14 is 306). The first version took the lane modulo 255, which
  changed nothing below lane 255, and it slowed the layout: the timed layout benchmark
  (`perf/layout.timed.perf.test.ts`) read 0.70, 0.81 and 0.72 microseconds a commit at this lane's head against
  0.58, 0.586 and 0.619 at the base, interleaved on 2026-11-09 at 12 to 40 % load before each run; with the old eight-bit mask in a scratch copy it read 0.585 to 0.61. With the seven-bit mask, at
  this lane's head, four runs interleaved with four at the base read 0.57 to 0.613 against 0.569 to 0.685, at 13 to
  54 % load before each run.

## The drawing

- **A stash's vertex** is a ring of radius 3.5, the commit dot's, stroked in its lane's colour, with a filled disc
  of radius 3.5 / 3 at its centre: a third of the ring's width across (`paintVertex` of `src/ui/graph-canvas.ts`).
- **Its inside is cleared**, for the stash's ring and the uncommitted row's, by filling it with
  `destination-out` before the ring is stroked, so the background shows there. A ring's own line is laid out to
  its centre, as every vertex's is, and was seen in the reference starting at the ring's bottom; clearing the
  inside is what makes it start there without a new kind of segment. A line of another lane passes a row's centre
  height at least half a lane, 7 pixels, away, and the ring's radius is half of that.
- **The uncommitted row's ring and line are grey**, `#808080`, a mid grey chosen as the lane colours are to read on
  both backgrounds (`UNCOMMITTED_GREY` of `src/ui/palette.ts`). Until this slice its ring was lane 0's blue.
- **The label** is a box of two parts before the message: a 15-pixel square of the stash's lane colour holding an
  inbox tray outline in white, then `stash@{n}` on dark grey inside a thin grey outline with rounded corners
  (`labelElement` of `src/ui/row-element.ts`, `.ref--stash` of `src/ui/renderer.css`). A stash's label comes first
  in the column. The message after it is the stash's subject as git stores it, at full brightness.
- **Lane colour or a fixed stash colour.** Both stashes the reference was observed with sat on lines of the same
  colour, so whether its square takes the lane's colour or a fixed colour for stashes could not be told apart. This
  slice takes the lane's colour, as the task asks.
- **The grey of the label** was seen in a dark theme only, and is the same in both themes here.
- **The inbox tray** is drawn for this project in `src/ui/inbox-icon.ts`, as two strokes on a 16-unit grid: a
  tray with sloping sides and the dip in its rim. No icon set and no file of the reference extension was opened
  to make it, so no third-party licence applies.

## A stash's details

`readGitDetails` reads a stash as any commit: its files are its changes against its first parent, which is the
commit it was made on. When the commit read has exactly three parents, it asks the stash list whether the commit
is a stash, and only a stash's third parent, its untracked files' commit, is read; its files follow the stash's
own with the status `untracked` (`thirdParentOf`, `isStashCommit` and `withUntrackedFiles` of
`src/core/parse/stash-list.ts`). That commit has no parent, so git lists its files as added against the empty
tree, and their line counts are kept. Measured by git's own trace on 2026-11-08 (`git-stash-details.spec.ts`): an
ordinary commit and a stash without untracked files cost one git process, as before; `stash@{0}` costs four,
`log`, `stash`, a `log` that `git stash list` starts itself, and `log`; a merge of three branches in a repository
with no stash costs two, because there `git stash list` starts no `log`. No channel and no contract shape changed
for this.

## Contract changes

- `RowFlag.UncommittedAbove`, 64, and `UNCOMMITTED_COLOUR`, 255, in `src/contracts/layout.ts`, with
  `ClipAboveVertex`'s definition and the invariants on row 0 and on the painter amended. The shapes snapshot is
  recorded again.
- No other shape changed. `RefKind.Stash`'s reference points at the stash's own row, which `Refs` did not specify
  before. `CommitDetails` and every channel are unchanged.

## The fixture

`stashes` in `test/fixtures/specification.json` is a scripted repository. A `fast-import` stream writes `main`'s
*commit 1* and *move main on*, the commit *on gone* that no branch reaches, and each stash's commits as
`git stash` makes them; `git stash store` puts the two stashes in the list, and a restored file leaves the
uncommitted change. They are written rather than made with `git stash push` because a step of a script reads no
clock (`scripted` of `test/fixtures/generate.ts`), and each commit needs a second of its own for the rows to fall by
date as observed; the first version of this fixture was a shape in `generate.ts` that made them with `git stash
push`, and it took that file to 319 lines, past the lint's 300. `git stash store` refuses a commit not shaped like
a stash (git 2.51.0, on a scratch repository), and took these. No existing fixture changed.

## No commit before its children (scope 10)

**Measured, before the change.** On a scratch repository, `main one`, then `main two` on `main`, then its child
`on gone` on a branch `gone`, the last two with the same `GIT_COMMITTER_DATE`: git 2.51.0's
`log refs/heads/main refs/heads/gone` listed `main two`, `on gone`, `main one`, with `--date-order` and with
`--topo-order` `on gone` first. The page this slice's code read under the selection `main` + `gone`, laid out as the
utility process lays it out, was row 0 `main two` in lane 0, row 1 `on gone` in lane 1 with `ClipAboveVertex` and
its one parent naming row 0, above it, so no line was drawn from it at all, and row 2 `main one`. **The layout drew
it wrongly**: `on gone` a lone dot, joined to nothing. On every branch the same repository happened to list
`on gone` first.

**The choice: `--date-order`.** Git documents `--date-order` and `--topo-order` as showing no parent before all its
children. `--date-order` otherwise keeps the commit-time order the page always had, which is also the order the
stash rows are put in by, so it moves a commit only where the old order put it above a child. `--topo-order` would
regroup the whole history by line of descent, which changes the layout of ordinary commits everywhere.

**The reference extension's setting.** Its Marketplace page's settings list names an *Order* setting under
Repository > Commits, "the order of commits on the Git Graph View", and refers to `git log` for each option; the
page states neither the values nor the default (read 2026-11-08), and its Changelog tab gave no text to the fetch.
So the reference's default was not established from what `AGENTS.md` §1 allows, and this choice does not rest on
it.

**The cost.** Without a commit-graph file, git has to walk more of the history before it can print the first
commit in either order. Measured on 2026-11-08 with fifteen runs each of the page's first-page log (`--max-count=301`,
every branch) on a machine at 100 % load from other work, so the numbers say only which is dearer: `large`, ten
thousand commits, median 241 ms without and 353 ms with `--date-order`; `remotes`, median 219 ms and 270 ms. The
perf and budgets gates decide whether that is acceptable; their readings are under *Gates*.

**Held** by `src/adapters/git-order.spec.ts`, which makes the tie certain with one `GIT_COMMITTER_DATE` and reads the
page on every branch and under the selection of both branches; removing the option turns it red (the audit has the
probe).

## What was seen

**How.** The built application (`npm run build`) was launched on 2026-11-08 with this project's end-to-end
launcher, `withBudgeted` of `test/e2e/support/budgets.ts`, from a scratch spec kept outside the commits, on the
`stashes` fixture at device pixel ratio 1 in software (`--disable-gpu`) and at ratio 4
(`--force-device-scale-factor=4`), and on `remotes` and `dirty-working-tree`, both dirty, at ratio 4. The window and
the graph column were captured and looked at enlarged, and at ratio 1 the canvas's alpha was read back over the
first three rows pixel by pixel. The images are in the executor's scratch folder, and none is in the repository.
Against the reference behaviour's six items:

1. **Stash rows.** On `stashes` the rows ran *Uncommitted changes (1)*, `stash@{0}`, *move main on* (with `main`),
   `stash@{1}`, *on gone*, *commit 1*: each stash its own row, at its date among the commits. No row and no line
   was the index or untracked-files commit of either stash.
2. **The dot.** Each stash's vertex was a red ring, lane 1's colour, about a commit dot's size, with the
   background inside it and a small red disc at its centre; in the alpha reading the ring and the disc were
   separated by a transparent pixel on each side. Nothing else marked the rows in the graph.
3. **The line.** `stash@{0}`'s line left its ring downwards and curved in the gap below into the blue dot of
   *move main on* in lane 0; nothing was drawn above either ring (transparent pixels above the ring in the
   reading).
4. **The deleted branch's stash.** `stash@{1}`'s line ran straight down lane 1 into *on gone*'s red dot, a plain
   commit row with no label and its own message, and from *on gone* the line curved in the next gap into
   *commit 1*'s dot in lane 0.
5. **The label.** Each stash row's Description began with a red square holding a white inbox tray, then
   `stash@{0}` or `stash@{1}` on dark grey inside a grey outline with rounded corners, then the message
   *On main: stash with an untracked file* or *On gone: stash on a deleted branch*, at full brightness. The
   message was cut with an ellipsis at the column's width, as every subject is.
6. **The uncommitted row.** On all three repositories its dot was a hollow grey ring with nothing inside it, in
   lane 0, and a grey line ran straight down lane 0 into HEAD's dot: past `stash@{0}` on `stashes`, and into the
   first commit's dot on `remotes` and `dirty-working-tree`, where review round 06 had seen it stop short. HEAD's
   own line below its dot was in lane 0's blue. On `remotes` the tips no row above joins, `feature` and
   `origin/only-remote`, each started at its dot with nothing above it.

`test/e2e/stash-rows.spec.ts` holds what of this only the window shows, by the DOM and by canvas pixels chosen from
the ratio-1 reading.

## Size

`repository.cjs` measured 37475 production bytes at `4bdd677` against 34567 at the base `be5f305`, over its budget of
35840, and its budget was reset once by the margin rule to 38912 (`comment-e04-m01-s14` of
`scripts/gates/size-budget.json` has the measurement); `src/core/parse/stash-list.ts` (1466 bytes) and
`src/ui/inbox-icon.ts` (462) were added to the module manifest. At `bc29a91` the gate read `repository.cjs` 37449
and `renderer.js` 20995, inside 38912 and 21504.

## Gates

**The full tier, `npm run gates`,** exited 0 at `bc29a91` on 2026-11-09, 06:18 to 07:11 local: 560 unit and 226
fixture-suite tests, 75 end-to-end cases, and a mutation run of 2090 mutants with 2053 killed by a failing
assertion, 35 by a timeout and the 2 listed survivors left. The perf gate's layout readings were at their
baselines: 18.747 units of layout work a row against 18.747, and 3.965 against 3.966 for 40000 rows over 10000.
Two earlier runs are in the audit: one at `4bdd677` red at the mutation gate, and one green at `d273dd5`.

**The budgets, `npm run gates:budgets`,** were read case by case at `bc29a91` on 2026-11-09, each read only when
the machine was free by `AGENTS.md` §11's measure: the reading ran inside a job object, so its own processor time
was counted with every process it started, exited ones included; the rest of the load was the processors' total
less that, sampled about every two seconds, and a reading was kept only when it averaged under 40 % with no sample
over 75 % and the minute before it averaged under 40 %. Every kept reading was green:

| case | kept reading | others' load, mean and max |
| --- | --- | --- |
| parse, layout and store benchmarks | 14.492 µs a commit parsed, 0.572 µs laid out, 44.354 ms for ten thousand stored | 14.7 %, 67 % |
| frames while scrolling | mean 4.881 ms, fifth-slowest 5.959 ms, longest 7.2 ms; reference 95th percentile 3.2 ms | 8 %, 20 % |
| cold start, empty repository | 966 ms, fastest of ten | 30.8 %, 62 % |
| cold start, first page of ten thousand commits | 1018 ms, fastest of ten, against a baseline of 1040 | 27 %, 64 % |
| ten thousand commits, one load | 372.7 ms, fastest of ten | 25.6 %, 73 % |
| the main process answering during a large load | 2643 round trips, worst 2 ms | 24.7 %, 38 % |
| fifty thousand commits: memory and idle | 160555008 private bytes; 1.003 after five idle minutes; 0.094 % of a core idle; 0 bytes after closing | 18.8 %, 73 % |

The first page's cold start is the reading `--date-order` could have moved, and it read 1018 ms. The readings
discarded on the way, at `d273dd5` and at `bc29a91`, are in the audit with their loads.
