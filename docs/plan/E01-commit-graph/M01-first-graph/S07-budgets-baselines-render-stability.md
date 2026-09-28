# E01-M01-S07 · Budgets, baselines and render stability

What a reader of the code needs to know about the slice that measured the assembled application against the
ten budgets of `docs/ADR-0002-architecture-and-performance.md` decision 6: what each budget measured, how, and
whether the application meets it; where each baseline lives and which gate reads it; how a run is held
strictly on the development machine and widely on a CI runner; what the size budgets calibrated to; and the
answer to the golden-image question of `docs/ADR-0003-quality-gates-and-ci.md` decision 5.

## The machine, and the condition it was in

Every figure below was measured by this slice's executor on **2026-09-28**, on the development machine: an
Intel Core i5-10310U (four cores, eight threads, 1.7 GHz base), 16 GB of memory, Intel UHD Graphics, Windows 11
Pro 10.0.26200, a display running at 60 Hz with a device pixel ratio of 1. Node 24.18.0 ran the gates; the
application ran on Electron 44.3.0, which is Chromium 152 and Node 24.20. **Load condition:** no other build,
gate or test was running during any measurement, and each run of the end-to-end suites started exactly one
application at a time; the owner's desktop session was otherwise as it was left, which this lane did not
control and did not measure.

## The ten budgets, measured

| budget | limit | measured | runs, range | verdict |
| --- | --- | --- | --- | --- |
| Cold start to a painted window, empty repository | ≤ 1500 ms | median **1068 ms** | five launches, 994 to 1156 | meets |
| Load 10 000 commits, to rows painted | ≤ 800 ms | median **437.7 ms** | five loads, 416 to 476 | meets |
| Parse throughput, streamed log | ≥ 20 000 / s, held as ≤ 50 µs a commit | **14.579 µs** a commit, 68 600 / s | fastest of five in each of six sessions: 14.468 to 15.768 µs | meets |
| Lane layout throughput | ≥ 200 000 / s, held as ≤ 5 µs a commit | **0.59 µs** a commit, 1.69 million / s | fastest of five in each of six sessions: 0.570 to 0.590 µs | meets |
| Structural memory per loaded commit | ≤ 96 bytes | 85.519 at the worst size | the committed baseline, re-run at the lane's base | meets |
| Resident memory, all processes, 50 000 commits | ≤ 400 MB | **467 034 112 bytes** (445.4 MiB) | five runs, 441.7 to 455.2 MiB | **does not meet** |
| Resident memory growth over 5 minutes idle | ≤ 2 % | **−6.9 %** (ratio 0.931) | five five-minute runs: 0.923 to 0.947 | meets |
| Main-thread work per frame while scrolling | ≤ 8 ms, no frame over 16.7 ms | mean **5.24 ms**, worst frame **7.7 ms** | five runs of 240 frames: means 5.13 to 5.34, worsts 7.3 to 8.1 | meets |
| Live DOM row elements | ≤ viewport rows + 2 × overscan | **37**, at 300 and at 10 000 commits | every run | meets, at the bound |
| CPU while idle, no timer wakeups | ≈ 0 % | **0.063 %** of one core; **0** wakeups in the page and the main process | five five-minute runs: 0.063 to 0.453 % | meets |

What each row measured and how follows. The memory and idle rows are five runs of one case, not five runs inside one, because each
reading takes five real minutes and the gate itself runs it once; that is said beside each.

### Cold start, empty repository

**What:** the time from the operating system creating the application's main process to the window painted
over a repository with no commits, named on the command line. **How:** `test/e2e/budgets-start.spec.ts`
makes the repository with `git init`, launches the built application with it five times, and reads the
process's creation time from Windows' own process table; the end is the first paint mark (below) showing that
repository's path in the bar and the empty table. **Runs:** 1033, 994, 1070, 1068 and 1156 ms. Measured from
the call to `electron.launch` instead, which also pays for Playwright's own connection, the same five read
1072 to 1191 ms.

Beside it, the case a person actually starts on — S06's first item — with the ten-thousand-commit fixture on
the command line and its first page of 300 painted: 1221, 1469, 1105, 969 and 988 ms, median 1105. That one
has no budget of its own, so it has a baseline and no ceiling.

### Ten thousand commits, one load, to rows painted

**What:** one read of git, one parse, one store, one layout of ten thousand rows from a fresh state, two
structured clones and one paint. **How it is one load without a product change:** an open reads 300 commits
and nothing on the bridge asks for more in one read, but a Refresh does — `src/app/repository-host.ts` reads
the open repository again at the size already loaded, into a fresh store, and lays out every row from a fresh
layout state. So the case grows the utility process's state to 10 000 commits with one Load More over the
bridge, **without drawing it**, and then presses Refresh. What that leaves out of a real first open is finding
git and starting the utility process, both paid once and both inside the cold-start figures. The clock runs
from the press to the first mark showing 10 000 rows, `commit 10000` at the top, ink on the canvas and the
control back at rest. **Runs:** 438, 452, 416, 417 and 476 ms.

S06 measured the nearest thing it had, a Load More of 9 700 over the bridge without the paint, at 822 to 954 ms
on 2026-09-19. The same round trip measured 481 ms here on 2026-09-28. This slice changed no product code, so
the difference is the machine or its condition on the two days; that is an inference, and neither day's
condition was measured.

### Parse and layout throughput

**How:** `perf/parse.perf.test.ts` reads the ten-thousand-commit fixture's log once from git, with the
adapter's own arguments, and times the parser feeding the store over it in 16 KiB chunks — smaller than any
chunk S03 saw arrive from the pipe, so it pays for more boundaries, not fewer. `perf/layout.perf.test.ts`
times `layoutPage` over 40 000 rows of a braided shape — for row *i*, a first parent at *i + 1 + r* with *r*
from 0 to 2, and every ninth row a second parent at *i + 1 + r* with *r* from 0 to 39, from a fixed
congruential sequence — implemented from S04's description, so its counters are this gate's own. Both take
the fastest of five runs after a warm-up.

**Both are held as time per commit, not commits per second.** A throughput is a lower bound and
`compareWithBaseline` fails a number that rises; 20 000 commits a second turned over is at most 50 µs a commit,
and 200 000 is at most 5 µs, so a slower parser raises the number exactly as every other regression in
`perf/baselines.json` does. Adding a second direction to the comparison was the alternative; it would have
been a new branch in the one function every gate trusts and a new way to read an entry the wrong way round.

Beside the time, two counters: **18.747 units of layout work a row** at 40 000 braided rows (18.746875 exactly),
and **3.965 times the work of 10 000 rows for 40 000** — about four, not sixteen. Both are identical on every
run and are held with no tolerance.

### Structural memory per commit

Not re-derived, as the task asked. `perf/store.perf.test.ts` ran unchanged at the lane's base and read
85.519, 79.828 and 76.416 bytes a commit at 12 502, 20 000 and 80 000 commits, each equal to its committed
baseline.

### Resident memory at 50 000 commits, and what closing gives back

**What:** the sum of the working sets of every process of the application with 50 000 commits loaded and
painted and ten seconds settled. **How:** `test/e2e/budgets-memory.spec.ts` opens a 50 000-commit fixture
built by the committed generator, loads all of it over the bridge, asks the main process for its own process
identifier, and reads every process descended from it out of Windows' process table: the main process, the
GPU process, the network service, the renderer and the utility process. The process Playwright spawns is a
`cmd.exe` shim above the main process and is not counted.

**It is over the budget.** Five readings on 2026-09-28 with nothing planted that changes memory — one while
this lane explored, the case's first run, a probe run whose only plant changed what happens after the window
closes, the full `npm run gates` run and the case's last run — were 441.7, 445.4, 442.0, 443.8 and 455.2
MiB, that is 463 to 477 MB against 400. The budget is left where
it is.

What the reading is, so that the finding is not misread in either direction: a working set counts a page
shared by several processes once for each, and Electron's own code is mapped into all five. The private bytes
of the same processes at the same moment were **201 416 704 bytes (192.1 MiB)**, which counts nothing twice
and misses what is shared; the memory the application really occupies lies between the two. And most of it is
not the commits: the same window with **no repository open**, four processes, read **312.7 MiB** of working
sets and 117.7 MiB private. So Electron with an empty window is already 328 MB of the 400. The utility process
with 50 000 commits held about 100 MiB of working set and 44 MiB private.

**After the window closed**, none of the five processes was still running, so nothing was still resident; the
utility process's memory went back to the operating system with the process, which is the claim S06 made and
had not tested. The window is closed the way a person closes it — every window of the main process closed,
then up to thirty seconds for the main process to exit — and not with Playwright's own `close`, which calls
`app.quit` itself and would measure Playwright's way of ending the application instead of
`window-all-closed` in `src/app/main.ts`. What is still running is found by matching each process's
identifier **and** creation time, so that an identifier reused by another program is not mistaken for a
survivor. With that handler's `app.quit()` removed, three of the five processes were still running thirty
seconds later, 227.8 MiB of them, and the gate failed.

### Five idle minutes after the load

Five real minutes, with the case's own timeout set to fit them. **Memory:** the working sets at the end were
0.931 of what they were at the start, down by 6.9 %, at 413.7 MiB; four more five-minute runs, none with a plant
that touched the idle window, read 0.947, 0.923, 0.939 and 0.933. The collections the load left behind finishing is the likely
cause, and that is an inference. **CPU:** the five processes used 187 ms of processor time in 300 s,
**0.063 % of one core**, read from Windows' per-process kernel and user times; the second run read 0.063 % as
well, the third **0.453 %**, the fourth 0.099 % and the fifth 0.156 %. Of the third run's time, 1 110 ms was
the main process alone, while the main-process count below saw no Node callback at all in that run, so the
time went to something in Chromium's side of the main process that this gate cannot name. **Wakeups:** none. In the page,
the init scripts count every callback of `setTimeout`, `setInterval`, `requestAnimationFrame` and
`requestIdleCallback`, wrapped before `renderer.js` runs, and none ran; nor did the canvas redraw. In the main
process an `async_hooks` hook counts every callback Node runs — a timer, an immediate, a socket, a message —
and none ran either, once the two reads of the count itself are subtracted. That held in all five runs.

What these cannot see is work Chromium schedules for itself outside JavaScript, such as a garbage collection
or a compositor task, and the utility process, where nothing of the gate's can run; the processor times cover
both.

"≈ 0 %" is not a number, so the gate needs one. It holds the figure to **0.5 % of one core** — below it, the
figure rounds to zero per cent — and the wakeups to exactly zero. Its tolerance is 8, which puts the baseline's
own limit at 0.504, just above the ceiling, so that the strict limit is the ceiling: the five runs show the
figure moving by seven times between runs of an unchanged product, and a tolerance sized to 0.063 would fail
the third. **The third run's 0.453 % is close enough to 0.5 that this gate may flap**, and a flapping gate is
a defect of the gate; it is raised with the owner rather than widened here.

### Main-thread work per frame while scrolling

**How:** `sampleScrollFrames` in `test/e2e/support/budgets-page.ts` scrolls the list once a frame from the first
animation-frame callback of each rendering update, and posts a message from it; a message is a task, and no
task runs until the update — the renderer's `paint`, then style, layout, paint and the hand-over to the
compositor — has finished, so the message's arrival is the end of the frame's main-thread work. Each timed
frame therefore holds one scroll, one repaint of the rows and the canvas, and all the rendering between.
What it leaves out is the scroll listener, which only asks for a frame, and anything off the main thread.

Two scrolls of 240 frames, five runs each, over the ten-thousand-commit fixture: 72 pixels a frame read means
of 2.69 to 2.90 ms and worst frames of 5.1 to 7.3 ms; **1 200 pixels a frame**, more than the whole pool, so
that every frame rewrites every row element, read means of 5.13 to 5.34 ms and worst frames of 7.3 to 8.1 ms.
The budget is held on the second, the most a frame of this view can be asked to do, as the median of the five
runs' means and the median of their worst frames. The fixture is a straight chain, one lane wide; a braided
history draws more lines a row, and this reading does not include one.

### Live row elements

37 row elements with 300 commits loaded, and 37 with 10 000 loaded after scrolling to four offsets across the
whole list. The viewport of the 1280 × 800 window is 669 pixels high, which is 29 visible rows, and twice the
overscan of 4 makes the bound 37: the pool is exactly at its budget, which is what `rowPoolSize` in
`src/ui/geometry.ts` is written to produce. The ratio of the two counts is held at 1.

## The counters

Deterministic figures of `docs/ADR-0003-quality-gates-and-ci.md` decision 4, held with no tolerance unless one
is named:

| counter | baseline | how |
| --- | --- | --- |
| canvas redraws per scrolled frame | 1 | 120 redraws for 120 frames of a scripted scroll |
| canvas redraws for 25 scroll events in one task | 1 | the view's own coalescing, with the events dispatched |
| git processes to open a repository | 6 | `git --version` to find git, then rev-parse, log, for-each-ref, stash and status |
| git processes per Refresh | 5 | the same five |
| git processes per Load More | 5 | worst of five presses |
| commits read by the fifth Load More over the first | 3 | 1 800 over 600 |
| heap bytes allocated parsing a commit | 3 168.776, tolerance 1.001 | see *Allocation* |
| typed-array bytes allocated parsing a commit | 66.64 | the store's columns |
| heap bytes allocated laying out a row | 13.512, tolerance 1.01 | |
| typed-array bytes allocated laying out a row | 130.491 | the layout's output and segment buffer |

**Git processes are counted by git.** `GIT_TRACE2_EVENT`, set to a file in the application's environment,
makes every git process append a `start` event as it begins; `src/adapters/git-process.ts` passes the
environment on apart from the seven variables that redirect a repository, and the utility process inherits the
main process's, so nothing in the product is touched.

**The per-press cost of Load More, as a ratio.** S06's item 3. The utility process reads the whole page again
at every press, so the *n*th press parses and stores *n + 1* pages; each reply's `commits.count` says how many
it stored — 600, 900, 1 200, 1 500, 1 800 — and the fifth over the first is 3, which no machine can move. A
reader that could start at an offset would bring it to 1 and the gate would report that as an improvement to
commit. The five presses took 537 to 600 ms each on this run, flat, which agrees with S06's reading that the
fixed cost of a press dominates at these sizes.

### Allocation

**It could be measured deterministically, nearly.** Node has no allocation counter, and a collection inside a
measurement subtracts from the heap's growth. `perf/allocation.perf.test.ts` removes the collection rather than
estimating around it: it bundles the parse and the layout with esbuild into a child Node process started with
`--expose-gc`, `--predictable` and a 256 MiB young generation, collects before each run, and reads the heap's
growth across the third run — `--trace-gc` on the same program printed only the collections it asked for. Five
processes read the parse at 3 168.7272 to 3 168.776 heap bytes a commit and the layout at 13.4814 to 13.5118 a
row: a residue `--predictable` does not remove, which the two tolerances cover four times over while still
failing one more small object per unit. The typed-array figures were identical in all five.

**3 169 heap bytes a commit is worth a reader's attention.** The store keeps under 96 bytes a commit and the
parser allocates thirty-three times that on the way, most of it — an inference from the parser's code, not a
measurement — the strings it decodes for every name, e-mail and subject before the store interns them. No
budget covers it; the baseline now does, so it cannot grow unseen.

What allocation this does not see is the renderer's: the switches are not the gate's to set inside Chromium, so
the frame budget is what holds that path.

## Where each baseline lives, and what reads it

Every figure above is an entry of `perf/baselines.json`, in the shape the file already had — `baseline`, an
optional `ceiling`, an optional `tolerance`, a `unit` that says what was measured and how — plus one new
optional field, `ciTolerance` (next section). Every ceiling is decision 6's budget, unchanged; every baseline
is what was measured on 2026-09-28, not a round target.

| gate | files | entries | the line that reaches `compareWithBaseline` |
| --- | --- | --- | --- |
| `gates:perf` | `perf/parse.perf.test.ts` | `parseMicrosecondsPerCommit` | its `compareInRegime` call |
| `gates:perf` | `perf/layout.perf.test.ts` | `layoutMicrosecondsPerCommit`, `layoutWorkPerRow`, `layoutScalingRatio` | `compareInRegime` in its `held` |
| `gates:perf` | `perf/allocation.perf.test.ts` | the four allocation entries | `compareInRegime` in its `held` |
| `gates:e2e` | `test/e2e/budgets-start.spec.ts`, `budgets-frames.spec.ts`, `budgets-git.spec.ts`, `budgets-memory.spec.ts` | every other new entry | `compareInRegime` in `holdToBaseline`, `test/e2e/support/budgets.ts` |

`compareInRegime`, in `perf/baselines.ts`, applies the regime's limits and calls `compareWithBaseline`, which is
unchanged. Every case asserts on the verdict it gets back, and a case that holds several budgets makes every
comparison before it asserts, so one red budget does not hide another's verdict.

## Two regimes: strict here, wide in CI

`docs/ADR-0003-quality-gates-and-ci.md` decision 4 checks the wall-clock budgets strictly on the development
machine and with a wide tolerance in CI, so that only an order-of-magnitude regression fails there.

**How a run knows.** `regimeOf` reads the `CI` variable, which GitHub Actions sets to `true` in every job and
nothing on the development machine sets; empty, `0` or `false` is the strict regime. It is the runner declaring
itself, so nothing in the workflow file has to pass a flag, and the failure it can have is one-sided: a runner
that did not set it would be held strictly and go red, which is seen. Every verdict is printed with the regime
it was held to.

**How wide.** An entry with a `ciTolerance` has every limit multiplied by it in CI — the ceiling and the
baseline's own tolerance — and nothing removed. Every wall-clock entry carries a tolerance of 1.5, applied to a
median of five or to the fastest of five, never to one run; the widest spread of single runs any of them
showed here was the cold start with a repository, 969 to 1469 ms, and its median sat at 1105. Each also
carries a `ciTolerance` of 4, so that in CI a
figure may be six times its baseline, or four times its budget, whichever is less. Six because it has to be
**under ten**, or a regression of an order of magnitude would pass on the runner, with room for a fast run to
still fail at ten; and as far above one as that allows, because the runner is a different machine: no run of
either job has happened (the task file records that `origin` carries only the scaffold commit, checked
2026-09-28; this lane touched no remote and did not check it), the runner has no
GPU, so its frames are drawn in software, and it builds its fixtures cold. That the runner is less than about
three times slower than this machine is an inference, and the first CI run is where it is tested.

The idle processor figure carries a tolerance of 4 and a `ciTolerance` of 4, because it is a time too; the
memory figures carry a tolerance and no `ciTolerance`, because the budget is about the product and not about
the machine.

**Shown failing, both ways.** A regression planted at about ten times the measured cost — a busy-wait at the
start of the renderer, in the utility process's Refresh, in the renderer's `paint`, in the parser and in the
layout pass, which read 7.2 to 10.8 times each figure's baseline — failed every wall-clock gate in both
regimes. A regression planted at about three times — 2.7 to 3.1 times — failed every one in the strict regime
and passed every one in the CI regime. Removing the plants turned every one green in both.

## The size budgets, calibrated

`npm run gates:size` weighed the production build on 2026-09-28, at the lane's base and again at its head:
renderer.js 10 942 bytes, renderer.css 4 280, main.cjs 3 969, repository.cjs 27 367. The margin rule
`scripts/gates/size-budget.json` states — measured plus one kibibyte, rounded up to the next whole kibibyte —
gives 12 288, 6 144, 5 120 and 28 672: each budget's existing number. **No budget moved**, the total moved by the
sum of the movements, which is zero, and stays 54 272, and the "initial" label is gone from all four; the file's
new `comment-e01-m01-s07` records the measurement.

One build change would lower one of them, and was not made: renderer.css is copied rather than minified, so its
comments ship. Without them it is 3 588 bytes, and the rule would give it 5 120, a kibibyte under today's
budget. That is a change to `scripts/build.js`, which this slice could not touch.

## The golden-image question: settled, yes

**Byte-stable on this machine.** Two fixtures — `branch-and-merge`, which has a merge and a second lane, and the
ten-thousand-commit chain — were each opened in five separate launches of the built application at the
application's own 1280 × 800, and the graph canvas was read back with `getImageData` and the window captured by
Playwright's screenshot. With the GPU: the canvas was 64 × 669 pixels, and its bytes, and the screenshot's
bytes, were identical in all five launches of each fixture. With `--disable-gpu`, the same: identical in all
five, with different bytes from the GPU's, as expected of a different rasteriser. Nothing differed within a mode.

**So there is a golden image.** `test/e2e/golden-graph.spec.ts` opens `branch-and-merge` with `--disable-gpu`,
sets the window's content to 960 × 600, and compares the canvas's unpremultiplied RGBA, byte for byte, with
`test/e2e/golden/graph-branch-and-merge.rgba.deflate`, which `.gitattributes` marks binary. It passed five runs
of five after the image was recorded. A mismatch writes what was drawn under `test-results/golden/`.

**What it will do on `windows-latest`, as an inference.** Software rendering is chosen because the runner has no
GPU and will rasterise in software whatever the switch says, and the window is set smaller than the
application's own size because the runner's screen may be smaller than 1280 × 800. With both of those equal,
the image depends on Skia's software rasteriser drawing the same pixels from the same commands on two x86-64
processors. It selects its vector code by the processor's features at run time, so a runner with a different
instruction set may round an anti-aliased edge by one step differently. I expect it to hold, and do not know
that it will; the case is not skipped or weakened anywhere, so if it does not hold, the first CI run says so,
and the repair is the owner's choice between a per-platform image and a tolerance.

## How each reading could be wrong, and how that was checked

- **A "painted" mark earlier than the paint.** A mark is taken in the second of two nested animation-frame
  callbacks asked for after each batch of changes, which cannot run until a rendering update after the change
  has painted. Recording both callbacks' frame times showed the gap from the change at between 1.6 and 34 ms;
  and every cold start holds its first mark to be no earlier than Chromium's own `paintTime` for the first
  contentful paint, which it was in every run, with the frame reaching the screen 50 to 92 ms after that paint.
  The mark is therefore after the main thread painted and may be before the compositor presented, by up to
  about one frame once the window is showing.
- **A probe installed too late.** Each init script records whether the renderer's view already existed; every
  launch requires all five to say no.
- **A memory reading that misses a process.** The tree is read from the operating system, rooted at the pid the
  main process reports, and must hold at least four processes; it held five in every run.
- **An idle window whose wakeups the count cannot see.** Chromium's own work and the utility process are out of
  the counters' reach; the processor times of all five processes are what cover them.
- **A ceiling nobody can reach.** Every gate was watched failing on a planted regression (above), and the
  resident-memory gate fails without one.

## What is not here

- **The resident-memory budget is not met**, and the gate that holds it is red. The budget stays at 400 MB. What
  the application should do about it — or whether decision 6 means the sum of working sets, which is what
  "resident" and "all processes" say — is the owner's to decide, and it is not this slice's.
- **Shipping renderer.css without its comments**, which would lower its budget by a kibibyte, is a build change
  for a later task.
- **A braided history in the frame and memory readings.** The fixtures are a straight chain; the committed
  generator has no large braided shape, and `test/e2e/support/fixtures.ts` was outside this boundary.
- **The renderer's allocation**, which this slice could not count deterministically inside Chromium.
